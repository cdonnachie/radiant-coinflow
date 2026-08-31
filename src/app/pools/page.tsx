'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pickaxe, Clock, Users, Coins, ExternalLink, RefreshCw } from 'lucide-react';

interface PayoutEvent {
    height: number;
    ts: number;
    recipients: number;
    rxdOut: number;
}

interface PoolSummary {
    key: string;
    name: string;
    link: string | null;
    addresses: number;
    scanned: number;
    totalTx: number;
    windowStart: number | null;
    windowEnd: number | null;
    rewardBlocks: number;
    rewardRxd: number;
    payoutEvents: number;
    avgIntervalHours: number | null;
    medianRecipients: number;
    pattern: 'direct' | 'consolidation' | 'none';
    patternText: string;
    consolidatesTo?: Array<{ address: string; txCount: number; rxd: number }>;
    recent: PayoutEvent[];
}

interface PoolData {
    generatedAt: string | null;
    windowMaxTxs?: number;
    pools: PoolSummary[];
    error?: string;
}

const rxd = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' RXD';
const fmtDate = (ts: number) =>
    new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const fmtInterval = (h: number | null) =>
    h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;

export default function PoolsPage() {
    const [data, setData] = useState<PoolData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/pools')
            .then((r) => r.json())
            .then(setData)
            .catch(() => setData({ generatedAt: null, pools: [], error: 'Failed to load pool data.' }))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Pickaxe className="h-7 w-7 text-primary" />
                    Mining Pool Payouts
                </h1>
                <p className="text-muted-foreground max-w-3xl">
                    Block rewards flowing into each identified Radiant mining pool, and how they pay out —
                    directly to miners (many recipients per transaction) or by consolidating first. Figures
                    cover a recent window of each pool&apos;s activity.
                </p>
                {data?.generatedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" />
                        Updated {new Date(data.generatedAt).toLocaleString()}
                    </p>
                )}
            </div>

            {loading && <p className="text-muted-foreground">Loading pool data…</p>}

            {!loading && data?.error && (
                <Card>
                    <CardContent className="py-6 text-muted-foreground">{data.error}</CardContent>
                </Card>
            )}

            {!loading && data && data.pools.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {data.pools.map((p) => (
                        <Card key={p.key} className="flex flex-col">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between gap-2">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        {p.link ? (
                                            <a href={p.link} target="_blank" rel="noopener noreferrer"
                                               className="hover:text-primary inline-flex items-center gap-1">
                                                {p.name}
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                        ) : p.name}
                                    </CardTitle>
                                    <Badge variant={p.pattern === 'direct' ? 'default' : 'secondary'}>
                                        {p.pattern === 'direct' ? 'Direct payouts'
                                            : p.pattern === 'consolidation' ? 'Consolidates'
                                            : 'No payouts'}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4 flex-1">
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Coins className="h-3 w-3" /> Rewards
                                        </div>
                                        <div className="font-semibold mt-0.5">{p.rewardBlocks} blocks</div>
                                        <div className="text-xs text-muted-foreground">{rxd(p.rewardRxd)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Clock className="h-3 w-3" /> Cadence
                                        </div>
                                        <div className="font-semibold mt-0.5">{fmtInterval(p.avgIntervalHours)}</div>
                                        <div className="text-xs text-muted-foreground">{p.payoutEvents} events</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Users className="h-3 w-3" /> Recipients
                                        </div>
                                        <div className="font-semibold mt-0.5">~{p.medianRecipients}</div>
                                        <div className="text-xs text-muted-foreground">median / payout</div>
                                    </div>
                                </div>

                                {p.consolidatesTo && p.consolidatesTo.length > 0 && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                            Consolidates to
                                        </div>
                                        <div className="space-y-1">
                                            {p.consolidatesTo.map((c) => (
                                                <a key={c.address}
                                                   href={`https://radiantexplorer.com/address/${c.address}`}
                                                   target="_blank" rel="noopener noreferrer"
                                                   className="flex items-center justify-between text-xs gap-2 hover:text-primary">
                                                    <code className="font-mono truncate">{c.address}</code>
                                                    <span className="text-muted-foreground shrink-0">{c.txCount}×</span>
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {p.recent.length > 0 && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                            Recent payouts
                                        </div>
                                        <div className="space-y-1">
                                            {p.recent.slice(0, 5).map((e, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs gap-2">
                                                    <span className="text-muted-foreground tabular-nums">{fmtDate(e.ts)}</span>
                                                    <span className="tabular-nums">{e.recipients} → {rxd(e.rxdOut)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="text-[11px] text-muted-foreground pt-1 border-t">
                                    Window: {p.scanned.toLocaleString()} of ~{p.totalTx.toLocaleString()} txs
                                    {p.windowStart && p.windowEnd &&
                                        ` · ${new Date(p.windowStart * 1000).toLocaleDateString()}–${new Date(p.windowEnd * 1000).toLocaleDateString()}`}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
