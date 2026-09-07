import type { GlyphMetadata } from '@/types/glyph';

/**
 * Server-side glyph caches. Stored on globalThis (same pattern as the backend
 * cache in src/server/backends/index.ts) so they survive route-module reloads
 * in dev. Glyph metadata is immutable once decoded; "not found" entries get a
 * short TTL in case the indexer is still catching up.
 */

interface MetaEntry {
    meta: GlyphMetadata;
    /** Epoch ms after which a not-found entry is stale; undefined = permanent. */
    expiresAt?: number;
}

export interface CachedIcon {
    mime: string;
    bytes: Uint8Array;
}

interface GlyphCaches {
    meta: Map<string, MetaEntry>;
    icons: Map<string, CachedIcon>;
    iconBytesTotal: number;
}

const CACHE_KEY = Symbol.for('radiant-coinflow.glyph-caches');

const META_MAX = 2000;
const NOT_FOUND_TTL_MS = 60_000;
export const ICON_MAX_BYTES = 512 * 1024;
const ICON_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

function getCaches(): GlyphCaches {
    const store = globalThis as unknown as Record<symbol, GlyphCaches | undefined>;
    let caches = store[CACHE_KEY];
    if (!caches) {
        caches = { meta: new Map(), icons: new Map(), iconBytesTotal: 0 };
        store[CACHE_KEY] = caches;
    }
    return caches;
}

export function getCachedMeta(refDisplay: string): GlyphMetadata | undefined {
    const { meta } = getCaches();
    const entry = meta.get(refDisplay);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        meta.delete(refDisplay);
        return undefined;
    }
    // LRU touch
    meta.delete(refDisplay);
    meta.set(refDisplay, entry);
    return entry.meta;
}

export function setCachedMeta(refDisplay: string, value: GlyphMetadata): void {
    const { meta } = getCaches();
    if (meta.size >= META_MAX) {
        const oldest = meta.keys().next().value;
        if (oldest !== undefined) meta.delete(oldest);
    }
    meta.set(refDisplay, {
        meta: value,
        expiresAt: value.found ? undefined : Date.now() + NOT_FOUND_TTL_MS,
    });
}

export function getCachedIcon(refDisplay: string): CachedIcon | undefined {
    return getCaches().icons.get(refDisplay);
}

export function setCachedIcon(refDisplay: string, icon: CachedIcon): void {
    const caches = getCaches();
    if (icon.bytes.length > ICON_MAX_BYTES) return;
    while (caches.iconBytesTotal + icon.bytes.length > ICON_TOTAL_MAX_BYTES && caches.icons.size > 0) {
        const oldest = caches.icons.keys().next().value;
        if (oldest === undefined) break;
        caches.iconBytesTotal -= caches.icons.get(oldest)!.bytes.length;
        caches.icons.delete(oldest);
    }
    caches.icons.set(refDisplay, icon);
    caches.iconBytesTotal += icon.bytes.length;
}
