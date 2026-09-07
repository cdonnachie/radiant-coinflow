import {
  OP_PUSHDATA1,
  OP_PUSHDATA2,
  OP_PUSHDATA4,
  REF_OPCODES,
} from "./opcodes";

/**
 * Radiant-aware script opcode walker.
 *
 * Security requirements (spec + Phase 1 report):
 * - walk opcode by opcode; push payloads are skipped, never scanned;
 * - reference opcodes (0xd0–0xd3, 0xd8) consume 36 RAW bytes with no length
 *   prefix (radiant-node script.cpp GetScriptOp) — a naive Bitcoin walker
 *   misparses every Radiant token script;
 * - OP_PUSHDATA1/2/4 supported; declared lengths are range-checked against the
 *   remaining input BEFORE any read;
 * - overall script size is bounded.
 */

export interface ScriptOp {
  /** Byte offset of the opcode within the script. */
  offset: number;
  opcode: number;
  /** Present for pushes (including OP_0's empty push) and ref-opcode operands. */
  data?: Uint8Array;
}

export class ScriptParseError extends Error {
  override name = "ScriptParseError";
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at byte ${offset})`);
  }
}

export interface WalkOptions {
  /** Maximum script size in bytes. Default 2 MiB (consensus allows 32 MB; Canon bounds tighter). */
  maxScriptSize?: number;
  /** Maximum single push size in bytes. Default 1 MiB. */
  maxPushSize?: number;
  /**
   * Tolerant mode: stop cleanly at a malformed tail instead of throwing,
   * returning the ops parsed so far plus the error. For display surfaces only —
   * verification always uses strict mode.
   */
  tolerant?: boolean;
}

export interface WalkResult {
  ops: ScriptOp[];
  /** Set only in tolerant mode when the script was malformed. */
  error?: ScriptParseError;
}

const DEFAULT_MAX_SCRIPT_SIZE = 2 * 1024 * 1024;
const DEFAULT_MAX_PUSH_SIZE = 1024 * 1024;

export function walkScript(script: Uint8Array, options: WalkOptions = {}): WalkResult {
  const maxScriptSize = options.maxScriptSize ?? DEFAULT_MAX_SCRIPT_SIZE;
  const maxPushSize = options.maxPushSize ?? DEFAULT_MAX_PUSH_SIZE;

  if (script.length > maxScriptSize) {
    const err = new ScriptParseError(
      `script size ${script.length} exceeds bound ${maxScriptSize}`,
      0,
    );
    if (options.tolerant) return { ops: [], error: err };
    throw err;
  }

  const ops: ScriptOp[] = [];
  let i = 0;

  const fail = (message: string, offset: number): WalkResult => {
    const err = new ScriptParseError(message, offset);
    if (options.tolerant) return { ops, error: err };
    throw err;
  };

  while (i < script.length) {
    const offset = i;
    const opcode = script[i]!;
    i += 1;

    // Direct pushes: 0x00 pushes empty, 0x01–0x4b push that many bytes.
    if (opcode >= 0x00 && opcode <= 0x4b) {
      const len = opcode;
      if (len > script.length - i) {
        return fail(`truncated push of ${len} bytes`, offset);
      }
      ops.push({ offset, opcode, data: script.slice(i, i + len) });
      i += len;
      continue;
    }

    if (opcode === OP_PUSHDATA1 || opcode === OP_PUSHDATA2 || opcode === OP_PUSHDATA4) {
      const lenBytes = opcode === OP_PUSHDATA1 ? 1 : opcode === OP_PUSHDATA2 ? 2 : 4;
      if (lenBytes > script.length - i) {
        return fail(`truncated PUSHDATA length prefix`, offset);
      }
      let len = 0;
      for (let b = 0; b < lenBytes; b++) {
        len += script[i + b]! * 2 ** (8 * b); // little-endian
      }
      i += lenBytes;
      if (len > maxPushSize) {
        return fail(`push of ${len} bytes exceeds bound ${maxPushSize}`, offset);
      }
      if (len > script.length - i) {
        return fail(`truncated PUSHDATA payload (${len} declared)`, offset);
      }
      ops.push({ offset, opcode, data: script.slice(i, i + len) });
      i += len;
      continue;
    }

    // Radiant reference opcodes: 36 raw operand bytes, no length prefix.
    if (REF_OPCODES.has(opcode)) {
      if (36 > script.length - i) {
        return fail(`truncated reference operand`, offset);
      }
      ops.push({ offset, opcode, data: script.slice(i, i + 36) });
      i += 36;
      continue;
    }

    ops.push({ offset, opcode });
  }

  return { ops };
}

/** Convenience: strict walk returning just the ops. */
export function parseScript(script: Uint8Array, options: WalkOptions = {}): ScriptOp[] {
  return walkScript(script, { ...options, tolerant: false }).ops;
}
