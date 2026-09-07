import { bytesToHex, constantTimeEqual, hexToBytes, reverseBytes } from './bytes';

/**
 * A Radiant reference: 36 bytes = 32-byte txid + 4-byte output index.
 * A Glyph token's ref is the outpoint of its commit output.
 *
 * Copied from canon.rxd packages/reference-parser/src/ref.ts — keep in sync.
 *
 * Encodings:
 * - script form (internal): internal-order txid ‖ little-endian uint32 vout.
 *   This is what appears in script operands and CBOR `in`/`by` arrays.
 *   Confirmed at consensus level: radiant-node src/validation.h `Converters::fromOutpoint`.
 * - display form (canonical): display-order txid hex ‖ BIG-endian
 *   vout as 8 hex chars. This is what `blockchain.ref.get` accepts and what
 *   photonic-wallet's `Outpoint.toString()` produces.
 * - electrum short form: `<display txid>i<decimal vout>` (listunspent `refs`).
 * - rxindexer form: `<display txid>_<decimal vout>`.
 */

export const REF_BYTE_LENGTH = 36;
export const TXID_BYTE_LENGTH = 32;

export class RefError extends Error {
  override name = 'RefError';
}

const DISPLAY_RE = /^[0-9a-f]{72}$/;
const TXID_RE = /^[0-9a-f]{64}$/;

export class Ref {
  /** Script-form bytes: internal txid ‖ LE vout. Do not mutate. */
  readonly scriptBytes: Uint8Array;

  private constructor(scriptBytes: Uint8Array) {
    this.scriptBytes = scriptBytes;
  }

  /** From the 36 raw bytes as they appear in a script operand or CBOR value. */
  static fromScriptBytes(bytes: Uint8Array): Ref {
    if (!(bytes instanceof Uint8Array) || bytes.length !== REF_BYTE_LENGTH) {
      throw new RefError(
        `reference must be exactly ${REF_BYTE_LENGTH} bytes, got ${bytes?.length ?? 'none'}`,
      );
    }
    return new Ref(Uint8Array.from(bytes));
  }

  /** From 72 hex chars in script form (internal txid + LE vout). */
  static fromScriptHex(hex: string): Ref {
    const lower = hex.toLowerCase();
    if (!DISPLAY_RE.test(lower)) {
      throw new RefError(`script-form ref must be 72 hex chars, got ${hex.length}`);
    }
    return Ref.fromScriptBytes(hexToBytes(lower));
  }

  /**
   * From the canonical display form: display txid (64 hex) + big-endian vout
   * (8 hex). Both halves are byte-reversed to obtain the script form —
   * matching `assert_ref` in rxd-electrumx session.py and photonic's
   * `Outpoint.reverse()`.
   */
  static fromDisplayHex(hex: string): Ref {
    const lower = hex.toLowerCase();
    if (!DISPLAY_RE.test(lower)) {
      throw new RefError(`display-form ref must be 72 hex chars, got ${hex.length}`);
    }
    const txidDisplay = hexToBytes(lower.substring(0, 64));
    const voutBE = hexToBytes(lower.substring(64));
    return Ref.fromScriptBytes(
      concat(reverseBytes(txidDisplay), reverseBytes(voutBE)),
    );
  }

  /** From a display txid string and a numeric vout. */
  static fromTxidVout(txidDisplay: string, vout: number): Ref {
    const lower = txidDisplay.toLowerCase();
    if (!TXID_RE.test(lower)) {
      throw new RefError(`txid must be 64 hex chars, got ${txidDisplay.length}`);
    }
    if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
      throw new RefError(`vout out of range: ${vout}`);
    }
    const scriptTxid = reverseBytes(hexToBytes(lower));
    const voutLE = new Uint8Array(4);
    new DataView(voutLE.buffer).setUint32(0, vout, true);
    return Ref.fromScriptBytes(concat(scriptTxid, voutLE));
  }

  /** From an outpoint whose txid is already in internal byte order (e.g. a parsed tx input). */
  static fromOutpoint(txidInternal: Uint8Array, vout: number): Ref {
    if (txidInternal.length !== TXID_BYTE_LENGTH) {
      throw new RefError(`internal txid must be 32 bytes, got ${txidInternal.length}`);
    }
    if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
      throw new RefError(`vout out of range: ${vout}`);
    }
    const voutLE = new Uint8Array(4);
    new DataView(voutLE.buffer).setUint32(0, vout, true);
    return Ref.fromScriptBytes(concat(txidInternal, voutLE));
  }

  /** From ElectrumX's short form `<txid>i<decimal vout>` (listunspent `refs` field). */
  static fromElectrumShort(s: string): Ref {
    const m = /^([0-9a-f]{64})i(\d{1,10})$/.exec(s.toLowerCase());
    if (!m) throw new RefError(`not an electrum short ref: ${truncateForError(s)}`);
    return Ref.fromTxidVout(m[1]!, Number(m[2]!));
  }

  /** From RXinDexer's `<txid>_<decimal vout>` (also accepts `<txid>:<vout>`). */
  static fromTxidVoutString(s: string): Ref {
    const m = /^([0-9a-f]{64})[_:](\d{1,10})$/.exec(s.toLowerCase());
    if (!m) throw new RefError(`not a txid_vout ref: ${truncateForError(s)}`);
    return Ref.fromTxidVout(m[1]!, Number(m[2]!));
  }

  /**
   * Parse user-supplied input. Accepts the canonical 72-hex display form and
   * the explicit-separator forms. Deliberately does NOT guess between display
   * and script byte order for bare 72-hex input: display form is the
   * documented interface (script-form hex must go through fromScriptHex).
   */
  static parse(input: string): Ref {
    const s = input.trim().toLowerCase();
    if (DISPLAY_RE.test(s)) return Ref.fromDisplayHex(s);
    if (/^[0-9a-f]{64}i\d{1,10}$/.test(s)) return Ref.fromElectrumShort(s);
    if (/^[0-9a-f]{64}[_:]\d{1,10}$/.test(s)) return Ref.fromTxidVoutString(s);
    throw new RefError(
      `unrecognized reference form (${truncateForError(s)}); expected 72 hex chars (txid + big-endian vout) or txid:vout`,
    );
  }

  /** Internal-order txid bytes (as serialized in transactions). */
  get txidInternal(): Uint8Array {
    return this.scriptBytes.slice(0, TXID_BYTE_LENGTH);
  }

  /** Display-order txid hex (RPC/explorer form). */
  get txidDisplay(): string {
    return bytesToHex(reverseBytes(this.txidInternal));
  }

  get vout(): number {
    return new DataView(
      this.scriptBytes.buffer,
      this.scriptBytes.byteOffset + TXID_BYTE_LENGTH,
      4,
    ).getUint32(0, true);
  }

  /** 72-hex script form (raw operand bytes). */
  toScriptHex(): string {
    return bytesToHex(this.scriptBytes);
  }

  /** Canonical 72-hex display form (display txid + BE vout). */
  toDisplayHex(): string {
    const voutBE = new Uint8Array(4);
    new DataView(voutBE.buffer).setUint32(0, this.vout, false);
    return bytesToHex(reverseBytes(this.txidInternal)) + bytesToHex(voutBE);
  }

  /** Parameter encoding for `blockchain.ref.get`. */
  toElectrumParam(): string {
    return this.toDisplayHex();
  }

  toElectrumShort(): string {
    return `${this.txidDisplay}i${this.vout}`;
  }

  toRxindexerForm(): string {
    return `${this.txidDisplay}_${this.vout}`;
  }

  /** Abbreviated display, photonic style: `abcd…wxyz·N`. */
  toShort(): string {
    const t = this.txidDisplay;
    return `${t.substring(0, 4)}…${t.substring(60)}·${this.vout}`;
  }

  /** Constant-time equality over the 36 script-form bytes. */
  equals(other: Ref): boolean {
    return constantTimeEqual(this.scriptBytes, other.scriptBytes);
  }

  equalsBytes(scriptBytes: Uint8Array): boolean {
    return constantTimeEqual(this.scriptBytes, scriptBytes);
  }

  toString(): string {
    return this.toDisplayHex();
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function truncateForError(s: string): string {
  return s.length > 40 ? `${s.substring(0, 40)}…[${s.length} chars]` : s;
}
