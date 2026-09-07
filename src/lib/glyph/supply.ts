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
