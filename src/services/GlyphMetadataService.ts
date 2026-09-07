/**
 * Client-side glyph metadata fetcher: dedupes refs, coalesces in-flight
 * requests, and caches results for the session. Refs are 72-hex display form.
 */

import type { GlyphMetadata } from '@/types/glyph';

const cache = new Map<string, GlyphMetadata>();
const inFlight = new Map<string, Promise<GlyphMetadata | null>>();

const CONCURRENCY = 6;

async function fetchOne(refDisplay: string): Promise<GlyphMetadata | null> {
    try {
        const res = await fetch(`/api/glyph/${refDisplay}`);
        if (!res.ok) return null;
        const meta = (await res.json()) as GlyphMetadata;
        cache.set(refDisplay, meta);
        return meta;
    } catch {
        return null;
    }
}

function getOrFetch(refDisplay: string): Promise<GlyphMetadata | null> {
    const cached = cache.get(refDisplay);
    if (cached) return Promise.resolve(cached);
    let pending = inFlight.get(refDisplay);
    if (!pending) {
        pending = fetchOne(refDisplay).finally(() => inFlight.delete(refDisplay));
        inFlight.set(refDisplay, pending);
    }
    return pending;
}

/** Fetch metadata for many refs; the result map contains only resolved entries. */
export async function getGlyphMetadataMany(
    refs: string[],
): Promise<Record<string, GlyphMetadata>> {
    const unique = [...new Set(refs)];
    const out: Record<string, GlyphMetadata> = {};

    for (let i = 0; i < unique.length; i += CONCURRENCY) {
        const batch = unique.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(getOrFetch));
        for (let j = 0; j < batch.length; j++) {
            const meta = results[j];
            if (meta) out[batch[j]] = meta;
        }
    }
    return out;
}
