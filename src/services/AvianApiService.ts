/**
 * Avian Network API Service
 *
 * REST client for api.avn.network — provides transaction and address data
 * for the CoinFlow analysis engine.
 */

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

export interface AvianUTXO {
    txid: string;
    vout: number;
    amount: number;
    confirmations: number;
    height: number;
}

export interface AvianBlockchainInfo {
    height: number;
    bestblockhash: string;
    difficulty: number;
}

export class AvianApiService {
    private readonly baseUrl: string = 'https://api.avn.network';
    private requestCount: number = 0;
    private lastRequestTime: number = 0;
    private readonly requestDelay: number = 100;
    private requestCache: Map<string, unknown> = new Map();
    private cacheTimestamps: Map<string, number> = new Map();
    private readonly cacheTimeout: number = 600000; // 10 minutes

    constructor(baseUrl?: string) {
        if (baseUrl) {
            this.baseUrl = baseUrl;
        }
    }

    async getTransaction(txid: string): Promise<AvianTransaction> {
        const cacheKey = `tx:${txid}`;
        if (this.requestCache.has(cacheKey)) {
            const timestamp = this.cacheTimestamps.get(cacheKey);
            if (timestamp && Date.now() - timestamp < this.cacheTimeout) {
                return this.requestCache.get(cacheKey) as AvianTransaction;
            }
        }

        const response = await this.rateLimitedFetch(`${this.baseUrl}/transaction/${txid}`);
        const data = await response.json();

        if (data.error) throw new Error(`API Error: ${data.error}`);

        const transaction: AvianTransaction = {
            hash: data.result.hash,
            height: data.result.height,
            confirmations: data.result.confirmations,
            blocktime: data.result.blocktime,
            vin: data.result.vin || [],
            vout: (data.result.vout || []).map((o: any) => ({
                ...o,
                valueSat: o.valueSat !== undefined
                    ? o.valueSat
                    : Math.round((o.value || 0) * 1e8),
            })),
        };

        this.requestCache.set(cacheKey, transaction);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return transaction;
    }

    async getTransactionsBatch(txids: string[]): Promise<Map<string, AvianTransaction>> {
        const results = new Map<string, AvianTransaction>();
        const uncachedTxids: string[] = [];

        for (const txid of txids) {
            const cacheKey = `tx:${txid}`;
            if (this.requestCache.has(cacheKey)) {
                const timestamp = this.cacheTimestamps.get(cacheKey);
                if (timestamp && Date.now() - timestamp < this.cacheTimeout) {
                    results.set(txid, this.requestCache.get(cacheKey) as AvianTransaction);
                    continue;
                }
            }
            uncachedTxids.push(txid);
        }

        if (uncachedTxids.length === 0) return results;

        // Try batch endpoint first
        try {
            const response = await this.rateLimitedFetch(`${this.baseUrl}/transactions/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txids: uncachedTxids }),
            });

            if (response.ok) {
                const data = await response.json();
                for (const txData of data.results || []) {
                    const transaction: AvianTransaction = {
                        hash: txData.hash,
                        height: txData.height,
                        confirmations: txData.confirmations,
                        blocktime: txData.blocktime,
                        vin: txData.vin || [],
                        vout: (txData.vout || []).map((o: any) => ({
                            ...o,
                            valueSat: o.valueSat !== undefined
                                ? o.valueSat
                                : Math.round((o.value || 0) * 1e8),
                        })),
                    };
                    results.set(txData.hash, transaction);
                    const cacheKey = `tx:${txData.hash}`;
                    this.requestCache.set(cacheKey, transaction);
                    this.cacheTimestamps.set(cacheKey, Date.now());
                }
                return results;
            }
        } catch {
            // Batch not available — fall through to individual requests
        }

        // Fallback: individual requests in parallel
        await Promise.all(
            uncachedTxids.map(async (txid) => {
                try {
                    results.set(txid, await this.getTransaction(txid));
                } catch {
                    // Skip failed transactions
                }
            }),
        );

        return results;
    }

    async getAddressHistory(address: string): Promise<AvianAddressHistory[]> {
        const cacheKey = `history:${address}`;
        if (this.requestCache.has(cacheKey)) {
            const timestamp = this.cacheTimestamps.get(cacheKey);
            if (timestamp && Date.now() - timestamp < this.cacheTimeout) {
                return this.requestCache.get(cacheKey) as AvianAddressHistory[];
            }
        }

        const response = await this.rateLimitedFetch(`${this.baseUrl}/history/${address}`);
        const data = await response.json();

        if (data.error) throw new Error(`API Error: ${data.error.message || data.error}`);

        const history: AvianAddressHistory[] = (data.result?.tx || []).map((txid: string) => ({
            txid,
            height: 0,
            tx_hash: txid,
        }));

        this.requestCache.set(cacheKey, history);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return history;
    }

    async isOutputUnspent(txid: string, vout: number, address: string): Promise<boolean> {
        try {
            const history = await this.getAddressHistory(address);
            const recentTxids = history.slice(0, 20).map((item) => item.txid);

            for (const candidateTxid of recentTxids) {
                if (candidateTxid === txid) continue;
                try {
                    const candidateTx = await this.getTransaction(candidateTxid);
                    for (const input of candidateTx.vin) {
                        if (input.txid === txid && input.vout === vout) return false;
                    }
                } catch {
                    continue;
                }
            }
            return true;
        } catch {
            return true;
        }
    }

    async getBlockchainInfo(): Promise<AvianBlockchainInfo> {
        const cacheKey = 'blockchain:info';
        if (this.requestCache.has(cacheKey)) {
            const timestamp = this.cacheTimestamps.get(cacheKey);
            if (timestamp && Date.now() - timestamp < 30000) {
                return this.requestCache.get(cacheKey) as AvianBlockchainInfo;
            }
        }

        for (const endpoint of ['/blockchain/info', '/info', '/status', '/stats']) {
            try {
                const response = await this.rateLimitedFetch(`${this.baseUrl}${endpoint}`);
                const data = await response.json();
                if (!data.error && data.result) {
                    const info: AvianBlockchainInfo = {
                        height: data.result.blocks || data.result.height || data.result.blockcount || 0,
                        bestblockhash: data.result.bestblockhash || data.result.hash || '',
                        difficulty: data.result.difficulty || 0,
                    };
                    this.requestCache.set(cacheKey, info);
                    this.cacheTimestamps.set(cacheKey, Date.now());
                    return info;
                }
            } catch {
                continue;
            }
        }

        return { height: 0, bestblockhash: '', difficulty: 0 };
    }

    private async rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestDelay) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.requestDelay - timeSinceLastRequest),
            );
        }

        this.requestCount++;
        this.lastRequestTime = Date.now();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, { signal: controller.signal, ...options });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    clearCache(): void {
        this.requestCache.clear();
        this.cacheTimestamps.clear();
    }

    getCacheStats(): { size: number; requests: number } {
        return { size: this.requestCache.size, requests: this.requestCount };
    }
}
