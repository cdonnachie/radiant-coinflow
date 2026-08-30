/**
 * Coin Flow Tracking Types
 * 
 * Types for tracking where coins go after being spent from a specific UTXO.
 * This enables users to visualize the flow of funds through the blockchain.
 */

export interface CoinFlowNode {
    /** Unique identifier for this node */
    id: string;
    /** Transaction ID */
    txid: string;
    /** Output index (vout) */
    vout: number;
    /** Output address */
    address: string;
    /** Amount in photons (bigint — RXD amounts can exceed 2^53) */
    amount: bigint;
    /** Block height when this output was created */
    blockHeight?: number;
    /** Number of confirmations */
    confirmations?: number;
    /** Whether this output is still unspent (UTXO) */
    isUnspent: boolean;
    /** Depth in the flow graph (0 = starting point) */
    depth: number;
    /** Estimated wallet/entity this address belongs to */
    wallet?: WalletCluster;
    /** Whether this is the starting point of the flow */
    isStarting?: boolean;
    /** Number of inputs aggregated into this node (backward tracing only, when > 1) */
    inputCount?: number;
    /** Output carries Radiant refs (token/induction contract) */
    hasRefs?: boolean;
    /** Pure contract output with no owner address (identified by scripthash) */
    isContract?: boolean;
}

export interface CoinFlowEdge {
    /** Unique identifier for this edge */
    id: string;
    /** Source node ID */
    from: string;
    /** Target node ID */
    to: string;
    /** Transaction that created this flow */
    txid: string;
    /** Amount transferred in photons (bigint) */
    amount: bigint;
    /** Block height of the transaction */
    blockHeight?: number;
    /** Transaction fee (for the entire transaction) */
    fee?: number;
    /** Timestamp of the transaction */
    timestamp?: Date;
}

export interface WalletCluster {
    /** Unique identifier for this wallet cluster */
    id: string;
    /** Estimated wallet name/label */
    name: string;
    /** All addresses believed to belong to this wallet */
    addresses: string[];
    /** Confidence level (0-1) that these addresses belong together */
    confidence: number;
    /** Clustering method used */
    method: ClusteringMethod[];
    /** Whether this is one of our own wallets */
    isOwnWallet: boolean;
    /** Exchange or service name if detected */
    serviceName?: string;
}

export enum ClusteringMethod {
    /** Common input ownership heuristic */
    COMMON_INPUT = 'common_input',
    /** Change detection heuristic */
    CHANGE_DETECTION = 'change_detection',
    /** Address reuse */
    ADDRESS_REUSE = 'address_reuse',
    /** Temporal clustering (transactions close in time) */
    TEMPORAL = 'temporal',
    /** Manual labeling */
    MANUAL = 'manual',
    /** Known exchange addresses */
    KNOWN_EXCHANGE = 'known_exchange',
    /** Known mining pool addresses */
    KNOWN_POOL = 'known_pool',
    /** Known service addresses (general category) */
    KNOWN_SERVICE = 'known_service'
}

export interface CoinFlowGraph {
    /** All nodes in the flow */
    nodes: CoinFlowNode[];
    /** All edges (connections) in the flow */
    edges: CoinFlowEdge[];
    /** Starting UTXO information */
    startingUtxo: {
        txid: string;
        vout: number;
        address: string;
        amount: bigint;
    };
    /** Maximum depth traced */
    maxDepth: number;
    /** Total number of transactions traced */
    transactionCount: number;
    /** Estimated wallet clusters found */
    walletClusters: WalletCluster[];
    /** Analysis metadata */
    metadata: {
        /** When this analysis was performed */
        analyzedAt: Date;
        /** Total time taken for analysis */
        analysisTimeMs: number;
        /** Whether the analysis completed successfully */
        isComplete: boolean;
        /** Any errors encountered during analysis */
        errors: string[];
        /** Maximum depth reached (may be less than requested) */
        actualMaxDepth: number;
    };
}

export interface CoinFlowOptions {
    /** Maximum depth to trace (default: 5) */
    maxDepth?: number;
    /** Maximum number of API calls to make during analysis (default: 100) */
    maxTransactions?: number;
    /** Whether to include dust outputs (default: false) */
    includeDust?: boolean;
    /** Dust threshold in satoshis (default: 1000) */
    dustThreshold?: number;
    /** Whether to perform wallet clustering (default: true) */
    enableClustering?: boolean;
    /** Whether to include only confirmed transactions (default: true) */
    confirmedOnly?: boolean;
    /** Minimum confirmations required (default: 1) */
    minConfirmations?: number;
    /** Whether to stop at known exchange addresses (default: false) */
    stopAtExchanges?: boolean;
    /** Timeout in milliseconds (default: 30000) */
    timeoutMs?: number;
    /** Trace direction: forward (where coins went) or backward (where coins came from) */
    direction?: 'forward' | 'backward';
}

export interface CoinFlowAnalysisResult {
    /** The complete flow graph */
    graph: CoinFlowGraph;
    /** Summary statistics */
    summary: CoinFlowSummary;
    /** Any warnings or issues */
    warnings: string[];
}

export interface CoinFlowSummary {
    /** Total number of addresses involved */
    totalAddresses: number;
    /** Total number of transactions traced */
    totalTransactions: number;
    /** Total amount that flowed from the starting UTXO (photons) */
    totalAmount: bigint;
    /** Amount still unspent (final UTXOs, photons) */
    unspentAmount: bigint;
    /** Estimated number of distinct wallets */
    estimatedWallets: number;
    /** Percentage of funds that went to each estimated wallet */
    walletDistribution: Array<{
        walletId: string;
        walletName: string;
        amount: bigint;
        percentage: number;
    }>;
    /** Final destination breakdown */
    finalDestinations: Array<{
        address: string;
        amount: bigint;
        isUnspent: boolean;
        estimatedWallet?: string;
    }>;
}

export interface CoinFlowVisualizationSettings {
    /** Layout algorithm to use */
    layout: 'hierarchical' | 'force' | 'circular' | 'tree';
    /** Whether to group nodes by wallet */
    groupByWallet: boolean;
    /** Whether to show transaction details on edges */
    showTransactionDetails: boolean;
    /** Whether to show amounts on nodes */
    showAmounts: boolean;
    /** Whether to highlight the path from starting UTXO */
    highlightPath: boolean;
    /** Color scheme for wallets */
    colorScheme: 'default' | 'categorical' | 'confidence' | 'amount';
    /** Whether to show dust outputs */
    showDust: boolean;
    /** Node size scaling factor */
    nodeScale: number;
    /** Edge thickness scaling factor */
    edgeScale: number;
}

export interface AddressLabel {
    /** The address */
    address: string;
    /** User-provided label */
    label: string;
    /** Category/type of address */
    category?: 'exchange' | 'personal' | 'business' | 'mining' | 'other';
    /** Additional notes */
    notes?: string;
    /** When this label was created */
    createdAt: Date;
    /** Whether this is a verified label */
    isVerified?: boolean;
}
