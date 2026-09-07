import { bytesToHex } from "@/lib/glyph/bytes";
import { sha256d } from "./hash";
import { REF_OPCODES } from "./opcodes";
import type { ScriptOp } from "./walker";

/**
 * Glyph envelope location (Phase 1 §3):
 * a direct 3-byte push of "gly" (0x03 0x67 0x6c 0x79) in the reveal input's
 * scriptSig, immediately followed by one push carrying the CBOR payload.
 * Mutable-token spends follow the payload with a push of "mod" or "sl".
 */

export const GLYPH_MAGIC = new Uint8Array([0x67, 0x6c, 0x79]); // "gly"

export class GlyphEnvelopeError extends Error {
  override name = "GlyphEnvelopeError";
  constructor(
    message: string,
    readonly code: "NO_ENVELOPE" | "MALFORMED_ENVELOPE" | "PAYLOAD_TOO_LARGE",
  ) {
    super(message);
  }
}

export interface GlyphEnvelope {
  payload: Uint8Array;
  /** sha256d(payload) hex — what a commit script commits to via OP_HASH256. */
  payloadHashHex: string;
  /** Index of the "gly" push within the walked ops. */
  markerOpIndex: number;
  /** Present when the scriptSig is a mutable-contract spend. */
  mutableOp?: "mod" | "sl";
}

export interface EnvelopeOptions {
  /** Bound applied to the payload before CBOR decoding. Default 2 MiB. */
  maxPayloadSize?: number;
}

const DEFAULT_MAX_PAYLOAD = 2 * 1024 * 1024;

function isGlyMarker(op: ScriptOp): boolean {
  return (
    op.opcode === 0x03 &&
    op.data !== undefined &&
    op.data.length === 3 &&
    op.data[0] === 0x67 &&
    op.data[1] === 0x6c &&
    op.data[2] === 0x79
  );
}

function isPush(op: ScriptOp): boolean {
  // Push family only: direct pushes and PUSHDATA1/2/4. Ref opcodes also carry
  // data but are NOT pushes of arbitrary payload.
  return op.data !== undefined && op.opcode <= 0x4e && !REF_OPCODES.has(op.opcode);
}

/**
 * Locate the Glyph envelope in a walked scriptSig. Returns undefined when no
 * "gly" marker exists; throws when a marker exists but the envelope is
 * malformed or over-size (these are different verdicts downstream).
 */
export function findGlyphEnvelope(
  ops: ScriptOp[],
  options: EnvelopeOptions = {},
): GlyphEnvelope | undefined {
  const maxPayload = options.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD;

  for (let i = 0; i < ops.length; i++) {
    if (!isGlyMarker(ops[i]!)) continue;

    const payloadOp = ops[i + 1];
    if (!payloadOp || !isPush(payloadOp)) {
      throw new GlyphEnvelopeError(
        `"gly" marker at op ${i} is not followed by a payload push`,
        "MALFORMED_ENVELOPE",
      );
    }
    const payload = payloadOp.data!;
    if (payload.length > maxPayload) {
      throw new GlyphEnvelopeError(
        `payload of ${payload.length} bytes exceeds bound ${maxPayload}`,
        "PAYLOAD_TOO_LARGE",
      );
    }

    let mutableOp: "mod" | "sl" | undefined;
    const next = ops[i + 2];
    if (next && isPush(next) && next.data) {
      const hex = bytesToHex(next.data);
      if (hex === "6d6f64") mutableOp = "mod";
      else if (hex === "736c") mutableOp = "sl";
    }

    return {
      payload,
      payloadHashHex: bytesToHex(sha256d(payload)),
      markerOpIndex: i,
      ...(mutableOp !== undefined ? { mutableOp } : {}),
    };
  }
  return undefined;
}
