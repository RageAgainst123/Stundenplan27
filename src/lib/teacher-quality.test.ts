import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { computeTeacherQuality } from './teacher-quality';

function teacher(id: string, name: string, sn: number): Teacher {
	return { id, name, shortNumber: sn, color: '#f00', subjects: [], unavailable: [] };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(o: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return { classes: ['1a'], weekPattern: 'every', includeInSolver: true, source: 'manual', afternoonAllowed: 'allowed', ...o };
}

describe('computeTeacherQuality', () => {
	it('leerer Plan → leere Liste', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'A', 1)];
		expect(computeTeacherQuality(doc)).toEqual([]);
	});

	it('zählt Lücken, Anwesenheitstage und Mini-Tage korrekt', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'A', 1)];
		doc.subjects = [subject('M')];
		doc.specs = [spec({ id: 's', subject: 'M', teachers: ['t1'], count: 4, grades: [5] })];
		doc.placed = [
			// Mo: P1 + P3 → 1 Lücke
			{ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 's', day: 'Mo', period: 3, grade: 5, pinned: false },
			// Di: P2 → Mini-Tag, Späteinstieg 1
			{ specId: 's', day: 'Di', period: 2, grade: 5, pinned: false },
			// Mi: P1 → Mini-Tag
			{ specId: 's', day: 'Mi', period: 1, grade: 5, pinned: false },
		];
		const rows = computeTeacherQuality(doc);
		expect(rows).toHaveLength(1);
		const r = rows[0];
		expect(r.weekLessons).toBe(4);
		expect(r.daysPresent).toBe(3);
		expect(r.idealDays).toBe(1); // ceil(4/6)
		expect(r.gaps).toBe(1);
		expect(r.worstDayGaps).toBe(1);
		expect(r.miniDays).toBe(2);
		expect(r.lateStarts).toBe(1); // Di startet P2 → firstP-Index 1
		expect(r.periodsByDay.Mo).toEqual([1, 3]);
	});

	it('Multi-Grade-Placements werden pro Slot dedupliziert', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'A', 1)];
		doc.subjects = [subject('REL')];
		doc.specs = [spec({ id: 's', subject: 'REL', teachers: ['t1'], count: 1, grades: [5, 6] })];
		// Multi-Grade: 2 PlacedLessons für DENSELBEN Slot (eine pro Stufe)
		doc.placed = [
			{ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 's', day: 'Mo', period: 1, grade: 6, pinned: false },
		];
		const rows = computeTeacherQuality(doc);
		expect(rows[0].weekLessons).toBe(1); // NICHT 2
	});

	it('Team-Teaching: effektive Lehrer aus PlacedLesson.teachers', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'A', 1), teacher('t2', 'B', 2)];
		doc.subjects = [subject('M')];
		doc.specs = [spec({
			id: 's', subject: 'M', teachers: ['t1', 't2'], count: 2, grades: [5],
			teachingSegments: [
				{ hours: 1, teachers: ['t1', 't2'] },
				{ hours: 1, teachers: ['t1'] },
			],
		})];
		doc.placed = [
			{ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false, teachers: ['t1', 't2'] },
			{ specId: 's', day: 'Di', period: 1, grade: 5, pinned: false, teachers: ['t1'] },
		];
		const rows = computeTeacherQuality(doc);
		const a = rows.find(r => r.teacherId === 't1')!;
		const b = rows.find(r => r.teacherId === 't2')!;
		expect(a.weekLessons).toBe(2);
		expect(b.weekLessons).toBe(1); // t2 nur im Segment-Slot
	});

	it('fehlende Mittagspause wird erkannt', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'A', 1)];
		doc.subjects = [subject('M')];
		doc.specs = [spec({ id: 's', subject: 'M', teachers: ['t1'], count: 6, grades: [5] })];
		doc.placed = ([1, 2, 5, 6, 7, 8] as const).map(p => ({
			specId: 's', day: 'Mo' as const, period: p, grade: 5 as const, pinned: false,
		}));
		const rows = computeTeacherQuality(doc);
		expect(rows[0].missedLunch).toBe(1);
	});

	it('sortiert schlechtesten Lehrer zuerst (meiste Lücken)', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('t1', 'Gut', 1), teacher('t2', 'Schlecht', 2)];
		doc.subjects = [subject('M')];
		doc.specs = [
			spec({ id: 'a', subject: 'M', teachers: ['t1'], count: 2, grades: [5] }),
			spec({ id: 'b', subject: 'M', teachers: ['t2'], count: 2, grades: [6] }),
		];
		doc.placed = [
			// t1: kompakt
			{ specId: 'a', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'a', day: 'Mo', period: 2, grade: 5, pinned: false },
			// t2: P1 + P4 → 2 Lücken
			{ specId: 'b', day: 'Mo', period: 1, grade: 6, pinned: false },
			{ specId: 'b', day: 'Mo', period: 4, grade: 6, pinned: false },
		];
		const rows = computeTeacherQuality(doc);
		expect(rows[0].name).toBe('Schlecht');
		expect(rows[0].gaps).toBe(2);
		expect(rows[1].name).toBe('Gut');
	});
});
