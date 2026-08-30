/**
 * Native radiantd RPC backend.
 *
 * Forwards calls unchanged to a radiantd node over HTTP JSON-RPC. The
 * address/spent index methods (getspentinfo, getaddresstxids, getaddressutxos,
 * getaddressbalance) require a node build carrying the Bitcore-style index
 * patches with addressindex=1 and spentindex=1 enabled.
 *
 * Stock radiantd omits the block height from verbose getrawtransaction
 * responses, so it is derived here from confirmations when absent — that way
 * both a patched and an unpatched node produce the shape the app expects.
 */

import { parseJsonPreservingBigInts } from '../jsonBigInt';
import { enrichVoutValues } from '../txvalues';
import { BackendRpcError, ChainBackend } from './ChainBackend';

export class NodeRpcBackend implements ChainBackend {
    private tipHeight = 0;
    private tipFetchedAt = 0;

    constructor(
        private readonly url: string,
        private readonly user: string,
        private readonly pass: string,
    ) {}

    describe(): string {
        return `radiantd rpc at ${this.url}`;
    }

    private async rpc(method: string, params: unknown[]): Promise<unknown> {
        const auth = Buffer.from(`${this.user}:${this.pass}`).toString('base64');

        let response: Response;
        try {
            response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${auth}`,
                },
                body: JSON.stringify({ jsonrpc: '1.0', id: 'coinflow', method, params }),
            });
        } catch (error) {
            throw new BackendRpcError(
                `Failed to reach Radiant node: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }

        // Parse from text so exact integers beyond 2^53 (e.g. satoshis fields
        // from an indexed node) survive as bigints instead of lossy doubles.
        const data = parseJsonPreservingBigInts(await response.text());
        if (data.error) {
            throw new BackendRpcError(
                data.error.message ?? JSON.stringify(data.error),
                data.error.code,
            );
        }
        return data.result;
    }

    private async getTipHeight(): Promise<number> {
        if (Date.now() - this.tipFetchedAt < 30000) return this.tipHeight;
        this.tipHeight = (await this.rpc('getblockcount', [])) as number;
        this.tipFetchedAt = Date.now();
        return this.tipHeight;
    }

    async call(method: string, params: unknown[]): Promise<unknown> {
        const result = await this.rpc(method, params);

        // Derive height for verbose transactions when the node doesn't include it.
        if (method === 'getrawtransaction' && result && typeof result === 'object') {
            const tx = result as {
                height?: number;
                confirmations?: number;
                hex?: string;
                vout?: Array<{ n?: number; valueSat?: unknown }>;
            };
            if (tx.height === undefined && typeof tx.confirmations === 'number' && tx.confirmations > 0) {
                try {
                    tx.height = (await this.getTipHeight()) - tx.confirmations + 1;
                } catch {
                    // best-effort enrichment only
                }
            }
            // Overwrite any node-provided valueSat with exact strings from the
            // raw hex — JSON numbers are lossy above 2^53 photons.
            enrichVoutValues(tx);
        }

        return result;
    }
}
