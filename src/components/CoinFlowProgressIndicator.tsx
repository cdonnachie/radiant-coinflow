import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Activity, AlertCircle, CheckCircle, X } from 'lucide-react';

interface CoinFlowProgressProps {
    isAnalyzing: boolean;
    progress?: {
        currentDepth: number;
        maxDepth: number;
        nodesFound: number;
        edgesFound: number;
        requestsMade: number;
        maxRequests: number;
        currentOperation?: string;
        elapsedTimeMs: number;
        estimatedRemainingMs?: number;
        errors: number;
    };
    onCancel?: () => void;
}

export default function CoinFlowProgressIndicator({ isAnalyzing, progress, onCancel }: CoinFlowProgressProps) {
    if (!isAnalyzing && !progress) return null;

    const formatTime = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    return (
        <Card className="w-full">
            <CardContent className="pt-6">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-500 animate-spin" />
                            <h3 className="font-semibold">Analyzing Coin Flow</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {progress && (
                                <Badge variant="secondary" className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatTime(progress.elapsedTimeMs)}
                                </Badge>
                            )}
                            {isAnalyzing && onCancel && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={onCancel}
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                    <X className="w-4 h-4 mr-1" />
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="text-center">
                        <div className="text-lg font-medium text-foreground">
                            {progress?.currentOperation || 'Initializing analysis...'}
                        </div>
                    </div>

                    {progress && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-blue-600">{progress.currentDepth}</div>
                                <div className="text-xs text-muted-foreground">Depth ({progress.maxDepth} max)</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-green-600">{progress.nodesFound}</div>
                                <div className="text-xs text-muted-foreground">Nodes Found</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-purple-600">{progress.edgesFound}</div>
                                <div className="text-xs text-muted-foreground">Transactions</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-orange-600">{progress.requestsMade}</div>
                                <div className="text-xs text-muted-foreground">API Calls ({progress.maxRequests} max)</div>
                            </div>
                        </div>
                    )}

                    {progress && (
                        <div className="flex flex-wrap gap-2">
                            {progress.errors > 0 && (
                                <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {progress.errors} error{progress.errors !== 1 ? 's' : ''}
                                </Badge>
                            )}
                            {progress.estimatedRemainingMs && (
                                <Badge variant="outline" className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    ~{formatTime(progress.estimatedRemainingMs)} remaining
                                </Badge>
                            )}
                            {!isAnalyzing && progress.currentOperation?.includes('complete') && (
                                <Badge variant="default" className="flex items-center gap-1 bg-green-600">
                                    <CheckCircle className="w-3 h-3" />
                                    Analysis Complete
                                </Badge>
                            )}
                        </div>
                    )}

                    {progress && progress.requestsMade > 100 && (
                        <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
                            <strong>Performance Tip:</strong> Large analyses may take several minutes.
                            Consider reducing max depth for faster results.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
