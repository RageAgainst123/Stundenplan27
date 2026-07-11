import { describe, it, expect } from 'vitest';
import { placementsAt, placedCountForSpec, checkPlacementConflict } from './schedule-helpers';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from './types';

function teacher(id: string, name: string, unavailable: { day: 'Mo'|'Di'|'Mi'|'Do'|'Fr'; period: 1|2|3|4|5|6|7|8 }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, t: string, grades: number[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades: grades as any,
		weekPattern: 'every', count,
		blocks: opts.blocks,
		includeInSolver: true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual'
	};
}

// Phase 8: PlacedLesson now carries its own grade. Multi-grade specs emit one
// PlacedLesson per grade column. The user-reported bug ("Schlegel hat 4 LE,
// aber Solver platziert mehr") was this rendering bug — same lesson appeared
// in every grade column the spec covers.

describe('placementsAt — grade-aware filtering (Phase 8)', () => {
	it('multi-grade lesson appears ONLY in pinned grade columns, not in every spec.grades', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5, 6], 1));
		// User pins on Mo/1 — both grade-rows (5 and 6) get a PlacedLesson.
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 6, pinned: true });

		// Both grade columns show the lesson — that's correct (it's taught to both).
		expect(placementsAt(doc, 'Mo', 1, 5)).toHaveLength(1);
		expect(placementsAt(doc, 'Mo', 1, 6)).toHaveLength(1);
		// Other grade columns must stay empty.
		expect(placementsAt(doc, 'Mo', 1, 7)).toHaveLength(0);
		expect(placementsAt(doc, 'Mo', 1, 8)).toHaveLength(0);
	});

	it('a lesson placed only in grade 5 is NOT shown in grade 6 (regression: render bug)', () => {
		// This is the EXACT bug the user hit: pre-fix, placementsAt fell back
		// to spec.grades.includes(grade) and showed the same PlacedLesson in
		// every column. Post-fix, only the matching grade column lights up.
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5, 6], 1));
		// Buggy single-row entry (e.g. pre-migration data) — should ONLY show
		// in grade 5 now, not grade 6.
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		expect(placementsAt(doc, 'Mo', 1, 5)).toHaveLength(1);
		expect(placementsAt(doc, 'Mo', 1, 6)).toHaveLength(0);
	});
});

describe('placedCountForSpec — counts unique slots, not grade-rows (Phase 8)', () => {
	it('multi-grade spec count = unique (day,period) slots, regardless of #grade-rows', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5, 6], 2));
		// Two pedagogical lessons → 4 PlacedLesson entries (2 slots × 2 grades).
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 6, pinned: true });
		doc.placed.push({ specId: 's', day: 'Di', period: 2, grade: 5, pinned: true });
		doc.placed.push({ specId: 's', day: 'Di', period: 2, grade: 6, pinned: true });
		// Without the unique-slot logic this would return 4 (grade-rows).
		expect(placedCountForSpec(doc, 's')).toBe(2);
	});

	it('single-grade spec count is unaffected', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 3));
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });
		doc.placed.push({ specId: 's', day: 'Di', period: 2, grade: 5, pinned: true });
		expect(placedCountForSpec(doc, 's')).toBe(2);
	});
});

describe('checkPlacementConflict — grade-aware (Phase 8)', () => {
	it('reports grade clash only when target grade column is actually occupied', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		const sM = spec('sM', 'M', 't1', [5], 1);
		const sD = spec('sD', 'D', 't2', [6], 1);
		doc.specs.push(sM, sD);
		// sM occupies grade 5 at Mo/1; sD wants to land at the same (day,period)
		// in grade 6 — no overlap, no conflict.
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, grade: 5, pinned: true });
		const conflict = checkPlacementConflict(doc, sD, 'Mo', 1);
		expect(conflict.hasConflict).toBe(false);
	});

	it('reports grade clash when target grade IS occupied', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		const sM = spec('sM', 'M', 't1', [5], 1);
		const sD = spec('sD', 'D', 't2', [5], 1);
		doc.specs.push(sM, sD);
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, grade: 5, pinned: true });
		const conflict = checkPlacementConflict(doc, sD, 'Mo', 1);
		expect(conflict.hasConflict).toBe(true);
		expect(conflict.reasons.some(r => r.includes('Schulstufe 5'))).toBe(true);
	});
});

describe('checkPlacementConflict — Solver-Parität (Audit A1c)', () => {
	it('Doppellage verboten: zweite Wochenstunde derselben Spec am selben Slot', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.subjects.push(subject('M'));
		const sM = spec('sM', 'M', 't1', [5], 2);
		doc.specs.push(sM);
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, grade: 5, pinned: true });
		// Zweite Occurrence auf denselben Slot ziehen → Konflikt (H8-Gegenstück).
		const conflict = checkPlacementConflict(doc, sM, 'Mo', 1);
		expect(conflict.hasConflict).toBe(true);
		expect(conflict.reasons.some(r => r.includes('liegt hier bereits'))).toBe(true);
	});

	it('Doppellage auch beim MOVE erkannt (Quell-Exclude ist quellgenau)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.subjects.push(subject('M'));
		const sM = spec('sM', 'M', 't1', [5], 2);
		doc.specs.push(sM);
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 'sM', day: 'Di', period: 3, grade: 5, pinned: false });
		// Stunde von Di P3 auf Mo P1 ziehen — dort liegt die ANDERE Occurrence.
		// Vorher wurde sie durch den pauschalen Same-Spec-Exclude übersehen.
		const conflict = checkPlacementConflict(doc, sM, 'Mo', 1, { specId: 'sM', day: 'Di', period: 3 });
		expect(conflict.hasConflict).toBe(true);
		// Drop zurück auf die EIGENE Zelle bleibt konfliktfrei.
		const selfDrop = checkPlacementConflict(doc, sM, 'Di', 3, { specId: 'sM', day: 'Di', period: 3 });
		expect(selfDrop.hasConflict).toBe(false);
	});

	it('Kopplungs-Parallelität (verschiedene Specs, gleiche couplingId) bleibt erlaubt', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'), teacher('t2', 'L2'));
		doc.subjects.push(subject('BSP'));
		const a = spec('a', 'BSP', 't1', [5], 1, { couplingId: 'c1' });
		const b = spec('b', 'BSP', 't2', [5], 1, { couplingId: 'c1' });
		doc.specs.push(a, b);
		doc.placed.push({ specId: 'a', day: 'Mo', period: 1, grade: 5, pinned: true });
		expect(checkPlacementConflict(doc, b, 'Mo', 1).hasConflict).toBe(false);
	});

	it('Team-Teaching: liegende Segment-Stunde zählt nur mit EFFEKTIVEM Team', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('tA', 'A'), teacher('tB', 'B'));
		doc.subjects.push(subject('M'), subject('D'));
		// Team-Spec [A,B] mit Segmenten; am Slot liegt ein Segment NUR mit A.
		const team: LessonSpec = {
			...spec('team', 'M', 'tA', [5], 2),
			teachers: ['tA', 'tB'],
			teachingSegments: [
				{ hours: 1, teachers: ['tA'] },
				{ hours: 1, teachers: ['tA', 'tB'] },
			],
		};
		const sB = spec('sB', 'D', 'tB', [6], 1);
		doc.specs.push(team, sB);
		doc.placed.push({ specId: 'team', day: 'Mo', period: 1, grade: 5, pinned: false, teachers: ['tA'] });
		// B ist im Slot NICHT anwesend → sB (Lehrer B, andere Stufe) darf hier hin.
		// Vorher: False-Positive über das volle Spec-Team [A,B].
		expect(checkPlacementConflict(doc, sB, 'Mo', 1).hasConflict).toBe(false);
	});

	it('Team-Teaching: bewegte Segment-Stunde prüft mit ihrem Quell-Team', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('tA', 'A'), teacher('tB', 'B'), teacher('tC', 'C'));
		doc.subjects.push(subject('M'), subject('D'));
		const team: LessonSpec = {
			...spec('team', 'M', 'tA', [5], 2),
			teachers: ['tA', 'tB'],
			teachingSegments: [
				{ hours: 1, teachers: ['tA'] },
				{ hours: 1, teachers: ['tA', 'tB'] },
			],
		};
		const sB = spec('sB', 'D', 'tB', [6], 1);
		doc.specs.push(team, sB);
		// Nur-A-Segment liegt auf Di P2; B unterrichtet Mo P1 in Stufe 6.
		doc.placed.push({ specId: 'team', day: 'Di', period: 2, grade: 5, pinned: false, teachers: ['tA'] });
		doc.placed.push({ specId: 'sB', day: 'Mo', period: 1, grade: 6, pinned: false });
		// Das Nur-A-Segment nach Mo P1 ziehen: B ist dort beschäftigt, aber B
		// gehört NICHT zum bewegten Segment → kein Konflikt.
		const conflict = checkPlacementConflict(doc, team, 'Mo', 1, { specId: 'team', day: 'Di', period: 2 });
		expect(conflict.hasConflict).toBe(false);
	});
});
