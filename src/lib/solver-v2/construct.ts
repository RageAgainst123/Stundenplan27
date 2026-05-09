// Solver v2 — Phase 1: Construction.
//
// Greedy placement with most-constrained-first ordering and ejection-chain
// repair on conflicts. See SOLVER-V2-CONCEPT.md §6 for design rationale.
//
// Output: a valid (hard-constraint-feasible) initial solution, or — if
// some units couldn't be placed even with ejection chains — a partial
// solution with a list of unplaced unit indices.

import { Rng } from './moves';
import { feasibleSlots, wouldViolate } from './hardCheck';
import {
	type SolverState,
	type Unit,
	SLOT_UNPLACED,
	dpFromSlot,
	slotFromDP,
	D,
	P,
	type ScoreWeights,
} from './types';

export interface ConstructResult {
	unplacedUnitIdxs: number[];
	/** True if all unpinned units got a slot. */
	complete: boolean;
}

export interface ConstructOptions {
	/** Seed for the random tie-breaker. Default: random. */
	seed?: number;
	/** Max recursion depth for ejection chains. Default 10. */
	maxEjectionDepth?: number;
	/** Score weights for slot scoring (greedy step). */
	weights: ScoreWeights;
}

/**
 * Run Construction. Mutates `state.placement` in place. Returns metadata
 * about which units could not be placed.
 *
 * Algorithm:
 *   1) Compute difficulty per non-pinned, unplaced unit
 *   2) Sort by difficulty descending
 *   3) For each unit, pick the best feasible slot by greedy slot-score
 *   4) If no feasible slot, run ejection chain
 *   5) Return list of definitively unplaced units (after ejection failures)
 */
export function construct(state: SolverState, opts: ConstructOptions): ConstructResult {
	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	const maxDepth = opts.maxEjectionDepth ?? 10;

	const toPlace = computeOrdering(state);

	const unplaced: number[] = [];
	// Time budget: ejection chains can be expensive; abort total at 5s
	const tStart = Date.now();
	const totalBudgetMs = 5000;

	for (const unit of toPlace) {
		if (state.placement[unit.idx] !== SLOT_UNPLACED) continue; // already placed (pinned)
		if (Date.now() - tStart > totalBudgetMs) {
			unplaced.push(unit.idx);
			continue;
		}

		// Rebuild (day, grade) count index every iteration — O(nUnits)
		const dgCounts = buildDayGradeCounts(state);
		const slot = pickBestSlot(state, unit, opts.weights, rng, dgCounts);
		if (slot !== -1) {
			state.placement[unit.idx] = slot;
			continue;
		}

		// No feasible slot found — try ejection chain
		const ok = ejectionChain(state, unit, maxDepth, rng, opts.weights);
		if (!ok) unplaced.push(unit.idx);
	}

	return {
		unplacedUnitIdxs: unplaced,
		complete: unplaced.length === 0,
	};
}

/**
 * Compute difficulty score per unplaced, non-pinned unit. Higher = harder.
 *
 * From SOLVER-V2-CONCEPT.md §6.2:
 *   +1000 if unit has any pinned spec-mate
 *   +500 if couplingId set
 *   +200 per multi-grade sibling
 *   +100 if blockSize > 1
 *   +30 × (40 - teacher.availableSlots)
 *   +20 × spec.count
 */
function computeOrdering(state: SolverState): Unit[] {
	const out: Unit[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const u = state.units[i];
		if (u.pinned) continue;
		if (state.placement[i] !== SLOT_UNPLACED) continue;
		out.push(u);
	}

	function difficulty(u: Unit): number {
		let d = 0;
		// Pinned spec-mates
		const mates = u.specIds.flatMap(sid => state.unitsBySpec.get(sid) ?? []);
		const pinnedMates = mates.filter(m => m !== u && m.pinned).length;
		d += 1000 * pinnedMates;
		// Coupling
		if (u.kind === 'coupling') d += 500;
		// Multi-grade
		d += 200 * (u.grades.length - 1);
		// Block
		if (u.blockSize > 1) d += 100;
		// Teacher availability
		const teacher = state.teachersById.get(u.teacherId);
		if (teacher) {
			const avail = D * P - (teacher.unavailable?.length ?? 0);
			d += 30 * (40 - avail);
		}
		// Spec count
		const spec = state.specsById.get(u.specIds[0]);
		d += 20 * (spec?.count ?? 1);
		return d;
	}

	out.sort((a, b) => difficulty(b) - difficulty(a));
	return out;
}

/**
 * Build a (day, grade) → lessonCount index for fast slot scoring.
 * O(nUnits) once per construction call, lookups O(1).
 */
function buildDayGradeCounts(state: SolverState): Int32Array {
	const G = 4;
	const counts = new Int32Array(D * G);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const u = state.units[i];
		const { dayIndex } = dpFromSlot(slot);
		for (const grade of u.grades) {
			counts[dayIndex * G + (grade - 5)] += u.blockSize;
		}
	}
	return counts;
}

/**
 * Score a candidate slot for greedy placement. Lower = better.
 * Uses a precomputed (day, grade) count index for O(1) lookups.
 */
function scoreSlot(
	state: SolverState,
	unit: Unit,
	slot: number,
	weights: ScoreWeights,
	dgCounts: Int32Array
): number {
	const G = 4;
	const { dayIndex, period } = dpFromSlot(slot);
	let s = 0;

	// Reward filling under-loaded days for unit's grades
	for (const grade of unit.grades) {
		const count = dgCounts[dayIndex * G + (grade - 5)];
		if (count < 4) s -= weights.uneven_days * 0.5;
		if (count === 0 && period === 1) s -= weights.no_p1_start;
	}

	// Penalize afternoon
	const afternoonStart = state.doc.constraints.noMainSubjectAfternoon.afternoonStartsAtPeriod;
	const isMain = state.subjectsByCode.get(unit.subjectCode)?.isMain ?? false;
	for (let pos = 0; pos < unit.blockSize; pos++) {
		const p = period + pos;
		if (p >= afternoonStart) {
			s += weights.any_aft;
			if (isMain) s += weights.main_aft;
		}
		if (isMain) s += weights.main_early * (p - 1);
	}

	return s;
}

/** Pick the best feasible slot for `unit`. Returns -1 if none. */
function pickBestSlot(
	state: SolverState,
	unit: Unit,
	weights: ScoreWeights,
	rng: Rng,
	dgCounts: Int32Array
): number {
	const slots = feasibleSlots(state, unit);
	if (slots.length === 0) return -1;
	let bestSlot = -1;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const slot of slots) {
		const s = scoreSlot(state, unit, slot, weights, dgCounts) + rng.next() * 0.001;
		if (s < bestScore) {
			bestScore = s;
			bestSlot = slot;
		}
	}
	return bestSlot;
}

/**
 * Ejection chain: try to place `unit` at SOME slot, evicting blockers if
 * needed and recursively re-placing them.
 *
 * @returns true if `unit` got a slot (state updated), false otherwise
 *          (state unchanged on failure).
 *
 * Performance notes:
 *  - We share ONE `visited` set across the recursion (mutate in/out instead
 *    of copying). Cuts the worst-case from O(branchFactor^maxDepth) to
 *    O(maxDepth * branchFactor) for visited management.
 *  - We only try the first 5 slot candidates per recursion level — past that
 *    the search is wasted on slot scoring with diminishing returns.
 *  - We hard-cap the total number of `wouldViolate` calls per chain via
 *    a shared counter. Past 200, abort.
 */
function ejectionChain(
	state: SolverState,
	unit: Unit,
	maxDepth: number,
	rng: Rng,
	weights: ScoreWeights,
	depth = 0,
	visited: Set<number> = new Set(),
	budget: { remaining: number } = { remaining: 200 }
): boolean {
	if (depth >= maxDepth) return false;
	if (budget.remaining <= 0) return false;
	if (visited.has(unit.idx)) return false;
	visited.add(unit.idx);

	const dgCounts = buildDayGradeCounts(state);

	// Try each slot in 0..D*P, sorted by score (try best first). Limit to
	// top-K candidates to keep recursion bounded.
	const TOP_K = 5;
	const candidateSlots: { slot: number; score: number }[] = [];
	for (let d = 0; d < D; d++) {
		for (let p = 1; p <= P - unit.blockSize + 1; p++) {
			const slot = slotFromDP(d, p);
			candidateSlots.push({ slot, score: scoreSlot(state, unit, slot, weights, dgCounts) + rng.next() * 0.001 });
		}
	}
	candidateSlots.sort((a, b) => a.score - b.score);
	const topSlots = candidateSlots.slice(0, TOP_K);

	for (const { slot } of topSlots) {
		if (budget.remaining <= 0) break;
		budget.remaining--;
		if (wouldViolate(state, unit, slot) === null) {
			state.placement[unit.idx] = slot;
			visited.delete(unit.idx);
			return true;
		}
		const blockers = findBlockers(state, unit, slot);
		if (blockers.length === 0 || blockers.length > 3) continue; // skip if too many

		const saved: { idx: number; slot: number }[] = blockers.map(b => ({ idx: b.idx, slot: state.placement[b.idx] }));
		for (const b of blockers) state.placement[b.idx] = SLOT_UNPLACED;

		if (wouldViolate(state, unit, slot) !== null) {
			for (const s of saved) state.placement[s.idx] = s.slot;
			continue;
		}

		state.placement[unit.idx] = slot;
		let allOk = true;
		const ejected: Unit[] = [];
		for (const b of blockers) {
			if (b.pinned) { allOk = false; break; }
			if (!ejectionChain(state, b, maxDepth, rng, weights, depth + 1, visited, budget)) {
				allOk = false;
				break;
			}
			ejected.push(b);
		}

		if (allOk) {
			visited.delete(unit.idx);
			return true;
		}

		// Revert
		state.placement[unit.idx] = SLOT_UNPLACED;
		for (const e of ejected) state.placement[e.idx] = SLOT_UNPLACED;
		for (const s of saved) state.placement[s.idx] = s.slot;
	}

	visited.delete(unit.idx);
	return false;
}

/** Find which units currently block `unit` from being placed at `slot`. */
function findBlockers(state: SolverState, unit: Unit, slot: number): Unit[] {
	const { dayIndex, period } = dpFromSlot(slot);
	const periodsToOccupy: number[] = [];
	for (let pos = 0; pos < unit.blockSize; pos++) {
		periodsToOccupy.push(period + pos);
	}

	const out: Unit[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const otherSlot = state.placement[i];
		if (otherSlot === SLOT_UNPLACED) continue;
		const other = state.units[i];
		if (other === unit) continue;
		const otherDp = dpFromSlot(otherSlot);
		if (otherDp.dayIndex !== dayIndex) continue;

		// Does any other-period overlap with our planned periods?
		let overlaps = false;
		for (let oPos = 0; oPos < other.blockSize; oPos++) {
			const oP = otherDp.period + oPos;
			if (periodsToOccupy.includes(oP)) {
				overlaps = true;
				break;
			}
		}
		if (!overlaps) continue;

		// Is this overlap a hard violation (teacher / grade clash)?
		const sameTeacher = other.teacherId === unit.teacherId;
		const overlapsGrade = unit.grades.some(g => other.grades.includes(g));
		if (sameTeacher || overlapsGrade) {
			out.push(other);
		}
	}
	return out;
}
