#!/usr/bin/env node
/**
 * Mining pool payout timeline.
 *
 * For each pool in public/data/exchange-addresses.json, scans its payout
 * address history via the RXinDexer REST API and separates:
 *   - coinbase rewards IN  (is_coinbase entries — block rewards accumulating)
 *   - payouts OUT          (transactions the pool address SPENDS, distributing
 *                           to miners or moving to a consolidation wallet)
 *
 * Reports each pool's reward volume, payout events (when / how much / how many
 * recipients), cadence, and whether it pays miners directly (many recipients)
 * or consolidates first (few recipients).
 *
 * The is_coinbase flag lets us skip the bulk of history (rewards) cheaply and
 * only fetch the non-coinbase transactions to classify, so it stays fast even
 * on very active pool addresses.
 *
 * Usage:
 *   node scripts/pool-payouts.mjs [--max-history N] [--recent N] [--out FILE] [POOL_NAME]
 *     --max-history N   history entries scanned per address (default 2500)
 *     --recent N        payout events printed / stored per pool (default 10)
 *     --out FILE        write structured results as JSON (default:
 *                       public/data/pool-payouts.json — the Pools page reads it)
 *     POOL_NAME         limit to one pool (substring match on the key/name)
 *
 * REST base URL from RADIANT_REST_URL (or .env.local).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvLocal, ROOT } from './lib/electrum.mjs';

loadEnvLocal();
const BASE = (process.env.RADIANT_REST_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const DATA = join(ROOT, 'public', 'data', 'exchange-addresses.json');

const args = process.argv.slice(2);
const num = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? Number(args[i + 1]) : def; };
const MAX_HISTORY = num('--max-history', 2500);
const RECENT = num('--recent', 10);
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? args[outIdx + 1] : join(ROOT, 'public', 'data', 'pool-payouts.json');
const only = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && args[i - 1] !== '--out');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(path, retries = 4) {
    for (let attempt = 0; ; attempt++) {
        try {
            const r = await fetch(BASE + path);
            if (r.ok) return await r.json();
            if (r.status === 404) return null;
            if ((r.status === 429 || r.status >= 500) && attempt < retries) { await sleep(200 * 2 ** attempt); continue; }
            return null;
        } catch { if (attempt < retries) { await sleep(200 * 2 ** attempt); continue; } return null; }
    }
}
const txCache = new Map();
async function getTx(t) { if (!txCache.has(t)) txCache.set(t, await fetchJson(`/transaction/${t}`)); return txCache.get(t); }
const outAddr = (tx, n) => tx?.vout?.[n]?.scriptPubKey?.addresses?.[0] ?? null;

async function poolIsInput(tx, poolSet) {
    for (const v of tx.vin ?? []) {
        if (!v.txid) continue;
        const p = await getTx(v.txid);
        if (p && poolSet.has(outAddr(p, v.vout))) return true;
    }
    return false;
}

const fmtDate = (ts) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16);

async function analyzePool(name, entry) {
    const poolSet = new Set(entry.addresses);
    let rewardCount = 0, rewardRxd = 0, totalTx = 0, scanned = 0;
    let earliest = Infinity, latest = 0;
    const payouts = [];

    for (const address of entry.addresses) {
        let offset = 0;
        while (scanned < MAX_HISTORY) {
            const page = await fetchJson(`/addresses/${address}/history?limit=200&offset=${offset}`);
            if (!page?.history?.length) break;
            if (offset === 0) totalTx += page.total_count ?? page.history.length;
            for (const h of page.history) {
                scanned++;
                earliest = Math.min(earliest, h.timestamp || earliest);
                latest = Math.max(latest, h.timestamp || 0);
                if (h.is_coinbase) { rewardCount++; rewardRxd += h.amount || 0; continue; }
                // Non-coinbase: fetch and check whether the pool is spending (a payout).
                const tx = await getTx(h.txid);
                if (!tx) continue;
                if (!(await poolIsInput(tx, poolSet))) continue; // inbound/consolidation from elsewhere
                const recipients = new Set();
                let rxdOut = 0;
                tx.vout.forEach((o, n) => {
                    const a = outAddr(tx, n);
                    if (a && !poolSet.has(a)) { recipients.add(a); rxdOut += o.value || 0; }
                });
                payouts.push({ height: h.height, ts: h.timestamp, recipients: recipients.size, rxdOut });
                if (scanned >= MAX_HISTORY) break;
            }
            if (!page.has_more) break;
            offset += page.history.length;
        }
    }

    payouts.sort((a, b) => b.height - a.height);
    const recipientsList = payouts.map((p) => p.recipients).sort((a, b) => a - b);
    const medianRecip = recipientsList.length ? recipientsList[Math.floor(recipientsList.length / 2)] : 0;
    const gaps = [];
    for (let i = 0; i < payouts.length - 1; i++) gaps.push((payouts[i].ts - payouts[i + 1].ts) / 3600);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const patternKind = payouts.length === 0 ? 'none' : medianRecip >= 20 ? 'direct' : 'consolidation';
    const patternText = patternKind === 'none' ? 'no payouts in window'
        : patternKind === 'direct' ? `direct payout to miners (median ${medianRecip} recipients)`
        : `consolidation / pay-from-elsewhere (median ${medianRecip} recipients)`;

    console.log(`\n=== ${name}${entry.link ? '  ' + entry.link : ''} ===`);
    console.log(`  scanned ${scanned} of ~${totalTx} txs${scanned && latest ? `, ${fmtDate(earliest)} → ${fmtDate(latest)} UTC` : ''}`);
    console.log(`  coinbase rewards in window: ${rewardCount} blocks, ${rewardRxd.toFixed(2)} RXD`);
    console.log(`  outbound events: ${payouts.length}${avgGap != null ? `, ~every ${avgGap.toFixed(1)}h` : ''}`);
    console.log(`  pattern: ${patternText}`);
    for (const p of payouts.slice(0, RECENT)) {
        console.log(`    ${fmtDate(p.ts)} UTC  block ${p.height}  ${String(p.recipients).padStart(4)} recipients  ${p.rxdOut.toFixed(2)} RXD`);
    }

    return {
        name, link: entry.link ?? null, addresses: entry.addresses.length,
        scanned, totalTx, windowStart: earliest === Infinity ? null : earliest, windowEnd: latest || null,
        rewardBlocks: rewardCount, rewardRxd,
        payoutEvents: payouts.length, avgIntervalHours: avgGap,
        medianRecipients: medianRecip, pattern: patternKind, patternText,
        recent: payouts.slice(0, RECENT),
    };
}

async function main() {
    const data = JSON.parse(readFileSync(DATA, 'utf8'));
    const pools = Object.entries(data.mining_pools || {});
    console.log(`Pool payout analysis via ${BASE} (${pools.length} pools, up to ${MAX_HISTORY} txs each)`);
    const results = [];
    const write = () => {
        if (!OUT) return;
        const sorted = [...results].sort((a, b) => b.rewardRxd - a.rewardRxd);
        writeFileSync(OUT, JSON.stringify({
            generatedAt: new Date().toISOString(),
            windowMaxTxs: MAX_HISTORY,
            pools: sorted,
        }, null, 2) + '\n');
    };
    for (const [key, entry] of pools) {
        if (entry.solo) continue; // solo miners aren't pools — skip the payout page
        if (only && !`${key} ${entry.name}`.toLowerCase().includes(only.toLowerCase())) continue;
        if (!entry.addresses?.length) continue;
        try { const summary = await analyzePool(entry.name || key, entry); results.push({ key, ...summary }); write(); }
        catch (e) { console.log(`\n=== ${entry.name || key} ===\n  error: ${e.message}`); }
    }
    if (OUT) console.log(`\nWrote ${results.length} pool summaries to ${OUT}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e); process.exit(1); });
