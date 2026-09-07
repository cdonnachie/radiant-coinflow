/**
 * Glyph metadata resolution: indexer hint first (fast, has decimals/supply),
 * then local envelope decode from the reveal transaction (trusted, works on
 * every backend, and covers deployments without a /glyphs endpoint).
 */

import { getChainBackend } from '@/server/backends';
import type { GlyphMetadata, GlyphTokenType } from '@/types/glyph';
import { hexToBytes } from '@/lib/glyph/bytes';
import type { Ref } from '@/lib/glyph/ref';
import { getCachedIcon, getCachedMeta, setCachedIcon, setCachedMeta, ICON_MAX_BYTES } from './cache';
import type { CachedIcon } from './cache';
import { findGlyphEnvelope } from './envelope';
import { fetchGlyphHint } from './indexer';
import type { GlyphHint } from './indexer';
import { sniffMediaType } from './media';
import { parseGlyphPayload, GLYPH_FT, GLYPH_NFT, GLYPH_DAT, GLYPH_DMINT, GLYPH_CONTAINER } from './payload';
import type { ParsedGlyphPayload, GlyphEmbeddedFile } from './payload';
import { walkScript } from './walker';

const MAX_ENVELOPE_PAYLOAD = 1024 * 1024;

interface VerboseTx {
    vin?: Array<{ txid?: string; vout?: number; coinbase?: string; scriptSig?: { hex?: string } }>;
}

const TYPE_LABELS: Record<GlyphTokenType, string> = {
    nft: 'NFT',
    ft: 'FT',
    dmint: 'dMint',
    container: 'Container',
    dat: 'Data',
    unknown: 'Token',
};

function classifyProtocols(protocols: number[] | undefined): GlyphTokenType {
    if (!protocols?.length) return 'unknown';
    const set = new Set(protocols);
    if (set.has(GLYPH_DMINT)) return 'dmint';
    if (set.has(GLYPH_NFT)) return 'nft';
    if (set.has(GLYPH_FT)) return 'ft';
    if (set.has(GLYPH_CONTAINER)) return 'container';
    if (set.has(GLYPH_DAT)) return 'dat';
    return 'unknown';
}

/** Pick the icon file from a decoded payload: key "main" preferred, else the first embedded image. */
function pickPayloadIcon(payload: ParsedGlyphPayload): CachedIcon | undefined {
    const embedded = payload.files.filter((f): f is GlyphEmbeddedFile => f.kind === 'embedded');
    const ordered = [
        ...embedded.filter((f) => f.key === 'main'),
        ...embedded.filter((f) => f.key !== 'main'),
    ];
    for (const file of ordered) {
        if (file.bytes.length === 0 || file.bytes.length > ICON_MAX_BYTES) continue;
        const sniffed = sniffMediaType(file.bytes);
        if (sniffed.kind === 'image') return { mime: sniffed.mime, bytes: file.bytes };
    }
    return undefined;
}

function hintIcon(hint: GlyphHint): CachedIcon | undefined {
    if (!hint.embed || hint.embed.data.length === 0 || hint.embed.data.length > ICON_MAX_BYTES) {
        return undefined;
    }
    const sniffed = sniffMediaType(hint.embed.data);
    if (sniffed.kind !== 'image') return undefined; // never trust the declared type
    return { mime: sniffed.mime, bytes: hint.embed.data };
}

/**
 * Find and decode the glyph envelope in the reveal transaction. The envelope
 * for THIS token sits in the input that spends the token's commit outpoint;
 * fall back to the first input carrying any envelope (single-token reveals).
 */
function decodeRevealTx(tx: VerboseTx, ref: Ref): ParsedGlyphPayload | undefined {
    const vins = tx.vin ?? [];
    const commitVinIndex = vins.findIndex(
        (v) => v.txid === ref.txidDisplay && v.vout === ref.vout,
    );
    const order = commitVinIndex >= 0
        ? [commitVinIndex, ...vins.map((_, i) => i).filter((i) => i !== commitVinIndex)]
        : vins.map((_, i) => i);

    for (const i of order) {
        const scriptSigHex = vins[i]?.scriptSig?.hex;
        if (!scriptSigHex) continue;
        try {
            const { ops } = walkScript(hexToBytes(scriptSigHex), { tolerant: true });
            const envelope = findGlyphEnvelope(ops, { maxPayloadSize: MAX_ENVELOPE_PAYLOAD });
            if (!envelope) continue;
            return parseGlyphPayload(envelope.payload);
        } catch {
            continue; // malformed envelope in this input — try the next
        }
    }
    return undefined;
}

async function resolveRevealTxid(ref: Ref, hint: GlyphHint | null): Promise<string | undefined> {
    if (hint?.deployTxid) return hint.deployTxid;
    try {
        const spent = await getChainBackend().call('getspentinfo', [
            { txid: ref.txidDisplay, index: ref.vout },
        ]) as { txid?: string } | null;
        return spent?.txid ?? undefined;
    } catch {
        return undefined; // unspent commit or lookup failure — no reveal to decode
    }
}

export interface GlyphResolution {
    meta: GlyphMetadata;
    icon?: CachedIcon;
}

export async function getGlyphMetadata(ref: Ref): Promise<GlyphResolution> {
    const refDisplay = ref.toDisplayHex();

    const cachedMeta = getCachedMeta(refDisplay);
    if (cachedMeta) {
        const cachedIcon = getCachedIcon(refDisplay);
        // Re-resolve when the icon was evicted but the metadata says one exists.
        if (!cachedMeta.hasIcon || cachedIcon) {
            return { meta: cachedMeta, icon: cachedIcon };
        }
    }

    const hint = await fetchGlyphHint(ref.toRxindexerForm());

    let payload: ParsedGlyphPayload | undefined;
    let revealTxid = hint?.deployTxid;
    try {
        revealTxid = await resolveRevealTxid(ref, hint);
        if (revealTxid) {
            const tx = await getChainBackend().call('getrawtransaction', [revealTxid]) as VerboseTx;
            payload = decodeRevealTx(tx, ref);
        }
    } catch {
        // backend unavailable or tx fetch failed — hint-only metadata below
    }

    const found = Boolean(payload) || Boolean(hint && (hint.name || hint.ticker || hint.protocols));
    const protocols = payload
        ? payload.protocols.filter((p): p is number => typeof p === 'number')
        : hint?.protocols;
    const tokenType = classifyProtocols(protocols);

    const icon = (payload && pickPayloadIcon(payload)) ?? (hint ? hintIcon(hint) : undefined);

    const meta: GlyphMetadata = {
        refDisplay,
        refShort: ref.toRxindexerForm(),
        found,
        name: payload?.name ?? hint?.name,
        ticker: payload?.ticker ?? hint?.ticker,
        description: payload?.description,
        tokenType,
        typeLabel: TYPE_LABELS[tokenType],
        protocols,
        decimals: hint?.decimals,
        deployTxid: revealTxid,
        deployHeight: hint?.deployHeight,
        // A zero total is indexer filler (e.g. NFTs have no supply concept).
        supply: hint?.totalSupply && hint.totalSupply !== '0'
            ? { total: hint.totalSupply, minted: hint.mintedSupply }
            : undefined,
        hasIcon: Boolean(icon),
        iconMime: icon?.mime,
        source: payload && hint ? 'both' : payload ? 'decoded' : hint ? 'indexer' : 'none',
    };

    setCachedMeta(refDisplay, meta);
    if (icon) setCachedIcon(refDisplay, icon);
    return { meta, icon };
}
