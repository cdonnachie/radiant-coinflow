'use client';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Hash, Info } from 'lucide-react';
import { CoinFlowAnalyzer } from '@/components/CoinFlowAnalyzer';

export default function HomePage() {
    const [activeTab, setActiveTab] = useState<'txid'>('txid');

    return (
        <div className="space-y-8">
            {/* Hero */}
            <div className="text-center space-y-4 py-8">
                <div className="flex items-center justify-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Activity className="w-6 h-6 text-primary" />
                    </div>
                </div>
                <h1 className="text-4xl font-bold tracking-tight">
                    CoinFlow <span className="text-primary">Explorer</span>
                </h1>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                    Trace and visualize where coins go on the{' '}
                    <a
                        href="https://radiantblockchain.org"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        Radiant Blockchain
                    </a>
                    . Follow the money from any UTXO through the entire transaction graph.
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                    <Badge variant="secondary">Radiant (RXD) Blockchain</Badge>
                    <Badge variant="secondary">Interactive Graph Visualization</Badge>
                    <Badge variant="secondary">Wallet Clustering</Badge>
                    <Badge variant="secondary">Exchange Detection</Badge>
                </div>
            </div>

            {/* How it works */}
            <Card className="bg-muted/30 border-primary/20">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Info className="w-4 h-4 text-primary" />
                        How It Works
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                                1
                            </div>
                            <div>
                                <strong>Enter a TXID or Address</strong>
                                <p className="text-muted-foreground mt-1">
                                    Paste a transaction ID and output index, or look up an address to browse its outputs and pick one to trace.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                                2
                            </div>
                            <div>
                                <strong>Analysis Runs</strong>
                                <p className="text-muted-foreground mt-1">
                                    Traces forward (where coins went) or backward (where they came from) up to your configured depth, querying your Radiant node or ElectrumX server.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                                3
                            </div>
                            <div>
                                <strong>Explore Results</strong>
                                <p className="text-muted-foreground mt-1">
                                    View the interactive flow graph, wallet clusters, final destinations, and known exchange and mining pool activity.
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Analyzer */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Hash className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold">Analyze Coin Flow</h2>
                </div>
                <CoinFlowAnalyzer />
            </div>
        </div>
    );
}
