/**
 * BigInt-safe photon (satoshi) amount handling.
 *
 * Radiant's 21 billion RXD supply means photon amounts can reach 2.1e18 —
 * beyond Number.MAX_SAFE_INTEGER (~9e15). Any output above ~90M RXD silently
 * loses precision as a JS number, so amounts are carried as bigint end to end
 * and only converted to Number for ratios and visual scaling.
 */

export const PHOTONS_PER_RXD = 100_000_000n;

/**
 * Converts a photon amount from any wire representation to bigint.
 * Strings are exact; numbers are rounded to the nearest integer (they may
 * already have lost precision upstream, but never gain garbage decimals here).
 */
export function toPhotons(value: string | number | bigint): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string') return BigInt(value);
    return BigInt(Math.round(value));
}

/** Converts a decimal RXD amount (JS number) to photons — fallback path only. */
export function photonsFromRxd(rxd: number): bigint {
    return BigInt(Math.round(rxd * 1e8));
}

/**
 * Lossy conversion for ratios, percentages, and visual scaling.
 * Exact below 2^53 photons; relative error ≤ 2^-52 above.
 */
export function photonsToNumber(photons: bigint): number {
    return Number(photons);
}

/**
 * Formats photons as an exact decimal RXD string.
 * decimals: how many fractional digits to keep (0–8), default all 8.
 */
export function formatRxd(photons: bigint, decimals: number = 8): string {
    const negative = photons < 0n;
    const abs = negative ? -photons : photons;
    const whole = abs / PHOTONS_PER_RXD;
    const frac = (abs % PHOTONS_PER_RXD).toString().padStart(8, '0');
    const digits = Math.max(0, Math.min(8, decimals));
    const fracPart = digits > 0 ? `.${frac.slice(0, digits)}` : '';
    return `${negative ? '-' : ''}${whole}${fracPart}`;
}
