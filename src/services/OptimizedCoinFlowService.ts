/**
 * Optimized Coin Flow Service
 *
 * Analyzes coin movement on the Radiant blockchain. Talks to the chain
 * exclusively through ChainDataService, so it is agnostic to whether the
 * server answers from a patched radiantd (spentindex) or from ElectrumX.
 */

import { RadiantChainService } from './RadiantChainService';
import type { ChainDataService } from './ChainDataService';
import type {
    CoinFlowGraph,
    CoinFlowNode,
    CoinFlowEdge,
    CoinFlowOptions,
    CoinFlowAnalysisResult,
    CoinFlowSummary,
    WalletCluster,
    AddressLabel,
} from '@/types/coinFlow';
import { ClusteringMethod } from '@/types/coinFlow';

export class OptimizedCoinFlowService {
    private apiService: ChainDataService;
    private addressLabels: Map<string, AddressLabel> = new Map();
    private knownExchanges: Map<string, { name: string; confidence: number; type: 'exchange' | 'pool' | 'service' }> = new Map();
    private requestCount: number = 0;
    private maxRequestsPerAnalysis: number = 1000;
    private initPromise: Promise<void> | null = null;

    constructor() {
        this.apiService = new RadiantChainService();
    }

    private ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.initializeKnownAddresses();
        }
        return this.initPromise;
    }

    async analyzeCoinFlow(
        txid: string,
        vout: number,
        options: CoinFlowOptions = {},
    ): Promise<CoinFlowAnalysisResult> {
        await this.ensureInitialized();
        const startTime = Date.now();
        const opts = this.getDefaultOptions(options);
        this.requestCount = 0;

        // Allow enough RPC headroom for the configured transaction budget.
        // Backward tracing fetches 1 creating-tx + N source-txs per node, so the
        // old power-of-2 formula (2^depth) was far too low.  Use maxTransactions
        // as the base so the limit scales with what the user actually asked for.
        this.maxRequestsPerAnalysis = Math.min(opts.maxTransactions * 10, 2000);

        if (opts.direction === 'backward') {
            return this.performBackwardAnalysis(txid, vout, opts, startTime);
        }
        return this.performOptimizedAnalysis(txid, vout, opts, startTime);
    }

    private async performOptimizedAnalysis(
        txid: string,
        vout: number,
        opts: Required<CoinFlowOptions>,
        startTime: number,
    ): Promise<CoinFlowAnalysisResult> {
        const startingTx = await this.apiService.getTransaction(txid);
        this.requestCount++;

        if (!startingTx.vout || !startingTx.vout[vout]) {
            throw new Error(`Transaction ${txid} output ${vout} not found`);
        }

        const startingOutput = startingTx.vout[vout];
        const startingIdentity = this.extractOutputIdentity(startingOutput);
        const startingAmount = startingOutput.valueSat;

        if (!startingIdentity) {
            throw new Error(`Could not extract address from output ${vout}`);
        }

        const graph: CoinFlowGraph = {
            nodes: [],
            edges: [],
            startingUtxo: { txid, vout, address: startingIdentity.address, amount: startingAmount },
            maxDepth: opts.maxDepth,
            transactionCount: 0,
            walletClusters: [],
            metadata: {
                analyzedAt: new Date(),
                analysisTimeMs: 0,
                isComplete: false,
                errors: [],
                actualMaxDepth: 0,
            },
        };

        const startingNode: CoinFlowNode = {
            id: `${txid}:${vout}`,
            txid,
            vout,
            address: startingIdentity.address,
            amount: startingAmount,
            blockHeight: startingTx.height || undefined,
            confirmations: startingTx.confirmations,
            isUnspent: false,
            depth: 0,
            isStarting: true,
            hasRefs: startingIdentity.hasRefs || undefined,
            isContract: startingIdentity.isContract || undefined,
        };

        graph.nodes.push(startingNode);
        await this.traceFlowOptimized(graph, startingNode, opts, new Set(), 0);

        if (opts.enableClustering) {
            graph.walletClusters = await this.performOptimizedClustering(graph);
            this.assignWalletClusters(graph);
        }

        const summary = this.generateSummary(graph);
        graph.metadata.analysisTimeMs = Date.now() - startTime;
        graph.metadata.isComplete = true;

        return { graph, summary, warnings: graph.metadata.errors };
    }

    private async traceFlowOptimized(
        graph: CoinFlowGraph,
        currentNode: CoinFlowNode,
        options: Required<CoinFlowOptions>,
        visitedTxIds: Set<string>,
        currentDepth: number,
    ): Promise<void> {
        try {
            if (currentDepth >= options.maxDepth) return;
            if (graph.transactionCount >= options.maxTransactions) {
                const msg = `Reached transaction limit of ${options.maxTransactions}`;
                if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
                return;
            }
            const maxNodes = options.maxTransactions * 5;
            if (graph.nodes.length >= maxNodes) {
                const msg = `Reached node limit of ${maxNodes}`;
                if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
                return;
            }
            if (this.requestCount >= this.maxRequestsPerAnalysis) {
                const msg = `Reached API request limit of ${this.maxRequestsPerAnalysis}`;
                if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
                return;
            }

            // Use getspentinfo (spentindex=1) — O(1) direct lookup, no history scan
            const spentInfo = await this.apiService.getSpentInfo(
                currentNode.txid,
                currentNode.vout,
            );
            this.requestCount++;

            if (!spentInfo) return; // output is unspent, nothing to trace

            const spendingTxid = spentInfo.txid;
            if (visitedTxIds.has(spendingTxid)) return;

            const spendingTx = await this.apiService.getTransaction(spendingTxid);
            this.requestCount++;

            if (visitedTxIds.has(spendingTx.hash)) return;
            if (options.confirmedOnly && spendingTx.confirmations < options.minConfirmations) return;

            visitedTxIds.add(spendingTx.hash);
            graph.transactionCount++;

            for (let i = 0; i < spendingTx.vout.length; i++) {
                const output = spendingTx.vout[i];
                const identity = this.extractOutputIdentity(output);
                const outputAmount = output.valueSat;

                if (!identity) continue;
                // Token/contract outputs carry dust-level RXD by design —
                // never dust-filter them or token flows disappear.
                const isTokenLike = identity.hasRefs || identity.isContract;
                if (!options.includeDust && !isTokenLike && outputAmount <= BigInt(options.dustThreshold)) continue;

                const isUnspent = await this.apiService.isOutputUnspent(spendingTx.hash, i);
                this.requestCount++;

                const outputNode: CoinFlowNode = {
                    id: `${spendingTx.hash}:${i}`,
                    txid: spendingTx.hash,
                    vout: i,
                    address: identity.address,
                    amount: outputAmount,
                    blockHeight: (spentInfo.height ?? spendingTx.height) || undefined,
                    confirmations: spendingTx.confirmations,
                    isUnspent,
                    depth: currentDepth + 1,
                    hasRefs: identity.hasRefs || undefined,
                    isContract: identity.isContract || undefined,
                };

                graph.nodes.push(outputNode);

                const edge: CoinFlowEdge = {
                    id: `${currentNode.id}->${outputNode.id}`,
                    from: currentNode.id,
                    to: outputNode.id,
                    txid: spendingTx.hash,
                    amount: outputAmount,
                    blockHeight: (spentInfo.height ?? spendingTx.height) || undefined,
                    timestamp: spendingTx.blocktime
                        ? new Date(spendingTx.blocktime * 1000)
                        : undefined,
                };

                graph.edges.push(edge);
                graph.metadata.actualMaxDepth = Math.max(
                    graph.metadata.actualMaxDepth,
                    currentDepth + 1,
                );

                if (options.stopAtExchanges && this.knownExchanges.has(identity.address)) continue;

                if (!isUnspent) {
                    await this.traceFlowOptimized(
                        graph,
                        outputNode,
                        options,
                        visitedTxIds,
                        currentDepth + 1,
                    );
                }
            }
        } catch (error) {
            graph.metadata.errors.push(`Error tracing from ${currentNode.id}: ${error}`);
        }
    }

    private async performBackwardAnalysis(
        txid: string,
        vout: number,
        opts: Required<CoinFlowOptions>,
        startTime: number,
    ): Promise<CoinFlowAnalysisResult> {
        const startingTx = await this.apiService.getTransaction(txid);
        this.requestCount++;

        if (!startingTx.vout || !startingTx.vout[vout]) {
            throw new Error(`Transaction ${txid} output ${vout} not found`);
        }

        const startingOutput = startingTx.vout[vout];
        const startingIdentity = this.extractOutputIdentity(startingOutput);
        const startingAddress = startingIdentity?.address;
        const startingAmount = startingOutput.valueSat;

        if (!startingAddress) {
            throw new Error(`Could not extract address from output ${vout}`);
        }

        const graph: CoinFlowGraph = {
            nodes: [],
            edges: [],
            startingUtxo: { txid, vout, address: startingAddress, amount: startingAmount },
            maxDepth: opts.maxDepth,
            transactionCount: 0,
            walletClusters: [],
            metadata: {
                analyzedAt: new Date(),
                analysisTimeMs: 0,
                isComplete: false,
                errors: [],
                actualMaxDepth: 0,
            },
        };

        const startingNode: CoinFlowNode = {
            id: `${txid}:${vout}`,
            txid,
            vout,
            address: startingAddress,
            amount: startingAmount,
            blockHeight: startingTx.height || undefined,
            confirmations: startingTx.confirmations,
            isUnspent: true,
            depth: 0,
            isStarting: true,
            hasRefs: startingIdentity.hasRefs || undefined,
            isContract: startingIdentity.isContract || undefined,
        };

        graph.nodes.push(startingNode);
        await this.traceBackwardsOptimized(graph, startingNode, opts, new Set(), 0);

        // Update start node amount to total inflow (sum of source edges pointing to it).
        // The original vout amount is just one output of the tx; the inflow is what the
        // user actually cares about when tracing backward.
        const totalInflow = graph.edges
            .filter((e) => e.to === startingNode.id)
            .reduce((sum, e) => sum + e.amount, 0n);
        if (totalInflow > 0n) {
            startingNode.amount = totalInflow;
            graph.startingUtxo.amount = totalInflow;
        }

        if (opts.enableClustering) {
            graph.walletClusters = await this.performOptimizedClustering(graph);
            this.assignWalletClusters(graph);
        }

        const summary = this.generateSummary(graph);
        graph.metadata.analysisTimeMs = Date.now() - startTime;
        graph.metadata.isComplete = true;

        return { graph, summary, warnings: graph.metadata.errors };
    }

    private async traceBackwardsOptimized(
        graph: CoinFlowGraph,
        currentNode: CoinFlowNode,
        options: Required<CoinFlowOptions>,
        visitedTxIds: Set<string>,
        currentDepth: number,
    ): Promise<void> {
        if (currentDepth >= options.maxDepth) return;
        if (graph.transactionCount >= options.maxTransactions) {
            const msg = `Reached transaction limit of ${options.maxTransactions}`;
            if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
            return;
        }
        const maxNodes = options.maxTransactions * 5;
        if (graph.nodes.length >= maxNodes) {
            const msg = `Reached node limit of ${maxNodes}`;
            if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
            return;
        }
        if (this.requestCount >= this.maxRequestsPerAnalysis) {
            const msg = `Reached API request limit of ${this.maxRequestsPerAnalysis}`;
            if (!graph.metadata.errors.includes(msg)) graph.metadata.errors.push(msg);
            return;
        }

        // Avoid reprocessing the same creating transaction
        if (visitedTxIds.has(currentNode.txid)) return;
        visitedTxIds.add(currentNode.txid);

        try {
            const creatingTx = await this.apiService.getTransaction(currentNode.txid);
            this.requestCount++;
            graph.transactionCount++;

            // Collect resolved info for all non-coinbase inputs in one pass
            const nonCoinbaseVins = creatingTx.vin.filter((v: { coinbase?: string }) => !v.coinbase);

            interface VinInfo {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                vin: { txid: string; vout: number };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sourceTx: any;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sourceOutput: any;
                sourceAddress: string;
                hasRefs: boolean;
                isContract: boolean;
            }

            const vinInfos: VinInfo[] = [];
            for (const vin of nonCoinbaseVins) {
                const sourceTx = await this.apiService.getTransaction(vin.txid);
                this.requestCount++;
                const sourceOutput = sourceTx.vout[vin.vout];
                if (!sourceOutput) continue;
                const identity = this.extractOutputIdentity(sourceOutput);
                if (!identity) continue;
                if (options.confirmedOnly && sourceTx.confirmations < options.minConfirmations) continue;
                const isTokenLike = identity.hasRefs || identity.isContract;
                if (!options.includeDust && !isTokenLike && sourceOutput.valueSat <= BigInt(options.dustThreshold)) continue;
                vinInfos.push({
                    vin, sourceTx, sourceOutput,
                    sourceAddress: identity.address,
                    hasRefs: identity.hasRefs,
                    isContract: identity.isContract,
                });
            }

            // Group inputs by source address — one aggregate node per address
            const byAddress = new Map<string, VinInfo[]>();
            for (const info of vinInfos) {
                const group = byAddress.get(info.sourceAddress) ?? [];
                group.push(info);
                byAddress.set(info.sourceAddress, group);
            }

            for (const [sourceAddress, infos] of byAddress) {
                const totalAmount = infos.reduce((sum, i) => sum + i.sourceOutput.valueSat, 0n);
                // Representative: largest by value — its txid drives further recursion
                const best = infos.reduce((a, b) =>
                    a.sourceOutput.valueSat >= b.sourceOutput.valueSat ? a : b
                );

                const sourceNodeId = `agg:${creatingTx.hash}:${sourceAddress}`;
                let sourceNode = graph.nodes.find((n) => n.id === sourceNodeId);
                if (!sourceNode) {
                    sourceNode = {
                        id: sourceNodeId,
                        txid: best.vin.txid,
                        vout: best.vin.vout,
                        address: sourceAddress,
                        amount: totalAmount,
                        blockHeight: best.sourceTx.height || undefined,
                        confirmations: best.sourceTx.confirmations,
                        isUnspent: false,
                        depth: currentDepth + 1,
                        inputCount: infos.length,
                        hasRefs: infos.some((i) => i.hasRefs) || undefined,
                        isContract: infos.some((i) => i.isContract) || undefined,
                    };
                    graph.nodes.push(sourceNode);
                }

                const edgeId = `${sourceNodeId}->${currentNode.id}`;
                if (!graph.edges.find((e) => e.id === edgeId)) {
                    graph.edges.push({
                        id: edgeId,
                        from: sourceNodeId,
                        to: currentNode.id,
                        txid: creatingTx.hash,
                        amount: totalAmount,
                        blockHeight: creatingTx.height || undefined,
                        timestamp: creatingTx.blocktime
                            ? new Date(creatingTx.blocktime * 1000)
                            : undefined,
                    });
                }

                graph.metadata.actualMaxDepth = Math.max(graph.metadata.actualMaxDepth, currentDepth + 1);

                if (options.stopAtExchanges && this.knownExchanges.has(sourceAddress)) continue;

                await this.traceBackwardsOptimized(graph, sourceNode, options, visitedTxIds, currentDepth + 1);
            }
        } catch (error) {
            graph.metadata.errors.push(`Error tracing back from ${currentNode.id}: ${error}`);
        }
    }

    private async performOptimizedClustering(graph: CoinFlowGraph): Promise<WalletCluster[]> {
        const clusters: Map<string, WalletCluster> = new Map();
        let clusterIdCounter = 0;

        try {
            const allAddresses = Array.from(new Set(graph.nodes.map((node) => node.address)));
            const exchangeResults = await this.batchCheckExchanges(allAddresses);

            const addressCounts: Map<string, CoinFlowNode[]> = new Map();
            for (const node of graph.nodes) {
                if (!addressCounts.has(node.address)) addressCounts.set(node.address, []);
                addressCounts.get(node.address)!.push(node);
            }

            for (const [address, nodes] of Array.from(addressCounts.entries())) {
                if (nodes.length > 1 || exchangeResults.has(address)) {
                    const clusterId = `cluster-${clusterIdCounter++}`;
                    let clusterName = `Reused Address ${address}`;
                    let confidence = 0.8;
                    let method: ClusteringMethod[] = [ClusteringMethod.ADDRESS_REUSE];
                    let serviceName: string | undefined;

                    if (exchangeResults.has(address)) {
                        const exchangeInfo = exchangeResults.get(address)!;
                        clusterName = exchangeInfo.name;
                        confidence = exchangeInfo.confidence || 0.9;
                        const knownMethod =
                            exchangeInfo.type === 'pool' ? ClusteringMethod.KNOWN_POOL :
                            exchangeInfo.type === 'exchange' ? ClusteringMethod.KNOWN_EXCHANGE :
                            ClusteringMethod.KNOWN_SERVICE;
                        method =
                            nodes.length > 1
                                ? [ClusteringMethod.ADDRESS_REUSE, knownMethod]
                                : [knownMethod];
                        serviceName = exchangeInfo.name;
                    }

                    clusters.set(clusterId, {
                        id: clusterId,
                        name: clusterName,
                        addresses: [address],
                        confidence,
                        method,
                        isOwnWallet: false,
                        serviceName,
                    });
                }
            }

            return Array.from(clusters.values());
        } catch {
            return [];
        }
    }

    private async batchCheckExchanges(
        addresses: string[],
    ): Promise<Map<string, { name: string; confidence?: number; type: 'exchange' | 'pool' | 'service' }>> {
        const results = new Map<string, { name: string; confidence?: number; type: 'exchange' | 'pool' | 'service' }>();
        for (const address of addresses) {
            const entry = this.knownExchanges.get(address);
            if (entry) results.set(address, entry);
        }
        return results;
    }

    /**
     * Resolves the identity of an output so value never silently vanishes:
     *  - standard outputs → their address
     *  - ref/token outputs with an embedded P2PKH owner → the owner address
     *  - pure contract outputs → a synthetic `contract:<scripthash>` identity
     *  - OP_RETURN / undecodable outputs → null (unspendable, skipped)
     */
    private extractOutputIdentity(output: {
        scriptPubKey?: {
            address?: string;
            addresses?: string[];
            type?: string;
            ownerAddress?: string;
            hasRefs?: boolean;
            scripthash?: string;
        };
    }): { address: string; isContract: boolean; hasRefs: boolean } | null {
        const spk = output.scriptPubKey;
        if (!spk) return null;
        const hasRefs = spk.hasRefs === true;

        const addr = (spk.addresses && spk.addresses[0]) || spk.address;
        if (addr) return { address: addr, isContract: false, hasRefs };
        if (spk.ownerAddress) return { address: spk.ownerAddress, isContract: false, hasRefs };
        if (spk.type === 'nulldata') return null;
        if (spk.scripthash) {
            return { address: `contract:${spk.scripthash.slice(0, 16)}`, isContract: true, hasRefs };
        }
        return null;
    }


    private getDefaultOptions(options: CoinFlowOptions): Required<CoinFlowOptions> {
        const isBackward = options.direction === 'backward';

        // Backward tracing has no natural termination (only stops at coinbase), so
        // use tight defaults to prevent runaway scans.
        if (isBackward) {
            return {
                maxDepth: 2,
                maxTransactions: 10,
                includeDust: false,
                dustThreshold: 1000,
                enableClustering: true,
                confirmedOnly: true,
                minConfirmations: 1,
                stopAtExchanges: false,
                timeoutMs: 60000,
                direction: 'backward',
                ...options,
            };
        }

        const requestedDepth = options.maxDepth || 2;
        let maxTransactions = 50;
        let timeoutMs = 120000;

        if (requestedDepth >= 10) {
            maxTransactions = 500;
            timeoutMs = 600000;
        } else if (requestedDepth >= 5) {
            maxTransactions = 200;
            timeoutMs = 300000;
        } else if (requestedDepth >= 3) {
            maxTransactions = 100;
            timeoutMs = 180000;
        }

        return {
            maxDepth: requestedDepth,
            maxTransactions,
            includeDust: false,
            dustThreshold: 1000,
            enableClustering: true,
            confirmedOnly: true,
            minConfirmations: 1,
            stopAtExchanges: requestedDepth >= 8,
            timeoutMs,
            direction: 'forward',
            ...options,
        };
    }

    private generateSummary(graph: CoinFlowGraph): CoinFlowSummary {
        const addresses = new Set(graph.nodes.map((n) => n.address));
        const transactions = new Set(graph.edges.map((e) => e.txid));
        const totalAmount = graph.startingUtxo.amount;
        const unspentAmount = graph.nodes
            .filter((n) => n.isUnspent)
            .reduce((sum, n) => sum + n.amount, 0n);

        const walletDistribution = graph.walletClusters.map((wallet) => {
            const walletAmount = graph.nodes
                .filter((n) => n.wallet?.id === wallet.id)
                .reduce((sum, n) => sum + n.amount, 0n);
            return {
                walletId: wallet.id,
                walletName: wallet.name,
                amount: walletAmount,
                // Ratio via Number is fine — percentages are display-only
                percentage: totalAmount === 0n ? 0 : (Number(walletAmount) / Number(totalAmount)) * 100,
            };
        });

        const finalDestinations = graph.nodes
            .filter(
                (n) => n.isUnspent || graph.edges.filter((e) => e.from === n.id).length === 0,
            )
            .map((n) => ({
                address: n.address,
                amount: n.amount,
                isUnspent: n.isUnspent,
                estimatedWallet: n.wallet?.name,
            }));

        return {
            totalAddresses: addresses.size,
            totalTransactions: transactions.size,
            totalAmount,
            unspentAmount,
            estimatedWallets: graph.walletClusters.length,
            walletDistribution,
            finalDestinations,
        };
    }

    private assignWalletClusters(graph: CoinFlowGraph): void {
        const addressToCluster = new Map<string, WalletCluster>();
        for (const cluster of graph.walletClusters) {
            for (const address of cluster.addresses) {
                addressToCluster.set(address, cluster);
            }
        }
        for (const node of graph.nodes) {
            const cluster = addressToCluster.get(node.address);
            if (cluster) node.wallet = cluster;
        }
    }

    private async initializeKnownAddresses(): Promise<void> {
        try {
            const response = await fetch('/data/exchange-addresses.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            for (const [, exchangeData] of Object.entries(data.exchanges || {})) {
                const typed = exchangeData as { name: string; confidence?: number; addresses: string[] };
                for (const address of typed.addresses) {
                    this.knownExchanges.set(address, { name: typed.name, confidence: typed.confidence ?? 0.9, type: 'exchange' });
                }
            }
            for (const [, poolData] of Object.entries(data.mining_pools || {})) {
                const typed = poolData as { name: string; confidence?: number; addresses: string[] };
                for (const address of typed.addresses) {
                    this.knownExchanges.set(address, { name: typed.name, confidence: typed.confidence ?? 0.9, type: 'pool' });
                }
            }
            for (const [, serviceData] of Object.entries(data.services || {})) {
                const typed = serviceData as { name: string; confidence?: number; addresses: string[] };
                for (const address of typed.addresses) {
                    this.knownExchanges.set(address, { name: typed.name, confidence: typed.confidence ?? 0.9, type: 'service' });
                }
            }
        } catch {
            // No fallback list — analysis proceeds without known-entity labels
        }
    }

    clearCaches(): void {
        this.apiService.clearCache();
    }
}
