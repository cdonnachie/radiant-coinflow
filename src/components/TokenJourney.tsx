'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowRight, Copy, ExternalLink, Flame, Loader2, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatSupply } from '@/lib/glyph/supply';
import type { GlyphMetadata, JourneyHop, TokenHolders, TokenJourney as TokenJourneyData } from '@/types/glyph';

interface TokenJourneyProps {
    refDisplay: string;
}

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
};

const shortTxid = (txid: string) => `${txid.slice(0, 10)}…${txid.slice(-8)}`;

const hopBadge = (event: JourneyHop['event']) => {
    switch (event) {
        case 'mint':
            return <Badge className="bg-blue-600 hover:bg-blue-600 text-white">Mint</Badge>;
        case 'transfer':
            return <Badge variant="secondary">Transfer</Badge>;
        case 'move':
            return <Badge variant="outline">Move</Badge>;
        case 'melt':
            return <Badge variant="destructive">Melt</Badge>;
    }
};

/** Timeline items: single hops, with runs of consecutive moves collapsed. */
type TimelineItem = { kind: 'hop'; hop: JourneyHop } | { kind: 'run'; hops: JourneyHop[] };

function groupHops(hops: JourneyHop[]): TimelineItem[] {
    const items: TimelineItem[] = [];
    let run: JourneyHop[] = [];
    const flush = () => {
        if (run.length >= 2) items.push({ kind: 'run', hops: run });
        else for (const hop of run) items.push({ kind: 'hop', hop });
        run = [];
    };
    for (const hop of hops) {
        if (hop.event === 'move') {
            run.push(hop);
        } else {
            flush();
            items.push({ kind: 'hop', hop });
        }
    }
    flush();
    return items;
}

const shortDate = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString() : '?');

/** Collapsed run of same-owner moves, expandable to the individual outpoints. */
const RunRow: React.FC<{ hops: JourneyHop[]; isLast: boolean; isResting: boolean }> = ({
    hops,
    isLast,
    isResting,
}) => {
    const holders = new Set(hops.map((h) => h.holder).filter(Boolean));
    const sameOwner = holders.size === 1 && hops.every((h) => h.holder);
    return (
        <div className="flex gap-3">
            <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${isResting ? 'bg-green-500' : 'bg-gray-400'}`} />
                {!isLast && <div className="w-px flex-1 bg-border my-1" />}
            </div>
            <div className={`flex-1 min-w-0 ${isLast ? '' : 'pb-5'}`}>
                <details>
                    <summary className="cursor-pointer list-none">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">
                                {hops.length} {sameOwner ? 'same-owner moves' : 'moves'}
                            </Badge>
                            {isResting && (
                                <span className="text-xs text-green-600 dark:text-green-500 font-medium">
                                    Current location
                                </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                                {shortDate(hops[0].timestamp)} → {shortDate(hops[hops.length - 1].timestamp)}
                                {' '}• click to expand
                            </span>
                        </div>
                        {sameOwner && hops[0].holder && (
                            <div className="flex items-center gap-2 mt-1.5">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
                                    {hops[0].holder}
                                </code>
                            </div>
                        )}
                    </summary>
                    <div className="mt-2 space-y-1 border-l pl-3">
                        {hops.map((hop) => (
                            <div key={`${hop.txid}:${hop.vout}`} className="flex items-center gap-2 flex-wrap">
                                <a
                                    href={`https://radiantexplorer.com/tx/${hop.txid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-mono text-muted-foreground hover:text-foreground hover:underline"
                                >
                                    {shortTxid(hop.txid)}
                                    {hop.vout !== undefined && `:${hop.vout}`}
                                </a>
                                <span className="text-xs text-muted-foreground">
                                    {hop.height ? `#${hop.height}` : 'unconfirmed'}
                                </span>
                                {!sameOwner && hop.holder && (
                                    <code className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                                        {hop.holder}
                                    </code>
                                )}
                            </div>
                        ))}
                    </div>
                </details>
            </div>
        </div>
    );
};

const livenessBadge = (liveness: TokenJourneyData['liveness']) => {
    switch (liveness) {
        case 'ACTIVE':
            return <Badge className="bg-green-600 hover:bg-green-600 text-white">Active</Badge>;
        case 'MELTED':
            return <Badge variant="destructive">Melted</Badge>;
        default:
            return <Badge variant="outline">Unknown</Badge>;
    }
};

const HopRow: React.FC<{ hop: JourneyHop; isLast: boolean; isResting: boolean }> = ({
    hop,
    isLast,
    isResting,
}) => (
    <div className="flex gap-3">
        {/* Timeline gutter */}
        <div className="flex flex-col items-center">
            <div
                className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${
                    hop.event === 'mint'
                        ? 'bg-blue-500'
                        : hop.event === 'melt'
                        ? 'bg-red-500'
                        : isResting
                        ? 'bg-green-500'
                        : 'bg-gray-400'
                }`}
            />
            {!isLast && <div className="w-px flex-1 bg-border my-1" />}
        </div>

        <div className={`flex-1 min-w-0 ${isLast ? '' : 'pb-5'}`}>
            <div className="flex items-center gap-2 flex-wrap">
                {hopBadge(hop.event)}
                {isResting && hop.event !== 'melt' && (
                    <span className="text-xs text-green-600 dark:text-green-500 font-medium">
                        Current location
                    </span>
                )}
                <span className="text-xs text-muted-foreground">
                    {hop.height ? `Block #${hop.height}` : 'Unconfirmed'}
                    {hop.timestamp && <> • {new Date(hop.timestamp * 1000).toLocaleString()}</>}
                </span>
            </div>

            {hop.holder && (
                <div className="flex items-center gap-2 mt-1.5">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
                        {hop.holder}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(hop.holder!)}>
                        <Copy className="h-3 w-3" />
                    </Button>
                    {!hop.isContract && (
                        <Button variant="ghost" size="sm" asChild>
                            <a
                                href={`https://radiantexplorer.com/address/${hop.holder}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </Button>
                    )}
                </div>
            )}

            <div className="flex items-center gap-2 mt-1 flex-wrap">
                <a
                    href={`https://radiantexplorer.com/tx/${hop.txid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-muted-foreground hover:text-foreground hover:underline"
                >
                    {shortTxid(hop.txid)}
                    {hop.vout !== undefined && `:${hop.vout}`}
                </a>
                {hop.vout !== undefined && (
                    <Link
                        href={`/?txid=${hop.txid}&vout=${hop.vout}`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                        <ArrowRight className="h-3 w-3" />
                        Trace RXD flow
                    </Link>
                )}
            </div>
        </div>
    </div>
);

export const TokenJourney: React.FC<TokenJourneyProps> = ({ refDisplay }) => {
    const [meta, setMeta] = useState<GlyphMetadata | null>(null);
    const [journey, setJourney] = useState<TokenJourneyData | null>(null);
    const [journeyError, setJourneyError] = useState<string | null>(null);
    const [holders, setHolders] = useState<TokenHolders | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setMeta(null);
        setJourney(null);
        setJourneyError(null);

        const metaFetch = fetch(`/api/glyph/${refDisplay}`)
            .then((r) => (r.ok ? (r.json() as Promise<GlyphMetadata>) : null))
            .catch(() => null);
        const journeyFetch = fetch(`/api/token/${refDisplay}/journey`)
            .then(async (r) => {
                if (r.ok) return r.json() as Promise<TokenJourneyData>;
                const body = await r.json().catch(() => null);
                throw new Error(body?.error ?? `Journey lookup failed (${r.status})`);
            });

        Promise.all([metaFetch, journeyFetch.catch((e: Error) => e)]).then(([m, j]) => {
            if (cancelled) return;
            setMeta(m);
            if (j instanceof Error) setJourneyError(j.message);
            else setJourney(j);
            setIsLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [refDisplay]);

    // Holders only exist for fungible/dMint tokens — fetch once the type is known.
    useEffect(() => {
        setHolders(null);
        if (!meta || (meta.tokenType !== 'ft' && meta.tokenType !== 'dmint')) return;
        let cancelled = false;
        fetch(`/api/token/${refDisplay}/holders`)
            .then((r) => (r.ok ? (r.json() as Promise<TokenHolders>) : null))
            .then((h) => {
                if (!cancelled && h && h.holders.length > 0) setHolders(h);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [refDisplay, meta]);

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-16 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Walking the token&apos;s on-chain history…
                </CardContent>
            </Card>
        );
    }

    const notFound = !journey?.found && !meta?.found;

    return (
        <div className="space-y-4">
            {/* Token header */}
            <Card>
                <CardHeader>
                    <div className="flex items-start gap-4">
                        {meta?.hasIcon && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={`/api/glyph/${refDisplay}/icon`}
                                alt=""
                                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).hidden = true;
                                }}
                            />
                        )}
                        <div className="min-w-0 flex-1">
                            <CardTitle className="flex items-center gap-2 flex-wrap">
                                <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
                                <span className="break-words">
                                    {meta?.name || meta?.ticker || 'Unknown Glyph'}
                                </span>
                                {meta?.ticker && meta.name && (
                                    <span className="text-muted-foreground font-normal">
                                        ({meta.ticker})
                                    </span>
                                )}
                                {meta?.found && <Badge variant="outline">{meta.typeLabel}</Badge>}
                                {journey && journey.kind === 'singleton' && livenessBadge(journey.liveness)}
                            </CardTitle>
                            {meta?.description && (
                                <CardDescription className="mt-1 break-words">
                                    {meta.description}
                                </CardDescription>
                            )}
                            <div className="flex items-center gap-2 mt-3">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all flex-1">
                                    {meta?.refShort ?? refDisplay}
                                </code>
                                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(refDisplay)}>
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                            {meta?.deployTxid && (
                                <div className="text-xs text-muted-foreground mt-2">
                                    Deployed in{' '}
                                    <a
                                        href={`https://radiantexplorer.com/tx/${meta.deployTxid}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono hover:underline"
                                    >
                                        {shortTxid(meta.deployTxid)}
                                    </a>
                                    {meta.deployHeight && <> at block #{meta.deployHeight}</>}
                                </div>
                            )}
                            {meta?.supply?.total && (meta.tokenType === 'ft' || meta.tokenType === 'dmint') && (
                                <div className="text-xs text-muted-foreground mt-1">
                                    Minted: {formatSupply(meta.supply.minted ?? '?', meta.decimals)} of{' '}
                                    {formatSupply(meta.supply.total, meta.decimals)} max
                                    {meta.supply.minted === meta.supply.total && ' — fully minted'}
                                </div>
                            )}
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* Journey */}
            {notFound ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p>No Glyph token was found at this ref.</p>
                        <p className="text-xs mt-2">
                            Expected a commit outpoint (txid + vout) of a Glyph deploy.
                        </p>
                    </CardContent>
                </Card>
            ) : journeyError ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p>Could not walk the token&apos;s history.</p>
                        <p className="text-xs mt-2 font-mono">{journeyError}</p>
                    </CardContent>
                </Card>
            ) : journey?.kind === 'fungible' ? (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Fungible Token</CardTitle>
                            <CardDescription>
                                Units of this token split and merge across outputs, so there is no
                                single movement chain — trace the token flow through the transaction
                                graph instead, starting from the deploy below.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {journey.hops.length > 0 && (
                                <>
                                    <HopRow hop={journey.hops[0]} isLast isResting={false} />
                                    {journey.hops[0].vout !== undefined && (
                                        <Button asChild className="w-full">
                                            <Link
                                                href={`/?txid=${journey.hops[0].txid}&vout=${journey.hops[0].vout}&token=${refDisplay}`}
                                            >
                                                <ArrowRight className="h-4 w-4 mr-2" />
                                                Trace token flow from the deploy
                                            </Link>
                                        </Button>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>
                    {holders && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Users className="h-4 w-4" />
                                    Top Holders
                                    {holders.holderCount !== undefined && (
                                        <span className="text-sm font-normal text-muted-foreground">
                                            {holders.holderCount} holders total
                                        </span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {holders.holders.map((h, i) => (
                                    <div key={h.address} className="flex items-center gap-3">
                                        <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0">
                                            {i + 1}.
                                        </span>
                                        <a
                                            href={`https://radiantexplorer.com/address/${h.address}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-mono hover:underline truncate flex-1 min-w-0"
                                        >
                                            {h.address}
                                        </a>
                                        <span className="text-xs font-medium whitespace-nowrap">
                                            {formatSupply(h.amount, meta?.decimals)}
                                            {meta?.ticker && ` ${meta.ticker}`}
                                        </span>
                                        {h.percentage !== undefined && (
                                            <span className="text-xs text-muted-foreground w-16 text-right flex-shrink-0">
                                                {h.percentage.toFixed(2)}%
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </>
            ) : journey && journey.hops.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            Token Journey
                            <span className="text-sm font-normal text-muted-foreground">
                                {journey.hops.length} {journey.hops.length === 1 ? 'event' : 'events'}
                            </span>
                            {journey.liveness === 'MELTED' && <Flame className="h-4 w-4 text-red-500" />}
                        </CardTitle>
                        <CardDescription>
                            {journey.filtered
                                ? 'Partial history: intermediate transfers were deliberately not indexed for this ref — only its mint and melt endpoints are shown.'
                                : 'Every hop below is derived from the transactions themselves — Transfer means the holder changed; Move is the same owner re-creating the outpoint (consolidation, state updates, fees).'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {(() => {
                            const items = groupHops(journey.hops);
                            return items.map((item, i) => {
                                const isLast = i === items.length - 1;
                                const isResting = isLast && journey.liveness === 'ACTIVE';
                                return item.kind === 'run' ? (
                                    <RunRow
                                        key={`run:${item.hops[0].txid}`}
                                        hops={item.hops}
                                        isLast={isLast}
                                        isResting={isResting}
                                    />
                                ) : (
                                    <HopRow
                                        key={`${item.hop.txid}:${item.hop.vout ?? 'melt'}`}
                                        hop={item.hop}
                                        isLast={isLast}
                                        isResting={isResting}
                                    />
                                );
                            });
                        })()}
                        {(journey.truncated || journey.notes.length > 0) && (
                            <>
                                <Separator className="my-4" />
                                <div className="space-y-1">
                                    {journey.notes.map((note, i) => (
                                        <p key={i} className="text-xs text-muted-foreground">
                                            {note}
                                        </p>
                                    ))}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p>No movement history available for this token.</p>
                        {journey?.notes.map((note, i) => (
                            <p key={i} className="text-xs mt-2">{note}</p>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
