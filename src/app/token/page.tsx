'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { Ref } from '@/lib/glyph/ref';
import type { GlyphSearchResult } from '@/types/glyph';

export default function TokenLandingPage() {
    const router = useRouter();
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<GlyphSearchResult[] | null>(null);

    const handleLookup = async () => {
        const query = input.trim();
        if (!query) return;
        setError(null);
        setResults(null);

        // A valid ref goes straight to the journey; anything else is a name search.
        try {
            const ref = Ref.parse(query);
            router.push(`/token/${ref.toDisplayHex()}`);
            return;
        } catch {
            // not a ref — search by name
        }

        setIsSearching(true);
        try {
            const res = await fetch(`/api/glyph-search?q=${encodeURIComponent(query)}`);
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                setError(body?.error ?? 'Search failed');
                return;
            }
            setResults(body?.results ?? []);
        } catch {
            setError('Search failed');
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="text-center space-y-4 py-8">
                <div className="flex items-center justify-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                </div>
                <h1 className="text-4xl font-bold tracking-tight">
                    Glyph <span className="text-primary">Token Journey</span>
                </h1>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                    Follow a Glyphs token on the Radiant blockchain — from its mint, through
                    every transfer, to where it rests today.
                </p>
            </div>

            <Card className="max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle className="text-base">Look up a token</CardTitle>
                    <CardDescription>
                        Enter a token name, or its ref (the commit outpoint of its Glyph
                        deploy): 72-hex, <code>txid_vout</code>, or <code>txid:vout</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor="token-query">Token name or ref</Label>
                        <Input
                            id="token-query"
                            placeholder="e.g. RadiantBulldog, or b45dc453…a2a8_0"
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                setError(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleLookup();
                            }}
                        />
                        {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                    <Button
                        onClick={handleLookup}
                        disabled={!input.trim() || isSearching}
                        className="w-full"
                    >
                        {isSearching ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Search className="h-4 w-4 mr-2" />
                        )}
                        Find Token
                    </Button>
                </CardContent>
            </Card>

            {results !== null && (
                <div className="max-w-2xl mx-auto space-y-3">
                    {results.length === 0 ? (
                        <Card>
                            <CardContent className="py-10 text-center text-muted-foreground">
                                <p>No tokens matched that name.</p>
                                <p className="text-xs mt-2">
                                    Matching is by full token name (case-insensitive) — try the
                                    exact name, or paste the token&apos;s ref directly.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            <p className="text-sm text-muted-foreground">
                                {results.length} {results.length === 1 ? 'token' : 'tokens'} found
                                {results.length > 1 && ' — token names are not unique, check the deploy height and ref'}
                            </p>
                            {results.map((r) => (
                                <Link key={r.refDisplay} href={`/token/${r.refDisplay}`} className="block">
                                    <Card className="hover:border-primary/50 transition-colors">
                                        <CardContent className="py-4 flex items-center gap-4">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={`/api/glyph/${r.refDisplay}/icon`}
                                                alt=""
                                                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).hidden = true;
                                                }}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium break-words">
                                                        {r.name || r.ticker || 'Unnamed token'}
                                                    </span>
                                                    {r.ticker && r.name && (
                                                        <span className="text-muted-foreground text-sm">
                                                            ({r.ticker})
                                                        </span>
                                                    )}
                                                    <Badge variant="outline">{r.typeLabel}</Badge>
                                                </div>
                                                <div className="text-xs text-muted-foreground font-mono mt-1 break-all">
                                                    {r.refShort}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                    {r.deployHeight && <>Deployed at block #{r.deployHeight}</>}
                                                    {r.supply?.total && (
                                                        <> • Supply: {r.supply.minted ?? '?'} / {r.supply.total}</>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
