import { Ref } from "@/lib/glyph/ref";
import {
  OP_DISALLOWPUSHINPUTREF,
  OP_DISALLOWPUSHINPUTREFSIBLING,
  OP_PUSHINPUTREF,
  OP_PUSHINPUTREFSINGLETON,
  OP_REQUIREINPUTREF,
  REF_OPCODES,
} from "./opcodes";
import { walkScript } from "./walker";
import type { ScriptOp } from "./walker";

/** A reference found as an actual reference-opcode operand (never inside pushed data). */
export interface RefOccurrence {
  ref: Ref;
  opcode: number;
  /** Byte offset of the opcode in the script — auditable evidence. */
  offset: number;
}

export interface ScriptRefs {
  /** OP_PUSHINPUTREF operands (normal refs). */
  pushRefs: RefOccurrence[];
  /** OP_PUSHINPUTREFSINGLETON operands. */
  singletonRefs: RefOccurrence[];
  /** OP_REQUIREINPUTREF operands. */
  requireRefs: RefOccurrence[];
  disallowRefs: RefOccurrence[];
  disallowSiblingRefs: RefOccurrence[];
}

/**
 * Extract reference operands from a walked script. Because this consumes
 * walker output, a ref-like byte pattern inside a pushed payload can never
 * appear here — the walker skips push payloads wholesale.
 */
export function extractRefs(ops: ScriptOp[]): ScriptRefs {
  const out: ScriptRefs = {
    pushRefs: [],
    singletonRefs: [],
    requireRefs: [],
    disallowRefs: [],
    disallowSiblingRefs: [],
  };
  for (const op of ops) {
    if (!op.data || op.data.length !== 36) continue;
    const occurrence = (): RefOccurrence => ({
      ref: Ref.fromScriptBytes(op.data!),
      opcode: op.opcode,
      offset: op.offset,
    });
    switch (op.opcode) {
      case OP_PUSHINPUTREF:
        out.pushRefs.push(occurrence());
        break;
      case OP_PUSHINPUTREFSINGLETON:
        out.singletonRefs.push(occurrence());
        break;
      case OP_REQUIREINPUTREF:
        out.requireRefs.push(occurrence());
        break;
      case OP_DISALLOWPUSHINPUTREF:
        out.disallowRefs.push(occurrence());
        break;
      case OP_DISALLOWPUSHINPUTREFSIBLING:
        out.disallowSiblingRefs.push(occurrence());
        break;
    }
  }
  return out;
}

/**
 * Return a copy of the script with every ref opcode's 36-byte operand zeroed.
 * ElectrumX indexes token outputs under the scripthash of this zeroed form,
 * so one scripthash covers all of an address's tokens.
 */
export function zeroRefs(script: Uint8Array): Uint8Array {
  const out = Uint8Array.from(script);
  const { ops } = walkScript(script, { tolerant: true });
  for (const op of ops) {
    if (REF_OPCODES.has(op.opcode) && op.data?.length === 36) {
      out.fill(0, op.offset + 1, op.offset + 1 + 36);
    }
  }
  return out;
}
