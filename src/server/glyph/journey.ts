/**
 * Singleton token journey.
 *
 * Hop discovery is hybrid:
 *  1. RXinDexer's /tokens/{ref}/history (when available) supplies the txid
 *     chain — but every hop is still verified against the raw transactions:
 *     the carrying output is located by its actual ref operand, holders come
 *     from the scripts, and each hop must spend the previous hop's outpoint.
 *  2. Without that endpoint (or past its last row), the walk continues via
 *     getspentinfo on the carrying outpoint — self-driven from tx data alone.
 *
 * The address-scan getspentinfo emulation cannot see spends of token outputs
 * on indexers that omit nonstandard scripts from address history, so the
 * history-first path is what makes multi-hop journeys reliable on REST.
 *
 * A singleton ref moves as a unit: exactly one output of each spending tx
 * carries it (consensus-enforced). A spender with no carrying output melted
 * the token. Fungible refs split/merge and are not walked (mint hop only).
 */

import { getChainBackend } from '@/server/backends';
import type { JourneyHop, TokenJourney } from '@/types/glyph';
import { hexToBytes } from '@/lib/glyph/bytes';
import type { Ref } from '@/lib/glyph/ref';
import { getGlyphMetadata } from './decode';
import { extractRefs } from './refs';
import { walkScript } from './walker';

const MAX_HOPS = 200;
const TIME_BUDGET_MS = 45_000;
const HISTORY_TIMEOUT_MS = 8000;

interface VerboseOutput {
    n: number;
    scriptPubKey?: {
        hex?: string;
        address?: string;
        addresses?: string[];
        ownerAddress?: string;
        refs?: string[];
        scripthash?: string;
    };
}

interface VerboseTx {
    txid?: string;
    height?: number;
    blocktime?: number;
    vin?: Array<{ txid?: string; vout?: number; coinbase?: string }>;
    vout?: VerboseOutput[];
}

function holderOf(output: VerboseOutput): { holder?: string; isContract?: boolean } {
    const spk = output.scriptPubKey;
    if (!spk) return {};
    const addr = spk.addresses?.[0] ?? spk.address ?? spk.ownerAddress;
    if (addr) return { holder: addr };
    if (spk.scripthash) return { holder: `contract:${spk.scripthash.slice(0, 16)}`, isContract: true };
    return {};
}

/** Is the ref carried as OP_PUSHINPUTREFSINGLETON (vs a normal push ref)? */
function classifyCarrier(scriptHex: string, refScriptHex: string): 'singleton' | 'fungible' | 'unknown' {
    try {
        const { ops } = walkScript(hexToBytes(scriptHex), { tolerant: true });
        const refs = extractRefs(ops);
        if (refs.singletonRefs.some((r) => r.ref.toScriptHex() === refScriptHex)) return 'singleton';
        if (refs.pushRefs.some((r) => r.ref.toScriptHex() === refScriptHex)) return 'fungible';
    } catch {
        // fall through
    }
    return 'unknown';
}

/** Ordered txid chain from RXinDexer's /tokens/{ref}/history; null when unavailable. */
async function fetchHistoryTxids(ref: Ref): Promise<string[] | null> {
    const baseUrl = process.env.RADIANT_REST_URL;
    if (!baseUrl) return null;
    const HISTORY_PAGE = 200; // the endpoint defaults to 100 rows — page explicitly
    try {
        const rows: Array<{ txid: string; height?: number; tx_idx?: number }> = [];
        for (let offset = 0; rows.length <= MAX_HOPS; offset += HISTORY_PAGE) {
            const res = await fetch(
                `${baseUrl.replace(/\/+$/, '')}/tokens/${ref.toRxindexerForm()}/history?limit=${HISTORY_PAGE}&offset=${offset}`,
                { signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS) },
            );
            if (!res.ok) return rows.length > 0 ? dedupeSorted(rows) : null;
            const body: unknown = await res.json();
            if (!Array.isArray(body)) return rows.length > 0 ? dedupeSorted(rows) : null;
            rows.push(...body.filter(
                (r): r is { txid: string; height?: number; tx_idx?: number } =>
                    typeof r === 'object' && r !== null && typeof (r as { txid?: unknown }).txid === 'string',
            ));
            if (body.length < HISTORY_PAGE) break; // last page
        }
        return rows.length > 0 ? dedupeSorted(rows) : null;
    } catch {
        return null;
    }
}

function dedupeSorted(rows: Array<{ txid: string; height?: number; tx_idx?: number }>): string[] {
    rows.sort((a, b) => {
        const ah = (a.height ?? 0) <= 0 ? Number.MAX_SAFE_INTEGER : a.height!;
        const bh = (b.height ?? 0) <= 0 ? Number.MAX_SAFE_INTEGER : b.height!;
        if (ah !== bh) return ah - bh;
        return (a.tx_idx ?? 0) - (b.tx_idx ?? 0);
    });
    const txids: string[] = [];
    for (const row of rows) {
        if (txids[txids.length - 1] !== row.txid) txids.push(row.txid);
    }
    return txids;
}

interface WalkState {
    journey: TokenJourney;
    refScriptHex: string;
    startedAt: number;
    /** Carrying outpoint of the last hop pushed (chain linkage anchor). */
    lastOutpoint?: { txid: string; vout: number };
    done: boolean;
}

/**
 * Process one transaction of the chain: locate the carrying output, verify it
 * spends the previous hop's outpoint, push the hop. Sets state.done when the
 * journey reached a terminal state (melt / fungible / broken).
 */
async function processChainTx(state: WalkState, ref: Ref, txid: string): Promise<void> {
    const { journey, refScriptHex } = state;

    let tx: VerboseTx;
    try {
        tx = await getChainBackend().call('getrawtransaction', [txid]) as VerboseTx;
    } catch (error) {
        journey.notes.push(`Failed to fetch ${txid}: ${error instanceof Error ? error.message : error}`);
        journey.truncated = true;
        state.done = true;
        return;
    }

    const isFirst = journey.hops.length === 0;
    const carrying = (tx.vout ?? []).find((o) => o.scriptPubKey?.refs?.includes(refScriptHex));

    if (!carrying) {
        if (isFirst) {
            journey.notes.push('The reveal transaction has no output carrying this ref — not a token deploy for this outpoint.');
            state.done = true;
            return;
        }
        // Spender consumed the ref without re-creating it: melt.
        journey.hops.push({ txid, height: tx.height, timestamp: tx.blocktime, event: 'melt' });
        journey.liveness = 'MELTED';
        state.done = true;
        return;
    }

    // Linkage: this tx must spend the previous carrying outpoint (the commit
    // outpoint for the reveal). A miss means the chain source skipped a hop.
    const expected = isFirst
        ? { txid: ref.txidDisplay, vout: ref.vout }
        : state.lastOutpoint!;
    const linked = (tx.vin ?? []).some((v) => v.txid === expected.txid && v.vout === expected.vout);
    if (!linked) {
        journey.notes.push(
            isFirst
                ? 'Reveal transaction does not spend the commit outpoint — linkage unverified.'
                : `Transaction ${txid} does not spend the previous hop's outpoint — intermediate hops may be missing.`,
        );
    }

    if (isFirst) {
        journey.found = true;
        journey.kind = carrying.scriptPubKey?.hex
            ? classifyCarrier(carrying.scriptPubKey.hex, refScriptHex)
            : 'unknown';
    }

    journey.hops.push({
        txid,
        vout: carrying.n,
        height: tx.height,
        timestamp: tx.blocktime,
        event: isFirst ? 'mint' : 'transfer',
        ...holderOf(carrying),
    });
    state.lastOutpoint = { txid, vout: carrying.n };

    if (journey.kind === 'fungible') {
        journey.notes.push('Fungible token — units split and merge across outputs, so a single movement chain does not exist.');
        state.done = true;
    }
}

/** Continue past the known chain via getspentinfo until unspent/melt/limits. */
async function continueBySpendWalk(state: WalkState, ref: Ref, trustEndAsActive: boolean): Promise<void> {
    const { journey } = state;
    while (!state.done && journey.hops.length < MAX_HOPS) {
        if (Date.now() - state.startedAt > TIME_BUDGET_MS) {
            journey.truncated = true;
            journey.notes.push('Walk stopped at the time budget; history is incomplete.');
            return;
        }
        const outpoint = state.lastOutpoint;
        if (!outpoint) return;

        let spent: { txid?: string } | null;
        try {
            spent = await getChainBackend().call('getspentinfo', [
                { txid: outpoint.txid, index: outpoint.vout },
            ]) as { txid?: string } | null;
        } catch (error) {
            // RPC code -5 = "not found": no spender, i.e. the output is unspent.
            // Duck-typed (not instanceof): the backend instance is shared on
            // globalThis across route bundles, each with its own error class.
            if ((error as { code?: number })?.code === -5) {
                journey.liveness = 'ACTIVE';
                return;
            }
            if (trustEndAsActive) {
                // The indexer's token history already ended here — treat the
                // failed spent lookup as confirmation, not an error.
                journey.liveness = 'ACTIVE';
            } else {
                journey.notes.push(`Spent lookup failed at ${outpoint.txid}:${outpoint.vout}: ${error instanceof Error ? error.message : error}`);
                journey.truncated = true;
            }
            return;
        }

        if (!spent?.txid) {
            journey.liveness = 'ACTIVE';
            return;
        }
        await processChainTx(state, ref, spent.txid);
    }
    if (!state.done && journey.hops.length >= MAX_HOPS) {
        journey.truncated = true;
        journey.notes.push(`Walk stopped at the ${MAX_HOPS}-hop cap; history is incomplete.`);
    }
}

export async function walkTokenJourney(ref: Ref): Promise<TokenJourney> {
    const journey: TokenJourney = {
        refDisplay: ref.toDisplayHex(),
        found: false,
        kind: 'unknown',
        hops: [],
        liveness: 'UNKNOWN',
        truncated: false,
        notes: [],
    };
    const state: WalkState = {
        journey,
        refScriptHex: ref.toScriptHex(),
        startedAt: Date.now(),
        done: false,
    };

    // Primary path: indexer-provided txid chain, verified hop by hop.
    const historyTxids = await fetchHistoryTxids(ref);
    if (historyTxids) {
        for (const txid of historyTxids.slice(0, MAX_HOPS)) {
            if (state.done) break;
            if (Date.now() - state.startedAt > TIME_BUDGET_MS) {
                journey.truncated = true;
                journey.notes.push('Walk stopped at the time budget; history is incomplete.');
                return journey;
            }
            await processChainTx(state, ref, txid);
        }
        if (historyTxids.length > MAX_HOPS) {
            journey.truncated = true;
            journey.notes.push(`Walk stopped at the ${MAX_HOPS}-hop cap; history is incomplete.`);
            return journey;
        }
        if (!state.done && journey.hops.length > 0) {
            // Extend past the indexer's last row in case it lags the chain;
            // a failed lookup there still counts as resting (history ended).
            await continueBySpendWalk(state, ref, true);
        }
        return journey;
    }

    // Fallback: resolve the reveal ourselves and spend-walk the whole chain.
    // (Metadata resolution finds the reveal via hint or commit spent-lookup.)
    const { meta } = await getGlyphMetadata(ref);
    if (!meta.deployTxid) {
        journey.notes.push('Could not resolve the reveal transaction for this ref (commit outpoint unspent or unknown).');
        return journey;
    }
    await processChainTx(state, ref, meta.deployTxid);
    if (!state.done && journey.hops.length > 0) {
        await continueBySpendWalk(state, ref, false);
    }
    return journey;
}
