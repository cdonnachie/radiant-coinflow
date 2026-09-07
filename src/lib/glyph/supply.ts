import { formatRxd } from '@/lib/amounts';
import type { TokenAssetInfo } from '@/types/glyph';

/**
 * Format a node/edge amount for the flow graph: token units when tracing a
 * Glyph asset (for FTs the photons ARE the token units), RXD otherwise.
 */
export function formatAssetAmount(amount: bigint, asset?: TokenAssetInfo): string {
    if (!asset) return formatRxd(amount) + ' RXD';
    return `${formatSupply(amount.toString(), asset.decimals)} ${asset.ticker ?? 'units'}`;
}

/** Format a raw supply string for display: apply token decimals, group digits. */
export function formatSupply(raw: string, decimals?: number): string {
    if (!/^\d+$/.test(raw)) return raw;
    let whole = raw;
    let fraction = '';
    if (decimals && decimals > 0) {
        const padded = raw.padStart(decimals + 1, '0');
        whole = padded.slice(0, -decimals);
        fraction = padded.slice(-decimals).replace(/0+$/, '');
    }
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? `${grouped}.${fraction}` : grouped;
}
