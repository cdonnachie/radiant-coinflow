/**
 * Minimal ElectrumX JSON-RPC client (server-side only).
 *
 * Speaks newline-delimited JSON-RPC 2.0 over a persistent TCP or TLS socket.
 * Maintains a blockchain.headers.subscribe subscription so the current chain
 * tip is always available without an extra round trip.
 *
 * Reconnects lazily: a dropped socket rejects in-flight requests, and the
 * next request opens a fresh connection.
 */

import { Socket, connect as netConnect } from 'net';
import { TLSSocket, connect as tlsConnect } from 'tls';
import { parseJsonPreservingBigInts } from '../jsonBigInt';

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
}

export interface TipHeader {
    height: number;
    hex: string;
}

export class ElectrumRpcError extends Error {
    constructor(message: string, public readonly code?: number) {
        super(message);
        this.name = 'ElectrumRpcError';
    }
}

export class ElectrumClient {
    private socket: Socket | TLSSocket | null = null;
    private connectPromise: Promise<void> | null = null;
    private buffer = '';
    private nextId = 1;
    private pending: Map<number, PendingRequest> = new Map();
    private tip: TipHeader | null = null;

    constructor(
        private readonly host: string,
        private readonly port: number,
        private readonly useTls: boolean,
        private readonly requestTimeoutMs: number = 30000,
    ) {}

    describe(): string {
        return `${this.useTls ? 'tls' : 'tcp'}://${this.host}:${this.port}`;
    }

    private ensureConnected(): Promise<void> {
        if (this.socket && !this.socket.destroyed) return Promise.resolve();
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise<void>((resolve, reject) => {
            const onConnect = () => {
                this.socket = socket;
                this.connectPromise = null;
                resolve();
            };

            const socket: Socket | TLSSocket = this.useTls
                ? // Electrum servers almost universally run self-signed certs;
                  // the protocol relies on the server being untrusted anyway.
                  tlsConnect({ host: this.host, port: this.port, rejectUnauthorized: false }, onConnect)
                : netConnect({ host: this.host, port: this.port }, onConnect);

            socket.setEncoding('utf8');
            socket.setTimeout(0);

            socket.on('data', (chunk: string) => this.onData(chunk));

            socket.on('error', (err: Error) => {
                if (this.connectPromise) {
                    this.connectPromise = null;
                    reject(new Error(`ElectrumX connection to ${this.describe()} failed: ${err.message}`));
                }
                this.teardown(err);
            });

            socket.on('close', () => {
                this.teardown(new Error('ElectrumX connection closed'));
            });
        }).then(async () => {
            // Protocol negotiation, then subscribe to headers for tip tracking.
            await this.rawRequest('server.version', ['radiant-coinflow 1.0', '1.4']);
            const header = (await this.rawRequest('blockchain.headers.subscribe', [])) as TipHeader;
            if (header && typeof header.height === 'number') this.tip = header;
        });

        return this.connectPromise;
    }

    private teardown(err: Error): void {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.buffer = '';
        for (const [, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(err);
        }
        this.pending.clear();
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (!line) continue;

            let message: {
                id?: number;
                result?: unknown;
                error?: { message?: string; code?: number } | string;
                method?: string;
                params?: unknown[];
            };
            try {
                // ElectrumX (Python json) sends integers at arbitrary precision;
                // recover values beyond 2^53 as bigints instead of lossy doubles.
                message = parseJsonPreservingBigInts(line);
            } catch {
                continue;
            }

            if (message.id !== undefined && this.pending.has(message.id)) {
                const req = this.pending.get(message.id)!;
                this.pending.delete(message.id);
                clearTimeout(req.timer);
                if (message.error) {
                    const msg = typeof message.error === 'string'
                        ? message.error
                        : message.error.message ?? JSON.stringify(message.error);
                    const code = typeof message.error === 'object' ? message.error.code : undefined;
                    req.reject(new ElectrumRpcError(msg, code));
                } else {
                    req.resolve(message.result);
                }
            } else if (message.method === 'blockchain.headers.subscribe' && Array.isArray(message.params)) {
                const header = message.params[0] as TipHeader | undefined;
                if (header && typeof header.height === 'number') this.tip = header;
            }
        }
    }

    private rawRequest(method: string, params: unknown[]): Promise<unknown> {
        const socket = this.socket;
        if (!socket || socket.destroyed) {
            return Promise.reject(new Error('ElectrumX socket not connected'));
        }

        const id = this.nextId++;
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`ElectrumX request timed out: ${method}`));
            }, this.requestTimeoutMs);

            this.pending.set(id, { resolve, reject, timer });
            socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    async request<T>(method: string, params: unknown[] = []): Promise<T> {
        await this.ensureConnected();
        return (await this.rawRequest(method, params)) as T;
    }

    async getTip(): Promise<TipHeader> {
        await this.ensureConnected();
        if (!this.tip) {
            const header = await this.request<TipHeader>('blockchain.headers.subscribe', []);
            this.tip = header;
        }
        return this.tip;
    }
}
