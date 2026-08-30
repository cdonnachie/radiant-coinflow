#!/usr/bin/env node
/**
 * Wallet cluster expansion via the common-input heuristic.
 *
 * Every input of a transaction is signed by the same party (for exchange
 * wallets, the same operator), so starting from one verified address —
 * e.g. the sender of a known exchange withdrawal — the closure of
 * "addresses that co-spend inputs with a known address" recovers the
 * operator's whole address set.
 *
 * Usage:
 *   node scripts/expand-cluster.mjs [--from-tx TXID]... [ADDRESS]...
 *        [--hops N] [--max-addrs N] [--max-history N] [--merge NAME]
 *
 *   --from-tx TXID    seed with the source addresses of that tx's inputs
 *                     (i.e. the wallet that SENT the transaction)
 *   --hops N          closure depth (default 4)
 *   --max-addrs N     stop growing beyond N addresses (default 500)
 *   --max-history N   skip addresses with longer histories (default 2000)
 *   --merge NAME      union the result into exchanges[NAME] in
 *                     public/data/exchange-addresses.json (creates the
 *                     entry if missing; confidence 0.95, common-input)
 *
 * ElectrumX connection from RADIANT_ELECTRUM_HOST / _PORT / _TLS.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createClient, addressToScripthash, ROOT } from './lib/electrum.mjs';

const OUT_PATH = join(ROOT, 'public', 'data', 'exchange-addresses.json');

// ------------------------------------------------------------------- args

const args = process.argv.slice(2);
const seedTxids = [];
const seedAddrs = [];
let hopsMax = 4, maxAddrs = 500, maxHistory = 2000, mergeName = null;

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--from-tx': seedTxids.push(args[++i]); break;
        case '--hops': hopsMax = Number(args[++i]); break;
        case '--max-addrs': maxAddrs = Number(args[++i]); break;
        case '--max-history': maxHistory = Number(args[++i]); break;
        case '--merge': mergeName = args[++i]; break;
        default:
            if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(args[i])) seedAddrs.push(args[i]);
            else { console.error(`Unrecognized argument: ${args[i]}`); process.exit(1); }
    }
}
if (seedTxids.length === 0 && seedAddrs.length === 0) {
    console.error('Provide at least one --from-tx TXID or a seed ADDRESS.');
    process.exit(1);
}

// ------------------------------------------------------------------- main

const client = createClient();
const txCache = new Map();

async function getTx(txid) {
    if (txCache.has(txid)) return txCache.get(txid);
    const tx = await client.request('blockchain.transaction.get', [txid, true]);
    txCache.set(txid, tx);
    return tx;
}

function outputAddress(tx, n) {
    const spk = tx?.vout?.[n]?.scriptPubKey;
    return spk?.addresses?.[0] ?? spk?.address ?? null;
}

/** Resolves the source address of every non-coinbase input of a tx. */
async function inputAddresses(tx) {
    const vins = (tx.vin ?? []).filter((v) => v.txid !== undefined);
    const addrs = new Set();
    for (let i = 0; i < vins.length; i += 25) {
        const batch = vins.slice(i, i + 25);
        const prevs = await Promise.all(batch.map((v) => getTx(v.txid).catch(() => null)));
        for (let j = 0; j < batch.length; j++) {
            const addr = prevs[j] && outputAddress(prevs[j], batch[j].vout);
            if (addr) addrs.add(addr);
        }
    }
    return addrs;
}

async function main() {
    // Seed from withdrawal txids: the input side is the sending wallet.
    for (const txid of seedTxids) {
        const tx = await getTx(txid);
        const addrs = await inputAddresses(tx);
        if (addrs.size === 0) {
            console.error(`No input addresses resolved for ${txid} (coinbase?)`);
            continue;
        }
        console.log(`Seed tx ${txid.slice(0, 16)}… sent by: ${[...addrs].join(', ')}`);
        for (const a of addrs) seedAddrs.push(a);
    }

    const known = new Set(seedAddrs);
    const skippedBusy = new Set();
    // addr -> number of co-spend transactions that linked it in
    const linkCounts = new Map(seedAddrs.map((a) => [a, Infinity]));
    let frontier = [...known];

    for (let hop = 1; hop <= hopsMax && frontier.length > 0 && known.size < maxAddrs; hop++) {
        const next = [];
        console.log(`Hop ${hop}: expanding ${frontier.length} address(es)…`);

        for (const addr of frontier) {
            if (known.size >= maxAddrs) break;
            let history;
            try {
                history = await client.request('blockchain.scripthash.get_history',
                    [addressToScripthash(addr)]);
            } catch (e) {
                skippedBusy.add(addr);
                console.log(`  ${addr}: history unavailable (${e.message}) — skipped`);
                continue;
            }
            if (history.length > maxHistory) {
                skippedBusy.add(addr);
                console.log(`  ${addr}: history ${history.length} > ${maxHistory} — skipped`);
                continue;
            }

            for (const entry of history) {
                const tx = await getTx(entry.tx_hash).catch(() => null);
                if (!tx) continue;
                const inAddrs = await inputAddresses(tx);
                if (!inAddrs.has(addr)) continue; // addr only receives in this tx
                for (const a of inAddrs) {
                    linkCounts.set(a, (linkCounts.get(a) === Infinity ? Infinity : (linkCounts.get(a) ?? 0) + 1));
                    if (!known.has(a)) {
                        known.add(a);
                        next.push(a);
                        if (known.size >= maxAddrs) break;
                    }
                }
                if (known.size >= maxAddrs) break;
            }
        }
        frontier = next;
        console.log(`  cluster size: ${known.size}`);
    }

    const cluster = [...known].sort();
    console.log(`\nCluster: ${cluster.length} address(es)` +
        (known.size >= maxAddrs ? ' (hit --max-addrs cap — cluster may be larger)' : ''));
    for (const a of cluster) {
        const links = linkCounts.get(a);
        console.log(`  ${a}${links === Infinity ? '  (seed)' : `  (${links} co-spend link${links === 1 ? '' : 's'})`}` +
            (skippedBusy.has(a) ? '  [history skipped]' : ''));
    }

    if (mergeName) {
        const data = existsSync(OUT_PATH)
            ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
            : { version: '1.0.0', exchanges: {}, mining_pools: {}, services: {} };
        data.exchanges ??= {};
        const entry = data.exchanges[mergeName] ?? { name: mergeName, confidence: 0.95, addresses: [] };
        const before = new Set(entry.addresses);
        for (const a of cluster) if (!before.has(a)) entry.addresses.push(a);
        entry.confidence = Math.max(entry.confidence ?? 0, 0.95);
        entry.source = `${entry.source ? entry.source + '; ' : ''}common-input expansion from verified withdrawal (${new Date().toISOString().slice(0, 10)})`;
        data.exchanges[mergeName] = entry;
        data.lastUpdated = new Date().toISOString();
        writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');
        console.log(`\nMerged ${cluster.length - before.size} new address(es) into exchanges["${mergeName}"] (${entry.addresses.length} total).`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error('expand failed:', e); process.exit(1); });
