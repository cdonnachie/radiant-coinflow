/**
 * RXinDexer glyph hint client. Hints are discovery/display data only — the
 * on-chain envelope decode (decode.ts) is the trusted path; hints fill in
 * indexer-only extras (decimals, supply) and provide a fast deploy_txid.
 *
 * Endpoint: GET {RADIANT_REST_URL}/glyphs/{txid}_{vout}   (404 → null)
 * Used whenever RADIANT_REST_URL is set, regardless of RADIANT_BACKEND.
 */

export interface GlyphHint {
    name?: string;
    ticker?: string;
    typeName?: string;
    protocols?: number[];
    decimals?: number;
    deployTxid?: string;
    deployHeight?: number;
    totalSupply?: string;
    mintedSupply?: string;
    /** Embedded icon bytes (already hex-decoded) + declared type (untrusted). */
    embed?: { type?: string; data: Uint8Array };
}

const HINT_TIMEOUT_MS = 8000;

function optString(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function optInt(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

function optSupply(v: unknown): string | undefined {
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    return undefined;
}

export async function fetchGlyphHint(refShort: string): Promise<GlyphHint | null> {
    const baseUrl = process.env.RADIANT_REST_URL;
    if (!baseUrl) return null;

    let raw: Record<string, unknown>;
    try {
        const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/glyphs/${refShort}`, {
            signal: AbortSignal.timeout(HINT_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const body: unknown = await res.json();
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
        raw = body as Record<string, unknown>;
    } catch {
        return null;
    }

    const hint: GlyphHint = {};
    hint.name = optString(raw.name);
    hint.ticker = optString(raw.ticker);
    hint.typeName = optString(raw.type_name) ?? optString(raw.type);
    if (Array.isArray(raw.protocols)) {
        const p = raw.protocols.filter((x): x is number => typeof x === 'number');
        if (p.length > 0) hint.protocols = p;
    }
    hint.decimals = optInt(raw.decimals);
    hint.deployTxid = optString(raw.deploy_txid);
    hint.deployHeight = optInt(raw.deploy_height);
    hint.totalSupply = optSupply(raw.total_supply);
    hint.mintedSupply = optSupply(raw.mined_supply) ?? optSupply(raw.minted_supply);

    const embed = raw.embed;
    if (typeof embed === 'object' && embed !== null && !Array.isArray(embed)) {
        const e = embed as Record<string, unknown>;
        const dataHex = optString(e.data);
        if (dataHex && /^[0-9a-fA-F]+$/.test(dataHex) && dataHex.length % 2 === 0) {
            hint.embed = {
                type: optString(e.type),
                data: Uint8Array.from(Buffer.from(dataHex, 'hex')),
            };
        }
    }

    return hint;
}
