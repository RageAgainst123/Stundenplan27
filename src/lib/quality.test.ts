import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher, type GradeLevel, type PlacedLesson } from './types';
import { qualityPercent, scorePlacedPlan } from './quality';

function teacher(id: string, name: string): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable: [] };
}
function subject(code: string, isMain = false): Subject {
	return { code, name: code, category: 'PG', isMain, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
		weekPattern: 'every', count, includeInSolver: true, source: 'manual',
	};
}

describe('qualityPercent (F2-S1, aus GenerateButton extrahiert)', () => {
	it('100 % bei Score 0, monoton fallend, nie negativ', () => {
		expect(qualityPercent(0)).toBe(100);
		expect(qualityPercent(15_000)).toBe(50);
		expect(qualityPercent(10_000)).toBe(60);
		expect(qualityPercent(100_000)).toBeLessThan(15);
		expect(qualityPercent(10_000_000)).toBeGreaterThanOrEqual(0);
		// Negativer Input (sollte nicht vorkommen) → clamp auf 100.
		expect(qualityPercent(-5)).toBe(100);
	});
});

describe('scorePlacedPlan (F2-S1)', () => {
	function sampleDoc() {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'A'), teacher('t2', 'B'));
		doc.subjects.push(subject('M', true), subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 2));
		doc.specs.push(spec('s2', 'D', 't2', [6], 2));
		doc.placed.push(
			{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 's1', day: 'Di', period: 1, grade: 5, pinned: true },
			{ specId: 's2', day: 'Mo', period: 1, grade: 6, pinned: false },
			{ specId: 's2', day: 'Mo', period: 2, grade: 6, pinned: false },
		);
		return doc;
	}

	it('mutiert das Doc nicht und ist für denselben Stand deterministisch', () => {
		const doc = sampleDoc();
		const jsonBefore = JSON.stringify(doc);
		const a = scorePlacedPlan(doc);
		const b = scorePlacedPlan(doc);
		expect(JSON.stringify(doc)).toBe(jsonBefore); // keine Mutation (auch pinned nicht)
		expect(a.total).toBe(b.total);
		expect(a.unplaced).toBe(0); // alle Placements geladen
	});

	it('kandidaten-placed überschreibt doc.placed und ändert den Score messbar', () => {
		const doc = sampleDoc();
		const before = scorePlacedPlan(doc);
		// Kandidat: s2 Mo P2 → Mo P4 reißt eine Klassen-Lücke in Stufe 6 (P3 leer? P1,P4 belegt → P2,P3 Lücken).
		const candidate: PlacedLesson[] = doc.placed.map(p =>
			p.specId === 's2' && p.period === 2 ? { ...p, period: 4 } : { ...p }
		);
		const after = scorePlacedPlan(doc, candidate);
		expect(after.no_free).toBeGreaterThan(before.no_free);
		expect(after.total).toBeGreaterThan(before.total);
	});

	it('identischer Kandidat ⇒ identischer Score (Vergleich ist symmetrisch)', () => {
		const doc = sampleDoc();
		const before = scorePlacedPlan(doc);
		const same = scorePlacedPlan(doc, doc.placed.map(p => ({ ...p })));
		expect(same.total).toBe(before.total);
	});
});
