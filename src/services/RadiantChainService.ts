/**
 * Radiant Chain Service
 *
 * Browser-side implementation of ChainDataService. Calls the /api/rpc proxy
 * route using Bitcore-style index method names (getspentinfo, getaddresstxids,
 * getaddressutxos, ...). The server decides how to answer:
 *   - RADIANT_BACKEND=rpc       → forwarded to a radiantd node carrying
 *                                 address/spent index patches
 *   - RADIANT_BACKEND=electrumx → translated to ElectrumX scripthash lookups
 *
 * Either way the responses have identical shapes, so the analysis engine
 * never needs to know which backend is active.
 */

import { photonsFromRxd, toPhotons } from '@/lib/amounts';
import type {
    AddressHistoryItem,
    AddressUtxo,
    BlockchainInfo,
    ChainDataService,
    ChainTransaction,
    SpentInfo,
} from './ChainDataService';

export class RadiantChainService implements ChainDataService {
    private requestCache: Map<string, unknown> = new Map();
    private cacheTimestamps: Map<string, number> = new Map();
    private readonly cacheTimeout: number = 600000; // 10 minutes
    private lastRequestTime: number = 0;
    private readonly requestDelay: number = 50; // ms between calls

    private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
        const now = Date.now();
        const wait = this.requestDelay - (now - this.lastRequestTime);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastRequestTime = Date.now();

        const response = await fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params }),
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(
                typeof data.error === 'object'
                    ? data.error.message || JSON.stringify(data.error)
                    : data.error || `RPC error: ${response.status}`,
            );
        }

        return data.result as T;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapRawTx(raw: any): ChainTransaction {
        return {
            hash: raw.txid ?? raw.hash,
            height: raw.height ?? raw.blockheight ?? 0,
            confirmations: raw.confirmations ?? 0,
            blocktime: raw.blocktime ?? raw.time ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vin: (raw.vin || []).map((v: any) => ({
                txid: v.txid ?? '',
                vout: Number(v.vout ?? 0),
                scriptSig: v.scriptSig,
                sequence: v.sequence,
                coinbase: v.coinbase,
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vout: (raw.vout || []).map((o: any) => ({
                n: o.n,
                value: o.value ?? 0,
                // Backends send valueSat as an exact decimal string parsed from
                // the raw tx hex; the float path is a fallback only.
                valueSat: o.valueSat !== undefined
                    ? toPhotons(o.valueSat)
                    : photonsFromRxd(o.value ?? 0),
                scriptPubKey: {
                    address: o.scriptPubKey?.address,
                    addresses: o.scriptPubKey?.addresses,
                    asm: o.scriptPubKey?.asm ?? '',
                    hex: o.scriptPubKey?.hex ?? '',
                    type: o.scriptPubKey?.type ?? '',
                },
            })),
        };
    }

    async getTransaction(txid: string): Promise<ChainTransaction> {
        const cacheKey = `tx:${txid}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached && Date.now() - cachedAt < this.cacheTimeout) {
            return cached as ChainTransaction;
        }

        // verbose=1 returns decoded transaction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await this.rpcCall<any>('getrawtransaction', [txid, 1]);
        const transaction = this.mapRawTx(raw);

        this.requestCache.set(cacheKey, transaction);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return transaction;
    }

    async getTransactionsBatch(txids: string[]): Promise<Map<string, ChainTransaction>> {
        const results = new Map<string, ChainTransaction>();
        // Fetch in parallel (node can handle it, no external rate limit)
        await Promise.all(
            txids.map(async (txid) => {
                try {
                    results.set(txid, await this.getTransaction(txid));
                } catch {
                    // skip failed
                }
            }),
        );
        return results;
    }

    /**
     * Directly find the transaction that spends txid:vout.
     * Returns null if the output is unspent.
     */
    async getSpentInfo(txid: string, vout: number): Promise<SpentInfo | null> {
        const cacheKey = `spent:${txid}:${vout}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached !== undefined && Date.now() - cachedAt < this.cacheTimeout) {
            return cached as SpentInfo | null;
        }

        try {
            const result = await this.rpcCall<SpentInfo>('getspentinfo', [{ txid, index: vout }]);
            this.requestCache.set(cacheKey, result);
            this.cacheTimestamps.set(cacheKey, Date.now());
            return result;
        } catch {
            // "Unable to get spent info" means unspent
            this.requestCache.set(cacheKey, null);
            this.cacheTimestamps.set(cacheKey, Date.now());
            return null;
        }
    }

    async isOutputUnspent(txid: string, vout: number): Promise<boolean> {
        const spentInfo = await this.getSpentInfo(txid, vout);
        return spentInfo === null;
    }

    async getAddressHistory(address: string): Promise<AddressHistoryItem[]> {
        const cacheKey = `history:${address}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached && Date.now() - cachedAt < this.cacheTimeout) {
            return cached as AddressHistoryItem[];
        }

        // Returns array of txids sorted by height (oldest first)
        const txids = await this.rpcCall<string[]>('getaddresstxids', [{ addresses: [address] }]);
        const history: AddressHistoryItem[] = txids.map((txid) => ({
            txid,
            height: 0,
            tx_hash: txid,
        }));

        this.requestCache.set(cacheKey, history);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return history;
    }

    // Fetches and caches the complete unspent UTXO set for an address (single RPC call).
    private async getAllUnspentUtxos(address: string): Promise<AddressUtxo[]> {
        const cacheKey = `all-utxos:${address}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached && Date.now() - cachedAt < 30000) {
            return cached as AddressUtxo[];
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await this.rpcCall<any[]>('getaddressutxos', [{ addresses: [address] }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: AddressUtxo[] = (raw || []).map((u: any) => ({
            address: u.address ?? address,
            txid: u.txid,
            outputIndex: u.outputIndex,
            satoshis: toPhotons(u.satoshis ?? 0),
            height: u.height || 0,
            isUnspent: true,
        }));
        items.sort((a, b) => b.height - a.height);
        this.requestCache.set(cacheKey, items);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return items;
    }

    async getAddressOutputs(
        address: string,
        pageSize = 20,
        pageOffset = 0,
    ): Promise<{ items: AddressUtxo[]; hasMoreUnspent: boolean }> {
        // Fetch the full unspent set (cached). Client-side pagination avoids the
        // bug where server-side offset paging caused out-of-page UTXOs to appear
        // in the spent lookup (they weren't in unspentKeys so they were mis-tagged).
        const allUnspent = await this.getAllUnspentUtxos(address);
        const allUnspentKeys = new Set(allUnspent.map((u) => `${u.txid}:${u.outputIndex}`));

        const unspentPage = allUnspent.slice(pageOffset, pageOffset + pageSize);
        const hasMoreUnspent = allUnspent.length > pageOffset + pageSize;

        // Show recent spent outputs only on the first page (best-effort).
        const spentItems: AddressUtxo[] = [];
        if (pageOffset === 0) {
            try {
                const allTxids = await this.rpcCall<string[]>('getaddresstxids', [{ addresses: [address] }]);
                const recentTxids = allTxids.slice(-15).reverse();

                const txs = await Promise.all(
                    recentTxids.map((txid) => this.getTransaction(txid).catch(() => null)),
                );

                const seen = new Set<string>();
                for (const tx of txs) {
                    if (!tx) continue;
                    for (const out of tx.vout) {
                        const addr = out.scriptPubKey?.address ?? out.scriptPubKey?.addresses?.[0];
                        if (addr !== address) continue;
                        const key = `${tx.hash}:${out.n}`;
                        // allUnspentKeys covers the full set — no false "Spent" for page 2+ UTXOs
                        if (allUnspentKeys.has(key) || seen.has(key)) continue;
                        seen.add(key);
                        spentItems.push({
                            address,
                            txid: tx.hash,
                            outputIndex: out.n,
                            satoshis: out.valueSat,
                            height: tx.height || 0,
                            isUnspent: false,
                        });
                    }
                }
                spentItems.sort((a, b) => b.height - a.height);
            } catch {
                // spent lookup is best-effort; continue with unspent only
            }
        }

        return { items: [...unspentPage, ...spentItems], hasMoreUnspent };
    }

    async getBlockchainInfo(): Promise<BlockchainInfo> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await this.rpcCall<any>('getblockchaininfo', []);
        return {
            height: raw.blocks ?? 0,
            bestblockhash: raw.bestblockhash ?? '',
            difficulty: raw.difficulty ?? 0,
        };
    }

    clearCache(): void {
        this.requestCache.clear();
        this.cacheTimestamps.clear();
    }

    getCacheStats(): { size: number } {
        return { size: this.requestCache.size };
    }
}
