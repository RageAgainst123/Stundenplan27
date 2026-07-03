import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type GradeLevel, type LessonSpec, type Period, type Subject, type Teacher } from '../types';
import { buildState } from './units';
import { Rng } from './moves';
import { slotFromDP } from './types';
import { pickDiversifyResetUnits } from './lnsDestroy';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
		weekPattern: 'every', count, includeInSolver: true, source: 'manual', ...opts,
	};
}

/**
 * Setup: t1 hat eine Springstunde (Mo P1 + Mo P3, Stufe 5),
 * t2 ist kompakt (Di P1 + Di P2, Stufe 6).
 * → worst-teacher muss t1-Units wählen; related-day den (Mo, 5)-Streifen
 *   (einziger mit Klassen-Lücke).
 */
function gapSetup() {
	const doc = emptyDoc();
	doc.teachers.push(teacher('t1', 'Lückig'), teacher('t2', 'Kompakt'));
	doc.subjects.push(subject('M'), subject('D'), subject('E'), subject('PH'));
	doc.specs.push(
		spec('s1', 'M', 't1', [5], 1),
		spec('s2', 'D', 't1', [5], 1),
		spec('s3', 'E', 't2', [6], 1),
		spec('s4', 'PH', 't2', [6], 1),
	);
	const state = buildState(doc);
	// Units sind in Spec-Reihenfolge: idx 0..3 ↔ s1..s4.
	state.placement[0] = slotFromDP(0, 1); // t1 Mo P1
	state.placement[1] = slotFromDP(0, 3); // t1 Mo P3 → Lücke P2 (Lehrer UND Stufe 5)
	state.placement[2] = slotFromDP(1, 1); // t2 Di P1
	state.placement[3] = slotFromDP(1, 2); // t2 Di P2
	return state;
}

describe('pickDiversifyResetUnits', () => {
	it('random: wählt Ziel-Anzahl bewegliche Units, deterministisch per Seed', () => {
		const state = gapSetup();
		const a = pickDiversifyResetUnits(state, 0.5, 'random', new Rng(42));
		const b = pickDiversifyResetUnits(state, 0.5, 'random', new Rng(42));
		expect(a).toEqual(b);
		expect(a).toHaveLength(2); // floor(4 * 0.5)
		for (const idx of a) expect(state.units[idx].pinned).toBe(false);
	});

	it('worst-teacher: wählt die Units des Lehrers mit den meisten Wochen-Lücken', () => {
		const state = gapSetup();
		const chosen = pickDiversifyResetUnits(state, 0.5, 'worst-teacher', new Rng(7));
		// t1 (idx 0+1) hat die einzige Springstunde → beide Seeds sind seine Units.
		expect(chosen.sort()).toEqual([0, 1]);
	});

	it('related-day: wählt den (Tag, Stufe)-Streifen mit Klassen-Lücke', () => {
		const state = gapSetup();
		const chosen = pickDiversifyResetUnits(state, 0.5, 'related-day', new Rng(7));
		// Einziger Streifen mit Lücke: Mo/Stufe 5 → Units 0+1.
		expect(chosen.sort()).toEqual([0, 1]);
	});

	it('worst-teacher ohne Lücken: fällt auf Random-Auffüllung zurück', () => {
		const state = gapSetup();
		// Lücke schließen: Unit 1 von Mo P3 auf Mo P2.
		state.placement[1] = slotFromDP(0, 2);
		const chosen = pickDiversifyResetUnits(state, 0.5, 'worst-teacher', new Rng(7));
		expect(chosen).toHaveLength(2); // Ziel-Anzahl trotzdem erreicht
	});

	it('gepinnte und unplatzierte Units werden nie gewählt', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1), spec('s2', 'M', 't1', [5], 1));
		doc.placed.push({ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: true });
		const state = buildState(doc);
		// s2-Unit bleibt unplatziert (SLOT_UNPLACED), s1 ist gepinnt.
		for (const strategy of ['random', 'worst-teacher', 'related-day'] as const) {
			expect(pickDiversifyResetUnits(state, 0.5, strategy, new Rng(1))).toEqual([]);
		}
	});

	it('leerer Plan → leere Auswahl', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1));
		const state = buildState(doc); // nichts platziert
		expect(pickDiversifyResetUnits(state, 0.3, 'random', new Rng(1))).toEqual([]);
	});
});
