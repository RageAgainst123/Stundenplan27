// Äquivalenz-Gate für Runde 2, Schritt 3 (scoped Hard-Checks).
//
// wouldViolate scannt seit Schritt 3 nur noch die Kandidaten-Union
// (Lehrer ∪ Stufen ∪ Coupling-Partner) statt aller nUnits. Dieser Test
// beweist auf Random-States, dass die null/nicht-null-Entscheidung
// identisch zum alten Voll-Scan bleibt (die Reason-STRINGS dürfen wegen
// anderer Scan-Reihenfolge abweichen — Callers prüfen nur Null-heit).
//
// Die Referenz-Implementierung unten ist eine 1:1-Kopie des Voll-Scans
// vor Schritt 3 (git: hardCheck.ts @ 760c6c8) — bewusst im Test dupliziert,
// damit es keinen toten Produktions-Code gibt.

import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type GradeLevel, type LessonSpec, type Period, type Subject, type Teacher } from '../types';
import { buildState } from './units';
import { Rng } from './moves';
import { wouldViolate } from './hardCheck';
import { D, DAYS_BY_INDEX, P, dpFromSlot, SLOT_UNPLACED, slotFromDP, type SolverState, type Unit } from './types';

function teacher(id: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name: id, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, teachers: string[], grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers, classes: ['1a'], grades,
		weekPattern: 'every', count, includeInSolver: true, source: 'manual', ...opts,
	};
}

/** Referenz: Voll-Scan-wouldViolate (Stand vor Schritt 3). */
function wouldViolateRef(
	state: SolverState,
	unit: Unit,
	slot: number,
	ignoreUnit?: Unit
): string | null {
	if (unit.pinned) return 'unit is pinned';
	const { dayIndex, period } = dpFromSlot(slot);
	const day = DAYS_BY_INDEX[dayIndex];
	const periodsToOccupy: number[] = [];
	for (let pos = 0; pos < unit.blockSize; pos++) {
		const p = period + pos;
		if (p > P) return 'block extends past last period';
		periodsToOccupy.push(p);
	}
	const afternoonStart = Math.max(1, Math.min(P, Math.round(
		state.doc.constraints.noMainSubjectAfternoon?.afternoonStartsAtPeriod ?? 7
	)));
	if (unit.afternoonAllowed === 'never') {
		for (const p of periodsToOccupy) {
			if (p >= afternoonStart) return 'H10';
		}
	}
	if (unit.afternoonAllowed === 'must') {
		for (const p of periodsToOccupy) {
			if (p < afternoonStart) return 'H11';
		}
	}
	for (const tid of unit.teacherIds) {
		const t = state.teachersById.get(tid);
		if (!t) continue;
		for (const p of periodsToOccupy) {
			if (t.unavailable.some(u => u.day === day && u.period === p)) {
				return 'teacher unavailable';
			}
		}
	}
	const sharesCoupling = (a: Unit, b: Unit): boolean => {
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
	};
	for (let i = 0; i < state.nUnits; i++) {
		const otherSlot = state.placement[i];
		if (otherSlot === SLOT_UNPLACED) continue;
		const other = state.units[i];
		if (other === unit) continue;
		if (ignoreUnit && other === ignoreUnit) continue;
		const otherDp = dpFromSlot(otherSlot);
		for (let oPos = 0; oPos < other.blockSize; oPos++) {
			const oP = otherDp.period + oPos;
			if (oP > P) continue;
			if (otherDp.dayIndex !== dayIndex) continue;
			if (!periodsToOccupy.includes(oP)) continue;
			const sameCoupling = sharesCoupling(unit, other);
			if (!sameCoupling) {
				const sharedTeacher = unit.teacherIds.find(tid => other.teacherIds.includes(tid));
				if (sharedTeacher) return 'teacher double';
			}
			const gradeOverlap = unit.grades.some(g => other.grades.includes(g));
			if (gradeOverlap && !sameCoupling) return 'grade double';
			if (sameCoupling) {
				if (
					(unit.weekPattern === 'even' && other.weekPattern === 'odd') ||
					(unit.weekPattern === 'odd' && other.weekPattern === 'even')
				) {
					return 'incompatible week patterns';
				}
			}
		}
	}
	const sameSpecUnits = unit.specIds.flatMap(sid => state.unitsBySpec.get(sid) ?? []);
	for (const other of sameSpecUnits) {
		if (other === unit) continue;
		if (ignoreUnit && other === ignoreUnit) continue;
		const otherSlot = state.placement[other.idx];
		if (otherSlot === SLOT_UNPLACED) continue;
		const otherDp = dpFromSlot(otherSlot);
		if (otherDp.dayIndex === dayIndex && periodsToOccupy.includes(otherDp.period)) {
			if (sharesCoupling(unit, other)) continue;
			return 'same-spec collision';
		}
	}
	return null;
}

/** Zufälliger, vielfältiger Doc: Kopplungen, Blöcke, Multi-Grade, G/U, Sperren. */
function randomState(rng: Rng): SolverState {
	const doc = emptyDoc();
	const nTeachers = 3 + rng.int(0, 3);
	for (let t = 0; t < nTeachers; t++) {
		const unavailable: { day: Day; period: Period }[] = [];
		for (let k = 0; k < rng.int(0, 4); k++) {
			unavailable.push({
				day: DAYS_BY_INDEX[rng.int(0, D)],
				period: (rng.int(0, P) + 1) as Period,
			});
		}
		doc.teachers.push(teacher(`t${t}`, unavailable));
	}
	const codes = ['M', 'D', 'E', 'BSP', 'REL', 'PH'];
	for (const c of codes) doc.subjects.push(subject(c));
	const nSpecs = 6 + rng.int(0, 6);
	for (let s = 0; s < nSpecs; s++) {
		const gradePick = rng.int(0, 4);
		const grades: GradeLevel[] =
			gradePick === 3 ? [5, 6] : gradePick === 2 ? [7, 8] : [((rng.int(0, 4) + 5) as GradeLevel)];
		const blocks = rng.int(0, 4) === 0 ? [2] : undefined;
		const weekPattern = (['every', 'every', 'even', 'odd'] as const)[rng.int(0, 4)];
		doc.specs.push(spec(`s${s}`, codes[rng.int(0, codes.length)], [`t${rng.int(0, nTeachers)}`],
			grades, blocks ? 2 : 1 + rng.int(0, 2), {
				blocks,
				weekPattern,
				couplingId: rng.int(0, 5) === 0 ? `c${rng.int(0, 2)}` : undefined,
			}));
	}
	const state = buildState(doc);
	// Zufällige (teils absichtlich konfliktbehaftete!) Platzierung — die
	// Checks müssen auch auf inkonsistenten Zwischenständen äquivalent sein.
	for (let i = 0; i < state.nUnits; i++) {
		if (rng.int(0, 5) === 0) continue; // manche unplaced lassen
		state.placement[i] = rng.int(0, D * P);
	}
	return state;
}

describe('wouldViolate scoped == Voll-Scan-Referenz', () => {
	it('500 Random-States × zufällige (Unit, Slot, ignoreUnit)-Proben', () => {
		const rng = new Rng(0xbeef);
		let checked = 0;
		let violations = 0;
		for (let round = 0; round < 500; round++) {
			const state = randomState(rng);
			if (state.nUnits === 0) continue;
			for (let probe = 0; probe < 8; probe++) {
				const unit = state.units[rng.int(0, state.nUnits)];
				const slot = rng.int(0, D * P);
				const ignore = rng.int(0, 3) === 0
					? state.units[rng.int(0, state.nUnits)]
					: undefined;
				const scoped = wouldViolate(state, unit, slot, ignore);
				const ref = wouldViolateRef(state, unit, slot, ignore);
				checked++;
				if (ref !== null) violations++;
				// Entscheidung (null vs nicht-null) muss identisch sein.
				expect(scoped === null, `Runde ${round} Probe ${probe}: scoped=${scoped} ref=${ref}`)
					.toBe(ref === null);
			}
		}
		// Sanity: der Test muss BEIDE Ausgänge tatsächlich ausüben.
		expect(checked).toBeGreaterThan(3000);
		expect(violations).toBeGreaterThan(100);
		expect(violations).toBeLessThan(checked);
	});
});
