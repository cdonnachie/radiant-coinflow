'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import 'reactflow/dist/style.css';
import {
    Search,
    Coins,
    MapPin,
    Activity,
    AlertTriangle,
    CheckCircle,
    Users,
    Settings,
    Copy,
    ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { OptimizedCoinFlowService } from '@/services/OptimizedCoinFlowService';
import { RadiantChainService } from '@/services/RadiantChainService';
import type { AddressUtxo } from '@/services/ChainDataService';
import { formatRxd } from '@/lib/amounts';
import { CoinFlowGraphVisualization } from '@/components/CoinFlowGraph';
import type {
    CoinFlowAnalysisResult,
    CoinFlowNode,
    CoinFlowOptions,
} from '@/types/coinFlow';

interface CoinFlowAnalyzerProps {
    initialTxid?: string;
    initialVout?: number;
}

export const CoinFlowAnalyzer: React.FC<CoinFlowAnalyzerProps> = ({
    initialTxid = '',
    initialVout = 0,
}) => {
    const coinFlowService = useMemo(() => new OptimizedCoinFlowService(), []);

    const rpcService = useMemo(() => new RadiantChainService(), []);

    const [txid, setTxid] = useState(initialTxid);
    const [vout, setVout] = useState(initialVout);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const [result, setResult] = useState<CoinFlowAnalysisResult | null>(null);
    const [selectedNode, setSelectedNode] = useState<string>('');
    const [selectedNodeDetails, setSelectedNodeDetails] = useState<CoinFlowNode | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    const [inputMode, setInputMode] = useState<'txid' | 'address'>('txid');
    const [addressInput, setAddressInput] = useState('');
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [addressUtxos, setAddressUtxos] = useState<AddressUtxo[] | null>(null);
    const [utxoOffset, setUtxoOffset] = useState(0);
    const [hasMoreUtxos, setHasMoreUtxos] = useState(false);
    const UTXO_PAGE_SIZE = 20;

    const [options, setOptions] = useState<CoinFlowOptions>({
        maxDepth: 5,
        maxTransactions: 100,
        includeDust: false,
        dustThreshold: 1000,
        enableClustering: true,
        confirmedOnly: true,
        minConfirmations: 1,
        stopAtExchanges: false,
        timeoutMs: 30000,
        direction: 'forward',
    });

    useEffect(() => {
        setTxid(initialTxid || '');
        setVout(initialVout || 0);
    }, [initialTxid, initialVout]);

    useEffect(() => {
        if (selectedNode && result) {
            const node = result.graph.nodes.find((n) => n.id === selectedNode);
            setSelectedNodeDetails(node || null);
        } else {
            setSelectedNodeDetails(null);
        }
    }, [selectedNode, result]);

    const handleAnalyze = useCallback(async (overrideTxid?: string, overrideVout?: number) => {
        const effectiveTxid = (overrideTxid ?? txid).trim();
        const effectiveVout = overrideVout ?? vout;
        if (!effectiveTxid) {
            toast.error('Please enter a transaction ID');
            return;
        }

        setIsAnalyzing(true);
        setAnalysisProgress(0);
        setResult(null);

        try {
            const progressInterval = setInterval(() => {
                setAnalysisProgress((prev) => Math.min(prev + 10, 90));
            }, 500);

            const analysisResult = await coinFlowService.analyzeCoinFlow(effectiveTxid, effectiveVout, options);

            clearInterval(progressInterval);
            setAnalysisProgress(100);
            setResult(analysisResult);

            if (analysisResult.warnings.length > 0) {
                toast.warning(`Analysis completed with ${analysisResult.warnings.length} warnings`);
            } else {
                toast.success('Coin flow analysis completed successfully');
            }
        } catch (error) {
            console.error('Analysis failed:', error);
            if (error instanceof Error) {
                if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
                    toast.error('Rate limit exceeded', {
                        duration: 5000,
                        description: 'Please wait a moment and try again with reduced scope.',
                    });
                } else if (error.message.includes('timeout')) {
                    toast.error('Analysis timed out', {
                        duration: 5000,
                        description: 'Try reducing analysis depth or max transactions.',
                    });
                } else {
                    toast.error(`Analysis failed: ${error.message}`);
                }
            } else {
                toast.error('Analysis failed with unknown error');
            }
        } finally {
            setIsAnalyzing(false);
            setAnalysisProgress(0);
        }
    }, [coinFlowService, txid, vout, options]);

    const handleAddressLookup = useCallback(async () => {
        if (!addressInput.trim()) {
            toast.error('Please enter an address');
            return;
        }
        setIsLookingUp(true);
        setAddressUtxos(null);
        setUtxoOffset(0);
        setHasMoreUtxos(false);
        try {
            const { items, hasMoreUnspent } = await rpcService.getAddressOutputs(addressInput.trim(), UTXO_PAGE_SIZE, 0);
            if (items.length === 0) {
                toast.info('No transaction history found for this address');
            }
            setAddressUtxos(items);
            setUtxoOffset(UTXO_PAGE_SIZE);
            setHasMoreUtxos(hasMoreUnspent);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Lookup failed');
        } finally {
            setIsLookingUp(false);
        }
    }, [rpcService, addressInput, UTXO_PAGE_SIZE]);

    const handleLoadMoreUtxos = useCallback(async () => {
        if (!addressInput.trim() || !hasMoreUtxos) return;
        setIsLoadingMore(true);
        try {
            const { items, hasMoreUnspent } = await rpcService.getAddressOutputs(addressInput.trim(), UTXO_PAGE_SIZE, utxoOffset);
            setAddressUtxos((prev) => [...(prev ?? []), ...items]);
            setUtxoOffset((prev) => prev + UTXO_PAGE_SIZE);
            setHasMoreUtxos(hasMoreUnspent);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to load more');
        } finally {
            setIsLoadingMore(false);
        }
    }, [rpcService, addressInput, utxoOffset, hasMoreUtxos, UTXO_PAGE_SIZE]);

    const handleSelectUtxo = useCallback((utxo: AddressUtxo) => {
        setTxid(utxo.txid);
        setVout(utxo.outputIndex);
        setInputMode('txid');
        handleAnalyze(utxo.txid, utxo.outputIndex);
    }, [handleAnalyze]);

    const handleClearMemory = useCallback(() => {
        coinFlowService.clearCaches();
        setResult(null);
        setSelectedNode('');
        setSelectedNodeDetails(null);
        toast.success('Memory cleared', {
            description: 'All caches and analysis data have been cleared.',
        });
    }, [coinFlowService]);

    const formatAmount = (amount: bigint): string => formatRxd(amount) + ' RXD';

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Input Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        Find Coin Flow
                    </CardTitle>
                    <CardDescription>
                        Enter an address to browse its UTXOs, or paste a transaction ID directly
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                        <button
                            onClick={() => setInputMode('address')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                inputMode === 'address'
                                    ? 'bg-background shadow text-foreground font-medium'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            disabled={isAnalyzing}
                        >
                            By Address
                        </button>
                        <button
                            onClick={() => setInputMode('txid')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                inputMode === 'txid'
                                    ? 'bg-background shadow text-foreground font-medium'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            disabled={isAnalyzing}
                        >
                            By TXID
                        </button>
                    </div>

                    {inputMode === 'address' ? (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    value={addressInput}
                                    onChange={(e) => { setAddressInput(e.target.value); setAddressUtxos(null); setHasMoreUtxos(false); setUtxoOffset(0); }}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddressLookup()}
                                    placeholder="Enter RXD address (e.g. 1MBm...)"
                                    disabled={isAnalyzing || isLookingUp}
                                    className="font-mono flex-1"
                                />
                                <Button
                                    onClick={handleAddressLookup}
                                    disabled={isAnalyzing || isLookingUp || !addressInput.trim()}
                                    variant="outline"
                                >
                                    {isLookingUp ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            {addressUtxos !== null && (
                                addressUtxos.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-4">
                                        No transaction history found for this address.
                                    </p>
                                ) : (
                                    <div className="space-y-1">
                                        <p className="text-xs text-muted-foreground">
                                            {addressUtxos.length} output{addressUtxos.length !== 1 ? 's' : ''} — click one to trace its coin flow
                                        </p>
                                        <div className="overflow-y-auto max-h-56 space-y-1 pr-1">
                                            <div className="space-y-1">
                                                {addressUtxos.map((utxo) => (
                                                    <button
                                                        key={`${utxo.txid}:${utxo.outputIndex}`}
                                                        onClick={() => handleSelectUtxo(utxo)}
                                                        disabled={isAnalyzing}
                                                        className="w-full text-left px-3 py-2 rounded-md border bg-card hover:bg-muted/60 transition-colors disabled:opacity-50"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-mono text-xs text-muted-foreground truncate">
                                                                {utxo.txid.slice(0, 16)}…{utxo.txid.slice(-8)}
                                                                <span className="text-foreground ml-1">:{utxo.outputIndex}</span>
                                                            </span>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-xs font-medium">
                                                                    {formatRxd(utxo.satoshis, 4)} RXD
                                                                </span>
                                                                {utxo.height > 0 && (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        #{utxo.height}
                                                                    </span>
                                                                )}
                                                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                                                    utxo.isUnspent
                                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                                                        : 'bg-muted text-muted-foreground'
                                                                }`}>
                                                                    {utxo.isUnspent ? 'Unspent' : 'Spent'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                                {hasMoreUtxos && (
                                                    <button
                                                        onClick={handleLoadMoreUtxos}
                                                        disabled={isLoadingMore || isAnalyzing}
                                                        className="w-full text-center px-3 py-2 rounded-md border border-dashed text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
                                                    >
                                                        {isLoadingMore ? (
                                                            <span className="flex items-center justify-center gap-1.5">
                                                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                                                                Loading…
                                                            </span>
                                                        ) : (
                                                            'Load more unspent outputs'
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="md:col-span-3">
                                <Label htmlFor="txid">Transaction ID (TXID)</Label>
                                <Input
                                    id="txid"
                                    value={txid}
                                    onChange={(e) => setTxid(e.target.value)}
                                    placeholder="Enter transaction ID (txid)"
                                    disabled={isAnalyzing}
                                    className="font-mono"
                                />
                            </div>
                            <div>
                                <Label htmlFor="vout">Output Index</Label>
                                <Input
                                    id="vout"
                                    type="number"
                                    value={vout}
                                    onChange={(e) => setVout(parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                    min="0"
                                    disabled={isAnalyzing}
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2 items-center">
                        <div className="flex rounded-md border overflow-hidden text-xs font-medium">
                            <button
                                className={`px-3 py-1.5 transition-colors ${
                                    options.direction !== 'backward'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'
                                }`}
                                onClick={() => setOptions((o) => ({
                                    ...o,
                                    direction: 'forward',
                                    maxDepth: 5,
                                    maxTransactions: 100,
                                }))}
                                title="Trace forward: follow where coins went"
                            >
                                ↓ Forward
                            </button>
                            <button
                                className={`px-3 py-1.5 transition-colors ${
                                    options.direction === 'backward'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'
                                }`}
                                onClick={() => setOptions((o) => ({
                                    ...o,
                                    direction: 'backward',
                                    maxDepth: 2,
                                    maxTransactions: 10,
                                }))}
                                title="Trace backward: find where coins came from"
                            >
                                ↑ Backward
                            </button>
                        </div>
                        <Button
                            onClick={() => handleAnalyze()}
                            disabled={isAnalyzing || !txid.trim()}
                            className="flex-1"
                        >
                            {isAnalyzing ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <Search className="h-4 w-4 mr-2" />
                                    Analyze Coin Flow
                                </>
                            )}
                        </Button>

                        <Button
                            variant="outline"
                            onClick={handleClearMemory}
                            disabled={isAnalyzing}
                            title="Clear caches"
                        >
                            🗑️
                        </Button>

                        <Button
                            variant="outline"
                            onClick={() => setShowSettings(!showSettings)}
                            disabled={isAnalyzing}
                        >
                            <Settings className="h-4 w-4" />
                        </Button>
                    </div>

                    {showSettings && (
                        <Card className="bg-muted/30">
                            <CardHeader>
                                <CardTitle className="text-base">Analysis Settings</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <Label>Max Depth: {options.maxDepth}</Label>
                                        <Slider
                                            value={[options.maxDepth!]}
                                            onValueChange={([value]) =>
                                                setOptions((prev) => ({ ...prev, maxDepth: value }))
                                            }
                                            max={10}
                                            min={1}
                                            step={1}
                                            className="mt-2"
                                        />
                                    </div>
                                    <div>
                                        <Label>Max Transactions: {options.maxTransactions}</Label>
                                        <Slider
                                            value={[options.maxTransactions!]}
                                            onValueChange={([value]) =>
                                                setOptions((prev) => ({ ...prev, maxTransactions: value }))
                                            }
                                            max={500}
                                            min={10}
                                            step={10}
                                            className="mt-2"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            checked={options.includeDust}
                                            onCheckedChange={(checked) =>
                                                setOptions((prev) => ({ ...prev, includeDust: checked }))
                                            }
                                        />
                                        <Label>Include Dust</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            checked={options.enableClustering}
                                            onCheckedChange={(checked) =>
                                                setOptions((prev) => ({ ...prev, enableClustering: checked }))
                                            }
                                        />
                                        <Label>Wallet Clustering</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            checked={options.confirmedOnly}
                                            onCheckedChange={(checked) =>
                                                setOptions((prev) => ({ ...prev, confirmedOnly: checked }))
                                            }
                                        />
                                        <Label>Confirmed Only</Label>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {isAnalyzing && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>Analyzing coin flow...</span>
                                <span>{analysisProgress}%</span>
                            </div>
                            <Progress value={analysisProgress} />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Results */}
            {result && (
                <Tabs defaultValue="visualization" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="visualization">Flow Graph</TabsTrigger>
                        <TabsTrigger value="summary">Summary</TabsTrigger>
                        <TabsTrigger value="wallets">Wallets</TabsTrigger>
                        <TabsTrigger value="details">Details</TabsTrigger>
                    </TabsList>

                    <TabsContent value="visualization" className="space-y-4">
                        <div className="flex flex-col lg:flex-row gap-4 items-start">
                            <div className="flex-1 min-w-0">
                                <CoinFlowGraphVisualization
                                    graph={result.graph}
                                    selectedNode={selectedNode}
                                    onNodeSelect={setSelectedNode}
                                    height="600px"
                                />
                            </div>

                            {selectedNodeDetails && (
                                <Card className="w-full lg:w-72 shrink-0">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-lg">Selected Node</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div>
                                            <Label className="text-xs text-muted-foreground">
                                                {selectedNodeDetails.isContract ? 'Contract (scripthash)' : 'Address'}
                                            </Label>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="text-xs bg-muted px-2 py-1 rounded break-all flex-1">
                                                    {selectedNodeDetails.address}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(selectedNodeDetails.address)}
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </Button>
                                                {!selectedNodeDetails.isContract && (
                                                    <Button variant="ghost" size="sm" asChild>
                                                        <a
                                                            href={`https://radiantexplorer.com/address/${selectedNodeDetails.address}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                        >
                                                            <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    </Button>
                                                )}
                                            </div>
                                            {(selectedNodeDetails.hasRefs || selectedNodeDetails.isContract) && (
                                                <Badge variant="secondary" className="mt-2">
                                                    {selectedNodeDetails.isContract
                                                        ? 'Contract output'
                                                        : 'Token output (carries refs)'}
                                                </Badge>
                                            )}
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Transaction</Label>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="text-xs bg-muted px-2 py-1 rounded truncate flex-1">
                                                    {selectedNodeDetails.txid}:{selectedNodeDetails.vout}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            `${selectedNodeDetails.txid}:${selectedNodeDetails.vout}`,
                                                        )
                                                    }
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </Button>
                                                <Button variant="ghost" size="sm" asChild>
                                                    <a
                                                        href={`https://radiantexplorer.com/tx/${selectedNodeDetails.txid}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </Button>
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Amount</Label>
                                            <div className="text-lg font-semibold mt-1">
                                                {formatAmount(selectedNodeDetails.amount)}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Depth</Label>
                                                <div className="text-sm font-medium mt-1">Level {selectedNodeDetails.depth}</div>
                                            </div>
                                            <div>
                                                <Label className="text-xs text-muted-foreground">Block Height</Label>
                                                <div className="text-sm font-medium mt-1">{selectedNodeDetails.blockHeight || 'N/A'}</div>
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Confirmations</Label>
                                            <div className="text-sm font-medium mt-1">{selectedNodeDetails.confirmations || 'N/A'}</div>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">Status</Label>
                                            <div className="flex gap-2 flex-wrap mt-1">
                                                {selectedNodeDetails.isUnspent && (
                                                    <Badge>Unspent (UTXO)</Badge>
                                                )}
                                                {selectedNodeDetails.isStarting && (
                                                    <Badge variant="secondary">Starting Point</Badge>
                                                )}
                                                {selectedNodeDetails.wallet && (
                                                    <Badge variant="outline" title={selectedNodeDetails.wallet.name}>
                                                        {selectedNodeDetails.wallet.name.length > 25
                                                            ? `${selectedNodeDetails.wallet.name.slice(0, 22)}...`
                                                            : selectedNodeDetails.wallet.name}
                                                    </Badge>
                                                )}
                                                {!selectedNodeDetails.isUnspent && (
                                                    <Badge variant="secondary">Spent</Badge>
                                                )}
                                            </div>
                                        </div>
                                        {selectedNodeDetails.wallet && (
                                            <>
                                                <Separator />
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">Wallet Information</Label>
                                                    <div className="text-sm mt-2 space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground text-xs">
                                                                {selectedNodeDetails.wallet.serviceName ? 'Service:' : 'Cluster:'}
                                                            </span>
                                                            <span className="font-medium break-all text-xs">
                                                                {selectedNodeDetails.wallet.serviceName || selectedNodeDetails.wallet.name}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground text-xs">Confidence:</span>
                                                            <span className="font-medium text-xs">
                                                                {Math.round(selectedNodeDetails.wallet.confidence * 100)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="summary" className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-blue-500" />
                                        <div>
                                            <div className="text-2xl font-bold">{result.summary.totalAddresses}</div>
                                            <div className="text-xs text-muted-foreground">Addresses</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2">
                                        <Activity className="h-4 w-4 text-green-500" />
                                        <div>
                                            <div className="text-2xl font-bold">{result.summary.totalTransactions}</div>
                                            <div className="text-xs text-muted-foreground">Transactions</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-purple-500" />
                                        <div>
                                            <div className="text-2xl font-bold">{result.summary.estimatedWallets}</div>
                                            <div className="text-xs text-muted-foreground">Est. Wallets</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2">
                                        <Coins className="h-4 w-4 text-orange-500" />
                                        <div>
                                            <div className="text-sm font-bold">{formatAmount(result.summary.unspentAmount)}</div>
                                            <div className="text-xs text-muted-foreground">Still Unspent</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle>Final Destinations</CardTitle>
                                <CardDescription>
                                    Where the coins ended up (unspent or final transactions)
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-64">
                                    <div className="space-y-2">
                                        {result.summary.finalDestinations.map((dest, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center justify-between p-2 bg-muted/30 rounded"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className={`w-2 h-2 rounded-full ${
                                                            dest.isUnspent ? 'bg-green-500' : 'bg-gray-500'
                                                        }`}
                                                    />
                                                    <code className="text-sm">
                                                        {dest.address.slice(0, 12)}...{dest.address.slice(-8)}
                                                    </code>
                                                    {dest.estimatedWallet && (
                                                        <Badge variant="outline" className="text-xs">
                                                            {dest.estimatedWallet}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="text-sm font-medium">{formatAmount(dest.amount)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="wallets" className="space-y-4">
                        {result.graph.walletClusters.length > 0 ? (
                            <div className="space-y-4">
                                {result.graph.walletClusters.map((wallet) => (
                                    <Card key={wallet.id}>
                                        <CardHeader>
                                            <div className="flex items-center justify-between">
                                                <CardTitle
                                                    className="text-lg break-all"
                                                    title={wallet.name}
                                                >
                                                    {wallet.name.length > 35
                                                        ? `${wallet.name.slice(0, 32)}...`
                                                        : wallet.name}
                                                </CardTitle>
                                                <Badge variant={wallet.isOwnWallet ? 'default' : 'secondary'}>
                                                    {wallet.isOwnWallet ? 'Known' : wallet.serviceName ? wallet.serviceName : 'Observed'}
                                                </Badge>
                                            </div>
                                            <CardDescription>
                                                Confidence: {(wallet.confidence * 100).toFixed(1)}% •
                                                Method: {wallet.method.join(', ')}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                <Label className="text-sm font-medium">
                                                    Addresses ({wallet.addresses.length})
                                                </Label>
                                                <ScrollArea className="h-24">
                                                    <div className="space-y-1">
                                                        {wallet.addresses.map((address, index) => (
                                                            <div key={index} className="flex items-center gap-2">
                                                                <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                                                                    {address}
                                                                </code>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => copyToClipboard(address)}
                                                                >
                                                                    <Copy className="h-3 w-3" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </ScrollArea>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <Card>
                                <CardContent className="p-8 text-center">
                                    <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                                    <p className="text-muted-foreground">No wallet clusters detected</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Enable clustering in settings or try a different transaction
                                    </p>
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    <TabsContent value="details" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Analysis Metadata</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Analysis Time</Label>
                                        <div>{result.graph.metadata.analysisTimeMs}ms</div>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Max Depth Reached</Label>
                                        <div>{result.graph.metadata.actualMaxDepth}</div>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Transactions Analyzed</Label>
                                        <div>{result.graph.transactionCount}</div>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Status</Label>
                                        <div className="flex items-center gap-2">
                                            {result.graph.metadata.isComplete ? (
                                                <>
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                    Complete
                                                </>
                                            ) : (
                                                <>
                                                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                                                    Incomplete
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {result.warnings.length > 0 && (
                                    <div className="mt-4">
                                        <Label className="text-sm font-medium">Warnings</Label>
                                        <div className="mt-2 space-y-1">
                                            {result.warnings.map((warning, index) => (
                                                <div
                                                    key={index}
                                                    className="flex items-start gap-2 text-sm text-orange-600 dark:text-orange-400"
                                                >
                                                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                                    <span>{warning}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
};
