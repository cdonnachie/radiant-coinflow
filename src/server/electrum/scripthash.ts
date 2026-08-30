/**
 * Address and scripthash helpers for the ElectrumX backend.
 *
 * ElectrumX indexes outputs by "scripthash": sha256(scriptPubKey), hex-encoded
 * in reversed byte order. Radiant uses legacy base58check addresses —
 * P2PKH prefix 0x00 ('1...'), P2SH prefix 0x05 ('3...') on mainnet,
 * 111 / 196 on testnet.
 */

import { createHash } from 'crypto';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const P2PKH_PREFIXES = new Set([0, 111]); // mainnet, testnet
const P2SH_PREFIXES = new Set([5, 196]); // mainnet, testnet

function sha256(data: Buffer): Buffer {
    return createHash('sha256').update(data).digest();
}

function base58Decode(input: string): Buffer {
    const bytes: number[] = [0];
    for (const char of input) {
        const value = B58_ALPHABET.indexOf(char);
        if (value === -1) throw new Error(`Invalid base58 character '${char}'`);
        let carry = value;
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    // Leading '1' characters encode leading zero bytes
    for (const char of input) {
        if (char !== '1') break;
        bytes.push(0);
    }
    return Buffer.from(bytes.reverse());
}

/** Decodes a base58check string, verifying the 4-byte double-sha256 checksum. */
function base58CheckDecode(input: string): { version: number; payload: Buffer } {
    const decoded = base58Decode(input);
    if (decoded.length < 5) throw new Error('Address too short');
    const payload = decoded.subarray(0, decoded.length - 4);
    const checksum = decoded.subarray(decoded.length - 4);
    const expected = sha256(sha256(payload)).subarray(0, 4);
    if (!checksum.equals(expected)) throw new Error('Bad address checksum');
    return { version: payload[0], payload: payload.subarray(1) };
}

/** Builds the scriptPubKey for a legacy base58check address. */
export function addressToScript(address: string): Buffer {
    const { version, payload } = base58CheckDecode(address);
    if (payload.length !== 20) {
        throw new Error(`Unexpected hash length ${payload.length} for address ${address}`);
    }
    if (P2PKH_PREFIXES.has(version)) {
        // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
        return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), payload, Buffer.from([0x88, 0xac])]);
    }
    if (P2SH_PREFIXES.has(version)) {
        // OP_HASH160 <20> OP_EQUAL
        return Buffer.concat([Buffer.from([0xa9, 0x14]), payload, Buffer.from([0x87])]);
    }
    throw new Error(`Unsupported address version ${version} for address ${address}`);
}

/** ElectrumX scripthash: sha256(script), reversed, hex. */
export function scriptToScripthash(script: Buffer): string {
    return Buffer.from(sha256(script)).reverse().toString('hex');
}

export function addressToScripthash(address: string): string {
    return scriptToScripthash(addressToScript(address));
}

export function scriptHexToScripthash(scriptHex: string): string {
    return scriptToScripthash(Buffer.from(scriptHex, 'hex'));
}
