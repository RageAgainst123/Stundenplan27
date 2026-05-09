// Solver v2 — hard constraint checks for placing a Unit on a slot.
//
// "Hard" means: a violation is forbidden, the move is rejected. These are
// the H1–H9 constraints from SOLVER-V2-CONCEPT.md §4.
//
// API: `wouldViolate(state, unit, slot, ignoreUnit?)` returns null if OK,
// else a short reason string. `ignoreUnit` is used during swaps where the
// unit being moved should be considered "not at its old position".

import {
	D,
	DAY_INDEX,
	DAYS_BY_INDEX,
	P,
	dpFromSlot,
	type SolverState,
	type Unit,
	SLOT_UNPLACED,
	slotFromDP,
} from './types';

/**
 * Check whether placing `unit` at `slot` would violate any hard constraint.
 *
 * @param state    Solver state (read-only — function doesn't mutate)
 * @param unit     The unit we want to place
 * @param slot     Target packed slot id (0..D*P-1)
 * @param ignoreUnit If set, this unit's current placement is ignored
 *                  (use during swap-evaluation: the swap target is treated
 *                  as if it had moved elsewhere already).
 * @returns null if the placement is valid, otherwise a short failure reason.
 */
export function wouldViolate(
	state: SolverState,
	unit: Unit,
	slot: number,
	ignoreUnit?: Unit
): string | null {
	// H1: Pinned units cannot move.
	if (unit.pinned) return 'unit is pinned';

	const { dayIndex, period } = dpFromSlot(slot);
	const day = DAYS_BY_INDEX[dayIndex];

	// Block-units occupy multiple consecutive periods. Check each one.
	const periodsToOccupy: number[] = [];
	for (let pos = 0; pos < unit.blockSize; pos++) {
		const p = period + pos;
		if (p > P) return 'block extends past last period';
		periodsToOccupy.push(p);
	}

	// H2: Teacher availability — none of the periods can be blocked.
	const teacher = state.teachersById.get(unit.teacherId);
	if (teacher) {
		for (const p of periodsToOccupy) {
			if (teacher.unavailable.some(u => u.day === day && u.period === p)) {
				return `teacher ${teacher.name} unavailable at ${day} P${p}`;
			}
		}
	}

	// H3 + H4: scan all OTHER placed units for collisions.
	// We iterate units (not slots) because we have no "slot occupancy" map
	// at this layer. Local Search will batch this differently for hot-path.
	for (let i = 0; i < state.nUnits; i++) {
		const otherSlot = state.placement[i];
		if (otherSlot === SLOT_UNPLACED) continue;
		const other = state.units[i];
		if (other === unit) continue;
		if (ignoreUnit && other === ignoreUnit) continue;

		const otherDp = dpFromSlot(otherSlot);
		// Other unit may also span multiple periods if block.
		for (let oPos = 0; oPos < other.blockSize; oPos++) {
			const oP = otherDp.period + oPos;
			if (oP > P) continue;
			// Same day required for any conflict on (day, period)
			if (otherDp.dayIndex !== dayIndex) continue;
			// Does any of unit's periods overlap with other's oP?
			if (!periodsToOccupy.includes(oP)) continue;

			// Determine if the two units share couplingId/specIds (allowed parallel)
			const sameCoupling = sharesCoupling(unit, other, state);

			// H3: same teacher → conflict unless coupled
			if (other.teacherId === unit.teacherId && !sameCoupling) {
				return `teacher ${unit.teacherId} double-booked at ${day} P${oP}`;
			}

			// H4: overlapping grade columns → conflict unless coupled
			const gradeOverlap = unit.grades.some(g => other.grades.includes(g));
			if (gradeOverlap && !sameCoupling) {
				return `grade ${unit.grades.find(g => other.grades.includes(g))} double-booked at ${day} P${oP}`;
			}

			// H7: week pattern compatibility
			// If both are coupled (same slot), patterns must be compatible.
			// If not coupled but somehow overlapping (shouldn't happen here):
			if (sameCoupling) {
				if (
					(unit.weekPattern === 'even' && other.weekPattern === 'odd') ||
					(unit.weekPattern === 'odd' && other.weekPattern === 'even')
				) {
					return `incompatible week patterns: ${unit.weekPattern} vs ${other.weekPattern}`;
				}
			}
		}
	}

	// H8: same spec, different occurrences → must NOT share (day, period).
	const sameSpecUnits = unit.specIds.flatMap(sid => state.unitsBySpec.get(sid) ?? []);
	for (const other of sameSpecUnits) {
		if (other === unit) continue;
		if (ignoreUnit && other === ignoreUnit) continue;
		const otherSlot = state.placement[other.idx];
		if (otherSlot === SLOT_UNPLACED) continue;
		const otherDp = dpFromSlot(otherSlot);
		// Different occurrence = different occurrenceIndex on EVERY shared instance.
		// But if two units of the same spec end up on (same day, same period),
		// they MUST be the same occurrence (which would be a bug — only one
		// Unit per occurrence is generated).
		// Easier rule: spec-mate units cannot share (day, period) at all,
		// because each occurrence is a distinct Unit.
		if (otherDp.dayIndex === dayIndex && periodsToOccupy.includes(otherDp.period)) {
			// Allow couplings (different specs, same coupling unit)
			if (sharesCoupling(unit, other, state)) continue;
			return `same-spec collision at ${day} P${otherDp.period}`;
		}
	}

	return null;
}

/**
 * Two units "share coupling" if they are the same Unit or if they have
 * any shared couplingId in their underlying specs.
 *
 * For solver-v2 coupling-units, multiple specs are merged into one Unit
 * already, so two DIFFERENT units with overlapping specs is a config bug
 * (we don't create such Units). This helper also defends against legacy
 * `pairedWith` field semantics, kept for safety.
 */
function sharesCoupling(a: Unit, b: Unit, state: SolverState): boolean {
	if (a === b) return true;
	for (const aSid of a.specIds) {
		const aSpec = state.specsById.get(aSid);
		if (!aSpec?.couplingId) continue;
		for (const bSid of b.specIds) {
			const bSpec = state.specsById.get(bSid);
			if (!bSpec?.couplingId) continue;
			if (aSpec.couplingId === bSpec.couplingId) return true;
		}
		// Legacy pairedWith
		if (aSpec.pairedWith?.some(pid => b.specIds.includes(pid))) return true;
	}
	return false;
}

/**
 * Find all valid slots for a unit (filtered by hard constraints), excluding
 * the current slot. Returns slot ids 0..D*P-1.
 *
 * Use case: Construction-phase greedy slot selection, Move-Operator generation.
 */
export function feasibleSlots(state: SolverState, unit: Unit, ignoreUnit?: Unit): number[] {
	const out: number[] = [];
	const currentSlot = state.placement[unit.idx];
	for (let d = 0; d < D; d++) {
		for (let p = 1; p <= P - unit.blockSize + 1; p++) {
			const slot = slotFromDP(d, p);
			if (slot === currentSlot) continue;
			if (wouldViolate(state, unit, slot, ignoreUnit) === null) {
				out.push(slot);
			}
		}
	}
	return out;
}

void DAY_INDEX;
