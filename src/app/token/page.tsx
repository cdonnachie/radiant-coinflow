'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search, Sparkles } from 'lucide-react';
import { Ref } from '@/lib/glyph/ref';

export default function TokenLandingPage() {
    const router = useRouter();
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleLookup = () => {
        try {
            const ref = Ref.parse(input);
            router.push(`/token/${ref.toDisplayHex()}`);
        } catch {
            setError('Not a valid token ref — expected 72 hex chars, or txid_vout / txid:vout.');
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
                        Enter the token&apos;s ref: the commit outpoint of its Glyph deploy.
                        Accepted forms: 72-hex ref, <code>txid_vout</code>, or <code>txid:vout</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor="token-ref">Token ref</Label>
                        <Input
                            id="token-ref"
                            placeholder="e.g. b45dc453…a2a8_0"
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                setError(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleLookup();
                            }}
                            className="font-mono"
                        />
                        {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                    <Button onClick={handleLookup} disabled={!input.trim()} className="w-full">
                        <Search className="h-4 w-4 mr-2" />
                        View Token Journey
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
