// Solver v2 — score delta for moves.
//
// Strategy: pragmatic full-scan after apply, then revert. Conceptually slower
// than O(1) per-component delta, but on our problem size (D×G×P=160 cells,
// nUnits~130) the entire computeScore() call costs ~50µs. That's enough for
// 20.000 moves/sec — plenty of headroom for Liste.csv.
//
// Why not the perfect O(1) delta? Because each soft-constraint component
// (no_free, main_run, compact_teacher) requires per-(day, grade) state that
// would need its own diff-tracking. Bug surface would be large. We profile
// later if performance is the bottleneck.

import { computeScore } from './score';
import { applyMove, revertMove, type Move } from './moves';
import type { ScoreBreakdown, ScoreWeights, SolverState } from './types';

/**
 * Evaluate the score delta for applying `move`. Does NOT keep the move
 * applied — state is identical before and after the call.
 *
 * Returns: deltaTotal (positive = score got worse), full new breakdown,
 * and the original (pre-move) breakdown for inspection.
 */
export function evaluateDelta(
	state: SolverState,
	move: Move,
	weights: ScoreWeights,
	currentBreakdown: ScoreBreakdown
): { delta: number; nextBreakdown: ScoreBreakdown } {
	applyMove(state, move);
	const nextBreakdown = computeScore(state, weights);
	revertMove(state, move);
	return { delta: nextBreakdown.total - currentBreakdown.total, nextBreakdown };
}
