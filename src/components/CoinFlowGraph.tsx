'use client';

import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { formatRxd, photonsToNumber } from '@/lib/amounts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import ReactFlow, {
    type Node,
    type Edge,
    Controls,
    MiniMap,
    Background,
    useNodesState,
    useEdgesState,
    ConnectionMode,
    MarkerType,
    Position,
    Handle,
    type NodeChange,
    type EdgeChange,
    type NodeTypes,
    type NodeProps,
    getNodesBounds,
    getViewportForBounds,
} from 'reactflow';
import { Activity, Download, Map, Maximize2, Minimize2, X, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { CoinFlowGraph, CoinFlowNode } from '@/types/coinFlow';
import { ClusteringMethod } from '@/types/coinFlow';
import { graphlib, layout } from '@dagrejs/dagre';
import { toPng } from 'html-to-image';
import 'reactflow/dist/style.css';

interface CoinFlowGraphVisualizationProps {
    graph: CoinFlowGraph;
    selectedNode?: string;
    onNodeSelect: (nodeId: string) => void;
    height?: string;
}

const CoinFlowNodeComponent = ({
    data,
    selected,
}: NodeProps<{ nodeData: CoinFlowNode; onSelect: () => void }>) => {
    const getNodeColor = (node: CoinFlowNode): string => {
        if (node.isAggregate) return '#94a3b8';
        if (node.isStarting) return '#3b82f6';
        if (node.wallet?.isOwnWallet) return '#8b5cf6';
        if (node.wallet?.method?.includes(ClusteringMethod.KNOWN_POOL)) return '#06b6d4';
        if (node.wallet?.serviceName) return '#f59e0b';
        if (node.isUnspent) return '#10b981';
        return '#6b7280';
    };

    const formatAmount = (amount: bigint): string => formatRxd(amount) + ' RXD';

    const nodeData = data.nodeData as CoinFlowNode;
    const color = getNodeColor(nodeData);
    const isSelected = selected || false;

    return (
        <div
            className={`px-3 py-2 shadow-lg rounded-lg bg-white border-2 min-w-[280px] max-w-[350px] cursor-pointer transition-all duration-300 hover:shadow-xl ${
                isSelected
                    ? 'border-primary ring-4 ring-primary/30 ring-offset-2 scale-105'
                    : 'border-gray-200 hover:border-gray-300'
            }`}
            style={{
                borderColor: isSelected ? undefined : color,
                boxShadow: isSelected
                    ? `0 0 20px ${color}40, 0 10px 25px -5px rgba(0,0,0,0.1)`
                    : undefined,
            }}
            onClick={data.onSelect}
        >
            <Handle
                type="target"
                position={Position.Top}
                id="top"
                style={{
                    background: color,
                    width: isSelected ? 14 : 10,
                    height: isSelected ? 14 : 10,
                    border: isSelected ? '3px solid white' : '2px solid white',
                }}
            />

            <div className="flex items-center gap-2 mb-1">
                <div
                    className={`rounded-full transition-all duration-300 ${isSelected ? 'w-4 h-4' : 'w-3 h-3'}`}
                    style={{ backgroundColor: color }}
                />
                <div className="text-xs font-medium text-gray-600">
                    {nodeData.isAggregate && 'Collapsed'}
                    {!nodeData.isAggregate && nodeData.isStarting && 'Start'}
                    {!nodeData.isAggregate && nodeData.wallet?.isOwnWallet && 'Your Wallet'}
                    {nodeData.wallet?.serviceName &&
                        !nodeData.isStarting &&
                        !nodeData.wallet?.isOwnWallet &&
                        (nodeData.wallet.method?.includes(ClusteringMethod.KNOWN_POOL)
                            ? 'Pool'
                            : nodeData.wallet.method?.includes(ClusteringMethod.KNOWN_EXCHANGE)
                            ? 'Exchange'
                            : 'Service')}
                    {nodeData.isUnspent &&
                        !nodeData.isStarting &&
                        !nodeData.wallet?.isOwnWallet &&
                        !nodeData.wallet?.serviceName &&
                        'UTXO'}
                    {!nodeData.isAggregate &&
                        !nodeData.isStarting &&
                        !nodeData.isUnspent &&
                        !nodeData.wallet?.isOwnWallet &&
                        !nodeData.wallet?.serviceName &&
                        (nodeData.inputCount && nodeData.inputCount > 1 ? 'Source' : 'Address')}
                </div>
                {(nodeData.hasRefs || nodeData.isContract) && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800">
                        {nodeData.isContract ? 'CONTRACT' : 'TOKEN'}
                    </span>
                )}
            </div>

            <div className="text-sm font-semibold text-gray-900 mb-1">
                {formatAmount(nodeData.amount)}
                {nodeData.inputCount && nodeData.inputCount > 1 && (
                    <span className="ml-1 text-xs font-normal text-gray-400">({nodeData.inputCount} inputs)</span>
                )}
            </div>

            <div className="text-xs text-gray-500 font-mono break-all">{nodeData.address}</div>

            <div className="text-xs text-blue-600 mt-1 min-h-[16px] break-words" title={nodeData.wallet?.name || ''}>
                {nodeData.wallet
                    ? nodeData.wallet.serviceName || nodeData.wallet.name
                    : '\u00A0'}
            </div>

            <div className="text-xs text-gray-400 mt-1">
                Depth {nodeData.depth} • {nodeData.confirmations || 0} conf
                {nodeData.blockHeight && <> • Block #{nodeData.blockHeight}</>}
            </div>

            <Handle
                type="source"
                position={Position.Bottom}
                id="bottom"
                style={{
                    background: color,
                    width: isSelected ? 14 : 10,
                    height: isSelected ? 14 : 10,
                    border: isSelected ? '3px solid white' : '2px solid white',
                }}
            />
        </div>
    );
};

const nodeTypes: NodeTypes = { coinFlowNode: CoinFlowNodeComponent };

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    const dagreGraph = new graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
        rankdir: direction,
        nodesep: 150,
        ranksep: 180,
        edgesep: 50,
        marginx: 50,
        marginy: 50,
    });

    nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 220, height: 120 }));
    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
    layout(dagreGraph);

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = Position.Top;
        node.sourcePosition = Position.Bottom;
        node.position = {
            x: nodeWithPosition.x - 110,
            y: nodeWithPosition.y - 60,
        };
    });

    return { nodes, edges };
};

const ReactFlowVisualization: React.FC<{
    nodes: Node[];
    edges: Edge[];
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onNodeClick: (event: React.MouseEvent, node: Node) => void;
    onNodeSelect: (nodeId: string) => void;
    nodeTypes: NodeTypes;
    showMiniMap: boolean;
    height: string;
}> = ({ nodes, edges, onNodesChange, onEdgesChange, onNodeClick, onNodeSelect, nodeTypes, showMiniMap, height }) => (
    <div className="w-full border rounded-lg overflow-hidden" style={{ height }}>
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={() => onNodeSelect('')}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Strict}
            fitView
            fitViewOptions={{ padding: 0.3, minZoom: 0.5, maxZoom: 1.5 }}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            minZoom={0.1}
            maxZoom={3}
            attributionPosition="bottom-left"
            elementsSelectable={true}
            nodesConnectable={false}
            nodesDraggable={false}
            zoomOnScroll={true}
            panOnScroll={false}
            selectNodesOnDrag={false}
            deleteKeyCode={null}
        >
            <Background color="#e2e8f0" gap={20} size={1} />
            <Controls position="top-right" />
            {showMiniMap && (
                <MiniMap
                    position="bottom-right"
                    nodeColor={(node) => {
                        const nd = node.data.nodeData as CoinFlowNode;
                        if (nd.isStarting) return '#3b82f6';
                        if (nd.isUnspent) return '#10b981';
                        if (nd.wallet?.isOwnWallet) return '#8b5cf6';
                        return '#6b7280';
                    }}
                    maskColor="rgba(0,0,0,0.1)"
                />
            )}
        </ReactFlow>
    </div>
);

// Node Details Card used in fullscreen dialog
const NodeDetailsCard: React.FC<{ node: CoinFlowNode; onClose?: () => void }> = ({
    node,
    onClose,
}) => {
    const formatAmount = (amount: bigint) => formatRxd(amount) + ' RXD';

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
    };

    const openInExplorer = (address: string) => {
        window.open(
            `https://radiantexplorer.com/address/${address}`,
            '_blank',
            'noopener,noreferrer',
        );
    };

    const getNodeColor = (node: CoinFlowNode) => {
        if (node.isStarting) return 'bg-blue-500';
        if (node.wallet?.isOwnWallet) return 'bg-purple-500';
        if (node.wallet?.method?.includes(ClusteringMethod.KNOWN_POOL)) return 'bg-cyan-500';
        if (node.wallet?.serviceName) return 'bg-amber-500';
        if (node.isUnspent) return 'bg-green-500';
        return 'bg-gray-500';
    };

    const getNodeLabel = (node: CoinFlowNode) => {
        if (node.isStarting) return 'Start';
        if (node.isUnspent) return 'Unspent';
        if (node.wallet?.isOwnWallet) return 'Your Wallet';
        if (node.wallet?.serviceName) return node.wallet.serviceName;
        if (node.isContract) return 'Contract';
        if (node.inputCount && node.inputCount > 1) return `Source (${node.inputCount} inputs)`;
        return 'Address';
    };

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${getNodeColor(node)}`} />
                        {getNodeLabel(node)}
                    </CardTitle>
                    {onClose && (
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
                <CardDescription className="text-xs">
                    {node.isStarting && 'Starting point of analysis'}
                    {node.isUnspent && !node.isStarting && 'Unspent output'}
                    {!node.isStarting && !node.isUnspent && node.inputCount && node.inputCount > 1
                        ? `Aggregated source — ${node.inputCount} inputs from this address`
                        : !node.isStarting && !node.isUnspent && 'Spent output'}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {node.isContract ? 'Contract (scripthash)' : 'Address'}
                    </label>
                    <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all flex-1">
                            {node.address}
                        </code>
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(node.address)}>
                            <Copy className="h-3 w-3" />
                        </Button>
                        {!node.isContract && (
                            <Button variant="ghost" size="sm" onClick={() => openInExplorer(node.address)}>
                                <ExternalLink className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                    {(node.hasRefs || node.isContract) && (
                        <div className="text-xs text-cyan-700 dark:text-cyan-400 mt-1">
                            {node.isContract ? 'Contract output (Radiant refs)' : 'Token output — carries Radiant refs'}
                        </div>
                    )}
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
                        <div className="text-sm font-medium mt-1 font-mono">{formatAmount(node.amount)}</div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Depth</label>
                        <div className="text-sm font-medium mt-1">Level {node.depth}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirmations</label>
                        <div className="text-sm font-medium mt-1">{node.confirmations || 'N/A'}</div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Block Height</label>
                        <div className="text-sm font-medium mt-1">{node.blockHeight || 'N/A'}</div>
                    </div>
                </div>
                {node.wallet && (
                    <>
                        <Separator />
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Wallet Information</label>
                            <div className="text-sm mt-1 space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">
                                        {node.wallet.serviceName ? 'Service:' : 'Cluster:'}
                                    </span>
                                    <span className="font-medium break-all">
                                        {node.wallet.serviceName || node.wallet.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">Confidence:</span>
                                    <span className="font-medium">
                                        {Math.round(node.wallet.confidence * 100)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

export const CoinFlowGraphVisualization: React.FC<CoinFlowGraphVisualizationProps> = ({
    graph,
    selectedNode,
    onNodeSelect,
    height = '600px',
}) => {
    const [showMiniMap, setShowMiniMap] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showNodeDetails, setShowNodeDetails] = useState(false);
    const [selectedNodeDetails, setSelectedNodeDetails] = useState<CoinFlowNode | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [forceRender, setForceRender] = useState(false);

    const formatAmount = (amount: bigint) => formatRxd(amount) + ' RXD';

    const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
        const nodes: Node[] = [];
        const edges: Edge[] = [];

        graph.nodes.forEach((node) => {
            nodes.push({
                id: node.id,
                type: 'coinFlowNode',
                position: { x: 0, y: 0 },
                data: { nodeData: node, onSelect: () => onNodeSelect(node.id) },
                selected: selectedNode === node.id,
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
            });
        });

        const findPathsToNode = (targetNodeId: string, visitedEdges = new Set<string>()): string[] => {
            const pathEdges: string[] = [];
            graph.edges.forEach((e, idx) => {
                const edgeId = e.id || `${e.from}->${e.to}-${idx}`;
                if (e.to === targetNodeId && !visitedEdges.has(edgeId)) {
                    pathEdges.push(edgeId);
                    visitedEdges.add(edgeId);
                    pathEdges.push(...findPathsToNode(e.from, visitedEdges));
                }
            });
            return pathEdges;
        };

        const pathEdges = selectedNode ? findPathsToNode(selectedNode) : [];

        graph.edges.forEach((edge, index) => {
            const sourceNode = nodes.find((n) => n.id === edge.from);
            const targetNode = nodes.find((n) => n.id === edge.to);
            if (!sourceNode || !targetNode) return;

            const edgeId = edge.id || `${edge.from}->${edge.to}-${index}`;
            const amountInRxd = photonsToNumber(edge.amount) / 100000000;
            const logAmount = Math.log10(amountInRxd + 0.001);
            const normalized = (logAmount - Math.log10(0.001)) / (Math.log10(1000) - Math.log10(0.001));
            const strokeWidth = Math.max(2, Math.min(16, 2 + normalized * 14));

            const isInPath = pathEdges.includes(edgeId);
            const isDirectToSelected = selectedNode ? edge.to === selectedNode : false;

            edges.push({
                id: edgeId,
                source: edge.from,
                target: edge.to,
                type: 'default',
                animated: isInPath,
                style: {
                    stroke: isDirectToSelected ? '#3b82f6' : isInPath ? '#60a5fa' : '#ef4444',
                    strokeWidth: isDirectToSelected ? strokeWidth + 3 : isInPath ? strokeWidth + 1 : strokeWidth,
                    strokeOpacity: isInPath ? 1.0 : 0.6,
                    transition: 'all 0.3s ease',
                },
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: isDirectToSelected ? '#3b82f6' : isInPath ? '#60a5fa' : '#ef4444',
                    height: 4,
                },
                label: formatAmount(edge.amount),
                labelStyle: {
                    fontSize: '12px',
                    fontWeight: isInPath ? 700 : 600,
                    fill: isInPath ? '#1e40af' : '#374151',
                },
                labelBgStyle: {
                    fill: 'white',
                    stroke: isInPath ? '#3b82f6' : '#9ca3af',
                    strokeWidth: isInPath ? 2 : 1,
                    fillOpacity: 0.9,
                },
            });
        });

        return getLayoutedElements(nodes, edges, 'TB');
    }, [graph, selectedNode, onNodeSelect]);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        setNodes(flowNodes);
        setEdges(flowEdges);
    }, [graph, selectedNode, setNodes, setEdges]);

    useEffect(() => {
        if (selectedNode && graph) {
            const node = graph.nodes.find((n) => n.id === selectedNode);
            setSelectedNodeDetails(node || null);
            if (isFullscreen) setShowNodeDetails(true);
        } else {
            setSelectedNodeDetails(null);
        }
    }, [selectedNode, graph, isFullscreen]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.key === 'f' || event.key === 'F') && !isFullscreen) {
                event.preventDefault();
                setIsFullscreen(true);
            }
            if (event.key === 'Escape' && isFullscreen) setIsFullscreen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen]);

    const onNodeClick = useCallback(
        (event: React.MouseEvent, node: Node) => {
            event.preventDefault();
            onNodeSelect(node.id);
        },
        [onNodeSelect],
    );

    const handleExport = useCallback(async (format: 'png' | 'pdf') => {
        const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
        if (!viewportEl) return;

        const imageWidth = 2000;
        const imageHeight = 1500;
        const nodesBounds = getNodesBounds(nodes);
        const { x, y, zoom } = getViewportForBounds(
            nodesBounds,
            imageWidth,
            imageHeight,
            0.5,
            2,
            0.1,
        );

        const txShort = graph.startingUtxo.txid.slice(0, 8);
        const addrShort = graph.startingUtxo.address.slice(0, 10);
        const baseName = `radiant-coinflow-${txShort}-${addrShort}`;

        setIsExporting(true);
        try {
            const dataUrl = await toPng(viewportEl, {
                backgroundColor: '#ffffff',
                width: imageWidth,
                height: imageHeight,
                style: {
                    width: `${imageWidth}px`,
                    height: `${imageHeight}px`,
                    transform: `translate(${x}px, ${y}px) scale(${zoom})`,
                },
            });
            if (format === 'png') {
                const a = document.createElement('a');
                a.download = `${baseName}.png`;
                a.href = dataUrl;
                a.click();
            } else {
                const { jsPDF } = await import('jspdf');
                const pdf = new jsPDF({
                    orientation: 'landscape',
                    unit: 'px',
                    format: [imageWidth, imageHeight],
                    hotfixes: ['px_scaling'],
                });
                pdf.addImage(dataUrl, 'PNG', 0, 0, imageWidth, imageHeight);
                pdf.save(`${baseName}.pdf`);
            }
        } catch {
            toast.error('Export failed.');
        } finally {
            setIsExporting(false);
        }
    }, [nodes]);

    if (!forceRender && (graph.nodes.length > 200 || graph.edges.length > 500)) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        Graph Too Large
                    </CardTitle>
                    <CardDescription>
                        {graph.nodes.length} nodes / {graph.edges.length} edges exceeds the safe render limit (200/500).
                        Rendering may be slow or unresponsive.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="outline" onClick={() => setForceRender(true)}>
                        Render Anyway
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            Interactive Coin Flow Graph
                        </CardTitle>
                        <CardDescription>
                            Click nodes to inspect • Use controls to zoom/pan • Press F for fullscreen
                        </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowMiniMap(!showMiniMap)}
                            className="flex items-center gap-2"
                        >
                            <Map className="h-4 w-4" />
                            {showMiniMap ? 'Hide' : 'Show'} Mini Map
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport('png')}
                            disabled={isExporting}
                            className="flex items-center gap-2"
                        >
                            <Download className="h-4 w-4" />
                            PNG
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport('pdf')}
                            disabled={isExporting}
                            className="flex items-center gap-2"
                        >
                            <Download className="h-4 w-4" />
                            PDF
                        </Button>
                        <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="flex items-center gap-2">
                                    <Maximize2 className="h-4 w-4" />
                                    Fullscreen
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 border-0">
                                <DialogHeader className="p-6 pb-0 border-b">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <DialogTitle className="flex items-center gap-2">
                                                <Activity className="h-5 w-5" />
                                                Coin Flow Graph — Fullscreen
                                            </DialogTitle>
                                            <DialogDescription>
                                                Click nodes for details • Controls top-right
                                            </DialogDescription>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setShowMiniMap(!showMiniMap)}
                                                className="flex items-center gap-2"
                                            >
                                                <Map className="h-4 w-4" />
                                                {showMiniMap ? 'Hide' : 'Show'} Mini Map
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleExport('png')}
                                                disabled={isExporting}
                                                className="flex items-center gap-2"
                                            >
                                                <Download className="h-4 w-4" />
                                                PNG
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleExport('pdf')}
                                                disabled={isExporting}
                                                className="flex items-center gap-2"
                                            >
                                                <Download className="h-4 w-4" />
                                                PDF
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setIsFullscreen(false)}
                                                className="flex items-center gap-2"
                                            >
                                                <Minimize2 className="h-4 w-4" />
                                                Exit
                                            </Button>
                                        </div>
                                    </div>
                                </DialogHeader>
                                <div className="flex-1 p-6 pt-4">
                                    <ReactFlowVisualization
                                        nodes={nodes}
                                        edges={edges}
                                        onNodesChange={onNodesChange}
                                        onEdgesChange={onEdgesChange}
                                        onNodeClick={onNodeClick}
                                        onNodeSelect={onNodeSelect}
                                        nodeTypes={nodeTypes}
                                        showMiniMap={showMiniMap}
                                        height="calc(95vh - 180px)"
                                    />
                                </div>
                                <Dialog open={showNodeDetails} onOpenChange={setShowNodeDetails}>
                                    <DialogContent className="max-w-lg">
                                        <DialogHeader>
                                            <DialogTitle>Node Details</DialogTitle>
                                            <DialogDescription>
                                                Selected node information
                                            </DialogDescription>
                                        </DialogHeader>
                                        {selectedNodeDetails && (
                                            <NodeDetailsCard
                                                node={selectedNodeDetails}
                                                onClose={() => setShowNodeDetails(false)}
                                            />
                                        )}
                                    </DialogContent>
                                </Dialog>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {graph.nodes.length === 0 ? (
                    <div className="w-full h-96 border rounded-lg flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No coin flow data available</p>
                        </div>
                    </div>
                ) : (
                    <ReactFlowVisualization
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={onNodeClick}
                        onNodeSelect={onNodeSelect}
                        nodeTypes={nodeTypes}
                        showMiniMap={showMiniMap}
                        height={height}
                    />
                )}

                <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                    <div className="flex flex-wrap gap-4 text-sm">
                        {[
                            { color: 'bg-blue-500', label: 'Starting UTXO' },
                            { color: 'bg-green-500', label: 'Unspent (UTXO)' },
                            { color: 'bg-amber-500', label: 'Exchange' },
                            { color: 'bg-cyan-500', label: 'Mining Pool' },
                            { color: 'bg-gray-500', label: 'Address' },
                        ].map(({ color, label }) => (
                            <div key={label} className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${color}`} />
                                <span>{label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                        Line thickness = transaction amount • Arrows show flow direction •{' '}
                        <span className="text-blue-600 font-medium">Dark blue</span>: direct connection to selected •{' '}
                        <span className="text-blue-400 font-medium">Light blue</span>: path to selected •{' '}
                        <span className="text-red-500 font-medium">Red</span>: other connections
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
