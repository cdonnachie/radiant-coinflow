/**
 * Server-side chain backend contract.
 *
 * The /api/rpc route accepts Bitcore-style index RPC calls from the browser
 * and dispatches them to whichever backend is configured:
 *
 *   RADIANT_BACKEND=rpc        Forward to a radiantd node that carries
 *                              address/spent index patches (txindex=1,
 *                              addressindex=1, spentindex=1).
 *   RADIANT_BACKEND=electrumx  Translate to ElectrumX scripthash lookups,
 *                              emulating getspentinfo via history scanning.
 *
 * When RADIANT_BACKEND is unset, electrumx is chosen if RADIANT_ELECTRUM_HOST
 * is set, otherwise rpc. Both backends return identical response shapes, so
 * switching is purely a configuration change.
 */

export class BackendRpcError extends Error {
    constructor(message: string, public readonly code?: number) {
        super(message);
        this.name = 'BackendRpcError';
    }
}

export interface ChainBackend {
    /** Handles one Bitcore-style RPC call; throws BackendRpcError on RPC-level failure. */
    call(method: string, params: unknown[]): Promise<unknown>;
    /** Human-readable description for logs and error messages. */
    describe(): string;
}
