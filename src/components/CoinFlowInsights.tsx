import React from 'react';
import { formatRxd } from '@/lib/amounts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    AlertTriangle,
    CheckCircle,
    Info,
    Building,
    Users,
    Target,
    Zap,
} from 'lucide-react';
import type { CoinFlowAnalysisResult } from '@/types/coinFlow';

interface CoinFlowInsightsProps {
    analysis: CoinFlowAnalysisResult;
    onExplorePattern?: (pattern: string) => void;
}

export default function CoinFlowInsights({ analysis, onExplorePattern }: CoinFlowInsightsProps) {
    const { graph, summary } = analysis;

    const totalValue = summary.totalAmount;
    const finalDestinations = summary.finalDestinations.length;
    const exchangeDestinations = summary.finalDestinations.filter((dest) =>
        dest.estimatedWallet?.toLowerCase().includes('exchange') ||
        dest.estimatedWallet?.toLowerCase().includes('xeggex') ||
        dest.estimatedWallet?.toLowerCase().includes('tradeogre'),
    ).length;

    const maxDepthReached = Math.max(...graph.nodes.map((n) => n.depth), 0);

    const patterns = detectPatterns(analysis);

    function detectPatterns(analysis: CoinFlowAnalysisResult) {
        const patterns: Array<{
            type: string;
            title: string;
            description: string;
            severity: 'info' | 'warning' | 'success';
            confidence: number;
            icon: React.ReactNode;
        }> = [];
        const { graph } = analysis;

        if (graph.nodes.filter((n) => n.depth === 1).length > 3) {
            patterns.push({
                type: 'mixing',
                title: 'Potential Mixing Detected',
                description: 'Funds were split across multiple addresses immediately after the initial transaction',
                severity: 'info',
                confidence: 0.7,
                icon: <Users className="w-4 h-4" />,
            });
        }

        const exchangeNodes = graph.nodes.filter(
            (n) =>
                n.wallet?.serviceName?.toLowerCase().includes('exchange') ||
                n.wallet?.name.toLowerCase().includes('xeggex') ||
                n.wallet?.name.toLowerCase().includes('tradeogre'),
        );
        if (exchangeNodes.length > 0) {
            patterns.push({
                type: 'exchange',
                title: 'Exchange Activity Detected',
                description: `${exchangeNodes.length} transaction${exchangeNodes.length !== 1 ? 's' : ''} involved known exchange addresses`,
                severity: 'success',
                confidence: 0.9,
                icon: <Building className="w-4 h-4" />,
            });
        }

        const consolidationNodes = graph.nodes.filter(
            (n) => graph.edges.filter((e) => e.to === n.id).length > 2,
        );
        if (consolidationNodes.length > 0) {
            patterns.push({
                type: 'consolidation',
                title: 'Fund Consolidation',
                description: 'Multiple inputs were consolidated into fewer outputs',
                severity: 'info',
                confidence: 0.8,
                icon: <Target className="w-4 h-4" />,
            });
        }

        const rapidTransactions = graph.edges.filter((e) => {
            const nextEdge = graph.edges.find((next) => next.from === e.to);
            if (!nextEdge || !e.timestamp || !nextEdge.timestamp) return false;
            return nextEdge.timestamp.getTime() - e.timestamp.getTime() < 3600000;
        });
        if (rapidTransactions.length > 2) {
            patterns.push({
                type: 'velocity',
                title: 'High Transaction Velocity',
                description: 'Funds moved quickly through multiple addresses',
                severity: 'warning',
                confidence: 0.6,
                icon: <Zap className="w-4 h-4" />,
            });
        }

        return patterns;
    }

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'warning': return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20';
            case 'success': return 'border-green-500 bg-green-50 dark:bg-green-900/20';
            default: return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20';
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
            case 'success': return <CheckCircle className="w-4 h-4 text-green-600" />;
            default: return <Info className="w-4 h-4 text-blue-600" />;
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5" />
                        Analysis Insights
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-4 bg-muted/50 rounded-lg">
                            <DollarSign className="w-6 h-6 mx-auto mb-2 text-green-600" />
                            <div className="text-2xl font-bold">{formatRxd(totalValue, 4)}</div>
                            <div className="text-sm text-muted-foreground">Total RXD Tracked</div>
                        </div>
                        <div className="text-center p-4 bg-muted/50 rounded-lg">
                            <Target className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                            <div className="text-2xl font-bold">{finalDestinations}</div>
                            <div className="text-sm text-muted-foreground">Final Destinations</div>
                        </div>
                        <div className="text-center p-4 bg-muted/50 rounded-lg">
                            <Building className="w-6 h-6 mx-auto mb-2 text-purple-600" />
                            <div className="text-2xl font-bold">{exchangeDestinations}</div>
                            <div className="text-sm text-muted-foreground">Exchange Flows</div>
                        </div>
                        <div className="text-center p-4 bg-muted/50 rounded-lg">
                            <TrendingDown className="w-6 h-6 mx-auto mb-2 text-orange-600" />
                            <div className="text-2xl font-bold">{maxDepthReached}</div>
                            <div className="text-sm text-muted-foreground">Max Depth Reached</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {patterns.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="w-5 h-5" />
                            Detected Patterns
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {patterns.map((pattern, index) => (
                                <div
                                    key={index}
                                    className={`p-4 rounded-lg border-l-4 ${getSeverityColor(pattern.severity)}`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5">{pattern.icon}</div>
                                            <div>
                                                <h3 className="font-semibold text-sm">{pattern.title}</h3>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {pattern.description}
                                                </p>
                                                <div className="flex items-center gap-2 mt-2">
                                                    {getSeverityIcon(pattern.severity)}
                                                    <span className="text-xs text-muted-foreground">
                                                        Confidence: {(pattern.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        {onExplorePattern && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => onExplorePattern(pattern.type)}
                                            >
                                                Explore
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
