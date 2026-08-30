import { NextRequest, NextResponse } from 'next/server';
import { getChainBackend } from '@/server/backends';
import { BackendRpcError } from '@/server/backends/ChainBackend';
import { stringifyWithBigInts } from '@/server/jsonBigInt';

// The ElectrumX backend keeps a persistent TCP socket — needs the Node runtime.
export const runtime = 'nodejs';

const ALLOWED_METHODS = new Set([
    'getrawtransaction',
    'getspentinfo',
    'getaddresstxids',
    'getaddressutxos',
    'getaddressbalance',
    'getblockcount',
    'getbestblockhash',
    'getblockchaininfo',
]);

export async function POST(request: NextRequest) {
    let method: string;
    let params: unknown[];

    try {
        const body = await request.json();
        method = body.method;
        params = body.params ?? [];
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!ALLOWED_METHODS.has(method)) {
        return NextResponse.json({ error: `Method not allowed: ${method}` }, { status: 403 });
    }

    try {
        const backend = getChainBackend();
        const result = await backend.call(method, params);
        // Amounts beyond 2^53 arrive from backends as bigints; serialize them
        // as exact decimal strings (the client's toPhotons accepts both).
        return new NextResponse(stringifyWithBigInts({ result }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        if (error instanceof BackendRpcError) {
            return NextResponse.json(
                { error: { message: error.message, code: error.code } },
                { status: 400 },
            );
        }
        console.error(`Chain backend call failed (${method}):`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown backend error' },
            { status: 502 },
        );
    }
}
