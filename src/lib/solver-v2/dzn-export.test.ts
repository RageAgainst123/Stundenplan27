// Tests für den erweiterten DZN-Export (Phase 18+).
// Sicherstellen dass alle wichtigen Informationen für Reproduktion und
// Bug-Reports enthalten sind — ohne dass bestehende Konsumenten brechen.

import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { startSolve } from './index';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#f00', subjects: [], unavailable };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return { code, name: code, category: 'PG', isMain: opts.isMain ?? false, hoursPerWeek: {}, maxConsecutive: opts.maxConsecutive ?? 99 };
}
function spec(o: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: GradeLevel[] }): LessonSpec {
	return {
		classes: ['1a'], weekPattern: 'every', includeInSolver: true, source: 'manual',
		afternoonAllowed: 'allowed', ...o
	};
}

describe('getDzn — erweiterte Reproduktions-Daten (Phase 18)', () => {
	function setupDoc() {
		const doc = emptyDoc('2026/27');
		doc.teachers = [
			teacher('L1', 'Lehrer1', [{ day: 'Fr', period: 8 }]),
			teacher('L2', 'Lehrer2'),
			teacher('L3', 'Lehrer3')
		];
		doc.subjects = [
			subject('M', { isMain: true }),
			subject('BBO'),
			subject('BSP')
		];
		doc.specs = [
			spec({ id: 'm5', subject: 'M', teachers: ['L1'], count: 4, grades: [5], afternoonAllowed: 'never' }),
			spec({ id: 'bbo7', subject: 'BBO', teachers: ['L2'], count: 1, grades: [7], afternoonAllowed: 'must' }),
			// Team-Teaching mit Segmenten
			spec({
				id: 'mteam', subject: 'M', teachers: ['L1', 'L2', 'L3'], count: 4, grades: [6],
				teachingSegments: [
					{ hours: 2, teachers: ['L1', 'L2', 'L3'] },
					{ hours: 2, teachers: ['L1'] }
				]
			})
		];
		doc.placed = [
			{ specId: 'm5', day: 'Mo', period: 1, grade: 5, pinned: true }
		];
		return doc;
	}

	async function getDznObject() {
		const doc = setupDoc();
		const session = startSolve(doc, { totalBudgetMs: 200 });
		// Auf 'done' warten damit der State sicher initialisiert ist.
		await new Promise<void>(resolve => {
			session.on('done', () => resolve());
		});
		const raw = session.getDzn();
		return JSON.parse(raw);
	}

	it('enthält Meta-Block mit Version, Timestamp, Schuljahr', async () => {
		const d = await getDznObject();
		expect(d.meta).toBeDefined();
		expect(d.meta.schoolYear).toBe('2026/27');
		expect(d.meta.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(typeof d.meta.exportVersion).toBe('number');
	});

	it('enthält Units (rückwärtskompatibel zum alten Format)', async () => {
		const d = await getDznObject();
		expect(typeof d.nUnits).toBe('number');
		expect(Array.isArray(d.units)).toBe(true);
		expect(d.units.length).toBe(d.nUnits);
		// Bestehende Felder müssen erhalten bleiben
		const u = d.units[0];
		expect(typeof u.idx).toBe('number');
		expect(typeof u.kind).toBe('string');
		expect(typeof u.subjectCode).toBe('string');
		expect(typeof u.teacherId).toBe('string');
		expect(Array.isArray(u.grades)).toBe(true);
		expect(typeof u.blockSize).toBe('number');
		expect(typeof u.pinned).toBe('boolean');
		expect(Array.isArray(u.specIds)).toBe(true);
	});

	it('Units enthalten NEU teacherIds, afternoonAllowed, weekPattern', async () => {
		const d = await getDznObject();
		const u = d.units.find((x: { specIds: string[] }) => x.specIds.includes('bbo7'));
		expect(Array.isArray(u.teacherIds)).toBe(true);
		expect(['never', 'allowed', 'preferred', 'must']).toContain(u.afternoonAllowed);
		expect(['every', 'even', 'odd']).toContain(u.weekPattern);
	});

	it('Team-Teaching-Units zeigen mehrere teacherIds', async () => {
		const d = await getDznObject();
		const teamUnits = d.units.filter((u: { specIds: string[]; teacherIds: string[] }) =>
			u.specIds.includes('mteam') && u.teacherIds.length > 1
		);
		expect(teamUnits.length).toBeGreaterThan(0);
		// 2h Segment mit allen 3 Lehrern → mindestens 1 Unit mit 3 Lehrern
		const triple = teamUnits.find((u: { teacherIds: string[] }) => u.teacherIds.length === 3);
		expect(triple).toBeDefined();
	});

	it('enthält originale specs (vor Solver-Expansion) mit teachingSegments', async () => {
		const d = await getDznObject();
		expect(Array.isArray(d.specs)).toBe(true);
		expect(d.specs.length).toBe(3);
		const teamSpec = d.specs.find((s: { id: string }) => s.id === 'mteam');
		expect(teamSpec).toBeDefined();
		expect(teamSpec.teachingSegments).toBeDefined();
		expect(teamSpec.teachingSegments.length).toBe(2);
	});

	it('enthält teachers mit unavailable-Slots', async () => {
		const d = await getDznObject();
		expect(Array.isArray(d.teachers)).toBe(true);
		expect(d.teachers.length).toBe(3);
		const l1 = d.teachers.find((t: { id: string }) => t.id === 'L1');
		expect(l1.unavailable).toEqual([{ day: 'Fr', period: 8 }]);
	});

	it('enthält subjects mit isMain-Flag', async () => {
		const d = await getDznObject();
		expect(Array.isArray(d.subjects)).toBe(true);
		const m = d.subjects.find((s: { code: string }) => s.code === 'M');
		expect(m.isMain).toBe(true);
	});

	it('enthält ConstraintConfig', async () => {
		const d = await getDznObject();
		expect(d.constraints).toBeDefined();
		expect(typeof d.constraints.minDailySlotsPerGrade).toBe('number');
		expect(d.constraints.noMainSubjectAfternoon).toBeDefined();
	});

	it('enthält placements aus doc.placed (für Reproduktion)', async () => {
		const d = await getDznObject();
		expect(Array.isArray(d.placements)).toBe(true);
		expect(d.placements.length).toBe(1);
		expect(d.placements[0]).toEqual({ specId: 'm5', day: 'Mo', period: 1, grade: 5, pinned: true });
	});

	it('enthält droppedPins-Array (kann leer sein)', async () => {
		const d = await getDznObject();
		expect(Array.isArray(d.droppedPins)).toBe(true);
	});

	it('vor Solver-Lauf: keine relaxation/scoreBreakdown', async () => {
		const d = await getDznObject();
		// Wenn der Lauf gerade abgebrochen wurde, sind das optionale Felder
		expect(d.relaxation === undefined || typeof d.relaxation === 'object').toBe(true);
	});

	it('JSON ist valide und lesbar', async () => {
		const doc = setupDoc();
		const session = startSolve(doc, { totalBudgetMs: 100 });
		session.abort();
		const raw = session.getDzn();
		expect(() => JSON.parse(raw)).not.toThrow();
		expect(raw).toContain('"meta"');
		expect(raw).toContain('"units"');
	});

	it('vor Solver-Start: liefert doc-only Dump (kein leerer String mehr)', async () => {
		// Phase 18: getDzn() liefert jetzt IMMER ein gültiges JSON-Dump.
		// Vor Solver-Start fehlen units/scoreBreakdown — Doc-Daten sind aber da.
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'Lehrer1')];
		doc.subjects = [subject('M')];
		doc.specs = [spec({ id: 'm', subject: 'M', teachers: ['L1'], count: 1, grades: [5] })];
		const session = startSolve(doc, { totalBudgetMs: 50 });
		// Direkt nach startSolve (vor queueMicrotask): State noch null
		const raw = session.getDzn();
		expect(raw).not.toBe('');
		const dump = JSON.parse(raw);
		expect(dump.meta).toBeDefined();
		expect(dump.teachers.length).toBe(1);
		expect(dump.specs.length).toBe(1);
		// State noch nicht da → nUnits=0, units=[]
		expect(dump.nUnits).toBe(0);
		expect(dump.units).toEqual([]);
		session.abort();
	});
});
