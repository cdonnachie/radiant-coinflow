import { NextResponse } from 'next/server';
import { Ref, RefError } from '@/lib/glyph/ref';
import { getGlyphMetadata } from '@/server/glyph/decode';

// The chain backend may hold a persistent ElectrumX socket — Node runtime.
export const runtime = 'nodejs';

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

    try {
        const { meta } = await getGlyphMetadata(ref);
        return NextResponse.json(meta, {
            headers: { 'Cache-Control': 'public, max-age=300' },
        });
    } catch (error) {
        console.error(`Glyph metadata lookup failed for ${ref.toDisplayHex()}:`, error);
        return NextResponse.json({ error: 'Glyph lookup failed' }, { status: 502 });
    }
}
