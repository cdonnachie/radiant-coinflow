import Link from 'next/link';
import { Ref } from '@/lib/glyph/ref';
import { TokenJourney } from '@/components/TokenJourney';

export default async function TokenPage({ params }: { params: Promise<{ ref: string }> }) {
    const { ref: refParam } = await params;

    let refDisplay: string;
    try {
        refDisplay = Ref.parse(decodeURIComponent(refParam)).toDisplayHex();
    } catch {
        return (
            <div className="py-16 text-center text-muted-foreground space-y-2">
                <p>Not a valid token ref.</p>
                <p className="text-sm">
                    Expected 72 hex chars, or <code>txid_vout</code> / <code>txid:vout</code>.{' '}
                    <Link href="/token" className="text-primary hover:underline">
                        Try another ref
                    </Link>
                </p>
            </div>
        );
    }

    return <TokenJourney refDisplay={refDisplay} />;
}
