import { describe, it, expect } from 'vitest';
import { emptyDoc, type ScheduleDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { findPlanConflicts, removeConflictedPlacements } from './plan-validation';

function teacher(id: string, name: string): Teacher {
	return { id, name, shortNumber: 1, color: '#f00', subjects: [], unavailable: [] };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(opts: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number }): LessonSpec {
	return {
		grades: [5], classes: ['1'], weekPattern: 'every', includeInSolver: true,
		source: 'manual', afternoonAllowed: 'allowed', ...opts
	};
}

function setupDoc(): ScheduleDoc {
	const doc = emptyDoc();
	doc.teachers = [teacher('L4', 'L4'), teacher('L11', 'L11')];
	doc.subjects = [subject('M'), subject('GPB')];
	return doc;
}

describe('findPlanConflicts', () => {
	it('Leerer Plan → keine Konflikte', () => {
		const doc = setupDoc();
		expect(findPlanConflicts(doc)).toEqual([]);
	});

	it('Lehrer-Doppelbelegung im selben Slot → Konflikt', () => {
		const doc = setupDoc();
		doc.specs = [
			spec({ id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6] }),
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] })
		];
		// Beide auf Mo P2 — L11 doppelt
		doc.placed = [
			{ specId: 'm6', day: 'Mo', period: 2, grade: 6, pinned: false },
			{ specId: 'gpb8', day: 'Mo', period: 2, grade: 8, pinned: false }
		];
		const c = findPlanConflicts(doc);
		expect(c.length).toBeGreaterThan(0);
		expect(c[0].reason).toBe('teacher-double');
		expect(c[0].teacherId).toBe('L11');
	});

	it('Gekoppelte Specs im gleichen Slot → KEIN Konflikt (erlaubtes parallel teaching)', () => {
		const doc = setupDoc();
		doc.specs = [
			spec({ id: 'bspK', subject: 'M', teachers: ['L4'], count: 4, grades: [5], couplingId: 'cpl1' }),
			spec({ id: 'bspM', subject: 'M', teachers: ['L11'], count: 4, grades: [5], couplingId: 'cpl1' })
		];
		doc.placed = [
			{ specId: 'bspK', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'bspM', day: 'Mo', period: 1, grade: 5, pinned: false }
		];
		// Andere Lehrer, gleiche couplingId → erlaubt
		expect(findPlanConflicts(doc)).toEqual([]);
	});

	it('Stufen-Doppelbelegung erkannt', () => {
		const doc = setupDoc();
		doc.specs = [
			spec({ id: 'a', subject: 'M', teachers: ['L4'], count: 1, grades: [5] }),
			spec({ id: 'b', subject: 'GPB', teachers: ['L11'], count: 1, grades: [5] })
		];
		doc.placed = [
			{ specId: 'a', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'b', day: 'Mo', period: 1, grade: 5, pinned: false }
		];
		const c = findPlanConflicts(doc);
		expect(c.some(x => x.reason === 'grade-double')).toBe(true);
	});
});

describe('removeConflictedPlacements', () => {
	it('Entfernt nicht-pinned konfliktverursachende Placements', () => {
		const doc = setupDoc();
		doc.specs = [
			spec({ id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6] }),
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] })
		];
		doc.placed = [
			{ specId: 'm6', day: 'Mo', period: 2, grade: 6, pinned: false },
			{ specId: 'gpb8', day: 'Mo', period: 2, grade: 8, pinned: false }
		];
		const conflicts = findPlanConflicts(doc);
		const removed = removeConflictedPlacements(doc, conflicts);
		expect(removed).toBe(2);
		expect(doc.placed.length).toBe(0);
	});

	it('Pinned Placements bleiben (User-Entscheidung)', () => {
		const doc = setupDoc();
		doc.specs = [
			spec({ id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6] }),
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] })
		];
		doc.placed = [
			{ specId: 'm6', day: 'Mo', period: 2, grade: 6, pinned: true },  // pinned!
			{ specId: 'gpb8', day: 'Mo', period: 2, grade: 8, pinned: false }
		];
		const conflicts = findPlanConflicts(doc);
		const removed = removeConflictedPlacements(doc, conflicts);
		expect(removed).toBe(1);
		expect(doc.placed.length).toBe(1);
		expect(doc.placed[0].specId).toBe('m6'); // pinned bleibt
	});
});
