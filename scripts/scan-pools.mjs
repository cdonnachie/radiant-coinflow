#!/usr/bin/env node
/**
 * Mining pool scanner — populates the mining_pools section of
 * public/data/exchange-addresses.json from live chain data.
 *
 * Every coinbase transaction identifies its miner: the payout address is
 * on-chain fact, and pools usually embed a self-identifying tag (a domain
 * like /m2pool.com/) in the coinbase scriptSig. This script scans the last
 * N blocks via ElectrumX, decodes those tags, and groups payout addresses
 * into pools.
 *
 * Naming precedence per address:
 *   1. curated identity from scripts/pool-names.json (name + link)
 *   2. dominant coinbase tag, if that tag appears in >= --min-tag-blocks
 *      blocks overall (filters junk domain-lookalikes in random bytes)
 *   3. "Unknown pool (<addr>…)" for untagged repeat miners
 *
 * Confidence: curated/tagged 0.95, unknown 0.5. Curated addresses are
 * included even when unseen in the scan window (blocks: 0).
 *
 * Usage:
 *   node scripts/scan-pools.mjs [--blocks N] [--min-untagged N]
 *                               [--min-tag-blocks N] [--dry-run]
 *
 * ElectrumX connection comes from RADIANT_ELECTRUM_HOST / _PORT / _TLS
 * (environment or .env.local).
 */

import { connect as netConnect } from 'net';
import { connect as tlsConnect } from 'tls';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'public', 'data', 'exchange-addresses.json');
const NAMES_PATH = join(ROOT, 'scripts', 'pool-names.json');

// ---------------------------------------------------------------- config

function loadEnvLocal() {
    const path = join(ROOT, '.env.local');
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
}
loadEnvLocal();

const HOST = process.env.RADIANT_ELECTRUM_HOST;
const PORT = Number(process.env.RADIANT_ELECTRUM_PORT ?? 50002);
const TLS = process.env.RADIANT_ELECTRUM_TLS !== undefined
    ? process.env.RADIANT_ELECTRUM_TLS === 'true'
    : PORT === 50002;

if (!HOST) {
    console.error('RADIANT_ELECTRUM_HOST not set (env or .env.local)');
    process.exit(1);
}

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
}
const BLOCKS = argValue('--blocks', 20000);
const MIN_UNTAGGED = argValue('--min-untagged', 5);
const MIN_TAG_BLOCKS = argValue('--min-tag-blocks', 3);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = 50;

const curated = existsSync(NAMES_PATH)
    ? Object.fromEntries(
          Object.entries(JSON.parse(readFileSync(NAMES_PATH, 'utf8')))
              .filter(([k]) => !k.startsWith('_')),
      )
    : {};

// ---------------------------------------------------------- electrum client

const socket = TLS
    ? tlsConnect({ host: HOST, port: PORT, rejectUnauthorized: false })
    : netConnect({ host: HOST, port: PORT });
socket.setEncoding('utf8');

let buffer = '';
let nextId = 1;
const pending = new Map();

function request(method, params = []) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
        }, 60000);
    });
}

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

// ------------------------------------------------------------- tag parsing

/** Printable-ASCII runs (>=4 chars) from coinbase scriptSig hex. */
function coinbaseRuns(coinbaseHex) {
    const bytes = Buffer.from(coinbaseHex, 'hex');
    const runs = [];
    let run = '';
    for (const b of bytes) {
        if (b >= 0x20 && b <= 0x7e) run += String.fromCharCode(b);
        else { if (run.length >= 4) runs.push(run); run = ''; }
    }
    if (run.length >= 4) runs.push(run);
    return runs;
}

/** Extracts a pool tag (domain) from coinbase scriptSig hex, or null. */
function extractPoolTag(coinbaseHex) {
    for (const r of coinbaseRuns(coinbaseHex)) {
        const m = r.match(/([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}/i);
        if (m) return m[0].toLowerCase();
    }
    return null;
}

/**
 * Solo-miner signature: the open-source radiant stratum proxy embeds a
 * "<name>-stratum-proxy" coinbase tag — default "radiant-stratum-proxy", or a
 * customized prefix like "craigd-stratum-proxy". Matching "stratum-proxy"
 * auto-detects solo miners on the default and common variants (a far better
 * default than mislabeling them "Unknown pool"). The tag is configurable, so a
 * fully-custom string won't match and still needs manual identification.
 */
function hasSoloSignature(coinbaseHex) {
    return coinbaseRuns(coinbaseHex).some((r) => /stratum-proxy/i.test(r));
}

// ------------------------------------------------------------------- scan

async function scan() {
    await request('server.version', ['radiant-coinflow pool-scanner 1.0', '1.4']);
    const tip = await request('blockchain.headers.subscribe');
    const from = Math.max(1, tip.height - BLOCKS + 1);
    console.log(`Scanning coinbases from height ${from} to ${tip.height} (${tip.height - from + 1} blocks)…`);

    // primary payout addr -> { blocks, firstSeen, lastSeen, tags: Map<tag,count> }
    const addrStats = new Map();
    // tag -> total blocks (for junk-tag filtering)
    const tagTotals = new Map();
    let scanned = 0, failed = 0;

    const heights = [];
    for (let h = tip.height; h >= from; h--) heights.push(h);

    for (let i = 0; i < heights.length; i += CONCURRENCY) {
        const batch = heights.slice(i, i + CONCURRENCY);
        const txids = await Promise.all(batch.map((h) =>
            request('blockchain.transaction.id_from_pos', [h, 0]).catch(() => null)));
        const txs = await Promise.all(txids.map((txid, j) => {
            if (!txid) return null;
            const id = typeof txid === 'string' ? txid : txid.tx_hash;
            return request('blockchain.transaction.get', [id, true])
                .then((tx) => ({ tx, height: batch[j] }))
                .catch(() => null);
        }));

        for (const entry of txs) {
            if (!entry) { failed++; continue; }
            const { tx, height } = entry;
            scanned++;

            const outs = (tx.vout ?? [])
                .map((o) => ({ addr: o.scriptPubKey?.addresses?.[0] ?? o.scriptPubKey?.address, value: o.value ?? 0 }))
                .filter((o) => o.addr);
            if (outs.length === 0) continue;
            const primary = outs.reduce((a, b) => (a.value >= b.value ? a : b)).addr;

            if (!addrStats.has(primary)) {
                addrStats.set(primary, { blocks: 0, firstSeen: height, lastSeen: height, tags: new Map() });
            }
            const stats = addrStats.get(primary);
            stats.blocks++;
            stats.firstSeen = Math.min(stats.firstSeen, height);
            stats.lastSeen = Math.max(stats.lastSeen, height);

            const coinbase = tx.vin?.[0]?.coinbase ?? '';
            if (hasSoloSignature(coinbase)) stats.soloBlocks = (stats.soloBlocks ?? 0) + 1;
            const tag = extractPoolTag(coinbase);
            if (tag) {
                stats.tags.set(tag, (stats.tags.get(tag) ?? 0) + 1);
                tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + 1);
            }
        }

        if ((i / CONCURRENCY) % 20 === 0) {
            process.stdout.write(`\r  ${scanned + failed}/${heights.length} blocks…`);
        }
    }
    console.log(`\r  Done: ${scanned} coinbases scanned, ${failed} failed.`);
    return { addrStats, tagTotals };
}

// ------------------------------------------------------------------ group

function buildPoolEntries({ addrStats, tagTotals }) {
    // Resolve each mining address to an identity. Curated names win; then the
    // solo-miner signature; then a decoded pool domain tag.
    function resolve(addr, stats) {
        if (curated[addr]) return { ...curated[addr], confidence: 0.95 };
        // Majority of this address's coinbases carry the stratum-proxy signature
        // → solo miner, not a pool.
        if (stats && stats.blocks > 0 && (stats.soloBlocks ?? 0) > stats.blocks / 2) {
            return { solo: true };
        }
        if (stats) {
            const validTags = [...stats.tags.entries()]
                .filter(([tag]) => (tagTotals.get(tag) ?? 0) >= MIN_TAG_BLOCKS)
                .sort((a, b) => b[1] - a[1]);
            if (validTags.length > 0) return { name: validTags[0][0], confidence: 0.95 };
        }
        return null;
    }

    // Ensure curated addresses appear even if unseen in the scan window
    for (const addr of Object.keys(curated)) {
        if (!addrStats.has(addr)) {
            addrStats.set(addr, { blocks: 0, firstSeen: 0, lastSeen: 0, tags: new Map() });
        }
    }

    // groupKey -> entry. Named pools merge their addresses under one entry;
    // solo miners get one entry per address (they are different individuals).
    const pools = new Map();
    for (const [addr, stats] of addrStats) {
        const identity = resolve(addr, stats);
        if (!identity && stats.blocks < MIN_UNTAGGED) continue;

        const isSolo = identity?.solo === true;
        const name = isSolo ? 'Solo miner' : (identity?.name ?? `Unknown pool (${addr.slice(0, 10)}…)`);
        const groupKey = isSolo ? `solo:${addr}` : name;

        if (!pools.has(groupKey)) {
            pools.set(groupKey, {
                name,
                ...(identity?.link ? { link: identity.link } : {}),
                ...(isSolo ? { solo: true } : {}),
                confidence: identity?.confidence ?? (isSolo ? 0.9 : 0.5),
                addresses: [],
                blocks: 0,
                firstSeen: Infinity,
                lastSeen: 0,
                source: isSolo ? 'coinbase-scan-solo' : (identity ? 'coinbase-scan' : 'coinbase-scan-untagged'),
                _addrBlocks: new Map(),
            });
        }
        const pool = pools.get(groupKey);
        pool.addresses.push(addr);
        pool._addrBlocks.set(addr, stats.blocks);
        pool.blocks += stats.blocks;
        if (stats.blocks > 0) {
            pool.firstSeen = Math.min(pool.firstSeen, stats.firstSeen);
            pool.lastSeen = Math.max(pool.lastSeen, stats.lastSeen);
        }
    }

    const result = {};
    const sorted = [...pools.values()].sort((a, b) => b.blocks - a.blocks);
    for (const pool of sorted) {
        pool.addresses.sort((a, b) => (pool._addrBlocks.get(b) ?? 0) - (pool._addrBlocks.get(a) ?? 0));
        delete pool._addrBlocks;
        if (pool.firstSeen === Infinity) { pool.firstSeen = 0; pool.lastSeen = 0; }
        const key = pool.solo
            ? `solo-${pool.addresses[0].slice(0, 10)}`
            : pool.name.startsWith('Unknown pool')
            ? `unknown-${pool.addresses[0].slice(0, 10)}`
            : pool.name;
        result[key] = pool;
    }
    return result;
}

async function main() {
    const result = await scan();
    const pools = buildPoolEntries(result);

    console.log('\nPools:');
    for (const p of Object.values(pools)) {
        console.log(`  ${p.name.padEnd(28)} ${String(p.blocks).padStart(6)} blocks  ` +
            `${p.addresses.length} address(es)  conf ${p.confidence}${p.link ? '  ' + p.link : ''}`);
        for (const a of p.addresses) console.log(`      ${a}`);
    }

    if (DRY_RUN) {
        console.log('\n--dry-run: not writing output.');
        return;
    }

    const existing = existsSync(OUT_PATH)
        ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
        : { version: '1.0.0', exchanges: {}, mining_pools: {}, services: {} };

    // Replace coinbase-scan entries wholesale; preserve manually added pools.
    const kept = {};
    for (const [key, p] of Object.entries(existing.mining_pools ?? {})) {
        if (!String(p.source ?? '').startsWith('coinbase-scan')) kept[key] = p;
    }
    existing.mining_pools = { ...kept, ...pools };
    existing.lastUpdated = new Date().toISOString();

    writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2) + '\n');
    console.log(`\nWrote ${Object.keys(pools).length} pool entries to ${OUT_PATH}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('scan failed:', e); process.exit(1); });
