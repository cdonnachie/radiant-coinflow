#!/usr/bin/env node
/**
 * Wallet cluster expansion via common-input, using the RXinDexer REST API.
 *
 * Same heuristic as expand-cluster.mjs (addresses that co-spend inputs share
 * an owner), but sources history from the REST API instead of ElectrumX, so
 * it works on busy exchange wallets that ElectrumX refuses ("history too
 * large"). Use this for high-volume exchanges (CoinEx's hot wallet, etc.).
 *
 * Usage:
 *   node scripts/expand-cluster-rest.mjs <SEED_ADDRESS> [--hops N]
 *        [--max-addrs N] [--max-history N] [--min-cospend N] [--merge NAME]
 *
 *   --hops N          closure depth (default 2)
 *   --max-addrs N     stop growing beyond N addresses (default 2000)
 *   --max-history N   per-address history txs to scan (default 6000)
 *   --min-cospend N   only keep addresses that co-spend with a known member in
 *                     at least N transactions (default 2) — filters one-off
 *                     coincidental co-inputs
 *   --merge NAME      union the result into exchanges[NAME]
 *
 * REST base URL from RADIANT_REST_URL (or .env.local).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadEnvLocal, ROOT } from './lib/electrum.mjs';

loadEnvLocal();
const BASE = (process.env.RADIANT_REST_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const OUT_PATH = join(ROOT, 'public', 'data', 'exchange-addresses.json');

const args = process.argv.slice(2);
const seeds = [];
let hopsMax = 2, maxAddrs = 2000, maxHistory = 6000, minCospend = 2, mergeName = null;
for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--hops': hopsMax = Number(args[++i]); break;
        case '--max-addrs': maxAddrs = Number(args[++i]); break;
        case '--max-history': maxHistory = Number(args[++i]); break;
        case '--min-cospend': minCospend = Number(args[++i]); break;
        case '--merge': mergeName = args[++i]; break;
        default:
            if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(args[i])) seeds.push(args[i]);
            else { console.error(`Unrecognized argument: ${args[i]}`); process.exit(1); }
    }
}
if (seeds.length === 0) { console.error('Provide a seed ADDRESS.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch JSON with retry/backoff — the REST API rate-limits rapid bursts.
async function fetchJson(path, retries = 4) {
    for (let attempt = 0; ; attempt++) {
        try {
            const r = await fetch(BASE + path);
            if (r.ok) return await r.json();
            if (r.status === 404) return null;
            if ((r.status === 429 || r.status >= 500) && attempt < retries) {
                await sleep(250 * 2 ** attempt);
                continue;
            }
            return null;
        } catch (e) {
            if (attempt < retries) { await sleep(250 * 2 ** attempt); continue; }
            throw e;
        }
    }
}

const txCache = new Map();
async function getTx(txid) {
    if (txCache.has(txid)) return txCache.get(txid);
    const tx = await fetchJson(`/transaction/${txid}`);
    txCache.set(txid, tx);
    return tx;
}
const outAddr = (tx, n) => tx?.vout?.[n]?.scriptPubKey?.addresses?.[0] ?? null;

async function historyTxids(address, cap) {
    const txids = [];
    let offset = 0;
    while (txids.length < cap) {
        const p = await fetchJson(`/addresses/${address}/history?limit=200&offset=${offset}`);
        if (!p?.history?.length) break;
        for (const h of p.history) txids.push(h.txid);
        if (!p.has_more) break;
        offset += p.history.length;
    }
    return { txids: txids.slice(0, cap), truncated: txids.length >= cap };
}

async function inputAddresses(tx) {
    const addrs = new Set();
    const vins = (tx.vin ?? []).filter((v) => v.txid !== undefined);
    for (let i = 0; i < vins.length; i += 20) {
        const batch = vins.slice(i, i + 20);
        const prevs = await Promise.all(batch.map((v) => getTx(v.txid)));
        for (let j = 0; j < batch.length; j++) {
            const a = prevs[j] && outAddr(prevs[j], batch[j].vout);
            if (a) addrs.add(a);
        }
    }
    return addrs;
}

async function main() {
    console.log(`REST cluster expansion from ${seeds.join(', ')} (base ${BASE})`);
    const known = new Set(seeds);
    const cospendCounts = new Map(seeds.map((s) => [s, Infinity]));
    const skipped = new Set();
    let frontier = [...seeds];

    for (let hop = 1; hop <= hopsMax && frontier.length && known.size < maxAddrs; hop++) {
        const next = [];
        console.log(`Hop ${hop}: expanding ${frontier.length} address(es)…`);
        for (const addr of frontier) {
            if (known.size >= maxAddrs) break;
            const { txids, truncated } = await historyTxids(addr, maxHistory);
            if (truncated) skipped.add(addr);
            let processed = 0;
            for (let i = 0; i < txids.length; i += 12) {
                const batch = txids.slice(i, i + 12);
                const txs = await Promise.all(batch.map((t) => getTx(t).catch(() => null)));
                for (const tx of txs) {
                    if (!tx) continue;
                    const ins = await inputAddresses(tx);
                    if (!ins.has(addr)) continue; // addr must be an INPUT (co-spend)
                    for (const a of ins) {
                        if (a === addr) continue;
                        cospendCounts.set(a, (cospendCounts.get(a) ?? 0) + 1);
                        if (!known.has(a) && cospendCounts.get(a) >= minCospend) {
                            known.add(a); next.push(a);
                            if (known.size >= maxAddrs) break;
                        }
                    }
                }
                processed += batch.length;
            }
            console.log(`  ${addr}: scanned ${processed} txs${truncated ? ' (capped)' : ''} — cluster ${known.size}`);
        }
        frontier = next;
    }

    const cluster = [...known].sort();
    console.log(`\nCluster: ${cluster.length} address(es)` + (known.size >= maxAddrs ? ' (hit --max-addrs)' : ''));
    for (const a of cluster.slice(0, 40)) {
        const c = cospendCounts.get(a);
        console.log(`  ${a}${c === Infinity ? '  (seed)' : `  (${c} co-spends)`}${skipped.has(a) ? ' [history capped]' : ''}`);
    }
    if (cluster.length > 40) console.log(`  … +${cluster.length - 40} more`);

    if (mergeName) {
        const data = existsSync(OUT_PATH)
            ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
            : { version: '1.0.0', exchanges: {}, mining_pools: {}, services: {} };
        data.exchanges ??= {};
        const entry = data.exchanges[mergeName] ?? { name: mergeName, confidence: 0.95, addresses: [] };
        const before = new Set(entry.addresses);
        const added = cluster.filter((a) => !before.has(a));
        entry.addresses.push(...added);
        entry.confidence = Math.max(entry.confidence ?? 0, 0.9);
        entry.source = `${entry.source ? entry.source + '; ' : ''}common-input expansion via RXinDexer REST (${new Date().toISOString().slice(0, 10)}, ${cluster.length} addrs, min-cospend ${minCospend})`;
        data.exchanges[mergeName] = entry;
        data.lastUpdated = new Date().toISOString();
        writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');
        console.log(`\nMerged ${added.length} new address(es) into exchanges["${mergeName}"] (${entry.addresses.length} total).`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e); process.exit(1); });
