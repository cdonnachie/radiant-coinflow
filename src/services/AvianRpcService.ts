/**
 * Avian RPC Service
 *
 * Calls your local Avian Core node via the /api/rpc proxy route.
 * Requires the node to be running with:
 *   txindex=1, addressindex=1, spentindex=1, timestampindex=1
 *
 * Key advantage over REST API: getspentinfo directly returns the spending
 * transaction for any UTXO — no address history scanning needed.
 */

// Re-export types used by OptimizedCoinFlowService
export interface AvianTransaction {
    hash: string;
    height: number;
    confirmations: number;
    blocktime: number;
    vin: Array<{
        txid: string;
        vout: number;
        scriptSig?: unknown;
        sequence?: number;
        coinbase?: string;
    }>;
    vout: Array<{
        n: number;
        value: number;
        valueSat: number;
        scriptPubKey: {
            address?: string;
            addresses?: string[];
            asm: string;
            hex: string;
            type: string;
        };
    }>;
}

export interface AvianAddressHistory {
    txid: string;
    height: number;
    tx_hash: string;
}

export interface AddressUtxo {
    address: string;
    txid: string;
    outputIndex: number;
    satoshis: number;
    height: number;
    isUnspent: boolean;
}

export interface SpentInfo {
    txid: string;
    index: number; // vin index in spending tx
    height?: number; // block height of the spending transaction
}

export class AvianRpcService {
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

    private mapRawTx(raw: any): AvianTransaction {
        return {
            hash: raw.txid ?? raw.hash,
            height: raw.height ?? raw.blockheight ?? 0,
            confirmations: raw.confirmations ?? 0,
            blocktime: raw.blocktime ?? raw.time ?? 0,
            vin: (raw.vin || []).map((v: any) => ({
                txid: v.txid ?? '',
                vout: Number(v.vout ?? 0),
                scriptSig: v.scriptSig,
                sequence: v.sequence,
                coinbase: v.coinbase,
            })),
            vout: (raw.vout || []).map((o: any) => ({
                n: o.n,
                value: o.value ?? 0,
                valueSat: o.valueSat !== undefined
                    ? o.valueSat
                    : Math.round((o.value ?? 0) * 1e8),
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

    async getTransaction(txid: string): Promise<AvianTransaction> {
        const cacheKey = `tx:${txid}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached && Date.now() - cachedAt < this.cacheTimeout) {
            return cached as AvianTransaction;
        }

        // verbose=1 returns decoded transaction
        const raw = await this.rpcCall<any>('getrawtransaction', [txid, 1]);
        const transaction = this.mapRawTx(raw);

        this.requestCache.set(cacheKey, transaction);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return transaction;
    }

    async getTransactionsBatch(txids: string[]): Promise<Map<string, AvianTransaction>> {
        const results = new Map<string, AvianTransaction>();
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
     * Requires spentindex=1 on the node.
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

    async getAddressHistory(address: string): Promise<AvianAddressHistory[]> {
        const cacheKey = `history:${address}`;
        const cached = this.requestCache.get(cacheKey);
        const cachedAt = this.cacheTimestamps.get(cacheKey) ?? 0;
        if (cached && Date.now() - cachedAt < this.cacheTimeout) {
            return cached as AvianAddressHistory[];
        }

        // Returns array of txids sorted by height (oldest first)
        const txids = await this.rpcCall<string[]>('getaddresstxids', [{ addresses: [address] }]);
        const history: AvianAddressHistory[] = txids.map((txid) => ({
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
        const raw = await this.rpcCall<any[]>('getaddressutxos', [{ addresses: [address] }]);
        const items: AddressUtxo[] = (raw || []).map((u: any) => ({
            address: u.address ?? address,
            txid: u.txid,
            outputIndex: u.outputIndex,
            satoshis: u.satoshis,
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
        let spentItems: AddressUtxo[] = [];
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

    async getBlockchainInfo(): Promise<{ height: number; bestblockhash: string; difficulty: number }> {
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
