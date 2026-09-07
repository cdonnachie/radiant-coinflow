import { NextResponse } from 'next/server';
import { Ref, RefError } from '@/lib/glyph/ref';
import { walkTokenJourney } from '@/server/glyph/journey';
import type { TokenJourney } from '@/types/glyph';

export const runtime = 'nodejs';

// Journeys change as tokens move — cache briefly to absorb page reloads.
const JOURNEY_TTL_MS = 60_000;
const journeyCache = new Map<string, { journey: TokenJourney; fetchedAt: number }>();
const JOURNEY_CACHE_MAX = 500;

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

    const key = ref.toDisplayHex();
    const cached = journeyCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < JOURNEY_TTL_MS) {
        return NextResponse.json(cached.journey);
    }

    try {
        const journey = await walkTokenJourney(ref);
        if (journeyCache.size >= JOURNEY_CACHE_MAX) {
            const oldest = journeyCache.keys().next().value;
            if (oldest !== undefined) journeyCache.delete(oldest);
        }
        journeyCache.set(key, { journey, fetchedAt: Date.now() });
        return NextResponse.json(journey);
    } catch (error) {
        console.error(`Token journey failed for ${key}:`, error);
        return NextResponse.json({ error: 'Token journey lookup failed' }, { status: 502 });
    }
}
