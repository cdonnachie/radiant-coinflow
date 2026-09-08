import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, Flag, Github, Scale, ShieldQuestion } from 'lucide-react';

export const metadata: Metadata = {
    title: 'About — CoinFlow Explorer',
    description:
        'What CoinFlow Explorer shows, where its data comes from, its labeling policy, and how to dispute a wrong label.',
};

const DISPUTE_URL =
    'https://github.com/cdonnachie/radiant-coinflow/issues/new' +
    '?title=' + encodeURIComponent('Label dispute: <entity name>') +
    '&body=' + encodeURIComponent(
        [
            '**Address(es) affected:**',
            '',
            '**Label shown:**',
            '',
            '**Why it is wrong (evidence helps — txids, announcements, signed messages):**',
            '',
        ].join('\n'),
    );

export default function AboutPage() {
    return (
        <div className="space-y-8 lg:space-y-12">
            <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(320px,1.2fr)] lg:items-end lg:pb-10">
                <div>
                    <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase text-primary">
                        <ShieldQuestion className="h-4 w-4" /> What this is
                    </div>
                    <h1 className="text-4xl font-bold leading-tight sm:text-5xl">About CoinFlow</h1>
                </div>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end lg:text-lg">
                    A transparency tool for the Radiant blockchain. Everything shown here is
                    already public — CoinFlow adds no data, it only makes the public ledger
                    readable.
                </p>
            </section>

            <section className="grid border md:grid-cols-2">
                <div className="border-b p-5 sm:p-6 md:border-b-0 md:border-r">
                    <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase text-primary">
                        <Eye className="h-4 w-4" /> Public data only
                    </div>
                    <h2 className="font-semibold">Where the data comes from</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Radiant is a transparent public ledger: every transaction, address, and
                        token movement is permanently published on chain by design, and anyone
                        can read it with a node or block explorer. CoinFlow queries that same
                        public record and draws it as a graph. Nothing here is private
                        information, and nothing is collected about the wallets being viewed —
                        the site keeps no accounts and no watchlists.
                    </p>
                </div>
                <div className="p-5 sm:p-6">
                    <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase text-primary">
                        <Scale className="h-4 w-4" /> Labeling policy
                    </div>
                    <h2 className="font-semibold">Services, never individuals</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        CoinFlow labels <strong className="text-foreground">services only</strong> —
                        exchanges, mining pools, and similar institutions — never private
                        individuals, and it will stay that way. Wallet clusters are{' '}
                        <strong className="text-foreground">estimates</strong> produced by
                        heuristics (shared transaction inputs, known deposit flows) and are shown
                        with confidence levels, not presented as facts. Heuristics can be wrong.
                        The label set itself is open data,{' '}
                        <a
                            href="https://github.com/cdonnachie/radiant-coinflow"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            maintained in the public repository
                        </a>{' '}
                        where anyone can review how it was assembled.
                    </p>
                </div>
            </section>

            <section className="border p-5 sm:p-6">
                <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase text-primary">
                    <Flag className="h-4 w-4" /> Corrections
                </div>
                <h2 className="font-semibold">Dispute a wrong label</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    If an address or cluster is labeled with the wrong entity — or labeled at
                    all when it shouldn&apos;t be — open an issue and it will be reviewed.
                    Evidence (transaction ids, official wallet announcements, or a signed
                    message from the address) speeds things up considerably.
                </p>
                <a
                    href={DISPUTE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 border-b-2 border-primary pb-1 text-sm font-semibold text-primary"
                >
                    <Github className="h-4 w-4" /> Open a label dispute on GitHub
                </a>
            </section>

            <p className="text-sm text-muted-foreground">
                Questions about how a trace works? Start with the{' '}
                <Link href="/" className="text-primary hover:underline">
                    analyzer
                </Link>{' '}
                or the{' '}
                <Link href="/token" className="text-primary hover:underline">
                    token journey
                </Link>{' '}
                pages — every figure shown links back to the underlying transactions.
            </p>
        </div>
    );
}
