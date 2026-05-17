// Phase 17: Tests für teachingSegments — Validierung + Solver-Expansion.
//
// Diese Tests prüfen sowohl die reine Validierungs-Funktion in types.ts
// als auch die Wirkung auf den Solver (units.ts expandSegmentedSpecs).

import { describe, it, expect } from 'vitest';
import {
	emptyDoc,
	validateTeachingSegments,
	type LessonSpec,
	type Teacher,
	type Subject
} from './types';
import { buildState } from './solver-v2/units';

function teacher(id: string, name: string, shortNumber: number = 1): Teacher {
	return {
		id,
		name,
		shortNumber,
		color: '#ff0000',
		subjects: ['M'],
		unavailable: []
	};
}

function subject(code: string, isMain: boolean = false): Subject {
	return {
		code,
		name: code,
		category: 'PG',
		isMain,
		hoursPerWeek: {},
		maxConsecutive: isMain ? 2 : 99
	};
}

function spec(opts: Partial<LessonSpec> & {
	id: string;
	subject: string;
	teachers: string[];
	count: number;
}): LessonSpec {
	return {
		grades: [5],
		classes: ['1a'],
		weekPattern: 'every',
		includeInSolver: true,
		source: 'manual',
		afternoonAllowed: 'allowed',
		...opts
	};
}

describe('validateTeachingSegments', () => {
	it('ohne Segmente → kein Fehler', () => {
		const s = spec({ id: 's1', subject: 'M', teachers: ['A'], count: 4 });
		expect(validateTeachingSegments(s)).toEqual([]);
	});

	it('Summe == count → OK', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
			teachingSegments: [
				{ hours: 2, teachers: ['A', 'B'] },
				{ hours: 2, teachers: ['A'] }
			]
		});
		expect(validateTeachingSegments(s)).toEqual([]);
	});

	it('Summe != count → Fehler', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
			teachingSegments: [
				{ hours: 2, teachers: ['A', 'B'] },
				{ hours: 1, teachers: ['A'] }
			]
		});
		const errs = validateTeachingSegments(s);
		expect(errs.length).toBeGreaterThan(0);
		expect(errs[0]).toContain('Segmente-Summe');
	});

	it('Lehrer nicht in Spec-Team → Fehler', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A'], count: 4,
			teachingSegments: [{ hours: 4, teachers: ['A', 'XXX'] }]
		});
		const errs = validateTeachingSegments(s);
		expect(errs.length).toBeGreaterThan(0);
		expect(errs.some(e => e.includes('nicht im Spec-Team'))).toBe(true);
	});

	it('leeres Lehrer-Array → Fehler', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A'], count: 4,
			teachingSegments: [{ hours: 4, teachers: [] }]
		});
		expect(validateTeachingSegments(s)[0]).toContain('kein Lehrer');
	});

	it('hours <= 0 → Fehler', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A'], count: 4,
			teachingSegments: [{ hours: 0, teachers: ['A'] }]
		});
		expect(validateTeachingSegments(s).some(e => e.includes('> 0'))).toBe(true);
	});

	it('Halbzahlige Stunden mit Toleranz akzeptiert', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
			teachingSegments: [
				{ hours: 2.5, teachers: ['A', 'B'] },
				{ hours: 1.5, teachers: ['A'] }
			]
		});
		expect(validateTeachingSegments(s)).toEqual([]);
	});

	it('3 Lehrer in einem Segment → OK', () => {
		const s = spec({
			id: 's1', subject: 'M', teachers: ['A', 'B', 'C'], count: 4,
			teachingSegments: [
				{ hours: 2, teachers: ['A', 'B', 'C'] },
				{ hours: 1, teachers: ['A', 'C'] },
				{ hours: 1, teachers: ['A'] }
			]
		});
		expect(validateTeachingSegments(s)).toEqual([]);
	});
});

describe('buildState — teachingSegments-Expansion im Solver', () => {
	function setupDoc(specs: LessonSpec[]) {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('A', 'LehrerA', 1),
			teacher('B', 'LehrerB', 2),
			teacher('C', 'LehrerC', 3)
		];
		doc.subjects = [subject('M', true)];
		doc.specs = specs;
		return doc;
	}

	it('Spec OHNE Segmente: 1 Unit pro count-Stunde wie vor Phase 17', () => {
		const doc = setupDoc([
			spec({ id: 's1', subject: 'M', teachers: ['A'], count: 4 })
		]);
		const state = buildState(doc);
		// 4 Single-Units (blocks=undefined → auto = [1,1,1,1])
		expect(state.nUnits).toBe(4);
		for (const u of state.units) {
			expect(u.teacherIds).toEqual(['A']);
			expect(u.subjectCode).toBe('M');
		}
	});

	it('Spec MIT Segmenten: 2+2 Stunden = 4 Units, 2 mit Team [A,B], 2 mit [A]', () => {
		const doc = setupDoc([
			spec({
				id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
				teachingSegments: [
					{ hours: 2, teachers: ['A', 'B'] },
					{ hours: 2, teachers: ['A'] }
				]
			})
		]);
		const state = buildState(doc);
		expect(state.nUnits).toBe(4); // 4 Solo-Units, 2 pro Segment

		const withB = state.units.filter(u => u.teacherIds.includes('B'));
		const withoutB = state.units.filter(u => !u.teacherIds.includes('B'));
		expect(withB.length).toBe(2);
		expect(withoutB.length).toBe(2);
		// Alle Units gehören zur gleichen Spec → spec.id muss überall passen
		for (const u of state.units) {
			expect(u.specIds).toEqual(['s1']);
			expect(u.teacherIds).toContain('A');
		}
	});

	it('3 Lehrer mit 3 Segmenten: korrekte Team-Verteilung', () => {
		const doc = setupDoc([
			spec({
				id: 's1', subject: 'M', teachers: ['A', 'B', 'C'], count: 4,
				teachingSegments: [
					{ hours: 2, teachers: ['A', 'B', 'C'] },  // alle drei
					{ hours: 1, teachers: ['A', 'C'] },         // A + C
					{ hours: 1, teachers: ['A'] }                // A allein
				]
			})
		]);
		const state = buildState(doc);
		expect(state.nUnits).toBe(4);
		// 2 Units mit 3 Lehrern, 1 Unit mit 2 Lehrern, 1 Unit mit 1 Lehrer
		const tripleTeam = state.units.filter(u => u.teacherIds.length === 3);
		const doubleTeam = state.units.filter(u => u.teacherIds.length === 2);
		const singleTeam = state.units.filter(u => u.teacherIds.length === 1);
		expect(tripleTeam.length).toBe(2);
		expect(doubleTeam.length).toBe(1);
		expect(singleTeam.length).toBe(1);
		expect(singleTeam[0].teacherIds).toEqual(['A']);
		expect(doubleTeam[0].teacherIds.sort()).toEqual(['A', 'C']);
	});

	it('Kaputter Split (Summe stimmt nicht) → Fallback auf 1-Unit-Spec', () => {
		const doc = setupDoc([
			spec({
				id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
				teachingSegments: [
					{ hours: 2, teachers: ['A', 'B'] },
					{ hours: 1, teachers: ['A'] }  // ← 2+1=3 ≠ 4
				]
			})
		]);
		const state = buildState(doc);
		// Fallback: Spec wird wie vor Phase 17 behandelt (count=4 mit beiden Lehrern)
		expect(state.nUnits).toBe(4); // 4 Solo-Units der Original-Spec
		for (const u of state.units) {
			expect(u.teacherIds.sort()).toEqual(['A', 'B']);
		}
	});

	it('Segment mit unbekanntem Lehrer → Fallback auf 1-Unit-Spec', () => {
		const doc = setupDoc([
			spec({
				id: 's1', subject: 'M', teachers: ['A'], count: 4,
				teachingSegments: [{ hours: 4, teachers: ['A', 'GHOST'] }]
			})
		]);
		const state = buildState(doc);
		// Fallback ohne Crash
		expect(state.nUnits).toBe(4);
	});

	it('Spec mit Segmenten zählt korrekt in unitsBySpec', () => {
		const doc = setupDoc([
			spec({
				id: 's1', subject: 'M', teachers: ['A', 'B'], count: 4,
				teachingSegments: [
					{ hours: 2, teachers: ['A', 'B'] },
					{ hours: 2, teachers: ['A'] }
				]
			})
		]);
		const state = buildState(doc);
		// Alle 4 Units gehören zu spec s1
		expect(state.unitsBySpec.get('s1')?.length).toBe(4);
	});

	it('Specs mit + ohne Segmente können koexistieren', () => {
		const doc = setupDoc([
			spec({ id: 's1', subject: 'M', teachers: ['A'], count: 2 }),
			spec({
				id: 's2', subject: 'M', teachers: ['B', 'C'], count: 4, grades: [6], classes: ['1a'],
				teachingSegments: [
					{ hours: 2, teachers: ['B', 'C'] },
					{ hours: 2, teachers: ['B'] }
				]
			})
		]);
		const state = buildState(doc);
		expect(state.nUnits).toBe(6); // 2 + 4
		expect(state.unitsBySpec.get('s1')?.length).toBe(2);
		expect(state.unitsBySpec.get('s2')?.length).toBe(4);
	});
});
