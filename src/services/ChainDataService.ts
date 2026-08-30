/**
 * Chain data service contract.
 *
 * Everything the CoinFlow analysis engine needs from the Radiant blockchain,
 * independent of how the data is sourced. The browser-side implementation
 * (RadiantChainService) calls the /api/rpc proxy, which dispatches to a
 * server-side backend: either a radiantd node with address/spent index
 * patches, or an ElectrumX server that emulates those lookups.
 */

export interface ChainTransaction {
    hash: string;
    height: number;
    confirmations: number;
    blocktime: number;
    vin: Array<{
        txid: string;
        vout: number;
        scriptSig?: unknown;
        sequence?: number;
        coinbase?: string;
    }>;
    vout: Array<{
        n: number;
        value: number;
        /** Exact photon amount — bigint because RXD amounts can exceed 2^53. */
        valueSat: bigint;
        scriptPubKey: {
            address?: string;
            addresses?: string[];
            asm: string;
            hex: string;
            type: string;
            /** Owner embedded in a ref/token script (P2PKH+refs pattern). */
            ownerAddress?: string;
            /** 36-byte ref payloads (hex) — present on token/contract outputs. */
            refs?: string[];
            hasRefs?: boolean;
            /** Electrum-style scripthash — stable identity for contract outputs. */
            scripthash?: string;
        };
    }>;
}

export interface AddressHistoryItem {
    txid: string;
    height: number;
    tx_hash: string;
}

export interface AddressUtxo {
    address: string;
    txid: string;
    outputIndex: number;
    /** Photon amount — bigint because RXD amounts can exceed 2^53. */
    satoshis: bigint;
    height: number;
    isUnspent: boolean;
}

export interface SpentInfo {
    txid: string;
    index: number; // vin index in spending tx
    height?: number; // block height of the spending transaction
}

export interface BlockchainInfo {
    height: number;
    bestblockhash: string;
    difficulty: number;
}

export interface ChainDataService {
    getTransaction(txid: string): Promise<ChainTransaction>;
    getTransactionsBatch(txids: string[]): Promise<Map<string, ChainTransaction>>;

    /**
     * Find the transaction that spends txid:vout. Returns null if unspent.
     */
    getSpentInfo(txid: string, vout: number): Promise<SpentInfo | null>;
    isOutputUnspent(txid: string, vout: number): Promise<boolean>;

    getAddressHistory(address: string): Promise<AddressHistoryItem[]>;
    getAddressOutputs(
        address: string,
        pageSize?: number,
        pageOffset?: number,
    ): Promise<{ items: AddressUtxo[]; hasMoreUnspent: boolean }>;

    getBlockchainInfo(): Promise<BlockchainInfo>;

    clearCache(): void;
    getCacheStats(): { size: number };
}
