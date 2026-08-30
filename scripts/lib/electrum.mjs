/**
 * Shared ElectrumX helpers for maintenance scripts.
 * Connection settings come from RADIANT_ELECTRUM_HOST / _PORT / _TLS
 * (environment or .env.local).
 */

import { connect as netConnect } from 'net';
import { connect as tlsConnect } from 'tls';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnvLocal() {
    const path = join(ROOT, '.env.local');
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
}

/** Opens a connection and returns { request, close }. Exits on config/socket errors. */
export function createClient() {
    loadEnvLocal();
    const host = process.env.RADIANT_ELECTRUM_HOST;
    const port = Number(process.env.RADIANT_ELECTRUM_PORT ?? 50002);
    const tls = process.env.RADIANT_ELECTRUM_TLS !== undefined
        ? process.env.RADIANT_ELECTRUM_TLS === 'true'
        : port === 50002;
    if (!host) {
        console.error('RADIANT_ELECTRUM_HOST not set (env or .env.local)');
        process.exit(1);
    }

    const socket = tls
        ? tlsConnect({ host, port, rejectUnauthorized: false })
        : netConnect({ host, port });
    socket.setEncoding('utf8');

    let buffer = '';
    let nextId = 1;
    const pending = new Map();

    socket.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
            if (!line.trim()) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.id !== undefined && pending.has(msg.id)) {
                const p = pending.get(msg.id); pending.delete(msg.id);
                msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
            }
        }
    });
    socket.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });

    function request(method, params = [], timeoutMs = 60000) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
            setTimeout(() => {
                if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
            }, timeoutMs);
        });
    }

    const ready = new Promise((resolve) => socket.on('connect', resolve))
        .then(() => request('server.version', ['radiant-coinflow scripts 1.0', '1.4']));

    return {
        request: async (method, params, timeoutMs) => { await ready; return request(method, params, timeoutMs); },
        close: () => socket.destroy(),
    };
}

// ---------------------------------------------------------------- addresses

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(input) {
    const bytes = [0];
    for (const char of input) {
        let carry = B58.indexOf(char);
        if (carry === -1) throw new Error(`Invalid base58 character '${char}'`);
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const char of input) {
        if (char !== '1') break;
        bytes.push(0);
    }
    return Buffer.from(bytes.reverse());
}

const sha256 = (data) => createHash('sha256').update(data).digest();

/** Electrum scripthash for a legacy P2PKH/P2SH address. */
export function addressToScripthash(address) {
    const decoded = base58Decode(address);
    const version = decoded[0];
    const h160 = decoded.subarray(1, 21);
    const script = [0, 111].includes(version)
        ? Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h160, Buffer.from([0x88, 0xac])])
        : Buffer.concat([Buffer.from([0xa9, 0x14]), h160, Buffer.from([0x87])]);
    return Buffer.from(sha256(script)).reverse().toString('hex');
}
