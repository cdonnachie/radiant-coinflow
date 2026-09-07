/**
 * Glyphs token metadata types. JSON-safe (no bigint) — these cross the
 * /api/glyph and /api/token route boundaries.
 */

export type GlyphTokenType = 'nft' | 'ft' | 'dmint' | 'container' | 'dat' | 'unknown';

export interface GlyphMetadata {
    /** Canonical 72-hex display form (display txid + big-endian vout). */
    refDisplay: string;
    /** RXinDexer form: `<txid>_<vout>`. */
    refShort: string;
    found: boolean;
    name?: string;
    ticker?: string;
    description?: string;
    /** Derived from protocols: [2]=nft, [1]=ft, [1,4]=dmint, [7]=container, [3]=dat. */
    tokenType: GlyphTokenType;
    /** Human label: "NFT" | "FT" | "dMint" | "Container" | "Data" | "Token". */
    typeLabel: string;
    protocols?: number[];
    /** From the indexer hint only (not in the on-chain payload). */
    decimals?: number;
    deployTxid?: string;
    deployHeight?: number;
    /** Strings to stay JSON-safe for large supplies. */
    supply?: { total?: string; minted?: string };
    hasIcon: boolean;
    iconMime?: string;
    /** Where the metadata came from. */
    source: 'indexer' | 'decoded' | 'both' | 'none';
}

export interface GlyphSearchResult {
    /** Canonical 72-hex display form — links to /token/[ref]. */
    refDisplay: string;
    refShort: string;
    name?: string;
    ticker?: string;
    typeLabel: string;
    deployHeight?: number;
    supply?: { total?: string; minted?: string };
}

export interface JourneyHop {
    txid: string;
    /** Output index carrying the ref after this hop (absent for melt hops). */
    vout?: number;
    height?: number;
    timestamp?: number;
    event: 'mint' | 'transfer' | 'melt';
    /** Holder address, or `contract:<scripthash8>` for pure contract outputs. */
    holder?: string;
    isContract?: boolean;
}

export interface TokenJourney {
    refDisplay: string;
    found: boolean;
    /** Singleton refs move as a unit; fungible refs split/merge (not walked). */
    kind: 'singleton' | 'fungible' | 'unknown';
    hops: JourneyHop[];
    liveness: 'ACTIVE' | 'MELTED' | 'UNKNOWN';
    /** True when the walk hit the hop cap or time budget. */
    truncated: boolean;
    notes: string[];
}
