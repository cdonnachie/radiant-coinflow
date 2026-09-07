import { NextResponse } from 'next/server';
import { Ref } from '@/lib/glyph/ref';
import { getGlyphMetadata } from '@/server/glyph/decode';

export const runtime = 'nodejs';

/**
 * Serves a glyph's embedded icon. Only passive raster formats sniffed from the
 * actual bytes (png/jpeg/gif/webp) are ever served — declared MIME types are
 * hostile input, and SVG/HTML are active content that must never render.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ ref: string }> },
) {
    let ref: Ref;
    try {
        ref = Ref.parse((await params).ref);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    try {
        const { icon } = await getGlyphMetadata(ref);
        if (!icon) return new NextResponse(null, { status: 404 });
        return new NextResponse(Buffer.from(icon.bytes), {
            headers: {
                'Content-Type': icon.mime,
                'Content-Length': String(icon.bytes.length),
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error(`Glyph icon lookup failed for ${ref.toDisplayHex()}:`, error);
        return new NextResponse(null, { status: 502 });
    }
}
