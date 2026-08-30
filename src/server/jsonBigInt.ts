/**
 * JSON parsing that preserves large integers.
 *
 * Python's json (ElectrumX) and the C++ daemons serialize integers exactly at
 * arbitrary precision — the wire bytes carry the true value. JavaScript's
 * JSON.parse coerces every number to a double, silently corrupting integers
 * above 2^53 (~90M RXD in photons).
 *
 * This parser uses the JSON.parse source-access reviver (V8 12.2+ / Node 22+)
 * to recover the exact digits from the source text, returning a bigint for
 * any integer that cannot be represented exactly as a number. Values within
 * the safe range stay plain numbers, so downstream code sees bigint only
 * where a number would have been wrong. On runtimes without source access it
 * degrades gracefully to standard (lossy-above-2^53) behaviour.
 */

const INTEGER_SOURCE = /^-?\d+$/;

// The 3-argument (source-access) reviver is a stage-3 addition not yet in TS lib typings.
type SourceAccessReviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonPreservingBigInts(text: string): any {
    const reviver: SourceAccessReviver = (_key, value, context) => {
        if (
            typeof value === 'number' &&
            Number.isInteger(value) &&
            !Number.isSafeInteger(value) &&
            typeof context?.source === 'string' &&
            INTEGER_SOURCE.test(context.source)
        ) {
            return BigInt(context.source);
        }
        return value;
    };
    return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

/** JSON.stringify with bigints rendered as exact decimal strings. */
export function stringifyWithBigInts(value: unknown): string {
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Coerces a wire integer (number or recovered bigint) to bigint. */
export function wireIntToBigInt(value: number | bigint): bigint {
    return typeof value === 'bigint' ? value : BigInt(Math.round(value));
}
