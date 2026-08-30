/**
 * Exact output values from raw transaction hex.
 *
 * JSON parsing coerces the daemon's decimal `value` fields to doubles, which
 * lose precision above 2^53 photons (~90M RXD). The 64-bit output values in
 * the raw serialized transaction are authoritative, so backends parse them
 * with BigInt and attach `valueSat` decimal strings to each vout.
 *
 * Radiant uses the classic pre-segwit Bitcoin transaction serialization:
 *   version(4) | vin_count(varint) | vins | vout_count(varint) | vouts | locktime(4)
 *   vin:  outpoint(36) | script_len(varint) | script | sequence(4)
 *   vout: value(8 LE)  | script_len(varint) | script
 */

class TxReader {
    private offset = 0;
    constructor(private readonly buf: Buffer) {}

    skip(n: number): void {
        this.offset += n;
        if (this.offset > this.buf.length) throw new Error('tx truncated');
    }

    readVarInt(): number {
        const first = this.buf.readUInt8(this.offset);
        this.offset += 1;
        if (first < 0xfd) return first;
        if (first === 0xfd) {
            const v = this.buf.readUInt16LE(this.offset);
            this.offset += 2;
            return v;
        }
        if (first === 0xfe) {
            const v = this.buf.readUInt32LE(this.offset);
            this.offset += 4;
            return v;
        }
        // 0xff — 8 bytes; counts this large never occur in valid transactions
        const v = this.buf.readBigUInt64LE(this.offset);
        this.offset += 8;
        if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('varint too large');
        return Number(v);
    }

    readUInt64LE(): bigint {
        const v = this.buf.readBigUInt64LE(this.offset);
        this.offset += 8;
        return v;
    }
}

/** Parses the exact photon value of every output in a serialized transaction. */
export function parseVoutValues(txHex: string): bigint[] {
    const reader = new TxReader(Buffer.from(txHex, 'hex'));
    reader.skip(4); // version

    const vinCount = reader.readVarInt();
    for (let i = 0; i < vinCount; i++) {
        reader.skip(36); // outpoint (txid + index)
        reader.skip(reader.readVarInt()); // scriptSig
        reader.skip(4); // sequence
    }

    const voutCount = reader.readVarInt();
    const values: bigint[] = [];
    for (let i = 0; i < voutCount; i++) {
        values.push(reader.readUInt64LE());
        reader.skip(reader.readVarInt()); // scriptPubKey
    }
    return values;
}

/**
 * Attaches an exact `valueSat` decimal string to each vout of a verbose
 * transaction, parsed from its raw hex. Best-effort: on any parse mismatch
 * the transaction is returned unmodified.
 */
export function enrichVoutValues(tx: {
    hex?: string;
    vout?: Array<{ n?: number; valueSat?: unknown }>;
}): void {
    if (!tx.hex || !Array.isArray(tx.vout)) return;
    try {
        const values = parseVoutValues(tx.hex);
        if (values.length !== tx.vout.length) return;
        for (const out of tx.vout) {
            if (typeof out.n === 'number' && out.n >= 0 && out.n < values.length) {
                out.valueSat = values[out.n].toString();
            }
        }
    } catch {
        // leave the decimal `value` fields as the only source
    }
}
