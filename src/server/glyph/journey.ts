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

interface ChainSource {
    txids: string[];
    /** Indexer deliberately dropped intermediate transfers (mint/melt only). */
    filtered: boolean;
    note?: string;
}

/**
 * Ordered txid chain from RXinDexer's /tokens/{ref}/locations (rows already in
 * chain order: height, then tx_index — no client-side sorting), falling back to
 * the older /tokens/{ref}/history on deployments without it. Null when neither
 * is available.
 */
async function fetchChainSource(ref: Ref): Promise<ChainSource | null> {
    const baseUrl = process.env.RADIANT_REST_URL?.replace(/\/+$/, '');
    if (!baseUrl) return null;
    const PAGE = 200;
    const refPath = `${baseUrl}/tokens/${ref.toRxindexerForm()}`;

    // Primary: /locations (cursor-paged, sorted, carries `filtered` + `note`).
    try {
        const txids: string[] = [];
        let filtered = false;
        let note: string | undefined;
        let cursor: string | undefined;
        let ok = false;
        for (let page = 0; txids.length <= MAX_HOPS; page++) {
            const url = `${refPath}/locations?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS) });
            if (!res.ok) break;
            const body = await res.json() as {
                rows?: unknown; next_cursor?: unknown; filtered?: unknown; note?: unknown;
            };
            if (!Array.isArray(body?.rows)) break;
            ok = true;
            if (body.filtered === true) filtered = true;
            if (typeof body.note === 'string' && !note) note = body.note;
            for (const row of body.rows) {
                const txid = (row as { txid?: unknown })?.txid;
                if (typeof txid === 'string' && txids[txids.length - 1] !== txid) txids.push(txid);
            }
            if (typeof body.next_cursor !== 'string' || body.next_cursor.length === 0) break;
            cursor = body.next_cursor;
        }
        if (ok && txids.length > 0) return { txids, filtered, note };
    } catch {
        // fall through to /history
    }

    // Fallback: /history (offset-paged plain array; sort defensively).
    try {
        const rows: Array<{ txid: string; height?: number; tx_idx?: number }> = [];
        for (let offset = 0; rows.length <= MAX_HOPS; offset += PAGE) {
            const res = await fetch(
                `${refPath}/history?limit=${PAGE}&offset=${offset}`,
                { signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS) },
            );
            if (!res.ok) break;
            const body: unknown = await res.json();
            if (!Array.isArray(body)) break;
            rows.push(...body.filter(
                (r): r is { txid: string; height?: number; tx_idx?: number } =>
                    typeof r === 'object' && r !== null && typeof (r as { txid?: unknown }).txid === 'string',
            ));
            if (body.length < PAGE) break;
        }
        if (rows.length === 0) return null;
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
        return { txids, filtered: false };
    } catch {
        return null;
    }
}

interface WalkState {
    journey: TokenJourney;
    refScriptHex: string;
    startedAt: number;
    /** Carrying outpoint of the last hop pushed (chain linkage anchor). */
    lastOutpoint?: { txid: string; vout: number };
    /** Filtered chain source: hop gaps are deliberate, skip linkage warnings. */
    expectGaps?: boolean;
    done: boolean;
}

/** 'transfer' when ownership changed; 'move' for same-owner re-creations or unknowns. */
function classifyEvent(prevHolder: string | undefined, holder: string | undefined): 'transfer' | 'move' {
    if (!prevHolder || !holder) return 'move';
    return prevHolder === holder ? 'move' : 'transfer';
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
    // outpoint for the reveal). A miss means the chain source skipped a hop —
    // unless the source is filtered, where gaps are deliberate.
    const expected = isFirst
        ? { txid: ref.txidDisplay, vout: ref.vout }
        : state.lastOutpoint!;
    const linked = (tx.vin ?? []).some((v) => v.txid === expected.txid && v.vout === expected.vout);
    if (!linked && !(state.expectGaps && !isFirst)) {
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

    const holderInfo = holderOf(carrying);
    const prevHolder = journey.hops[journey.hops.length - 1]?.holder;
    journey.hops.push({
        txid,
        vout: carrying.n,
        height: tx.height,
        timestamp: tx.blocktime,
        event: isFirst ? 'mint' : classifyEvent(prevHolder, holderInfo.holder),
        ...holderInfo,
    });
    state.lastOutpoint = { txid, vout: carrying.n };

    if (journey.kind === 'fungible') {
        journey.notes.push('Fungible token — units split and merge across outputs, so a single movement chain does not exist.');
        state.done = true;
    }
}

/** Continue past the known chain via getspentinfo until unspent/melt/limits. */
async function continueBySpendWalk(state: WalkState, ref: Ref): Promise<void> {
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
            journey.notes.push(`Spent lookup failed at ${outpoint.txid}:${outpoint.vout}: ${error instanceof Error ? error.message : error}`);
            journey.truncated = true;
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
    const source = await fetchChainSource(ref);
    if (source) {
        if (source.filtered) {
            journey.filtered = true;
            state.expectGaps = true;
            journey.notes.push(source.note
                ?? 'Intermediate transfers are not indexed for this ref — only its mint and melt are shown.');
        }
        // Prefetch the whole chain in parallel batches — the backend caches
        // transactions, so the sequential verification pass below is then
        // cache-hits instead of one round-trip per hop.
        const chainTxids = source.txids.slice(0, MAX_HOPS);
        const PREFETCH_BATCH = 10;
        for (let i = 0; i < chainTxids.length; i += PREFETCH_BATCH) {
            if (Date.now() - state.startedAt > TIME_BUDGET_MS) break;
            await Promise.all(chainTxids.slice(i, i + PREFETCH_BATCH).map((t) =>
                getChainBackend().call('getrawtransaction', [t]).catch(() => null)));
        }

        for (const txid of chainTxids) {
            if (state.done) break;
            if (Date.now() - state.startedAt > TIME_BUDGET_MS) {
                journey.truncated = true;
                journey.notes.push('Walk stopped at the time budget; history is incomplete.');
                return journey;
            }
            await processChainTx(state, ref, txid);
        }
        if (source.txids.length > MAX_HOPS) {
            journey.truncated = true;
            journey.notes.push(`Walk stopped at the ${MAX_HOPS}-hop cap; history is incomplete.`);
            return journey;
        }
        // No spend-walk continuation here: the indexer is synced, so its last
        // row IS the resting place — and a getspentinfo on a busy holder can
        // take minutes (address-scan). Melt rows already set MELTED above.
        // Filtered refs (mint/melt only) stay UNKNOWN unless a melt was seen.
        if (!state.done && journey.hops.length > 0 && !source.filtered && !journey.truncated) {
            journey.liveness = 'ACTIVE';
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
        await continueBySpendWalk(state, ref);
    }
    return journey;
}
