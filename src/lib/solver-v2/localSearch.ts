// Solver v2 — Phase 2: Local Search.
//
// Hill-climbing + Simulated Annealing + Tabu list. See SOLVER-V2-CONCEPT.md §7.
//
// Operates on a constructed (hard-feasible) state. Each iteration generates
// a random move, evaluates the score delta, and accepts/rejects according to
// the SA criterion. The tabu list prevents direct undo of recent moves.

import { applyMove, genMove, revertMove, Rng, type Move } from './moves';
import { evaluateDelta } from './scoreDelta';
import type { ScoreBreakdown, ScoreWeights, SolverState } from './types';

export interface LocalSearchOptions {
	weights: ScoreWeights;
	/** Maximum iterations. Default 50_000. */
	maxIterations?: number;
	/** Maximum wall-clock time in ms. Default 60_000 (1 min). */
	timeBudgetMs?: number;
	/** Initial SA temperature. Default 100. */
	tStart?: number;
	/** Minimum SA temperature. Default 0.1. */
	tMin?: number;
	/** Cooling rate. Default 0.9995 (per iteration). */
	cooling?: number;
	/** Tabu tenure (iterations). Default 50. */
	tabuTenure?: number;
	/**
	 * Diversification boost — added to the kempe-chain probability when
	 * generating moves. ILS raises this after unproductive restarts. 0 = default mix.
	 */
	kempeBoost?: number;
	/** Random seed. Default deterministic. */
	seed?: number;
	/**
	 * Optional callback invoked after each accepted improvement (i.e. score
	 * dropped). Used by the streaming session to push live updates to the UI.
	 */
	onImprovement?: (info: {
		iteration: number;
		tElapsedMs: number;
		breakdown: ScoreBreakdown;
		bestPlacement: Int32Array;
	}) => void;
	/**
	 * Optional cancel signal. If returns true, LS aborts after the next move.
	 * Used by `startSolve.abort()`.
	 */
	shouldAbort?: () => boolean;
}

export interface LocalSearchResult {
	/** The best placement seen (deep copy of state.placement). */
	bestPlacement: Int32Array;
	/** The best breakdown corresponding to bestPlacement. */
	bestBreakdown: ScoreBreakdown;
	/** Number of iterations performed. */
	iterations: number;
	/** Number of accepted moves (including SA-uphill). */
	acceptedMoves: number;
	/** Number of accepted improvements (delta < 0). */
	improvementCount: number;
	/** Final wall-clock time spent in ms. */
	tElapsedMs: number;
}

/**
 * Run local search on the given state. State is restored to the best-found
 * placement on return.
 */
export function localSearch(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: LocalSearchOptions
): LocalSearchResult {
	const maxIter = opts.maxIterations ?? 50_000;
	const timeBudgetMs = opts.timeBudgetMs ?? 60_000;
	let T = opts.tStart ?? 100;
	const tMin = opts.tMin ?? 0.1;
	const cooling = opts.cooling ?? 0.9995;
	const tabuTenure = opts.tabuTenure ?? 50;
	const kempeBoost = opts.kempeBoost ?? 0;
	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	const tStart = Date.now();

	let curBreakdown = initialBreakdown;
	let bestPlacement = new Int32Array(state.placement);
	let bestBreakdown = { ...curBreakdown };

	// Tabu: map<key, iteration-when-expires>. Key = `${unitIdx}:${oldSlot}`.
	const tabu = new Map<string, number>();

	let iterations = 0;
	let acceptedMoves = 0;
	let improvementCount = 0;

	while (iterations < maxIter) {
		if (opts.shouldAbort?.()) break;
		const elapsed = Date.now() - tStart;
		if (elapsed > timeBudgetMs) break;

		const move = genMove(state, rng, kempeBoost);
		if (!move) {
			iterations++;
			continue;
		}

		// Tabu check: is the move forbidden?
		if (isTabu(move, tabu, iterations)) {
			iterations++;
			continue;
		}

		const { delta, nextBreakdown } = evaluateDelta(state, move, opts.weights, curBreakdown);

		const accept =
			delta < 0 ||
			(T > tMin && rng.next() < Math.exp(-delta / T));

		if (accept) {
			applyMove(state, move);
			acceptedMoves++;
			curBreakdown = nextBreakdown;
			pushTabu(move, tabu, iterations + tabuTenure);
			if (delta < 0) {
				improvementCount++;
				if (curBreakdown.total < bestBreakdown.total) {
					bestBreakdown = { ...curBreakdown };
					bestPlacement = new Int32Array(state.placement);
					opts.onImprovement?.({
						iteration: iterations,
						tElapsedMs: elapsed,
						breakdown: bestBreakdown,
						bestPlacement,
					});
				}
			}
		}

		T = Math.max(tMin, T * cooling);
		iterations++;
	}

	// Restore best placement
	for (let i = 0; i < state.nUnits; i++) state.placement[i] = bestPlacement[i];

	return {
		bestPlacement,
		bestBreakdown,
		iterations,
		acceptedMoves,
		improvementCount,
		tElapsedMs: Date.now() - tStart,
	};
}

function isTabu(move: Move, tabu: Map<string, number>, iter: number): boolean {
	switch (move.kind) {
		case 'slot-move':
			return checkTabu(`${move.unitIdx}:${move.fromSlot}`, tabu, iter);
		case 'slot-swap':
			return (
				checkTabu(`${move.aIdx}:${move.aSlot}`, tabu, iter) ||
				checkTabu(`${move.bIdx}:${move.bSlot}`, tabu, iter)
			);
		case 'kempe-chain':
			// Don't bother with tabu for kempe — they're rare and hard to oscillate
			return false;
	}
}

function checkTabu(key: string, tabu: Map<string, number>, iter: number): boolean {
	const expiry = tabu.get(key);
	if (expiry === undefined) return false;
	if (expiry <= iter) {
		tabu.delete(key);
		return false;
	}
	return true;
}

function pushTabu(move: Move, tabu: Map<string, number>, expiry: number): void {
	switch (move.kind) {
		case 'slot-move':
			tabu.set(`${move.unitIdx}:${move.toSlot}`, expiry);
			return;
		case 'slot-swap':
			tabu.set(`${move.aIdx}:${move.bSlot}`, expiry);
			tabu.set(`${move.bIdx}:${move.aSlot}`, expiry);
			return;
		case 'kempe-chain':
			return;
	}
}
