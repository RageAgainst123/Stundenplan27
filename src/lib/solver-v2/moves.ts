// Solver v2 — move operators for Local Search.
//
// Three operators per SOLVER-V2-CONCEPT.md §7.1:
//   - slot-move (60%): one unit jumps to a different slot
//   - slot-swap (35%): two units exchange slots
//   - kempe-chain (5%): block-swap of all lessons of one (day, grade)
//                       between two days
//
// All moves come with apply/revert symmetry — applyMove(state, m) followed
// by revertMove(state, m) restores the state byte-for-byte.

import { wouldViolate } from './hardCheck';
import {
	D,
	dpFromSlot,
	type SolverState,
	type Unit,
	SLOT_UNPLACED,
	slotFromDP,
} from './types';

export type MoveKind = 'slot-move' | 'slot-swap' | 'kempe-chain';

/** Description of a planned move. Apply and revert use this for undo. */
export type Move =
	| { kind: 'slot-move'; unitIdx: number; fromSlot: number; toSlot: number }
	| { kind: 'slot-swap'; aIdx: number; bIdx: number; aSlot: number; bSlot: number }
	| { kind: 'kempe-chain'; unitIdxs: number[]; fromSlots: number[]; toSlots: number[] };

/**
 * Simple seedable PRNG (xoroshiro64* — fast, decent quality, deterministic).
 * Used for reproducible moves with a known seed.
 */
export class Rng {
	private state: number;
	constructor(seed: number) {
		this.state = (seed | 0) || 1;
	}
	/** Aktuellen internen Zustand lesen — für Resume über LS-Chunk-Grenzen. */
	getState(): number {
		return this.state;
	}
	/** Internen Zustand setzen — Gegenstück zu getState() beim Resume. */
	setState(s: number): void {
		this.state = (s | 0) || 1;
	}
	next(): number {
		// xorshift32
		let x = this.state;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.state = x | 0;
		// Map to [0, 1)
		return ((x >>> 0) % 1_000_000) / 1_000_000;
	}
	int(min: number, maxExclusive: number): number {
		return Math.floor(this.next() * (maxExclusive - min)) + min;
	}
	pick<T>(arr: T[]): T {
		return arr[this.int(0, arr.length)];
	}
}

/**
 * Generate a candidate move. May return null if no valid move can be
 * constructed (e.g. all units pinned).
 *
 * Default mix is slot-move 60% / slot-swap 35% / kempe-chain 5%. The
 * `kempeBoost` arg can shift the mix toward more diversification — the
 * caller (typically `iteratedLocalSearchAsync` after an unproductive
 * plateau) raises this to break out of local optima.
 */
export function genMove(state: SolverState, rng: Rng, kempeBoost = 0): Move | null {
	const kempeProb = Math.min(0.4, 0.05 + kempeBoost);
	const swapProb = 0.35;
	const moveProb = 1 - swapProb - kempeProb;
	const r = rng.next();
	if (r < moveProb) return genSlotMove(state, rng);
	if (r < moveProb + swapProb) return genSlotSwap(state, rng);
	return genKempeChain(state, rng);
}

/**
 * slot-move: pick a non-pinned, placed unit; pick a feasible target slot;
 * if target is occupied by another non-pinned unit, fall back to a swap.
 */
function genSlotMove(state: SolverState, rng: Rng): Move | null {
	const candidates = movableUnits(state);
	if (candidates.length === 0) return null;
	const unit = rng.pick(candidates);
	const fromSlot = state.placement[unit.idx];

	// Hot-path optimization: instead of building the full feasibleSlots list
	// (which costs O(D*P*nUnits) wouldViolate calls), we sample random slots
	// directly and let wouldViolate filter them. This trades a slight chance
	// of missing a feasible slot for a ~50× speedup at our problem size.
	const D = 5; // days
	const P = 8; // periods
	const maxStartP = P - unit.blockSize + 1;
	if (maxStartP < 1) return null;
	for (let tries = 0; tries < 12; tries++) {
		const d = rng.int(0, D);
		const p = rng.int(1, maxStartP + 1);
		const toSlot = d * P + (p - 1);
		if (toSlot === fromSlot) continue;
		const occupant = findOccupantAt(state, toSlot);
		if (occupant && occupant !== unit) {
			// Convert to swap
			if (occupant.pinned) continue;
			if (wouldViolate(state, unit, toSlot, occupant) !== null) continue;
			if (wouldViolate(state, occupant, fromSlot, unit) !== null) continue;
			return {
				kind: 'slot-swap',
				aIdx: unit.idx,
				bIdx: occupant.idx,
				aSlot: fromSlot,
				bSlot: toSlot,
			};
		}
		// Empty target — verify no hard violation
		if (wouldViolate(state, unit, toSlot) !== null) continue;
		return { kind: 'slot-move', unitIdx: unit.idx, fromSlot, toSlot };
	}
	return null;
}

/**
 * slot-swap: pick two distinct non-pinned units, check both ways for hard
 * constraints, return swap.
 */
function genSlotSwap(state: SolverState, rng: Rng): Move | null {
	const candidates = movableUnits(state);
	if (candidates.length < 2) return null;
	for (let tries = 0; tries < 8; tries++) {
		const a = rng.pick(candidates);
		const b = rng.pick(candidates);
		if (a === b) continue;
		const aSlot = state.placement[a.idx];
		const bSlot = state.placement[b.idx];
		if (aSlot === SLOT_UNPLACED || bSlot === SLOT_UNPLACED) continue;
		// After swap, a must be valid at b's slot and vice versa.
		// We "ignore" the other unit for the cross-check (it's about to move).
		if (wouldViolate(state, a, bSlot, b) !== null) continue;
		if (wouldViolate(state, b, aSlot, a) !== null) continue;
		return { kind: 'slot-swap', aIdx: a.idx, bIdx: b.idx, aSlot, bSlot };
	}
	return null;
}

/**
 * kempe-chain: pick two days D1, D2 and a grade G; collect all units of grade G
 * placed on D1 and D2; swap all of them between the two days. If the resulting
 * config is hard-feasible, return the move.
 *
 * This is a coarse-grained move that helps escape local minima where individual
 * slot-moves can't fix the day-distribution.
 */
function genKempeChain(state: SolverState, rng: Rng): Move | null {
	for (let tries = 0; tries < 4; tries++) {
		const d1 = rng.int(0, D);
		let d2 = rng.int(0, D);
		while (d2 === d1) d2 = rng.int(0, D);
		const g = (rng.int(0, 4) + 5) as 5 | 6 | 7 | 8;

		const onD1: Unit[] = [];
		const onD2: Unit[] = [];
		for (let i = 0; i < state.nUnits; i++) {
			const u = state.units[i];
			if (u.pinned) continue;
			if (!u.grades.includes(g)) continue;
			const slot = state.placement[u.idx];
			if (slot === SLOT_UNPLACED) continue;
			const dp = dpFromSlot(slot);
			if (dp.dayIndex === d1) onD1.push(u);
			else if (dp.dayIndex === d2) onD2.push(u);
		}
		if (onD1.length === 0 && onD2.length === 0) continue;

		// Build target slots: keep period, swap day.
		const allUnits = [...onD1, ...onD2];
		const fromSlots = allUnits.map(u => state.placement[u.idx]);
		const toSlots = allUnits.map(u => {
			const dp = dpFromSlot(state.placement[u.idx]);
			const newDay = dp.dayIndex === d1 ? d2 : d1;
			return slotFromDP(newDay, dp.period);
		});

		// Validate: simulate the chain by temporarily clearing all involved
		// placements, then check each new placement.
		const saved: number[] = [];
		for (const u of allUnits) {
			saved.push(state.placement[u.idx]);
			state.placement[u.idx] = SLOT_UNPLACED;
		}
		let ok = true;
		for (let i = 0; i < allUnits.length; i++) {
			if (wouldViolate(state, allUnits[i], toSlots[i]) !== null) { ok = false; break; }
			// Tentatively place to detect intra-chain conflicts
			state.placement[allUnits[i].idx] = toSlots[i];
		}
		// Restore original placements no matter what (caller will applyMove if ok)
		for (let i = 0; i < allUnits.length; i++) {
			state.placement[allUnits[i].idx] = saved[i];
		}
		if (!ok) continue;

		return {
			kind: 'kempe-chain',
			unitIdxs: allUnits.map(u => u.idx),
			fromSlots,
			toSlots,
		};
	}
	return null;
}

/** Return all unit references that are currently non-pinned and placed. */
function movableUnits(state: SolverState): Unit[] {
	const out: Unit[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const u = state.units[i];
		if (u.pinned) continue;
		if (state.placement[i] === SLOT_UNPLACED) continue;
		out.push(u);
	}
	return out;
}

/** Find which unit (if any) currently occupies the given slot. O(nUnits). */
function findOccupantAt(state: SolverState, slot: number): Unit | null {
	for (let i = 0; i < state.nUnits; i++) {
		if (state.placement[i] === slot) return state.units[i];
	}
	return null;
}

/** Apply a move in-place. */
export function applyMove(state: SolverState, move: Move): void {
	switch (move.kind) {
		case 'slot-move':
			state.placement[move.unitIdx] = move.toSlot;
			return;
		case 'slot-swap':
			state.placement[move.aIdx] = move.bSlot;
			state.placement[move.bIdx] = move.aSlot;
			return;
		case 'kempe-chain':
			for (let i = 0; i < move.unitIdxs.length; i++) {
				state.placement[move.unitIdxs[i]] = move.toSlots[i];
			}
			return;
	}
}

/** Revert a previously applied move. Symmetric inverse of applyMove. */
export function revertMove(state: SolverState, move: Move): void {
	switch (move.kind) {
		case 'slot-move':
			state.placement[move.unitIdx] = move.fromSlot;
			return;
		case 'slot-swap':
			state.placement[move.aIdx] = move.aSlot;
			state.placement[move.bIdx] = move.bSlot;
			return;
		case 'kempe-chain':
			for (let i = 0; i < move.unitIdxs.length; i++) {
				state.placement[move.unitIdxs[i]] = move.fromSlots[i];
			}
			return;
	}
}
