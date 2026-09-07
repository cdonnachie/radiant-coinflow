/**
 * Bounded, defensive CBOR decoder (RFC 8949 subset) for hostile on-chain data.
 *
 * Properties:
 * - every declared length is range-checked against remaining input BEFORE any
 *   read or allocation;
 * - depth, item-count, and string-size bounds;
 * - strict UTF-8 (invalid text throws);
 * - tags preserved as CBORTag wrappers (Glyph payloads wrap byte arrays in
 *   tag 64 — RFC 8746 — via cbor-x's typed-array encoding);
 * - maps decode to plain objects; non-string map keys and duplicate keys are
 *   rejected (ambiguous, therefore hostile);
 * - integers beyond Number.MAX_SAFE_INTEGER decode as BigInt.
 */

export class CBORError extends Error {
  override name = "CBORError";
}

export class CBORTag {
  constructor(
    readonly tag: number | bigint,
    readonly value: unknown,
  ) {}
}

export interface CBORDecodeOptions {
  /** Maximum nesting depth. Default 32. */
  maxDepth?: number;
  /** Maximum total decoded items. Default 100_000. */
  maxItems?: number;
  /** Maximum single byte/text string length. Default 4 MiB. */
  maxStringLength?: number;
  /** Allow trailing bytes after the first complete item. Default true. */
  allowTrailing?: boolean;
}

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_ITEMS = 100_000;
const DEFAULT_MAX_STRING = 4 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8", { fatal: true });

interface State {
  buf: Uint8Array;
  pos: number;
  itemsLeft: number;
  maxDepth: number;
  maxString: number;
}

export function decodeCbor(input: Uint8Array, options: CBORDecodeOptions = {}): unknown {
  if (!(input instanceof Uint8Array)) throw new CBORError("input must be bytes");
  const state: State = {
    buf: input,
    pos: 0,
    itemsLeft: options.maxItems ?? DEFAULT_MAX_ITEMS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxString: options.maxStringLength ?? DEFAULT_MAX_STRING,
  };
  const value = decodeItem(state, 0);
  if (!(options.allowTrailing ?? true) && state.pos !== input.length) {
    throw new CBORError(`${input.length - state.pos} trailing bytes after CBOR item`);
  }
  return value;
}

function need(state: State, n: number): void {
  if (n > state.buf.length - state.pos) {
    throw new CBORError(`truncated CBOR: need ${n} bytes at offset ${state.pos}`);
  }
}

function takeItemBudget(state: State): void {
  if (--state.itemsLeft < 0) throw new CBORError("CBOR item limit exceeded");
}

/** Reads the argument for additional-info values; returns number | bigint. */
function readArgument(state: State, info: number): number | bigint {
  if (info < 24) return info;
  if (info === 24) {
    need(state, 1);
    return state.buf[state.pos++]!;
  }
  if (info === 25) {
    need(state, 2);
    const v = (state.buf[state.pos]! << 8) | state.buf[state.pos + 1]!;
    state.pos += 2;
    return v;
  }
  if (info === 26) {
    need(state, 4);
    const v = new DataView(state.buf.buffer, state.buf.byteOffset + state.pos, 4).getUint32(0);
    state.pos += 4;
    return v;
  }
  if (info === 27) {
    need(state, 8);
    const v = new DataView(state.buf.buffer, state.buf.byteOffset + state.pos, 8).getBigUint64(0);
    state.pos += 8;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
  throw new CBORError(`reserved additional-info value ${info}`);
}

function argToLength(state: State, arg: number | bigint, what: string): number {
  const n = typeof arg === "bigint" ? Number.MAX_SAFE_INTEGER + 1 : arg;
  if (typeof n !== "number" || n > state.buf.length - state.pos) {
    throw new CBORError(`declared ${what} length exceeds input`);
  }
  if (n > state.maxString) {
    throw new CBORError(`${what} length ${n} exceeds bound ${state.maxString}`);
  }
  return n;
}

function decodeItem(state: State, depth: number): unknown {
  if (depth > state.maxDepth) throw new CBORError("CBOR depth limit exceeded");
  takeItemBudget(state);
  need(state, 1);
  const initial = state.buf[state.pos++]!;
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0: {
      return readArgument(state, info);
    }
    case 1: {
      const arg = readArgument(state, info);
      return typeof arg === "bigint" ? -1n - arg : -1 - arg;
    }
    case 2: {
      // byte string
      if (info === 31) return decodeIndefiniteString(state, depth, 2);
      const len = argToLength(state, readArgument(state, info), "byte string");
      const out = state.buf.slice(state.pos, state.pos + len);
      state.pos += len;
      return out;
    }
    case 3: {
      // text string
      if (info === 31) return decodeIndefiniteString(state, depth, 3);
      const len = argToLength(state, readArgument(state, info), "text string");
      const bytes = state.buf.subarray(state.pos, state.pos + len);
      state.pos += len;
      try {
        return utf8.decode(bytes);
      } catch {
        throw new CBORError("invalid UTF-8 in text string");
      }
    }
    case 4: {
      // array
      if (info === 31) {
        const out: unknown[] = [];
        while (!tryBreak(state)) out.push(decodeItem(state, depth + 1));
        return out;
      }
      const arg = readArgument(state, info);
      if (typeof arg === "bigint" || arg > state.itemsLeft) {
        throw new CBORError("declared array length exceeds item budget");
      }
      const out: unknown[] = [];
      for (let i = 0; i < arg; i++) out.push(decodeItem(state, depth + 1));
      return out;
    }
    case 5: {
      // map → plain object; string keys only; duplicates rejected
      const out: Record<string, unknown> = Object.create(null);
      const setEntry = (key: unknown, value: unknown) => {
        if (typeof key !== "string") {
          throw new CBORError(`non-string map key of type ${typeof key}`);
        }
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          throw new CBORError(`duplicate map key "${key}"`);
        }
        out[key] = value;
      };
      if (info === 31) {
        while (!tryBreak(state)) {
          const key = decodeItem(state, depth + 1);
          setEntry(key, decodeItem(state, depth + 1));
        }
        return out;
      }
      const arg = readArgument(state, info);
      if (typeof arg === "bigint" || arg * 2 > state.itemsLeft) {
        throw new CBORError("declared map length exceeds item budget");
      }
      for (let i = 0; i < arg; i++) {
        const key = decodeItem(state, depth + 1);
        setEntry(key, decodeItem(state, depth + 1));
      }
      return out;
    }
    case 6: {
      const tag = readArgument(state, info);
      return new CBORTag(tag, decodeItem(state, depth + 1));
    }
    case 7: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      if (info === 24) {
        need(state, 1);
        return state.buf[state.pos++]; // simple value
      }
      if (info === 25) {
        need(state, 2);
        const v = decodeHalfFloat(
          (state.buf[state.pos]! << 8) | state.buf[state.pos + 1]!,
        );
        state.pos += 2;
        return v;
      }
      if (info === 26) {
        need(state, 4);
        const v = new DataView(state.buf.buffer, state.buf.byteOffset + state.pos, 4).getFloat32(0);
        state.pos += 4;
        return v;
      }
      if (info === 27) {
        need(state, 8);
        const v = new DataView(state.buf.buffer, state.buf.byteOffset + state.pos, 8).getFloat64(0);
        state.pos += 8;
        return v;
      }
      if (info === 31) throw new CBORError("unexpected break code");
      if (info < 20) return info; // unassigned simple values 0-19
      throw new CBORError(`reserved simple/float form ${info}`);
    }
    default:
      throw new CBORError(`unreachable major type ${major}`);
  }
}

function tryBreak(state: State): boolean {
  need(state, 1);
  if (state.buf[state.pos] === 0xff) {
    state.pos += 1;
    return true;
  }
  return false;
}

function decodeIndefiniteString(state: State, depth: number, major: 2 | 3): Uint8Array | string {
  if (depth + 1 > state.maxDepth) throw new CBORError("CBOR depth limit exceeded");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (!tryBreak(state)) {
    takeItemBudget(state);
    need(state, 1);
    const initial = state.buf[state.pos++]!;
    if (initial >> 5 !== major || (initial & 0x1f) === 31) {
      throw new CBORError("invalid chunk inside indefinite-length string");
    }
    const len = argToLength(state, readArgument(state, initial & 0x1f), "string chunk");
    total += len;
    if (total > state.maxString) throw new CBORError("indefinite string exceeds bound");
    chunks.push(state.buf.slice(state.pos, state.pos + len));
    state.pos += len;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.length;
  }
  if (major === 2) return joined;
  try {
    return utf8.decode(joined);
  } catch {
    throw new CBORError("invalid UTF-8 in indefinite text string");
  }
}

/** IEEE 754 half-precision (CBOR f9). */
function decodeHalfFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** Recursively unwrap CBORTag wrappers (tag 64 typed arrays and friends). */
export function unwrapTags(value: unknown): unknown {
  let v = value;
  while (v instanceof CBORTag) v = v.value;
  return v;
}
