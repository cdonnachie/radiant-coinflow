#!/usr/bin/env node
/**
 * Merge expand-cluster-rest.mjs output files into the entities list.
 *
 * Usage:
 *   node scripts/merge-clusters.mjs ExchangeName=cluster.json [More=other.json ...]
 *
 * Each cluster file is {seed, cluster:[...], count, cappedAtMaxAddrs}. Existing
 * addresses for that exchange (hot/cold wallets, prior runs) are preserved.
 * Before writing, checks for the same address appearing in two different
 * exchange clusters — that would indicate over-clustering and aborts the merge.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'public', 'data', 'exchange-addresses.json');

const specs = process.argv.slice(2).map((a) => {
    const eq = a.indexOf('=');
    if (eq === -1) { console.error(`Bad arg (expected Name=file): ${a}`); process.exit(1); }
    return { name: a.slice(0, eq), file: a.slice(eq + 1) };
});
if (specs.length === 0) { console.error('Provide Name=file pairs.'); process.exit(1); }

const clusters = specs.map(({ name, file }) => {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { name, addresses: data.cluster, capped: data.cappedAtMaxAddrs, seed: data.seed };
});

// Cross-cluster overlap check
const owner = new Map();
let overlap = false;
for (const c of clusters) {
    for (const a of c.addresses) {
        if (owner.has(a) && owner.get(a) !== c.name) {
            console.error(`OVERLAP: ${a} in both ${owner.get(a)} and ${c.name}`);
            overlap = true;
        }
        owner.set(a, c.name);
    }
}
if (overlap) {
    console.error('\nAborting merge — clusters share addresses (possible over-clustering).');
    process.exit(1);
}
console.log('No cross-exchange overlap. Clusters are disjoint.\n');

const data = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    : { version: '1.0.0', exchanges: {}, mining_pools: {}, services: {} };
data.exchanges ??= {};

for (const c of clusters) {
    const entry = data.exchanges[c.name] ?? { name: c.name, confidence: 0.95, addresses: [] };
    const before = new Set(entry.addresses);
    const added = c.addresses.filter((a) => !before.has(a));
    entry.addresses.push(...added);
    entry.confidence = Math.max(entry.confidence ?? 0, 0.95);
    data.exchanges[c.name] = entry;
    console.log(`${c.name}: +${added.length} new → ${entry.addresses.length} total` +
        (c.capped ? '  (cluster hit --max-addrs cap; may be larger)' : ''));
}

data.lastUpdated = new Date().toISOString();
writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`\nWrote ${OUT_PATH}`);
