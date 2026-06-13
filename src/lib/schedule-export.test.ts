import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { buildScheduleExport } from './schedule-export';

function teacher(id: string, name: string, sn: number, color = '#f00'): Teacher {
	return { id, name, shortNumber: sn, color, subjects: [], unavailable: [] };
}
function subject(code: string, name: string, isMain = false): Subject {
	return { code, name, category: 'PG', isMain, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(o: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return { classes:['1a'], weekPattern:'every', includeInSolver:true, source:'manual', afternoonAllowed:'allowed', ...o };
}

describe('buildScheduleExport', () => {
	it('leerer Plan → leere placements aber Metadaten vorhanden', () => {
		const doc = emptyDoc();
		const e = buildScheduleExport(doc);
		expect(e.placements).toEqual([]);
		expect(e.stats.totalPlacements).toBe(0);
		expect(e.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('einfaches Placement: subject, subjectName, Lehrer-Farbe sind aufgelöst', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'Müller', 1, '#abc')];
		doc.subjects = [subject('D', 'Deutsch', true)];
		doc.specs = [spec({ id: 'd5', subject: 'D', teachers: ['L1'], count: 4, grades: [5] })];
		doc.placed = [
			{ specId: 'd5', day: 'Mo', period: 1, grade: 5, pinned: true }
		];
		const e = buildScheduleExport(doc);
		expect(e.placements).toHaveLength(1);
		const p = e.placements[0];
		expect(p.subject).toBe('D');
		expect(p.subjectName).toBe('Deutsch');
		expect(p.teachers).toEqual([{ id: 'L1', name: 'Müller', color: '#abc', shortNumber: 1 }]);
		expect(p.pinned).toBe(true);
		expect(p.isTeamTeaching).toBe(false);
	});

	it('Team-Teaching ohne Segmente: alle Lehrer der Spec im Slot', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1), teacher('L2', 'B', 2)];
		doc.subjects = [subject('M', 'Mathematik', true)];
		doc.specs = [spec({ id: 'm', subject: 'M', teachers: ['L1', 'L2'], count: 4, grades: [5] })];
		doc.placed = [
			{ specId: 'm', day: 'Mo', period: 1, grade: 5, pinned: false }
		];
		const e = buildScheduleExport(doc);
		expect(e.placements[0].teachers.length).toBe(2);
		expect(e.placements[0].teacherCount).toBe(2);
		expect(e.placements[0].isTeamTeaching).toBe(false); // keine Segmente
	});

	it('Team-Teaching mit Segmenten: pro Slot effektive Lehrer aus PlacedLesson.teachers', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1), teacher('L2', 'B', 2), teacher('L3', 'C', 3)];
		doc.subjects = [subject('M', 'Mathematik')];
		doc.specs = [spec({
			id: 'm', subject: 'M', teachers: ['L1', 'L2', 'L3'], count: 4, grades: [5],
			teachingSegments: [
				{ hours: 2, teachers: ['L1', 'L2', 'L3'] },
				{ hours: 2, teachers: ['L1'] }
			]
		})];
		// Ein Slot mit allen 3, ein Slot nur mit L1
		doc.placed = [
			{ specId: 'm', day: 'Mo', period: 1, grade: 5, pinned: false, teachers: ['L1', 'L2', 'L3'] },
			{ specId: 'm', day: 'Di', period: 1, grade: 5, pinned: false, teachers: ['L1'] }
		];
		const e = buildScheduleExport(doc);
		expect(e.placements).toHaveLength(2);
		const monday = e.placements.find(p => p.day === 'Mo')!;
		const tuesday = e.placements.find(p => p.day === 'Di')!;
		expect(monday.teachers.map(t => t.id).sort()).toEqual(['L1', 'L2', 'L3']);
		expect(tuesday.teachers.map(t => t.id)).toEqual(['L1']);
		// Beide markiert als Team-Teaching weil Spec Segmente hat
		expect(monday.isTeamTeaching).toBe(true);
		expect(tuesday.isTeamTeaching).toBe(true);
		expect(e.stats.teamTeachingSlots).toBe(2);
	});

	it('byDay denormalisiert: Tag → Stunde → Stufe → Placement[]', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1)];
		doc.subjects = [subject('D', 'Deutsch')];
		doc.specs = [spec({ id: 'd', subject: 'D', teachers: ['L1'], count: 2, grades: [5] })];
		doc.placed = [
			{ specId: 'd', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'd', day: 'Mi', period: 3, grade: 5, pinned: false }
		];
		const e = buildScheduleExport(doc);
		expect(e.byDay.Mo[1][5]).toHaveLength(1);
		expect(e.byDay.Mo[1][5][0].subject).toBe('D');
		expect(e.byDay.Mi[3][5]).toHaveLength(1);
		// Nicht-belegte Slots sind nicht im byDay (undefined)
		expect(e.byDay.Mo[2]).toBeUndefined();
		expect(e.byDay.Fr[1]).toBeUndefined();
	});

	it('teachers[]: nur aktiv platzierte Lehrer, sortiert nach shortNumber', () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L1', 'Anna', 3),
			teacher('L2', 'Bob', 1),
			teacher('L3', 'Carl', 2) // nicht platziert
		];
		doc.subjects = [subject('M', 'Mathe')];
		doc.specs = [
			spec({ id: 'm1', subject: 'M', teachers: ['L1'], count: 1, grades: [5] }),
			spec({ id: 'm2', subject: 'M', teachers: ['L2'], count: 1, grades: [6] })
		];
		doc.placed = [
			{ specId: 'm1', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'm2', day: 'Mo', period: 2, grade: 6, pinned: false }
		];
		const e = buildScheduleExport(doc);
		// Nur L1 und L2, sortiert nach shortNumber (Bob=1 zuerst, Anna=3)
		expect(e.teachers.map(t => t.name)).toEqual(['Bob', 'Anna']);
		expect(e.teachers.find(t => t.id === 'L3')).toBeUndefined();
	});

	it('Placements sortiert nach Tag, Stunde, Stufe', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1)];
		doc.subjects = [subject('D', 'D')];
		doc.specs = [spec({ id: 'd', subject: 'D', teachers: ['L1'], count: 4, grades: [5, 6, 7, 8] })];
		doc.placed = [
			{ specId: 'd', day: 'Fr', period: 5, grade: 8, pinned: false },
			{ specId: 'd', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'd', day: 'Mi', period: 3, grade: 6, pinned: false }
		];
		const e = buildScheduleExport(doc);
		expect(e.placements.map(p => p.day)).toEqual(['Mo', 'Mi', 'Fr']);
	});

	it('Stats: pinned + team-teaching korrekt gezählt', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1), teacher('L2', 'B', 2)];
		doc.subjects = [subject('M', 'M')];
		doc.specs = [
			spec({ id: 'm1', subject: 'M', teachers: ['L1', 'L2'], count: 2, grades: [5],
				teachingSegments: [{ hours: 2, teachers: ['L1', 'L2'] }] }),
			spec({ id: 'm2', subject: 'M', teachers: ['L1'], count: 2, grades: [6] })
		];
		doc.placed = [
			{ specId: 'm1', day: 'Mo', period: 1, grade: 5, pinned: true, teachers: ['L1', 'L2'] },
			{ specId: 'm1', day: 'Di', period: 1, grade: 5, pinned: false, teachers: ['L1', 'L2'] },
			{ specId: 'm2', day: 'Mo', period: 2, grade: 6, pinned: true }
		];
		const e = buildScheduleExport(doc);
		expect(e.stats.totalPlacements).toBe(3);
		expect(e.stats.pinnedPlacements).toBe(2);
		expect(e.stats.teamTeachingSlots).toBe(2); // beide m1-Slots
		expect(e.stats.teachingSlots).toBe(3);
	});

	it('Placement mit fehlender Spec-ID → wird übersprungen (defensiv)', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'A', 1)];
		doc.subjects = [subject('M', 'M')];
		doc.specs = [spec({ id: 'm', subject: 'M', teachers: ['L1'], count: 1, grades: [5] })];
		doc.placed = [
			{ specId: 'm', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 'GHOST', day: 'Mo', period: 2, grade: 5, pinned: false } // existiert nicht
		];
		const e = buildScheduleExport(doc);
		expect(e.placements.length).toBe(1);
		expect(e.placements[0].specId === undefined || e.placements[0].subject === 'M').toBe(true);
	});
});
