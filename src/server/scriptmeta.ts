/**
 * Radiant script metadata for ref/contract outputs.
 *
 * Radiant's induction-proof opcodes (OP_PUSHINPUTREF 0xd0, OP_REQUIREINPUTREF
 * 0xd1, OP_DISALLOWPUSHINPUTREF 0xd2, OP_DISALLOWPUSHINPUTREFSIBLING 0xd3,
 * OP_PUSHINPUTREFSINGLETON 0xd8) each carry a 36-byte immediate payload in
 * the script serialization (see Radiant-Core CScript::GetOp). Any script
 * containing them is reported by the node as `nonstandard` with no address —
 * yet the dominant token pattern embeds a plain P2PKH lock ahead of an
 * OP_STATESEPARATOR, so the output still has a meaningful owner:
 *
 *   OP_DUP OP_HASH160 <h160> OP_EQUALVERIFY OP_CHECKSIG OP_STATESEPARATOR <refs…>
 *
 * This module tokenizes such scripts, extracts the embedded owner address and
 * the refs, and attaches them to verbose transaction outputs so the tracer
 * can follow token value instead of dropping it.
 */

import { createHash } from 'crypto';
import { scriptHexToScripthash } from './electrum/scripthash';

const REF_OPCODES = new Set([0xd0, 0xd1, 0xd2, 0xd3, 0xd8]);
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

// Radiant mainnet base58check version bytes (chainparams.cpp)
const P2PKH_VERSION = 0;
const P2SH_VERSION = 5;

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(data: Buffer): Buffer {
    return createHash('sha256').update(data).digest();
}

function base58CheckEncode(version: number, payload: Buffer): string {
    const body = Buffer.concat([Buffer.from([version]), payload]);
    const checksum = sha256(sha256(body)).subarray(0, 4);
    const data = Buffer.concat([body, checksum]);

    const digits: number[] = [0];
    for (const byte of data) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let prefix = '';
    for (const byte of data) {
        if (byte !== 0) break;
        prefix += '1';
    }
    return prefix + digits.reverse().map((d) => B58_ALPHABET[d]).join('');
}

export interface ScriptMetadata {
    /** P2PKH/P2SH owner embedded at the start of the script, if any. */
    ownerAddress?: string;
    /** 36-byte ref payloads (hex) pushed by ref opcodes. */
    refs: string[];
    hasRefs: boolean;
}

/** Tokenizes a Radiant script and extracts owner + ref metadata. */
export function analyzeScript(scriptHex: string): ScriptMetadata {
    const buf = Buffer.from(scriptHex, 'hex');
    const refs: string[] = [];

    // Embedded owner lock at the script head:
    //   P2PKH: 76 a9 14 <20 bytes> 88 ac   |   P2SH: a9 14 <20 bytes> 87
    let ownerAddress: string | undefined;
    if (buf.length > 25 && buf[0] === 0x76 && buf[1] === 0xa9 && buf[2] === 0x14 &&
        buf[23] === 0x88 && buf[24] === 0xac) {
        ownerAddress = base58CheckEncode(P2PKH_VERSION, buf.subarray(3, 23));
    } else if (buf.length > 22 && buf[0] === 0xa9 && buf[1] === 0x14 && buf[22] === 0x87) {
        ownerAddress = base58CheckEncode(P2SH_VERSION, buf.subarray(2, 22));
    }

    let pos = 0;
    while (pos < buf.length) {
        const opcode = buf[pos++];
        if (opcode > 0 && opcode <= 0x4b) {
            pos += opcode;
        } else if (opcode === OP_PUSHDATA1) {
            if (pos + 1 > buf.length) break;
            pos += 1 + buf[pos];
        } else if (opcode === OP_PUSHDATA2) {
            if (pos + 2 > buf.length) break;
            pos += 2 + buf.readUInt16LE(pos);
        } else if (opcode === OP_PUSHDATA4) {
            if (pos + 4 > buf.length) break;
            pos += 4 + buf.readUInt32LE(pos);
        } else if (REF_OPCODES.has(opcode)) {
            if (pos + 36 > buf.length) break; // malformed
            refs.push(buf.subarray(pos, pos + 36).toString('hex'));
            pos += 36;
        }
        // all other opcodes carry no immediate
    }

    return { ownerAddress, refs, hasRefs: refs.length > 0 };
}

/**
 * Attaches ref/owner metadata to every address-less output of a verbose
 * transaction: `ownerAddress`, `refs`, `hasRefs`, and the electrum-style
 * `scripthash` (a stable identity for pure contract outputs). Best-effort.
 */
export function enrichScriptMetadata(tx: {
    vout?: Array<{
        scriptPubKey?: {
            hex?: string;
            type?: string;
            address?: string;
            addresses?: string[];
            ownerAddress?: string;
            refs?: string[];
            hasRefs?: boolean;
            scripthash?: string;
        };
    }>;
}): void {
    if (!Array.isArray(tx.vout)) return;
    for (const out of tx.vout) {
        const spk = out.scriptPubKey;
        if (!spk?.hex) continue;
        if (spk.address || (spk.addresses && spk.addresses.length > 0)) continue;
        if (spk.type === 'nulldata') continue; // unspendable data carrier
        try {
            const meta = analyzeScript(spk.hex);
            if (meta.ownerAddress) spk.ownerAddress = meta.ownerAddress;
            if (meta.hasRefs) {
                spk.refs = meta.refs;
                spk.hasRefs = true;
            }
            spk.scripthash = scriptHexToScripthash(spk.hex);
        } catch {
            // leave the output unenriched
        }
    }
}
