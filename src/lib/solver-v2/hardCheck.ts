// Solver v2 — hard constraint checks for placing a Unit on a slot.
//
// "Hard" means: a violation is forbidden, the move is rejected. These are
// the H1–H9 constraints; canonical reference is docs/MODEL.md §4 (table with
// "where checked" / "where tested"). H5/H6/H9 are enforced implicitly via
// the Unit data structure in units.ts, not by an explicit check here.
//
// API: `wouldViolate(state, unit, slot, ignoreUnit?)` returns null if OK,
// else a short reason string. `ignoreUnit` is used during swaps where the
// unit being moved should be considered "not at its old position".

import type { GradeLevel } from '../types';
import {
	D,
	DAY_INDEX,
	DAYS_BY_INDEX,
	P,
	dpFromSlot,
	type HardCheckIndex,
	type SolverState,
	type Unit,
	SLOT_UNPLACED,
	slotFromDP,
} from './types';

/**
 * Solver-Opt Runde 2, Schritt 3: Kandidaten-Index für scoped Checks.
 *
 * Ein Platzierungs-Konflikt zwischen zwei Units setzt voraus:
 *  - H3 (Lehrer-Doppelbelegung): gemeinsamer Lehrer,
 *  - H4 (Stufen-Doppelbelegung): gemeinsame Stufe,
 *  - H8 (Same-Spec): gemeinsame Spec → gemeinsamer Lehrer,
 *  - H7 (Wochen-Pattern, nur bei sameCoupling): gemeinsame couplingId.
 * Die Kandidatenmenge ist also unitsByTeacher ∪ unitsByGrade ∪
 * unitsByCoupling — typ. 10–40 statt aller ~130 Units. Lazy gebaut und
 * am State gecacht (Units sind während einer Session unveränderlich).
 */
export function ensureCheckIndex(state: SolverState): HardCheckIndex {
	if (state.checkIndex) return state.checkIndex;
	const unitsByGrade = new Map<GradeLevel, Unit[]>();
	const unitsByCoupling = new Map<string, Unit[]>();
	for (let i = 0; i < state.nUnits; i++) {
		const u = state.units[i];
		for (const g of u.grades) {
			let list = unitsByGrade.get(g);
			if (!list) { list = []; unitsByGrade.set(g, list); }
			list.push(u);
		}
		const seenCouplings = new Set<string>();
		for (const sid of u.specIds) {
			const cid = state.specsById.get(sid)?.couplingId;
			if (!cid || seenCouplings.has(cid)) continue;
			seenCouplings.add(cid);
			let list = unitsByCoupling.get(cid);
			if (!list) { list = []; unitsByCoupling.set(cid, list); }
			list.push(u);
		}
	}
	const idx: HardCheckIndex = {
		unitsByGrade,
		unitsByCoupling,
		seenGen: new Int32Array(state.nUnits),
		gen: 0,
	};
	state.checkIndex = idx;
	return idx;
}

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

	// Phase 18: Nachmittag-Schwellwert aus ConstraintConfig holen — derselbe
	// wie für noMainSubjectAfternoon. Default 7. So bleiben H10/H11 mit dem
	// User-konfigurierten Schwellwert konsistent.
	const afternoonStart = Math.max(1, Math.min(P, Math.round(
		state.doc.constraints.noMainSubjectAfternoon?.afternoonStartsAtPeriod ?? 7
	)));

	// H10: Phase 13 — Specs mit `afternoonAllowed='never'` dürfen nicht in
	// Nachmittagsslots P7-P8 (inkl. Block-Reichweite). Default für Hauptfächer
	// nach Migration v4→v5.
	if (unit.afternoonAllowed === 'never') {
		for (const p of periodsToOccupy) {
			if (p >= afternoonStart) return 'H10: Nachmittag verboten (Hauptfach)';
		}
	}

	// H11: Phase 18 — Specs mit `afternoonAllowed='must'` MÜSSEN im
	// Nachmittag liegen (alle Perioden ≥ afternoonStart). Spiegelbild zu H10.
	// Block-Patterns: alle Perioden (auch der Block-Schwanz) müssen
	// nachmittags sein. Wenn die Spec nicht erfüllbar ist, schlägt der
	// Construction-Pfad das früh fest und meldet sie als unplaced.
	if (unit.afternoonAllowed === 'must') {
		for (const p of periodsToOccupy) {
			if (p < afternoonStart) return 'H11: muss am Nachmittag liegen';
		}
	}

	// H2: Teacher availability — for couplings, EVERY teacher in the team
	// must be free in every occupied period.
	for (const tid of unit.teacherIds) {
		const teacher = state.teachersById.get(tid);
		if (!teacher) continue;
		for (const p of periodsToOccupy) {
			if (teacher.unavailable.some(u => u.day === day && u.period === p)) {
				return `teacher ${teacher.name} unavailable at ${day} P${p}`;
			}
		}
	}

	// H3 + H4 + H7: scan OTHER placed units for collisions — scoped auf die
	// Kandidaten-Union (Lehrer ∪ Stufen ∪ Coupling-Partner) statt aller
	// nUnits (Runde 2, Schritt 3). Dedup über Generation-Marker, kein
	// Set-Alloc pro Aufruf. Scan-Reihenfolge weicht vom alten Voll-Scan ab
	// → bei mehreren gleichzeitigen Verletzungen kann die Reason-MELDUNG
	// anders ausfallen; die null/nicht-null-Entscheidung ist identisch
	// (Äquivalenztest in hardCheck.test.ts).
	const idx = ensureCheckIndex(state);
	if (idx.gen >= 0x7ffffff0) { idx.seenGen.fill(0); idx.gen = 0; }
	const gen = ++idx.gen;
	const seen = idx.seenGen;

	const uStart = period;
	const uEnd = period + unit.blockSize - 1; // <= P, oben geprüft

	const checkOther = (other: Unit): string | null => {
		if (other === unit) return null;
		if (seen[other.idx] === gen) return null;
		seen[other.idx] = gen;
		if (ignoreUnit && other === ignoreUnit) return null;
		const otherSlot = state.placement[other.idx];
		if (otherSlot === SLOT_UNPLACED) return null;
		// Inline dpFromSlot — das Objekt pro Kandidat war eine der
		// heißesten Allokationen im ganzen Solver.
		if (((otherSlot / P) | 0) !== dayIndex) return null;
		const otherPeriod = (otherSlot % P) + 1;
		// Perioden-Intervalle überlappen? (Block-Schwanz über P hinaus zählt
		// nicht — wie der alte oP>P-Skip.)
		const oEnd = Math.min(otherPeriod + other.blockSize - 1, P);
		if (otherPeriod > uEnd || oEnd < uStart) return null;
		const oP = Math.max(uStart, otherPeriod); // erste überlappende Periode (Meldung)

		// Determine if the two units share couplingId/specIds (allowed parallel)
		const sameCoupling = sharesCoupling(unit, other, state);

		// H3: any shared teacher → conflict unless the two units are coupled
		// (which means they intentionally occupy the same slot).
		if (!sameCoupling) {
			const sharedTeacher = unit.teacherIds.find(tid => other.teacherIds.includes(tid));
			if (sharedTeacher) {
				return `teacher ${sharedTeacher} double-booked at ${day} P${oP}`;
			}
		}

		// H4: overlapping grade columns → conflict unless coupled
		const gradeOverlap = unit.grades.some(g => other.grades.includes(g));
		if (gradeOverlap && !sameCoupling) {
			return `grade ${unit.grades.find(g => other.grades.includes(g))} double-booked at ${day} P${oP}`;
		}

		// H7: week pattern compatibility
		// If both are coupled (same slot), patterns must be compatible.
		if (sameCoupling) {
			if (
				(unit.weekPattern === 'even' && other.weekPattern === 'odd') ||
				(unit.weekPattern === 'odd' && other.weekPattern === 'even')
			) {
				return `incompatible week patterns: ${unit.weekPattern} vs ${other.weekPattern}`;
			}
		}
		return null;
	};

	for (const tid of unit.teacherIds) {
		const list = state.unitsByTeacher.get(tid);
		if (!list) continue;
		for (const other of list) {
			const reason = checkOther(other);
			if (reason !== null) return reason;
		}
	}
	for (const g of unit.grades) {
		const list = idx.unitsByGrade.get(g);
		if (!list) continue;
		for (const other of list) {
			const reason = checkOther(other);
			if (reason !== null) return reason;
		}
	}
	for (const sid of unit.specIds) {
		const cid = state.specsById.get(sid)?.couplingId;
		if (!cid) continue;
		const list = idx.unitsByCoupling.get(cid);
		if (!list) continue;
		for (const other of list) {
			const reason = checkOther(other);
			if (reason !== null) return reason;
		}
	}

	// H8: same spec, different occurrences → must NOT share (day, period).
	for (const sid of unit.specIds) {
		const sameSpecUnits = state.unitsBySpec.get(sid);
		if (!sameSpecUnits) continue;
		for (const other of sameSpecUnits) {
			if (other === unit) continue;
			if (ignoreUnit && other === ignoreUnit) continue;
			const otherSlot = state.placement[other.idx];
			if (otherSlot === SLOT_UNPLACED) continue;
			// Different occurrence = different occurrenceIndex on EVERY shared
			// instance. But if two units of the same spec end up on (same day,
			// same period), they MUST be the same occurrence (which would be a
			// bug — only one Unit per occurrence is generated).
			// Easier rule: spec-mate units cannot share (day, period) at all,
			// because each occurrence is a distinct Unit.
			const otherPeriod = (otherSlot % P) + 1;
			if (((otherSlot / P) | 0) === dayIndex && otherPeriod >= uStart && otherPeriod <= uEnd) {
				// Allow couplings (different specs, same coupling unit)
				if (sharesCoupling(unit, other, state)) continue;
				return `same-spec collision at ${day} P${otherPeriod}`;
			}
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
 * (we don't create such Units).
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

/**
 * Defensive sweep: scan every placed Unit and check whether its current slot
 * would violate hard constraints given the rest of the placement. Returns
 * the indices of any offending Units. Used as a safety net at the end of
 * Construction and after each ILS restart so that a buggy ejection-chain
 * sub-step or a stale pinned cell can never produce a final plan with
 * teacher-double or grade-double bookings.
 *
 * The caller decides what to do with the offenders — typically they are
 * un-placed (set to SLOT_UNPLACED) so the solver re-tries them or the UI
 * lists them as unplaced rather than rendering an impossible schedule.
 */
export function findHardViolations(state: SolverState): number[] {
	const offenders: number[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		// Temporarily un-place the unit so wouldViolate doesn't see it as
		// its own conflict, then re-evaluate against everyone else.
		state.placement[i] = SLOT_UNPLACED;
		const wasPinned = unit.pinned;
		unit.pinned = false;
		const reason = wouldViolate(state, unit, slot);
		unit.pinned = wasPinned;
		state.placement[i] = slot;
		if (reason !== null) offenders.push(i);
	}

	return offenders;
}

void DAY_INDEX;
