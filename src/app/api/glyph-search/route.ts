import { NextRequest, NextResponse } from 'next/server';
import { Ref } from '@/lib/glyph/ref';
import type { GlyphSearchResult } from '@/types/glyph';

export const runtime = 'nodejs';

const SEARCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 25;

interface SearchRow {
    ref?: string; // txid_vout display form
    name?: string;
    ticker?: string;
    type_name?: string;
    deploy_height?: number;
    total_supply?: unknown;
    mined_supply?: unknown;
}

function optSupply(v: unknown): string | undefined {
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    return undefined;
}

async function search(baseUrl: string, q: string): Promise<SearchRow[]> {
    const res = await fetch(`${baseUrl}/glyphs/search?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    // Exact-match mode responds with `results`; wildcard mode with `tokens`.
    const b = body as { results?: unknown; tokens?: unknown };
    const rows = Array.isArray(b?.results) ? b.results : Array.isArray(b?.tokens) ? b.tokens : [];
    return rows as SearchRow[];
}

/**
 * Glyph name search, proxying RXinDexer /glyphs/search. Tries the query as an
 * exact (case-insensitive) full name first, then falls back to a *q* wildcard
 * so partial matching works on indexers that support it.
 */
export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (q.length < 2 || q.length > 100) {
        return NextResponse.json({ error: 'Query must be 2-100 characters' }, { status: 400 });
    }
    const baseUrl = process.env.RADIANT_REST_URL?.replace(/\/+$/, '');
    if (!baseUrl) {
        return NextResponse.json({ error: 'Name search requires the REST indexer backend' }, { status: 501 });
    }

    try {
        let rows = await search(baseUrl, q);
        if (rows.length === 0 && !q.includes('*')) {
            rows = await search(baseUrl, `*${q}*`);
        }

        const results: GlyphSearchResult[] = [];
        for (const row of rows.slice(0, MAX_RESULTS)) {
            if (typeof row?.ref !== 'string') continue;
            let ref: Ref;
            try {
                ref = Ref.fromTxidVoutString(row.ref);
            } catch {
                continue;
            }
            const total = optSupply(row.total_supply);
            results.push({
                refDisplay: ref.toDisplayHex(),
                refShort: ref.toRxindexerForm(),
                name: typeof row.name === 'string' ? row.name : undefined,
                ticker: typeof row.ticker === 'string' ? row.ticker : undefined,
                typeLabel: typeof row.type_name === 'string' ? row.type_name : 'Token',
                deployHeight: typeof row.deploy_height === 'number' ? row.deploy_height : undefined,
                supply: total && total !== '0'
                    ? { total, minted: optSupply(row.mined_supply) }
                    : undefined,
            });
        }
        return NextResponse.json({ results }, {
            headers: { 'Cache-Control': 'public, max-age=60' },
        });
    } catch (error) {
        console.error(`Glyph search failed for "${q}":`, error);
        return NextResponse.json({ error: 'Search failed' }, { status: 502 });
    }
}
