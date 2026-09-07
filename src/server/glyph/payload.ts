import { Ref } from "@/lib/glyph/ref";
import { CBORError, CBORTag, decodeCbor, unwrapTags } from "./cbor";

/**
 * Glyph CBOR payload parsing. Field semantics per Phase 1 report §3 plus the
 * current Glyph v2 surface (protocol IDs 6–11, CBOR `v` version key) confirmed
 * against the maintained Photonic Wallet fork and Radiant-Core/Glyph-Token-Standards.
 *
 * Everything here is untrusted, attacker-authored input. Names/URLs/types are
 * display metadata only and must be sanitized again at render time.
 */

export const GLYPH_FT = 1;
export const GLYPH_NFT = 2;
export const GLYPH_DAT = 3;
export const GLYPH_DMINT = 4;
export const GLYPH_MUT = 5;
export const GLYPH_BURN = 6;
export const GLYPH_CONTAINER = 7;
export const GLYPH_ENCRYPTED = 8;
export const GLYPH_TIMELOCK = 9;
export const GLYPH_AUTHORITY = 10;
export const GLYPH_WAVE = 11;

export const PROTOCOL_NAMES: Record<number, string> = {
  [GLYPH_FT]: "ft",
  [GLYPH_NFT]: "nft",
  [GLYPH_DAT]: "dat",
  [GLYPH_DMINT]: "dmint",
  [GLYPH_MUT]: "mutable",
  [GLYPH_BURN]: "burn",
  [GLYPH_CONTAINER]: "container",
  [GLYPH_ENCRYPTED]: "encrypted",
  [GLYPH_TIMELOCK]: "timelock",
  [GLYPH_AUTHORITY]: "authority",
  [GLYPH_WAVE]: "wave",
};

/** Payload versions Canon fully understands. `v` absent ⇒ 1. */
export const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

export class GlyphPayloadError extends Error {
  override name = "GlyphPayloadError";
  constructor(
    message: string,
    readonly code: "MALFORMED" | "TOO_LARGE",
  ) {
    super(message);
  }
}

export interface DeclaredRelationship {
  kind: "in" | "by";
  /** Index within the declared array. */
  index: number;
  /** Present when the entry decoded to a well-formed 36-byte ref. */
  ref?: Ref;
  /** Reason the entry is unusable, when it is. */
  malformedReason?: string;
}

export interface GlyphEmbeddedFile {
  kind: "embedded";
  key: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface GlyphRemoteFile {
  kind: "remote";
  key: string;
  contentType?: string;
  url: string;
  /** Committed content digest: single SHA-256 of the remote file bytes. */
  hash?: Uint8Array;
  /** "HashStamp" — a small embedded thumbnail, NOT a digest. */
  hashStamp?: Uint8Array;
}

export type GlyphFile = GlyphEmbeddedFile | GlyphRemoteFile;

export interface ParsedGlyphPayload {
  /** CBOR `v` key; 1 when absent. */
  version: number;
  versionSupported: boolean;
  protocols: (number | string)[];
  name?: string;
  /** Token kind string: "container", "user", "wave_name", … absent ⇒ object/fungible. */
  type?: string;
  ticker?: string;
  description?: string;
  license?: string;
  /** Free-text `author` field — NOT the `by` relationship. */
  authorText?: string;
  /** Sanitized attribute map (values stringified and length-capped). */
  attrs: Record<string, string>;
  declared: DeclaredRelationship[];
  files: GlyphFile[];
  loc?: number;
  mutableProtocol: boolean;
  /** The full decoded map, tags preserved — raw evidence for the advanced view. */
  raw: Record<string, unknown>;
  notes: string[];
}

const META_KEYS = new Set([
  "p",
  "v",
  "in",
  "by",
  "attrs",
  "name",
  "type",
  "ticker",
  "desc",
  "license",
  "author",
  "loc",
  "dmint",
]);

const MAX_STRING = 10_000;
const MAX_ATTR_VALUE = 200;
const MAX_ATTRS = 100;
const MAX_DECLARED = 32;
const MAX_FILES = 16;

function asBoundedString(value: unknown): string | undefined {
  const v = unwrapTags(value);
  if (typeof v !== "string") return undefined;
  return v.length > MAX_STRING ? v.substring(0, MAX_STRING) : v;
}

function classifyFile(key: string, value: unknown): GlyphFile | undefined {
  const v = unwrapTags(value);
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Uint8Array) {
    return undefined;
  }
  const obj = v as Record<string, unknown>;
  const t = unwrapTags(obj["t"]);
  const b = unwrapTags(obj["b"]);
  const u = unwrapTags(obj["u"]);
  const h = unwrapTags(obj["h"]);
  const hs = unwrapTags(obj["hs"]);

  if (typeof t === "string" && b instanceof Uint8Array) {
    return { kind: "embedded", key, contentType: t, bytes: b };
  }
  if (typeof u === "string") {
    return {
      kind: "remote",
      key,
      url: u,
      ...(typeof t === "string" ? { contentType: t } : {}),
      ...(h instanceof Uint8Array ? { hash: h } : {}),
      ...(hs instanceof Uint8Array ? { hashStamp: hs } : {}),
    };
  }
  return undefined;
}

function parseDeclared(kind: "in" | "by", value: unknown, notes: string[]): DeclaredRelationship[] {
  const v = unwrapTags(value);
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    notes.push(`"${kind}" is not an array; ignored as a relationship declaration`);
    return [];
  }
  const out: DeclaredRelationship[] = [];
  for (let i = 0; i < v.length && i < MAX_DECLARED; i++) {
    const entry = unwrapTags(v[i]);
    if (entry instanceof Uint8Array && entry.length === 36) {
      out.push({ kind, index: i, ref: Ref.fromScriptBytes(entry) });
    } else if (entry instanceof Uint8Array) {
      out.push({ kind, index: i, malformedReason: `expected 36 bytes, got ${entry.length}` });
    } else {
      out.push({ kind, index: i, malformedReason: `expected a byte string, got ${typeof entry}` });
    }
  }
  if (v.length > MAX_DECLARED) {
    notes.push(`"${kind}" declares ${v.length} entries; only the first ${MAX_DECLARED} were processed`);
  }
  return out;
}

export function parseGlyphPayload(payload: Uint8Array): ParsedGlyphPayload {
  let decoded: unknown;
  try {
    decoded = decodeCbor(payload, { allowTrailing: false });
  } catch (err) {
    if (err instanceof CBORError) {
      throw new GlyphPayloadError(`invalid CBOR payload: ${err.message}`, "MALFORMED");
    }
    throw err;
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded) ||
    decoded instanceof Uint8Array ||
    decoded instanceof CBORTag
  ) {
    throw new GlyphPayloadError("payload is not a CBOR map", "MALFORMED");
  }
  const raw = decoded as Record<string, unknown>;
  const notes: string[] = [];

  // Version: absent ⇒ v1 (confirmed against mainnet envelopes).
  const vRaw = unwrapTags(raw["v"]);
  let version = 1;
  if (vRaw !== undefined) {
    if (typeof vRaw === "number" && Number.isInteger(vRaw) && vRaw >= 0) {
      version = vRaw;
    } else {
      notes.push(`non-integer "v" value; treated as unsupported`);
      version = -1;
    }
  }
  const versionSupported = SUPPORTED_VERSIONS.has(version);

  // Protocols: array of ints (strings structurally permitted, surfaced as-is).
  const pRaw = unwrapTags(raw["p"]);
  let protocols: (number | string)[] = [];
  if (Array.isArray(pRaw)) {
    protocols = pRaw
      .map(unwrapTags)
      .filter((x): x is number | string => typeof x === "number" || typeof x === "string");
    if (protocols.length !== pRaw.length) {
      notes.push("protocol array contained non-scalar entries; they were dropped");
    }
  } else if (pRaw !== undefined) {
    notes.push(`"p" is not an array; no protocols recognized`);
  } else {
    notes.push(`payload declares no "p" protocol array`);
  }

  // Attributes.
  const attrs: Record<string, string> = {};
  const attrsRaw = unwrapTags(raw["attrs"]);
  if (typeof attrsRaw === "object" && attrsRaw !== null && !Array.isArray(attrsRaw)) {
    let count = 0;
    for (const [key, valueRaw] of Object.entries(attrsRaw as Record<string, unknown>)) {
      if (count >= MAX_ATTRS) {
        notes.push(`attrs truncated at ${MAX_ATTRS} entries`);
        break;
      }
      const value = unwrapTags(valueRaw);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      ) {
        const s = String(value);
        attrs[key.substring(0, MAX_ATTR_VALUE)] =
          s.length > MAX_ATTR_VALUE ? s.substring(0, MAX_ATTR_VALUE) : s;
        count++;
      }
    }
  }

  // Files: every non-meta key with a file-shaped value.
  const files: GlyphFile[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (META_KEYS.has(key)) continue;
    if (files.length >= MAX_FILES) {
      notes.push(`file entries truncated at ${MAX_FILES}`);
      break;
    }
    const file = classifyFile(key, value);
    if (file) files.push(file);
  }

  const locRaw = unwrapTags(raw["loc"]);
  const loc =
    typeof locRaw === "number" && Number.isInteger(locRaw) && locRaw >= 0 ? locRaw : undefined;

  const protocolNumbers = new Set(protocols.filter((p): p is number => typeof p === "number"));

  const name = asBoundedString(raw["name"]);
  const type = asBoundedString(raw["type"]);
  const ticker = asBoundedString(raw["ticker"]);
  const description = asBoundedString(raw["desc"]);
  const license = asBoundedString(raw["license"]);
  const authorText = asBoundedString(raw["author"]);

  return {
    version,
    versionSupported,
    protocols,
    ...(name !== undefined ? { name } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(ticker !== undefined ? { ticker } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(authorText !== undefined ? { authorText } : {}),
    attrs,
    declared: [
      ...parseDeclared("in", raw["in"], notes),
      ...parseDeclared("by", raw["by"], notes),
    ],
    files,
    ...(loc !== undefined ? { loc } : {}),
    mutableProtocol: protocolNumbers.has(GLYPH_NFT) && protocolNumbers.has(GLYPH_MUT),
    raw,
    notes,
  };
}
