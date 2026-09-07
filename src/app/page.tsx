'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowDownRight, CircleDot, Hash, Network, ScanSearch } from 'lucide-react';
import { CoinFlowAnalyzer } from '@/components/CoinFlowAnalyzer';

/** Reads ?txid=&vout=&token= so token pages can deep-link into the tracer. */
function AnalyzerWithParams() {
    const searchParams = useSearchParams();
    const txid = searchParams.get('txid') ?? undefined;
    const voutRaw = searchParams.get('vout');
    const vout = voutRaw !== null && /^\d+$/.test(voutRaw) ? Number(voutRaw) : undefined;
    const tokenRaw = searchParams.get('token');
    const token = tokenRaw !== null && /^[0-9a-f]{72}$/i.test(tokenRaw) ? tokenRaw.toLowerCase() : undefined;
    return <CoinFlowAnalyzer initialTxid={txid} initialVout={vout} initialTokenRef={token} />;
}

export default function HomePage() {
    return (
        <div className="space-y-10 lg:space-y-14">
            <section className="grid overflow-hidden border bg-card lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="flex flex-col justify-center p-5 sm:p-10 lg:p-12">
                    <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-medium uppercase text-primary sm:mb-6 sm:text-[11px]">
                        <span className="inline-block h-2 w-2 bg-primary" />
                        UTXO route analysis / RXD
                    </div>
                    <h1 className="max-w-3xl text-3xl font-bold leading-[1.08] sm:text-5xl sm:leading-[1.05] lg:text-6xl">
                        Trace the route of every coin.
                    </h1>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-5 sm:text-lg sm:leading-7">
                        Inspect where a Radiant transaction output came from and where it moved next.
                        Map wallet clusters, mining pools, known exchanges, and final destinations on one graph.
                    </p>
                    <a href="#analyzer" className="mt-5 inline-flex w-fit items-center gap-2 border-b-2 border-primary pb-1 text-sm font-semibold text-primary sm:mt-8">
                        Open the analyzer <ArrowDownRight className="h-4 w-4" />
                    </a>
                </div>
                <div className="route-map relative min-h-[220px] overflow-hidden border-t bg-foreground p-4 text-background sm:min-h-[340px] sm:p-6 lg:border-l lg:border-t-0">
                    <div className="relative z-10 flex items-center justify-between font-mono text-[10px] uppercase text-background/55">
                        <span>Transaction route</span>
                        <span>Forward / backward</span>
                    </div>
                    <div className="route-line route-line-a" />
                    <div className="route-line route-line-b" />
                    <div className="route-line route-line-c" />
                    <div className="route-node left-[12%] top-[46%]">
                        <CircleDot /><span>UTXO:0</span>
                    </div>
                    <div className="route-node left-[48%] top-[28%]">
                        <Network /><span>CLUSTER</span>
                    </div>
                    <div className="route-node left-[67%] top-[65%]">
                        <ScanSearch /><span>OUTPUT:2</span>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 flex justify-between border-t border-background/20 pt-3 font-mono text-[9px] text-background/50 sm:bottom-5 sm:left-6 sm:right-6 sm:text-[10px]">
                        <span>DEPTH 05</span><span>100 TX MAX</span><span>CONFIRMED</span>
                    </div>
                </div>
            </section>

            <section aria-labelledby="workflow-title">
                <div className="mb-4 flex items-center gap-2">
                    <span className="font-mono text-xs text-primary">01-03</span>
                    <h2 id="workflow-title" className="text-sm font-semibold uppercase">From outpoint to destination</h2>
                </div>
                <div className="grid border md:grid-cols-3">
                    {[
                        ['01 / LOCATE', 'Enter an address or TXID', 'Browse address outputs or target a specific transaction output directly.'],
                        ['02 / TRACE', 'Set scope and direction', 'Follow value forward or backward with explicit depth and transaction limits.'],
                        ['03 / INSPECT', 'Read the transaction graph', 'Examine destinations, wallet clusters, exchanges, pools, and token movement.'],
                    ].map(([step, title, description], index) => (
                        <div key={step} className={`p-5 ${index < 2 ? 'border-b md:border-b-0 md:border-r' : ''}`}>
                            <span className="font-mono text-xs text-muted-foreground">{step}</span>
                            <h3 className="mt-5 font-semibold">{title}</h3>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section id="analyzer" className="scroll-mt-32 space-y-5">
                <div className="flex items-end justify-between gap-4 border-b pb-4">
                    <div>
                        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase text-primary">
                            <Hash className="h-3.5 w-3.5" /> Live query
                        </div>
                        <h2 className="text-2xl font-bold sm:text-3xl">Analyze coin flow</h2>
                    </div>
                    <span className="hidden font-mono text-[10px] uppercase text-muted-foreground sm:block">Public chain data</span>
                </div>
                <Suspense fallback={<CoinFlowAnalyzer />}>
                    <AnalyzerWithParams />
                </Suspense>
            </section>
        </div>
    );
}
