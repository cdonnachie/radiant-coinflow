/**
 * Minimal byte/hex helpers. No dependencies; isomorphic (client + server).
 * Copied from canon.rxd packages/reference-parser/src/bytes.ts — keep in sync.
 */

const HEX_RE = /^[0-9a-f]*$/;

export function hexToBytes(hex: string): Uint8Array {
  const lower = hex.toLowerCase();
  if (lower.length % 2 !== 0 || !HEX_RE.test(lower)) {
    throw new Error(`invalid hex string (length ${hex.length})`);
  }
  const out = new Uint8Array(lower.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(lower.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Constant-time byte equality. Length mismatch returns false immediately —
 * lengths are not secret here, only contents are compared without early exit.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a[i]! ^ b[i]!;
  }
  return acc === 0;
}
