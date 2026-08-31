/**
 * RXinDexer REST chain backend.
 *
 * Answers the Bitcore-style index RPCs from the Radiant node's RXinDexer REST
 * API. Its decisive advantage over the ElectrumX backend is paginated address
 * history with no "history too large" ceiling, so busy exchange/pool wallets
 * that ElectrumX refuses can be traced and clustered.
 *
 * The REST API exposes address history and full transactions but no UTXO or
 * balance endpoint. Both are reconstructed from history: an address's own
 * history contains every transaction that creates one of its outputs AND
 * every transaction that spends one, so the unspent set is (outputs created)
 * minus (outputs spent) over that history — computed with no extra source.
 *
 * Endpoints used (all unauthenticated):
 *   GET /transaction/{txid}                     verbose tx (no height field)
 *   GET /addresses/{ident}/history?limit=&offset=   newest-first, limit<=200
 *   GET /status                                 sync_height = chain tip
 */

import { enrichScriptMetadata } from '../scriptmeta';
import { enrichVoutValues } from '../txvalues';
import { BackendRpcError, ChainBackend } from './ChainBackend';

const HISTORY_PAGE = 200; // API maximum
// Bound per-request work on pathological histories (env-overridable).
const MAX_SPEND_SCAN = Number(process.env.RADIANT_SPEND_SCAN_LIMIT ?? 2500);
const MAX_UTXO_SCAN = Number(process.env.RADIANT_REST_UTXO_SCAN ?? 5000);
const TX_CACHE_MAX = 8000;
const SPENT_CACHE_MAX = 20000;

interface RestTx {
    txid: string;
    hex?: string;
    height?: number;
    confirmations?: number;
    blocktime?: number;
    time?: number;
    vin: Array<{ txid?: string; vout?: number; coinbase?: string }>;
    vout: Array<{
        n: number;
        value: number;
        valueSat?: unknown;
        scriptPubKey?: { hex?: string; type?: string; addresses?: string[]; address?: string; ownerAddress?: string };
    }>;
}

interface HistoryEntry {
    txid: string;
    height: number; // <= 0 for mempool
    direction: string;
    amount: number;
    vin_count: number;
    vout_count: number;
}

interface HistoryPage {
    history: HistoryEntry[];
    total_count: number;
    has_more: boolean;
}

export class RestBackend implements ChainBackend {
    private txCache: Map<string, RestTx> = new Map();
    private spentCache: Map<string, { txid: string; index: number; height?: number }> = new Map();
    private tipHeight = 0;
    private tipFetchedAt = 0;
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    describe(): string {
        return `rxindexer rest at ${this.baseUrl}`;
    }

    private async get<T>(path: string): Promise<T> {
        let res: Response;
        try {
            res = await fetch(this.baseUrl + path);
        } catch (error) {
            throw new BackendRpcError(
                `RXinDexer REST fetch failed: ${error instanceof Error ? error.message : error}`,
            );
        }
        if (!res.ok) {
            if (res.status === 404) throw new BackendRpcError('Not found', -5);
            throw new BackendRpcError(`RXinDexer REST ${res.status} for ${path}`);
        }
        return res.json() as Promise<T>;
    }

    private async getTipHeight(): Promise<number> {
        if (Date.now() - this.tipFetchedAt < 30000 && this.tipHeight > 0) return this.tipHeight;
        const status = await this.get<{ sync_height: number }>('/status');
        this.tipHeight = status.sync_height ?? 0;
        this.tipFetchedAt = Date.now();
        return this.tipHeight;
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
                return this.getTipHeight();
            case 'getbestblockhash':
                return '';
            case 'getblockchaininfo':
                return { blocks: await this.getTipHeight(), bestblockhash: '', difficulty: 0 };
            default:
                throw new BackendRpcError(`Method not supported by rest backend: ${method}`);
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

    private async getRawTransaction(txid: string): Promise<RestTx> {
        const cached = this.txCache.get(txid);
        if (cached) return cached;

        const tx = await this.get<RestTx>(`/transaction/${txid}`);

        // REST omits height (like the daemon); derive it from confirmations.
        if (tx.height === undefined && typeof tx.confirmations === 'number' && tx.confirmations > 0) {
            tx.height = (await this.getTipHeight()) - tx.confirmations + 1;
        }
        if (tx.blocktime === undefined && typeof tx.time === 'number') tx.blocktime = tx.time;

        enrichVoutValues(tx);
        enrichScriptMetadata(tx);

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
    // Address history
    // ------------------------------------------------------------------

    /**
     * Pages an address's history (newest-first). Stops when the callback
     * returns false or history is exhausted. Bounds total entries scanned.
     */
    private async forEachHistory(
        address: string,
        maxEntries: number,
        fn: (entry: HistoryEntry) => boolean | void,
    ): Promise<{ scanned: number; truncated: boolean }> {
        let offset = 0;
        let scanned = 0;
        for (;;) {
            const page = await this.get<HistoryPage>(
                `/addresses/${address}/history?limit=${HISTORY_PAGE}&offset=${offset}`,
            );
            if (!page.history?.length) break;
            for (const entry of page.history) {
                scanned++;
                if (fn(entry) === false) return { scanned, truncated: false };
                if (scanned >= maxEntries) return { scanned, truncated: page.has_more || scanned < page.total_count };
            }
            if (!page.has_more) break;
            offset += page.history.length;
        }
        return { scanned, truncated: false };
    }

    private async getAddressTxids(addresses: string[]): Promise<string[]> {
        const entries: Array<{ txid: string; height: number }> = [];
        for (const address of addresses) {
            await this.forEachHistory(address, MAX_UTXO_SCAN, (e) => {
                entries.push({ txid: e.txid, height: e.height });
            });
        }
        // Bitcore returns oldest-first; REST is newest-first.
        entries.sort((a, b) => {
            const ah = a.height <= 0 ? Number.MAX_SAFE_INTEGER : a.height;
            const bh = b.height <= 0 ? Number.MAX_SAFE_INTEGER : b.height;
            return ah - bh;
        });
        const seen = new Set<string>();
        const txids: string[] = [];
        for (const e of entries) {
            if (seen.has(e.txid)) continue;
            seen.add(e.txid);
            txids.push(e.txid);
        }
        return txids;
    }

    // ------------------------------------------------------------------
    // Spent-info via history scan (no size ceiling)
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
        if (!output) throw new BackendRpcError(`Output ${txid}:${index} not found`);
        const address = output.scriptPubKey?.addresses?.[0] ?? output.scriptPubKey?.address
            ?? output.scriptPubKey?.ownerAddress;
        if (!address) {
            // Pure contract output with no address to scan by — report unspent.
            throw new BackendRpcError('Unable to get spent info', -5);
        }
        const fundingHeight = fundingTx.height ?? 0;

        // Candidate spenders sit at or after the funding height. History is
        // newest-first; once we pass below the funding height the rest is older
        // and cannot spend this output, so we can stop paging there.
        const candidates: Array<{ txid: string; height: number }> = [];
        await this.forEachHistory(address, Number.MAX_SAFE_INTEGER, (e) => {
            if (e.txid === txid) return;
            if (fundingHeight > 0 && e.height > 0 && e.height < fundingHeight) return false; // stop
            candidates.push({ txid: e.txid, height: e.height });
        });
        // Scan oldest-first among candidates (spender is usually soon after funding).
        candidates.sort((a, b) => {
            const ah = a.height <= 0 ? Number.MAX_SAFE_INTEGER : a.height;
            const bh = b.height <= 0 ? Number.MAX_SAFE_INTEGER : b.height;
            return ah - bh;
        });

        const scanned = candidates.slice(0, MAX_SPEND_SCAN);
        for (let i = 0; i < scanned.length; i += 10) {
            const batch = scanned.slice(i, i + 10);
            const txs = await Promise.all(batch.map((c) => this.getRawTransaction(c.txid).catch(() => null)));
            for (let j = 0; j < batch.length; j++) {
                const tx = txs[j];
                if (!tx) continue;
                const vinIndex = (tx.vin ?? []).findIndex((v) => v.txid === txid && v.vout === index);
                if (vinIndex !== -1) {
                    const result = { txid: batch[j].txid, index: vinIndex, height: batch[j].height > 0 ? batch[j].height : undefined };
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
            throw new BackendRpcError(`Spent-lookup scan limit reached for ${cacheKey}`);
        }
        // Absent spender across the full post-funding history — output is unspent.
        throw new BackendRpcError('Unable to get spent info', -5);
    }

    // ------------------------------------------------------------------
    // UTXO / balance reconstruction from history
    // ------------------------------------------------------------------

    /**
     * Reconstructs the unspent set for an address by replaying its history:
     * every output it created that no transaction in that same history spends.
     */
    private async reconstructUtxos(address: string): Promise<Array<{
        txid: string; outputIndex: number; satoshis: bigint; height: number;
    }>> {
        const created = new Map<string, { txid: string; outputIndex: number; satoshis: bigint; height: number }>();
        const spent = new Set<string>();

        // Collect the history txids (bounded), then fetch each once.
        const txids: string[] = [];
        await this.forEachHistory(address, MAX_UTXO_SCAN, (e) => { txids.push(e.txid); });

        for (let i = 0; i < txids.length; i += 10) {
            const batch = txids.slice(i, i + 10);
            const txs = await Promise.all(batch.map((t) => this.getRawTransaction(t).catch(() => null)));
            for (const tx of txs) {
                if (!tx) continue;
                for (const vin of tx.vin ?? []) {
                    if (vin.txid !== undefined && vin.vout !== undefined) spent.add(`${vin.txid}:${vin.vout}`);
                }
                for (const out of tx.vout ?? []) {
                    const addr = out.scriptPubKey?.addresses?.[0] ?? out.scriptPubKey?.address;
                    if (addr !== address) continue;
                    const key = `${tx.txid}:${out.n}`;
                    created.set(key, {
                        txid: tx.txid,
                        outputIndex: out.n,
                        satoshis: BigInt((out.valueSat as string | undefined) ?? Math.round((out.value ?? 0) * 1e8)),
                        height: tx.height ?? 0,
                    });
                }
            }
        }

        const utxos = [];
        for (const [key, u] of created) if (!spent.has(key)) utxos.push(u);
        utxos.sort((a, b) => b.height - a.height);
        return utxos;
    }

    private async getAddressUtxos(addresses: string[]): Promise<unknown[]> {
        const out: unknown[] = [];
        for (const address of addresses) {
            for (const u of await this.reconstructUtxos(address)) {
                out.push({ address, txid: u.txid, outputIndex: u.outputIndex, satoshis: u.satoshis, height: u.height });
            }
        }
        return out;
    }

    private async getAddressBalance(addresses: string[]): Promise<unknown> {
        let balance = 0n;
        for (const address of addresses) {
            for (const u of await this.reconstructUtxos(address)) balance += u.satoshis;
        }
        return { balance, received: 0 };
    }
}
