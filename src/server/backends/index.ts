/**
 * Backend selection.
 *
 * Environment variables:
 *   RADIANT_BACKEND        'electrumx' | 'rpc'. Optional — when unset,
 *                          electrumx is used if RADIANT_ELECTRUM_HOST is set,
 *                          otherwise rpc.
 *
 *   RADIANT_ELECTRUM_HOST  ElectrumX server host.
 *   RADIANT_ELECTRUM_PORT  Default 50002.
 *   RADIANT_ELECTRUM_TLS   'true' | 'false'. Default: true only for port 50002.
 *
 *   RADIANT_RPC_URL        radiantd JSON-RPC endpoint (e.g. http://host:7332).
 *   RADIANT_RPC_USER       rpcuser from radiant.conf.
 *   RADIANT_RPC_PASS       rpcpassword from radiant.conf.
 *
 * The backend instance is cached on globalThis so the ElectrumX socket and
 * caches survive route-module reloads in dev.
 */

import { ElectrumClient } from '../electrum/ElectrumClient';
import { ChainBackend } from './ChainBackend';
import { ElectrumBackend } from './ElectrumBackend';
import { NodeRpcBackend } from './NodeRpcBackend';

interface BackendCache {
    signature: string;
    backend: ChainBackend;
}

const CACHE_KEY = Symbol.for('radiant-coinflow.chain-backend');

export function getChainBackend(): ChainBackend {
    const env = process.env;
    const electrumHost = env.RADIANT_ELECTRUM_HOST;
    const mode = env.RADIANT_BACKEND ?? (electrumHost ? 'electrumx' : 'rpc');

    let signature: string;
    if (mode === 'electrumx') {
        signature = `electrumx|${electrumHost}|${env.RADIANT_ELECTRUM_PORT}|${env.RADIANT_ELECTRUM_TLS}`;
    } else {
        signature = `rpc|${env.RADIANT_RPC_URL}|${env.RADIANT_RPC_USER}`;
    }

    const globalStore = globalThis as unknown as Record<symbol, BackendCache | undefined>;
    const cached = globalStore[CACHE_KEY];
    if (cached && cached.signature === signature) return cached.backend;

    let backend: ChainBackend;
    if (mode === 'electrumx') {
        if (!electrumHost) {
            throw new Error('RADIANT_BACKEND=electrumx requires RADIANT_ELECTRUM_HOST');
        }
        const port = Number(env.RADIANT_ELECTRUM_PORT ?? 50002);
        const tls = env.RADIANT_ELECTRUM_TLS !== undefined
            ? env.RADIANT_ELECTRUM_TLS === 'true'
            : port === 50002;
        backend = new ElectrumBackend(new ElectrumClient(electrumHost, port, tls));
    } else if (mode === 'rpc') {
        const { RADIANT_RPC_URL, RADIANT_RPC_USER, RADIANT_RPC_PASS } = env;
        if (!RADIANT_RPC_URL || !RADIANT_RPC_USER || !RADIANT_RPC_PASS) {
            throw new Error(
                'RPC backend not configured. Set RADIANT_RPC_URL, RADIANT_RPC_USER, RADIANT_RPC_PASS ' +
                'in .env.local (or set RADIANT_ELECTRUM_HOST to use the electrumx backend).',
            );
        }
        backend = new NodeRpcBackend(RADIANT_RPC_URL, RADIANT_RPC_USER, RADIANT_RPC_PASS);
    } else {
        throw new Error(`Unknown RADIANT_BACKEND '${mode}' (expected 'electrumx' or 'rpc')`);
    }

    globalStore[CACHE_KEY] = { signature, backend };
    return backend;
}
