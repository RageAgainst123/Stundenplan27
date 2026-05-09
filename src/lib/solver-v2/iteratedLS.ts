// Solver v2 — Phase 3: Iterated Local Search (Restart + Diversification).
//
// When Local Search plateaus, perturb 20% of the units and restart LS from
// the disturbed state. The best-ever solution is kept across restarts.
// See SOLVER-V2-CONCEPT.md §8.

import { Rng } from './moves';
import { construct } from './construct';
import { localSearch, type LocalSearchOptions } from './localSearch';
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
}

export interface IteratedLSResult {
	bestPlacement: Int32Array;
	bestBreakdown: ScoreBreakdown;
	restartCount: number;
	totalIterations: number;
	tElapsedMs: number;
}

/**
 * Run iterated local search. Calls localSearch repeatedly with perturbations
 * in between. Returns the best-ever placement.
 *
 * Synchronous variant. For UI integration, use `iteratedLocalSearchAsync` —
 * it yields to the microtask queue between inner LS runs so abort signals
 * can fire and the UI thread isn't blocked indefinitely.
 */
export function iteratedLocalSearch(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: IteratedLSOptions
): IteratedLSResult {
	const totalBudget = opts.totalBudgetMs ?? 60_000;
	const innerBudget = opts.innerBudgetMs ?? 15_000;
	const perturbFraction = opts.perturbFraction ?? 0.2;
	const plateauMs = opts.plateauMs ?? 8_000;
	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	const tStart = Date.now();

	let bestPlacement = new Int32Array(state.placement);
	let bestBreakdown = { ...initialBreakdown };
	let lastImprovementMs = 0;
	let restartCount = 0;
	let totalIterations = 0;
	// Adaptive perturbation: each consecutive restart that does NOT yield
	// a new global best raises the perturbation strength. A fresh global
	// best resets it. Range is clamped to [base..0.6] — beyond 60% of the
	// units we'd practically restart from scratch.
	let consecutiveUnproductive = 0;
	let bestEverSeenScore = bestBreakdown.total;

	function improvementHook(info: Parameters<NonNullable<LocalSearchOptions['onImprovement']>>[0]) {
		if (info.breakdown.total < bestBreakdown.total) {
			bestBreakdown = { ...info.breakdown };
			bestPlacement = new Int32Array(info.bestPlacement);
			lastImprovementMs = Date.now() - tStart;
			opts.onImprovement?.(info);
		}
	}

	while (Date.now() - tStart < totalBudget) {
		if (opts.shouldAbort?.()) break;

		const remainingTotal = totalBudget - (Date.now() - tStart);
		const thisBudget = Math.min(innerBudget, remainingTotal);

		// Reheat + diversify: after an unproductive plateau, raise SA start
		// temperature AND boost kempe-chain probability so the next LS chunk
		// explores wider neighbourhoods before settling.
		const reheat = consecutiveUnproductive >= 2;
		const tStartLS = reheat ? 200 + 50 * consecutiveUnproductive : 100;
		const kempeBoost = reheat ? Math.min(0.3, 0.05 * consecutiveUnproductive) : 0;

		const scoreBefore = bestBreakdown.total;
		const ls = localSearch(state, computeScore(state, opts.weights), {
			weights: opts.weights,
			maxIterations: 1_000_000,
			timeBudgetMs: thisBudget,
			seed: rng.int(0, 2147483647),
			tStart: tStartLS,
			kempeBoost,
			onImprovement: improvementHook,
			shouldAbort: opts.shouldAbort,
		});
		totalIterations += ls.iterations;

		if (bestBreakdown.total < bestEverSeenScore) {
			bestEverSeenScore = bestBreakdown.total;
			consecutiveUnproductive = 0;
		} else if (bestBreakdown.total >= scoreBefore) {
			consecutiveUnproductive++;
		}

		if (Date.now() - tStart >= totalBudget) break;
		if (opts.shouldAbort?.()) break;

		// Decide whether to restart: plateau detection.
		const sinceImprovement = Date.now() - tStart - lastImprovementMs;
		if (sinceImprovement < plateauMs && Date.now() - tStart < totalBudget * 0.7) {
			// Still improving — keep going (LS exited because of inner-budget,
			// but we have wall budget left).
			continue;
		}

		// Perturbation: knock out a fraction of non-pinned units, then re-construct.
		const candidates: number[] = [];
		for (let i = 0; i < state.nUnits; i++) {
			if (state.units[i].pinned) continue;
			candidates.push(i);
		}
		if (candidates.length === 0) break;
		// Shuffle and pick the first N
		for (let i = candidates.length - 1; i > 0; i--) {
			const j = rng.int(0, i + 1);
			[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
		}
		// Adaptive perturbation strength: base + 5% per unproductive restart,
		// clamped at 60%. Empirically this is a good balance — enough to
		// escape the local minimum without throwing away too much progress.
		const adaptiveFraction = Math.min(
			0.6,
			perturbFraction + 0.05 * consecutiveUnproductive
		);
		const nPerturb = Math.max(1, Math.floor(candidates.length * adaptiveFraction));
		for (let i = 0; i < nPerturb; i++) state.placement[candidates[i]] = SLOT_UNPLACED;

		// Restore the rest from the best placement
		for (let i = nPerturb; i < candidates.length; i++) {
			state.placement[candidates[i]] = bestPlacement[candidates[i]];
		}

		// Re-construct the perturbed units
		construct(state, { weights: opts.weights, seed: rng.int(0, 2147483647) });

		restartCount++;
		opts.onRestart?.({ iteration: totalIterations, tElapsedMs: Date.now() - tStart, reason: 'plateau' });
	}

	// Restore best
	for (let i = 0; i < state.nUnits; i++) state.placement[i] = bestPlacement[i];

	return {
		bestPlacement,
		bestBreakdown,
		restartCount,
		totalIterations,
		tElapsedMs: Date.now() - tStart,
	};
}

/**
 * Async variant of {@link iteratedLocalSearch} for UI / service-wrapper
 * integration. Yields to the macrotask queue (`setTimeout(..., 0)`) before
 * each inner LS run so that:
 *
 *  - external `setTimeout`-scheduled aborts can fire and flip `shouldAbort`,
 *  - the host event loop (browser UI, vitest worker) is not blocked for the
 *    full `totalBudgetMs`.
 *
 * The inner `localSearch` itself stays synchronous — it polls `shouldAbort`
 * every iteration and exits within ms once the flag flips, so per-chunk
 * latency is bounded by `innerBudgetMs`.
 */
export async function iteratedLocalSearchAsync(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: IteratedLSOptions
): Promise<IteratedLSResult> {
	const totalBudget = opts.totalBudgetMs ?? 60_000;
	const innerBudget = opts.innerBudgetMs ?? 15_000;
	const perturbFraction = opts.perturbFraction ?? 0.2;
	const plateauMs = opts.plateauMs ?? 8_000;
	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	const tStart = Date.now();

	let bestPlacement = new Int32Array(state.placement);
	let bestBreakdown = { ...initialBreakdown };
	let lastImprovementMs = 0;
	let restartCount = 0;
	let totalIterations = 0;
	let consecutiveUnproductive = 0;
	let bestEverSeenScore = bestBreakdown.total;

	function improvementHook(info: Parameters<NonNullable<LocalSearchOptions['onImprovement']>>[0]) {
		if (info.breakdown.total < bestBreakdown.total) {
			bestBreakdown = { ...info.breakdown };
			bestPlacement = new Int32Array(info.bestPlacement);
			lastImprovementMs = Date.now() - tStart;
			opts.onImprovement?.(info);
		}
	}

	while (Date.now() - tStart < totalBudget) {
		// Yield to the macrotask queue so external setTimeout-based aborts
		// (and UI repaints) get a chance to run between LS chunks.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		if (opts.shouldAbort?.()) break;
		if (Date.now() - tStart >= totalBudget) break;

		const remainingTotal = totalBudget - (Date.now() - tStart);
		const thisBudget = Math.min(innerBudget, remainingTotal);

		// Reheat + diversify: after an unproductive plateau, raise SA start
		// temperature AND boost kempe-chain probability so the next LS chunk
		// explores wider neighbourhoods before settling.
		const reheat = consecutiveUnproductive >= 2;
		const tStartLS = reheat ? 200 + 50 * consecutiveUnproductive : 100;
		const kempeBoost = reheat ? Math.min(0.3, 0.05 * consecutiveUnproductive) : 0;

		const scoreBefore = bestBreakdown.total;
		// Split the inner LS budget into ~250 ms chunks and yield between them
		// so external setTimeout-based aborts (and UI repaints) can fire even
		// when innerBudgetMs is large (e.g. 30s in tests).
		const CHUNK_MS = 250;
		const lsTStart = Date.now();
		let abortedInner = false;
		while (true) {
			const chunkRemaining = thisBudget - (Date.now() - lsTStart);
			if (chunkRemaining <= 0) break;
			if (opts.shouldAbort?.()) { abortedInner = true; break; }
			const chunkBudget = Math.min(CHUNK_MS, chunkRemaining);
			const ls = localSearch(state, computeScore(state, opts.weights), {
				weights: opts.weights,
				maxIterations: 1_000_000,
				timeBudgetMs: chunkBudget,
				seed: rng.int(0, 2147483647),
				tStart: tStartLS,
				onImprovement: improvementHook,
				shouldAbort: opts.shouldAbort,
			});
			totalIterations += ls.iterations;
			if (opts.shouldAbort?.()) { abortedInner = true; break; }
			// Yield to the macrotask queue between chunks.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}

		if (bestBreakdown.total < bestEverSeenScore) {
			bestEverSeenScore = bestBreakdown.total;
			consecutiveUnproductive = 0;
		} else if (bestBreakdown.total >= scoreBefore) {
			consecutiveUnproductive++;
		}

		if (abortedInner) break;
		if (Date.now() - tStart >= totalBudget) break;
		if (opts.shouldAbort?.()) break;

		// Decide whether to restart: plateau detection.
		const sinceImprovement = Date.now() - tStart - lastImprovementMs;
		if (sinceImprovement < plateauMs && Date.now() - tStart < totalBudget * 0.7) {
			continue;
		}

		// Perturbation: knock out a fraction of non-pinned units, then re-construct.
		const candidates: number[] = [];
		for (let i = 0; i < state.nUnits; i++) {
			if (state.units[i].pinned) continue;
			candidates.push(i);
		}
		if (candidates.length === 0) break;
		for (let i = candidates.length - 1; i > 0; i--) {
			const j = rng.int(0, i + 1);
			[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
		}
		const adaptiveFraction = Math.min(
			0.6,
			perturbFraction + 0.05 * consecutiveUnproductive
		);
		const nPerturb = Math.max(1, Math.floor(candidates.length * adaptiveFraction));
		for (let i = 0; i < nPerturb; i++) state.placement[candidates[i]] = SLOT_UNPLACED;
		for (let i = nPerturb; i < candidates.length; i++) {
			state.placement[candidates[i]] = bestPlacement[candidates[i]];
		}

		construct(state, { weights: opts.weights, seed: rng.int(0, 2147483647) });

		restartCount++;
		opts.onRestart?.({ iteration: totalIterations, tElapsedMs: Date.now() - tStart, reason: 'plateau' });
	}

	// Restore best
	for (let i = 0; i < state.nUnits; i++) state.placement[i] = bestPlacement[i];

	return {
		bestPlacement,
		bestBreakdown,
		restartCount,
		totalIterations,
		tElapsedMs: Date.now() - tStart,
	};
}
