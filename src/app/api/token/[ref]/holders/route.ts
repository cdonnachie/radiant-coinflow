import { NextResponse } from 'next/server';
import { Ref, RefError } from '@/lib/glyph/ref';
import type { TokenHolders } from '@/types/glyph';

export const runtime = 'nodejs';

const HOLDERS_TIMEOUT_MS = 8000;
const HOLDERS_TTL_MS = 60_000;
const HOLDERS_CACHE_MAX = 500;

const holdersCache = new Map<string, { data: TokenHolders; fetchedAt: number }>();

function optAmount(v: unknown): string | undefined {
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    return undefined;
}

function parseRows(rows: unknown): TokenHolders['holders'] {
    if (!Array.isArray(rows)) return [];
    const out: TokenHolders['holders'] = [];
    for (const row of rows) {
        const r = row as { address?: unknown; amount?: unknown; balance?: unknown; percentage?: unknown };
        const amount = optAmount(r?.amount) ?? optAmount(r?.balance);
        if (typeof r?.address !== 'string' || !amount) continue;
        out.push({
            address: r.address,
            amount,
            percentage: typeof r.percentage === 'number' ? r.percentage : undefined,
        });
    }
    return out;
}

/** Top holders of a fungible Glyph token, via RXinDexer. Amounts are photons (= token units). */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ ref: string }> },
) {
    let ref: Ref;
    try {
        ref = Ref.parse((await params).ref);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof RefError ? error.message : 'Invalid ref' },
            { status: 400 },
        );
    }

    const baseUrl = process.env.RADIANT_REST_URL?.replace(/\/+$/, '');
    if (!baseUrl) {
        return NextResponse.json({ error: 'Holders require the REST indexer backend' }, { status: 501 });
    }

    const key = ref.toDisplayHex();
    const cached = holdersCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < HOLDERS_TTL_MS) {
        return NextResponse.json(cached.data);
    }

    try {
        const refShort = ref.toRxindexerForm();
        let data: TokenHolders | null = null;

        const topRes = await fetch(`${baseUrl}/tokens/${refShort}/top-holders?limit=25`, {
            signal: AbortSignal.timeout(HOLDERS_TIMEOUT_MS),
        });
        if (topRes.ok) {
            const body = await topRes.json() as {
                top_holders?: unknown; holders?: unknown;
                holder_count?: unknown; total_supply?: unknown;
            };
            data = {
                holders: parseRows(body?.top_holders ?? body?.holders),
                holderCount: typeof body?.holder_count === 'number' ? body.holder_count : undefined,
                totalSupply: optAmount(body?.total_supply),
            };
        } else {
            const plainRes = await fetch(`${baseUrl}/tokens/${refShort}/holders?limit=25`, {
                signal: AbortSignal.timeout(HOLDERS_TIMEOUT_MS),
            });
            if (plainRes.ok) {
                const body = await plainRes.json() as { holders?: unknown };
                data = { holders: parseRows(body?.holders) };
            }
        }

        if (!data) {
            return NextResponse.json({ error: 'Holder data unavailable' }, { status: 404 });
        }
        if (holdersCache.size >= HOLDERS_CACHE_MAX) {
            const oldest = holdersCache.keys().next().value;
            if (oldest !== undefined) holdersCache.delete(oldest);
        }
        holdersCache.set(key, { data, fetchedAt: Date.now() });
        return NextResponse.json(data);
    } catch (error) {
        console.error(`Token holders lookup failed for ${key}:`, error);
        return NextResponse.json({ error: 'Holders lookup failed' }, { status: 502 });
    }
}
