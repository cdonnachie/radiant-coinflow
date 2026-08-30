/**
 * ElectrumX chain backend.
 *
 * Answers the Bitcore-style index RPCs using an ElectrumX server, so the app
 * can run against the existing Radiant ElectrumX infrastructure while the
 * native radiantd address/spent index is still in development.
 *
 * Method mapping:
 *   getrawtransaction  → blockchain.transaction.get (verbose; height derived
 *                        from confirmations since daemons omit it)
 *   getaddressutxos    → blockchain.scripthash.listunspent
 *   getaddresstxids    → blockchain.scripthash.get_history
 *   getaddressbalance  → blockchain.scripthash.get_balance
 *   getblockchaininfo  → blockchain.headers.subscribe (tip header)
 *   getspentinfo       → EMULATED: if the outpoint is absent from
 *                        listunspent, scan the script's history from the
 *                        funding height forward until the transaction whose
 *                        input spends it is found. Throws "Unable to get
 *                        spent info" for unspent outputs, matching the
 *                        Bitcore RPC behaviour the client relies on.
 */

import { ElectrumClient } from '../electrum/ElectrumClient';
import { addressToScripthash, scriptHexToScripthash } from '../electrum/scripthash';
import { wireIntToBigInt } from '../jsonBigInt';
import { enrichVoutValues } from '../txvalues';
import { BackendRpcError, ChainBackend } from './ChainBackend';

interface HistoryEntry {
    tx_hash: string;
    height: number; // <= 0 for mempool
}

interface UnspentEntry {
    tx_hash: string;
    tx_pos: number;
    /** Photons — bigint when the exact value exceeds 2^53 (see jsonBigInt). */
    value: number | bigint;
    height: number;
}

interface VerboseTx {
    txid: string;
    hex?: string;
    height?: number;
    confirmations?: number;
    vin: Array<{ txid?: string; vout?: number; coinbase?: string }>;
    vout: Array<{ n: number; value: number; valueSat?: unknown; scriptPubKey?: { hex?: string } }>;
}

// How many candidate spending transactions to inspect before giving up.
// Filtering by funding height keeps this small in practice; the cap protects
// against pathological hot-wallet addresses with enormous histories.
const MAX_SPEND_SCAN = 400;
const SPEND_SCAN_BATCH = 10;
const TX_CACHE_MAX = 8000;
const SPENT_CACHE_MAX = 20000;

export class ElectrumBackend implements ChainBackend {
    private txCache: Map<string, VerboseTx> = new Map();
    private spentCache: Map<string, { txid: string; index: number; height?: number }> = new Map();

    constructor(private readonly client: ElectrumClient) {}

    describe(): string {
        return `electrumx at ${this.client.describe()}`;
    }

    async call(method: string, params: unknown[]): Promise<unknown> {
        switch (method) {
            case 'getrawtransaction':
                return this.getRawTransaction(String(params[0]));
            case 'getspentinfo':
                return this.getSpentInfo(params[0] as { txid: string; index: number });
            case 'getaddresstxids':
                return this.getAddressTxids(this.extractAddresses(params[0]));
            case 'getaddressutxos':
                return this.getAddressUtxos(this.extractAddresses(params[0]));
            case 'getaddressbalance':
                return this.getAddressBalance(this.extractAddresses(params[0]));
            case 'getblockcount':
                return (await this.client.getTip()).height;
            case 'getbestblockhash':
                // Not derivable from the electrum protocol without hashing the
                // header with Radiant's PoW hash; the app tolerates ''.
                return '';
            case 'getblockchaininfo':
                return this.getBlockchainInfo();
            default:
                throw new BackendRpcError(`Method not supported by electrumx backend: ${method}`);
        }
    }

    private extractAddresses(param: unknown): string[] {
        const addresses = (param as { addresses?: unknown })?.addresses;
        if (!Array.isArray(addresses) || addresses.length === 0) {
            throw new BackendRpcError('Expected {"addresses": [...]}');
        }
        return addresses.map(String);
    }

    // ------------------------------------------------------------------
    // Transactions
    // ------------------------------------------------------------------

    private async getRawTransaction(txid: string): Promise<VerboseTx> {
        const cached = this.txCache.get(txid);
        if (cached) return cached;

        let tx: VerboseTx;
        try {
            tx = await this.client.request<VerboseTx>('blockchain.transaction.get', [txid, true]);
        } catch (error) {
            throw new BackendRpcError(
                `transaction.get failed for ${txid}: ${error instanceof Error ? error.message : error}`,
            );
        }

        // Daemons omit height from verbose output; derive it from confirmations.
        if (tx.height === undefined && typeof tx.confirmations === 'number' && tx.confirmations > 0) {
            const tip = await this.client.getTip();
            tx.height = tip.height - tx.confirmations + 1;
        }

        // Attach exact valueSat strings parsed from the raw hex — the JSON
        // decimal `value` fields lose precision above 2^53 photons.
        enrichVoutValues(tx);

        // Only confirmed transactions are effectively immutable; cache those.
        if ((tx.confirmations ?? 0) > 0) {
            if (this.txCache.size >= TX_CACHE_MAX) {
                const oldest = this.txCache.keys().next().value;
                if (oldest !== undefined) this.txCache.delete(oldest);
            }
            this.txCache.set(txid, tx);
        }
        return tx;
    }

    // ------------------------------------------------------------------
    // Spent-info emulation
    // ------------------------------------------------------------------

    private async getSpentInfo(outpoint: { txid: string; index: number }): Promise<unknown> {
        const { txid, index } = outpoint ?? {};
        if (typeof txid !== 'string' || typeof index !== 'number') {
            throw new BackendRpcError('Expected {"txid": ..., "index": ...}');
        }

        const cacheKey = `${txid}:${index}`;
        const cached = this.spentCache.get(cacheKey);
        if (cached) return cached;

        const fundingTx = await this.getRawTransaction(txid);
        const output = fundingTx.vout?.[index];
        if (!output) {
            throw new BackendRpcError(`Output ${txid}:${index} not found`);
        }
        const scriptHex = output.scriptPubKey?.hex;
        if (!scriptHex) {
            throw new BackendRpcError(`Output ${txid}:${index} has no scriptPubKey`);
        }

        const scripthash = scriptHexToScripthash(scriptHex);

        // Fast path: if the outpoint is still in the unspent set, it has no spender.
        const unspent = await this.client.request<UnspentEntry[]>(
            'blockchain.scripthash.listunspent', [scripthash],
        );
        if (unspent.some((u) => u.tx_hash === txid && u.tx_pos === index)) {
            throw new BackendRpcError('Unable to get spent info', -5);
        }

        // The output is spent — walk the script's history from the funding
        // height forward to find the transaction that consumed it.
        const history = await this.client.request<HistoryEntry[]>(
            'blockchain.scripthash.get_history', [scripthash],
        );

        const fundingHeight =
            history.find((h) => h.tx_hash === txid)?.height ?? fundingTx.height ?? 0;

        let candidates = history.filter(
            (h) => h.tx_hash !== txid && (h.height <= 0 || h.height >= fundingHeight),
        );
        if (fundingHeight <= 0) {
            // Unconfirmed funding tx can only be spent by another mempool tx.
            candidates = candidates.filter((h) => h.height <= 0);
        }
        // Confirmed ascending (spender is usually shortly after funding), mempool last.
        candidates.sort((a, b) => {
            const ah = a.height <= 0 ? Number.MAX_SAFE_INTEGER : a.height;
            const bh = b.height <= 0 ? Number.MAX_SAFE_INTEGER : b.height;
            return ah - bh;
        });

        const scanned = candidates.slice(0, MAX_SPEND_SCAN);
        for (let i = 0; i < scanned.length; i += SPEND_SCAN_BATCH) {
            const batch = scanned.slice(i, i + SPEND_SCAN_BATCH);
            const txs = await Promise.all(
                batch.map(async (entry) => ({
                    entry,
                    tx: await this.getRawTransaction(entry.tx_hash).catch(() => null),
                })),
            );
            for (const { entry, tx } of txs) {
                if (!tx) continue;
                const vinIndex = (tx.vin ?? []).findIndex(
                    (v) => v.txid === txid && v.vout === index,
                );
                if (vinIndex !== -1) {
                    const result = {
                        txid: entry.tx_hash,
                        index: vinIndex,
                        height: entry.height > 0 ? entry.height : undefined,
                    };
                    if (this.spentCache.size >= SPENT_CACHE_MAX) {
                        const oldest = this.spentCache.keys().next().value;
                        if (oldest !== undefined) this.spentCache.delete(oldest);
                    }
                    this.spentCache.set(cacheKey, result);
                    return result;
                }
            }
        }

        if (candidates.length > MAX_SPEND_SCAN) {
            // The output IS spent (absent from listunspent) but the spender sits
            // beyond the scan cap. Surface a distinct error; the client treats
            // any getspentinfo failure as "unspent", which ends that trace branch.
            console.warn(
                `[electrum-backend] spend scan limit (${MAX_SPEND_SCAN}) hit for ${cacheKey}; ` +
                `history size ${history.length}`,
            );
            throw new BackendRpcError(`Spent-lookup scan limit reached for ${cacheKey}`);
        }

        // Absent from the UTXO set yet no spender found in a full history scan —
        // can happen briefly around reorgs/mempool churn. Report as unspent.
        throw new BackendRpcError('Unable to get spent info', -5);
    }

    // ------------------------------------------------------------------
    // Address queries
    // ------------------------------------------------------------------

    private async getAddressTxids(addresses: string[]): Promise<string[]> {
        const entries: HistoryEntry[] = [];
        for (const address of addresses) {
            const scripthash = addressToScripthash(address);
            const history = await this.client.request<HistoryEntry[]>(
                'blockchain.scripthash.get_history', [scripthash],
            );
            entries.push(...history);
        }
        // Match Bitcore ordering: oldest first, mempool entries last.
        entries.sort((a, b) => {
            const ah = a.height <= 0 ? Number.MAX_SAFE_INTEGER : a.height;
            const bh = b.height <= 0 ? Number.MAX_SAFE_INTEGER : b.height;
            return ah - bh;
        });
        const seen = new Set<string>();
        const txids: string[] = [];
        for (const entry of entries) {
            if (seen.has(entry.tx_hash)) continue;
            seen.add(entry.tx_hash);
            txids.push(entry.tx_hash);
        }
        return txids;
    }

    private async getAddressUtxos(addresses: string[]): Promise<unknown[]> {
        const utxos: unknown[] = [];
        for (const address of addresses) {
            const scripthash = addressToScripthash(address);
            const unspent = await this.client.request<UnspentEntry[]>(
                'blockchain.scripthash.listunspent', [scripthash],
            );
            for (const u of unspent) {
                utxos.push({
                    address,
                    txid: u.tx_hash,
                    outputIndex: u.tx_pos,
                    // bigints serialize as exact decimal strings at the route boundary
                    satoshis: u.value,
                    height: u.height > 0 ? u.height : 0,
                });
            }
        }
        return utxos;
    }

    private async getAddressBalance(addresses: string[]): Promise<unknown> {
        let balance = 0n;
        for (const address of addresses) {
            const scripthash = addressToScripthash(address);
            const result = await this.client.request<{
                confirmed: number | bigint;
                unconfirmed: number | bigint;
            }>('blockchain.scripthash.get_balance', [scripthash]);
            balance += wireIntToBigInt(result.confirmed ?? 0) + wireIntToBigInt(result.unconfirmed ?? 0);
        }
        // "received" (lifetime total) isn't available from electrum without a
        // full history walk; the app doesn't consume it.
        return { balance, received: 0 };
    }

    // ------------------------------------------------------------------
    // Chain info
    // ------------------------------------------------------------------

    private async getBlockchainInfo(): Promise<unknown> {
        const tip = await this.client.getTip();
        return {
            blocks: tip.height,
            bestblockhash: '',
            difficulty: difficultyFromHeader(tip.hex),
        };
    }
}

/** Derives difficulty from the nBits field of an 80-byte header (hex). */
function difficultyFromHeader(headerHex: string): number {
    if (!headerHex || headerHex.length < 160) return 0;
    // nBits: 4 little-endian bytes at offset 72 (after version, prev, merkle, time)
    const bitsLe = headerHex.slice(144, 152);
    const bits = parseInt(
        bitsLe.match(/../g)!.reverse().join(''),
        16,
    );
    if (!Number.isFinite(bits) || bits === 0) return 0;
    const exponent = bits >>> 24;
    const mantissa = bits & 0xffffff;
    if (mantissa === 0) return 0;
    const target = mantissa * Math.pow(256, exponent - 3);
    const diff1 = 0xffff * Math.pow(256, 0x1d - 3);
    return diff1 / target;
}
