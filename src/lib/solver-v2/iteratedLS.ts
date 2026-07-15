// Solver v2 — Phase 3: Iterated Local Search (Restart + Diversification).
//
// When Local Search plateaus, perturb 20% of the units and restart LS from
// the disturbed state. The best-ever solution is kept across restarts.
// See SOLVER-V2-CONCEPT.md §8.
//
// This module exports two entry points that share the same core algorithm:
//   - `iteratedLocalSearch`        — synchronous, blocks the event loop
//   - `iteratedLocalSearchAsync`   — yields to the macrotask queue between
//                                    LS chunks so abort signals and UI
//                                    repaints can fire
// Both call into the shared internals below; this DRY-up replaces ~150
// lines of previously-duplicated logic and removed a kempeBoost-drift bug
// (the async variant didn't pass kempeBoost to localSearch).

import { Rng } from './moves';
import { construct } from './construct';
import { localSearch, type LocalSearchOptions, type LsResumeState } from './localSearch';
import { computeScore } from './score';
import {
	SLOT_UNPLACED,
	type ScoreBreakdown,
	type ScoreWeights,
	type SolverState,
} from './types';

export interface IteratedLSOptions {
	weights: ScoreWeights;
	/** Hard wall-clock cap for the whole iterated LS phase. */
	totalBudgetMs?: number;
	/** Single-LS-run budget. */
	innerBudgetMs?: number;
	/** Restart: fraction of non-pinned units to perturb (0..1). Default 0.2. */
	perturbFraction?: number;
	/** Plateau detection: ms without improvement after which we restart. */
	plateauMs?: number;
	/** Random seed. */
	seed?: number;
	/** Forwarded improvement callback. */
	onImprovement?: LocalSearchOptions['onImprovement'];
	/** Forwarded abort signal. */
	shouldAbort?: () => boolean;
	/** Optional callback fired when a restart is initiated. */
	onRestart?: (info: { iteration: number; tElapsedMs: number; reason: string }) => void;
	/**
	 * R3-S3: Akzeptanz-Kriterium der inneren Local Search ('lahc' Default
	 * = Late Acceptance Hill Climbing; 'sa' = SA-Metropolis-Referenz-Arm,
	 * nur via Bench-A/B-Hook erreichbar) — siehe localSearch.ts und
	 * docs/bench-baseline.json (r3-schritt-3).
	 */
	acceptance?: LocalSearchOptions['acceptance'];
	/** R3-S4: Move-Generator-Auswahl ('fixed' Default, 'alns' adaptiv). */
	moveSelection?: LocalSearchOptions['moveSelection'];
}

export interface IteratedLSResult {
	bestPlacement: Int32Array;
	bestBreakdown: ScoreBreakdown;
	restartCount: number;
	totalIterations: number;
	tElapsedMs: number;
}

/** Internal mutable bookkeeping shared between sync and async runs. */
interface IlsState {
	bestPlacement: Int32Array;
	bestBreakdown: ScoreBreakdown;
	bestEverSeenScore: number;
	lastImprovementMs: number;
	restartCount: number;
	totalIterations: number;
	consecutiveUnproductive: number;
}

/** Read-only context passed to inner helpers. */
interface IlsCtx {
	state: SolverState;
	weights: ScoreWeights;
	totalBudget: number;
	innerBudget: number;
	perturbFraction: number;
	plateauMs: number;
	rng: Rng;
	tStart: number;
	opts: IteratedLSOptions;
}

function makeImprovementHook(ils: IlsState, ctx: IlsCtx): NonNullable<LocalSearchOptions['onImprovement']> {
	return (info) => {
		if (info.breakdown.total < ils.bestBreakdown.total) {
			ils.bestBreakdown = { ...info.breakdown };
			ils.bestPlacement = new Int32Array(info.bestPlacement);
			ils.lastImprovementMs = Date.now() - ctx.tStart;
			ctx.opts.onImprovement?.(info);
		}
	};
}

/**
 * Compute the SA-temperature and kempe-chain boost for the next LS chunk
 * based on how many recent restarts produced no improvement. Cap at 500
 * so very long stuck sessions don't drift into pure random-walk territory.
 *
 * R3-S3-Hinweis: Unter dem neuen LAHC-Default ist tStartLS wirkungslos
 * (keine Temperatur im Akzeptanz-Kriterium) — der kempeBoost bleibt der
 * wirksame Eskalations-Hebel; die Perturbation übernimmt den Rest.
 */
function reheatParams(consecutiveUnproductive: number): { tStartLS: number; kempeBoost: number } {
	const reheat = consecutiveUnproductive >= 2;
	if (!reheat) return { tStartLS: 100, kempeBoost: 0 };
	return {
		tStartLS: Math.min(500, 200 + 50 * consecutiveUnproductive),
		kempeBoost: Math.min(0.3, 0.05 * consecutiveUnproductive),
	};
}

/** Update the unproductive-restart counter after one LS chunk. */
function updateProductivity(ils: IlsState, scoreBefore: number): void {
	if (ils.bestBreakdown.total < ils.bestEverSeenScore) {
		ils.bestEverSeenScore = ils.bestBreakdown.total;
		ils.consecutiveUnproductive = 0;
	} else if (ils.bestBreakdown.total >= scoreBefore) {
		ils.consecutiveUnproductive++;
	}
}

/** Run a single LS chunk and bookkeeping. Returns true if we should keep going. */
function runOneChunkSync(ils: IlsState, ctx: IlsCtx): boolean {
	if (ctx.opts.shouldAbort?.()) return false;
	const remainingTotal = ctx.totalBudget - (Date.now() - ctx.tStart);
	if (remainingTotal <= 0) return false;
	const thisBudget = Math.min(ctx.innerBudget, remainingTotal);
	const { tStartLS, kempeBoost } = reheatParams(ils.consecutiveUnproductive);
	const scoreBefore = ils.bestBreakdown.total;
	const ls = localSearch(ctx.state, computeScore(ctx.state, ctx.weights), {
		weights: ctx.weights,
		maxIterations: 1_000_000,
		timeBudgetMs: thisBudget,
		seed: ctx.rng.int(0, 2147483647),
		tStart: tStartLS,
		kempeBoost,
		acceptance: ctx.opts.acceptance,
		moveSelection: ctx.opts.moveSelection,
		onImprovement: makeImprovementHook(ils, ctx),
		shouldAbort: ctx.opts.shouldAbort,
	});
	ils.totalIterations += ls.iterations;
	updateProductivity(ils, scoreBefore);
	return true;
}

/** Decide if a restart-perturbation is due (plateau detection). */
function shouldPerturb(ils: IlsState, ctx: IlsCtx): boolean {
	const elapsed = Date.now() - ctx.tStart;
	if (elapsed >= ctx.totalBudget) return false;
	const sinceImprovement = elapsed - ils.lastImprovementMs;
	// Stay in inner LS if we're still making progress AND not yet 70% through
	// the total budget (heuristic: late in the budget we always perturb).
	if (sinceImprovement < ctx.plateauMs && elapsed < ctx.totalBudget * 0.7) {
		return false;
	}
	return true;
}

/** Apply perturbation: clear `nPerturb` non-pinned units and re-construct. */
function perturbAndRestart(ils: IlsState, ctx: IlsCtx): boolean {
	const candidates: number[] = [];
	for (let i = 0; i < ctx.state.nUnits; i++) {
		if (ctx.state.units[i].pinned) continue;
		candidates.push(i);
	}
	if (candidates.length === 0) return false;
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = ctx.rng.int(0, i + 1);
		[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
	}
	// Adaptive perturbation strength: base + 5% per unproductive restart,
	// clamped at 60%. Empirically a good escape-vs.-keep-progress balance.
	const adaptiveFraction = Math.min(
		0.6,
		ctx.perturbFraction + 0.05 * ils.consecutiveUnproductive
	);
	const nPerturb = Math.max(1, Math.floor(candidates.length * adaptiveFraction));
	for (let i = 0; i < nPerturb; i++) ctx.state.placement[candidates[i]] = SLOT_UNPLACED;
	// Restore the rest from the global best so we restart from a known-good
	// vicinity, not from intermediate LS state.
	for (let i = nPerturb; i < candidates.length; i++) {
		ctx.state.placement[candidates[i]] = ils.bestPlacement[candidates[i]];
	}
	construct(ctx.state, { weights: ctx.weights, seed: ctx.rng.int(0, 2147483647) });
	ils.restartCount++;
	ctx.opts.onRestart?.({
		iteration: ils.totalIterations,
		tElapsedMs: Date.now() - ctx.tStart,
		reason: 'plateau',
	});
	return true;
}

/** Build the initial bookkeeping + context block. */
function init(state: SolverState, initialBreakdown: ScoreBreakdown, opts: IteratedLSOptions): { ils: IlsState; ctx: IlsCtx } {
	const totalBudget = opts.totalBudgetMs ?? 60_000;
	const innerBudget = opts.innerBudgetMs ?? 15_000;
	const perturbFraction = opts.perturbFraction ?? 0.2;
	const plateauMs = opts.plateauMs ?? 8_000;
	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	const tStart = Date.now();
	const bestPlacement = new Int32Array(state.placement);
	const bestBreakdown = { ...initialBreakdown };
	const ils: IlsState = {
		bestPlacement,
		bestBreakdown,
		bestEverSeenScore: bestBreakdown.total,
		lastImprovementMs: 0,
		restartCount: 0,
		totalIterations: 0,
		consecutiveUnproductive: 0,
	};
	const ctx: IlsCtx = { state, weights: opts.weights, totalBudget, innerBudget, perturbFraction, plateauMs, rng, tStart, opts };
	return { ils, ctx };
}

/** Final cleanup: copy best placement back into state, return the result. */
function finalize(ils: IlsState, ctx: IlsCtx): IteratedLSResult {
	for (let i = 0; i < ctx.state.nUnits; i++) {
		ctx.state.placement[i] = ils.bestPlacement[i];
	}
	return {
		bestPlacement: ils.bestPlacement,
		bestBreakdown: ils.bestBreakdown,
		restartCount: ils.restartCount,
		totalIterations: ils.totalIterations,
		tElapsedMs: Date.now() - ctx.tStart,
	};
}

/**
 * Run iterated local search synchronously. Calls localSearch repeatedly with
 * perturbations in between. Returns the best-ever placement.
 *
 * For UI integration, use `iteratedLocalSearchAsync` — it yields to the
 * macrotask queue between inner LS runs so abort signals can fire and the
 * UI thread isn't blocked indefinitely.
 */
export function iteratedLocalSearch(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: IteratedLSOptions
): IteratedLSResult {
	const { ils, ctx } = init(state, initialBreakdown, opts);

	while (Date.now() - ctx.tStart < ctx.totalBudget) {
		if (!runOneChunkSync(ils, ctx)) break;
		if (Date.now() - ctx.tStart >= ctx.totalBudget) break;
		if (ctx.opts.shouldAbort?.()) break;
		if (!shouldPerturb(ils, ctx)) continue;
		if (!perturbAndRestart(ils, ctx)) break;
	}

	return finalize(ils, ctx);
}

/**
 * Async variant. Same algorithm as the sync version, but splits the inner
 * LS budget into ~250 ms chunks with `await new Promise(setTimeout(..., 0))`
 * yields between chunks. That lets external setTimeout-scheduled aborts fire
 * and keeps the host event loop (browser UI, vitest worker) responsive.
 *
 * Schritt 2 der Solver-Optimierung: Chunks setzen die LS-Session via
 * `resume` NAHTLOS fort (Temperatur, Tabu, Walk-Punkt, RNG) statt jede
 * 250ms komplett frisch zu starten. Vor dem Fix akzeptierte jeder Chunk-
 * Start bei T=100 massenhaft Verschlechterungen — empirisch blieben 2 von
 * 5 Bench-Läufen mit einer Klassen-Lücke stecken (bench-baseline.json).
 * Die Best-Restauration passiert erst am ECHTEN Ende des Inner-Budgets.
 */
export async function iteratedLocalSearchAsync(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: IteratedLSOptions
): Promise<IteratedLSResult> {
	const { ils, ctx } = init(state, initialBreakdown, opts);
	const CHUNK_MS = 250;

	while (Date.now() - ctx.tStart < ctx.totalBudget) {
		// Macrotask yield so abort timers can fire even if we just entered.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		if (ctx.opts.shouldAbort?.()) break;
		if (Date.now() - ctx.tStart >= ctx.totalBudget) break;

		const remainingTotal = ctx.totalBudget - (Date.now() - ctx.tStart);
		const thisBudget = Math.min(ctx.innerBudget, remainingTotal);
		const { tStartLS, kempeBoost } = reheatParams(ils.consecutiveUnproductive);
		const scoreBefore = ils.bestBreakdown.total;
		const lsTStart = Date.now();
		let abortedInner = false;
		// Ein Full-Scan pro Inner-Run (nicht pro Chunk!) — danach trägt
		// resume.curBreakdown den Walk-Score über die Chunk-Grenzen.
		const innerBreakdown = computeScore(ctx.state, ctx.weights);
		let resume: LsResumeState | undefined = undefined;
		// Slice the inner LS into CHUNK_MS pieces with macrotask yields between.
		while (true) {
			const chunkRemaining = thisBudget - (Date.now() - lsTStart);
			if (chunkRemaining <= 0) break;
			if (ctx.opts.shouldAbort?.()) { abortedInner = true; break; }
			const chunkBudget = Math.min(CHUNK_MS, chunkRemaining);
			const ls = localSearch(ctx.state, innerBreakdown, {
				weights: ctx.weights,
				maxIterations: 1_000_000,
				timeBudgetMs: chunkBudget,
				seed: ctx.rng.int(0, 2147483647), // nur der 1. Chunk nutzt den Seed
				tStart: tStartLS,
				kempeBoost,
				acceptance: ctx.opts.acceptance,
				moveSelection: ctx.opts.moveSelection,
				resume,
				restoreBestOnExit: false,
				onImprovement: makeImprovementHook(ils, ctx),
				shouldAbort: ctx.opts.shouldAbort,
			});
			ils.totalIterations += ls.iterations;
			resume = ls.resumeState;
			if (ctx.opts.shouldAbort?.()) { abortedInner = true; break; }
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
		// Echtes Ende des Inner-Runs: jetzt (und erst jetzt) das beste
		// Placement dieses Runs restaurieren — wie es die Sync-Variante am
		// Ende jedes localSearch-Aufrufs tut.
		if (resume) {
			ctx.state.placement.set(resume.bestPlacement);
		}
		updateProductivity(ils, scoreBefore);

		if (abortedInner) break;
		if (Date.now() - ctx.tStart >= ctx.totalBudget) break;
		if (ctx.opts.shouldAbort?.()) break;
		if (!shouldPerturb(ils, ctx)) continue;
		if (!perturbAndRestart(ils, ctx)) break;
	}

	return finalize(ils, ctx);
}
