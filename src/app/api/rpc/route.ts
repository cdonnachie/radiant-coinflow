import { NextRequest, NextResponse } from 'next/server';

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
    const rpcUrl = process.env.AVIAN_RPC_URL;
    const rpcUser = process.env.AVIAN_RPC_USER;
    const rpcPass = process.env.AVIAN_RPC_PASS;

    if (!rpcUrl || !rpcUser || !rpcPass) {
        return NextResponse.json(
            { error: 'RPC not configured. Set AVIAN_RPC_URL, AVIAN_RPC_USER, AVIAN_RPC_PASS in .env.local' },
            { status: 503 },
        );
    }

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

    const auth = Buffer.from(`${rpcUser}:${rpcPass}`).toString('base64');

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${auth}`,
            },
            body: JSON.stringify({
                jsonrpc: '1.0',
                id: 'coinflow',
                method,
                params,
            }),
        });

        const data = await response.json();

        if (data.error) {
            return NextResponse.json({ error: data.error }, { status: 400 });
        }

        return NextResponse.json({ result: data.result });
    } catch (error) {
        console.error('RPC call failed:', error);
        return NextResponse.json(
            { error: `Failed to reach Avian node: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 502 },
        );
    }
}
