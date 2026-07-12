import { describe, it, expect } from 'vitest';
import { migrateDoc } from './persistence';
import { emptyDoc, type ScheduleDoc, SCHEMA_VERSION } from './types';

// v1 → v2 migration: PlacedLesson without `grade` is expanded to one entry
// per spec.grades column, so the grid renders correctly post-migration.

describe('migrateDoc — v1 → v2 PlacedLesson.grade expansion', () => {
	it('expands a v1 multi-grade placement into one entry per grade column', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'BSP', name: 'BSP', category: 'PG', isMain: false, hoursPerWeek: {} });
		doc.specs.push({
			id: 's', subject: 'BSP', teachers: ['t'], classes: ['1a'], grades: [5, 6],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		// Simulate v1 placement (no `grade` field).
		(doc.placed as any).push({ specId: 's', day: 'Mo', period: 1, pinned: true });
		(doc.meta as any).schemaVersion = 1;

		migrateDoc(doc);

		expect(doc.placed).toHaveLength(2);
		const grades = doc.placed.map(p => p.grade).sort();
		expect(grades).toEqual([5, 6]);
		// Both should keep pinned + same (day,period)
		expect(doc.placed.every(p => p.day === 'Mo' && p.period === 1 && p.pinned)).toBe(true);
		// Schema bumped to current
		expect(doc.meta.schemaVersion).toBe(SCHEMA_VERSION);
	});

	it('leaves v2 placements untouched', () => {
		const doc = emptyDoc();
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'M', name: 'M', category: 'PG', isMain: true, hoursPerWeek: {} });
		doc.specs.push({
			id: 's', subject: 'M', teachers: ['t'], classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });

		migrateDoc(doc);

		expect(doc.placed).toHaveLength(1);
		expect(doc.placed[0].grade).toBe(5);
	});

	it('drops placements whose spec was removed', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		(doc.placed as any).push({ specId: 'gone', day: 'Mo', period: 1, pinned: true });
		(doc.meta as any).schemaVersion = 1;
		migrateDoc(doc);
		expect(doc.placed).toHaveLength(0);
	});

	it('migrates legacy block patterns ([1,1,1,1] → undefined)', () => {
		const doc = emptyDoc();
		doc.specs.push({
			id: 's', subject: 'M', teachers: ['t'], classes: [], grades: [5],
			weekPattern: 'every', count: 4, blocks: [1, 1, 1, 1],
			includeInSolver: true, source: 'manual'
		});
		migrateDoc(doc);
		expect(doc.specs[0].blocks).toBeUndefined();
	});

	it('preserves explicit non-default block patterns', () => {
		const doc = emptyDoc();
		doc.specs.push({
			id: 's', subject: 'M', teachers: ['t'], classes: [], grades: [5],
			weekPattern: 'every', count: 3, blocks: [2, 1],
			includeInSolver: true, source: 'manual'
		});
		migrateDoc(doc);
		expect(doc.specs[0].blocks).toEqual([2, 1]);
	});
});

describe('migrateDoc — Phase 10 ConstraintConfig additions', () => {
	it('adds mustStartFirstPeriod to old configs missing it', () => {
		const doc = emptyDoc();
		// simulate an old doc without the new field
		delete (doc.constraints as any).mustStartFirstPeriod;
		migrateDoc(doc);
		expect(doc.constraints.mustStartFirstPeriod).toEqual({ enabled: true, weight: 300 });
	});

	it('preserves an explicit mustStartFirstPeriod = false', () => {
		const doc = emptyDoc();
		doc.constraints.mustStartFirstPeriod = { enabled: false, weight: 300 };
		migrateDoc(doc);
		expect(doc.constraints.mustStartFirstPeriod.enabled).toBe(false);
	});

	it('Anwesenheitspflicht (2026-07): teacherPresence wird additiv ergänzt, explizite Werte bleiben', () => {
		const doc = emptyDoc();
		delete (doc.constraints as any).teacherPresence;
		migrateDoc(doc);
		expect(doc.constraints.teacherPresence).toEqual({ enabled: true, weight: 400 });
		// Explizit gesetzter Wert übersteht die Migration.
		doc.constraints.teacherPresence = { enabled: false, weight: 250 };
		migrateDoc(doc);
		expect(doc.constraints.teacherPresence).toEqual({ enabled: false, weight: 250 });
	});
});

describe('migrateDoc — v2 → v3 groupKey split (Option A)', () => {
	it('moves old groupKey to groupLabel, never to couplingId', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		(doc.specs as any).push({
			id: 's', subject: 'BSP', teachers: ['t'], classes: ['1a'], grades: [5, 6],
			weekPattern: 'every', count: 2, blocks: undefined,
			includeInSolver: true,
			groupKey: 'DGB 1/2',
			source: 'manual'
		});
		(doc.meta as any).schemaVersion = 2;

		migrateDoc(doc);

		const s = doc.specs[0] as any;
		expect(s.groupKey).toBeUndefined();
		expect(s.groupLabel).toBe('DGB 1/2');
		expect(s.couplingId).toBeUndefined();
		expect(doc.meta.schemaVersion).toBe(SCHEMA_VERSION);
	});

	it('does not overwrite groupLabel/couplingId if already set', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		(doc.specs as any).push({
			id: 's', subject: 'BSP', teachers: ['t'], classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true,
			groupKey: 'old',
			groupLabel: 'manual',
			couplingId: 'kopplung-x',
			source: 'manual'
		});
		migrateDoc(doc);
		const s = doc.specs[0] as any;
		expect(s.groupKey).toBeUndefined();
		expect(s.groupLabel).toBe('manual');
		expect(s.couplingId).toBe('kopplung-x');
	});
});

describe('migrateDoc — v3 → v4 teacher → teachers[]', () => {
	it('moves a v3 single teacher string into teachers[0]', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 'tNagl', name: 'Nagl', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'BSP', name: 'BSP', category: 'PG', isMain: false, hoursPerWeek: {} });
		// v3-style spec with the legacy `teacher` field, no `teachers` array.
		(doc.specs as any).push({
			id: 's', subject: 'BSP', teacher: 'tNagl', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		(doc.meta as any).schemaVersion = 3;

		migrateDoc(doc);

		const s = doc.specs[0] as any;
		expect(s.teachers).toEqual(['tNagl']);
		expect(s.teacher).toBeUndefined();
		expect(doc.meta.schemaVersion).toBe(SCHEMA_VERSION);
	});

	it('keeps an existing v4 teachers[] array untouched even if a stale teacher string is present', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 'tA', name: 'A', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.teachers.push({ id: 'tB', name: 'B', shortNumber: 2, color: '#111', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'BSP', name: 'BSP', category: 'PG', isMain: false, hoursPerWeek: {} });
		(doc.specs as any).push({
			id: 's', subject: 'BSP', teacher: 'tA', teachers: ['tA', 'tB'],
			classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});

		migrateDoc(doc);

		const s = doc.specs[0] as any;
		expect(s.teachers).toEqual(['tA', 'tB']);
		expect(s.teacher).toBeUndefined();
	});

	it('produces an empty teachers[] when no teacher info is present (defensive)', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.subjects.push({ code: 'M', name: 'M', category: 'PG', isMain: true, hoursPerWeek: {} });
		(doc.specs as any).push({
			id: 's', subject: 'M', classes: [], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});

		migrateDoc(doc);

		expect((doc.specs[0] as any).teachers).toEqual([]);
	});
});

describe('migrateDoc — v4 → v5 afternoonAllowed default', () => {
	it('sets afternoonAllowed=never for specs of an isMain subject', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'M', name: 'Mathe', category: 'PG', isMain: true, hoursPerWeek: {} });
		doc.specs.push({
			id: 's', subject: 'M', teachers: ['t'], classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 4, blocks: undefined,
			includeInSolver: true, source: 'csv'
		});
		(doc.meta as any).schemaVersion = 4;

		migrateDoc(doc);

		expect((doc.specs[0] as any).afternoonAllowed).toBe('never');
	});

	it('sets afternoonAllowed=allowed for non-main subject', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'BSP', name: 'BSP', category: 'PG', isMain: false, hoursPerWeek: {} });
		doc.specs.push({
			id: 's', subject: 'BSP', teachers: ['t'], classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 2, blocks: undefined,
			includeInSolver: true, source: 'csv'
		});
		(doc.meta as any).schemaVersion = 4;

		migrateDoc(doc);

		expect((doc.specs[0] as any).afternoonAllowed).toBe('allowed');
	});

	it('does NOT overwrite an existing user choice (idempotent)', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'M', name: 'Mathe', category: 'PG', isMain: true, hoursPerWeek: {} });
		(doc.specs as any).push({
			id: 's', subject: 'M', teachers: ['t'], classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 4, blocks: undefined,
			includeInSolver: true, source: 'csv',
			afternoonAllowed: 'allowed' // user chose this explicitly
		});

		migrateDoc(doc);

		// User's explicit choice survives a second migration pass.
		expect((doc.specs[0] as any).afternoonAllowed).toBe('allowed');
	});

	it('sets default targetDailyLessons constraint when missing', () => {
		const doc = emptyDoc();
		// Simulate older constraint config without the field.
		delete (doc.constraints as any).targetDailyLessons;
		(doc.meta as any).schemaVersion = 4;

		migrateDoc(doc);

		expect(doc.constraints.targetDailyLessons).toEqual({
			enabled: true, weight: 80, target: 6
		});
	});
});

describe('migrateDoc — Reihenfolge teacherMiddayBreak vs. Legacy-Delete (Audit A2d)', () => {
	it('Legacy teacherLunchBreak wird gestrippt, das NEUE teacherMiddayBreak überlebt', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		const c = doc.constraints as any;
		// Alt-Zustand simulieren: Legacy-Feld vorhanden, neues Feld fehlt.
		delete c.teacherMiddayBreak;
		c.teacherLunchBreak = { enabled: true, weight: 60 };
		c.teacherDailyLoad = { enabled: true, max: 6 };
		(doc.meta as any).schemaVersion = 4;

		migrateDoc(doc);

		// Namens-Verwandtschaft ist die dokumentierte Falle (types.ts):
		// Der Legacy-Delete darf das frisch gesetzte neue Feld NIE treffen.
		expect(c.teacherMiddayBreak).toEqual({ enabled: false, weight: 100 });
		expect('teacherLunchBreak' in c).toBe(false);
		expect('teacherDailyLoad' in c).toBe(false);
	});

	it('bereits vorhandenes (user-konfiguriertes) teacherMiddayBreak bleibt unangetastet', () => {
		const doc = emptyDoc() as any as ScheduleDoc;
		const c = doc.constraints as any;
		c.teacherMiddayBreak = { enabled: true, weight: 250 };
		c.teacherLunchBreak = { enabled: false, weight: 10 };
		migrateDoc(doc);
		expect(c.teacherMiddayBreak).toEqual({ enabled: true, weight: 250 });
		expect('teacherLunchBreak' in c).toBe(false);
	});
});

describe('validateDocStructure — JSON-Backup-Guard (Audit A2a)', () => {
	const goodDoc = () => JSON.parse(JSON.stringify(emptyDoc('2026/27')));

	it('akzeptiert ein gültiges Doc (auch mit Daten)', async () => {
		const { validateDocStructure } = await import('./persistence');
		const doc = goodDoc();
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'M', name: 'M', category: 'PG', isMain: true, hoursPerWeek: {} });
		doc.specs.push({ id: 's', subject: 'M', teachers: ['t'], classes: ['1a'], grades: [5], weekPattern: 'every', count: 2, includeInSolver: true, source: 'manual' });
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		expect(validateDocStructure(doc)).toBeNull();
	});

	it('lehnt kaputte Strukturen mit präziser Meldung ab', async () => {
		const { validateDocStructure } = await import('./persistence');
		// placed kein Array
		const d1 = goodDoc(); d1.placed = 'kaputt';
		expect(validateDocStructure(d1)).toMatch(/placed/);
		// count als String
		const d2 = goodDoc();
		d2.specs.push({ id: 's', subject: 'M', teachers: [], classes: [], grades: [5], weekPattern: 'every', count: 'x', includeInSolver: true, source: 'manual' });
		expect(validateDocStructure(d2)).toMatch(/count/);
		// erfundene Stufe
		const d3 = goodDoc();
		d3.specs.push({ id: 's', subject: 'M', teachers: [], classes: [], grades: [5, 9], weekPattern: 'every', count: 1, includeInSolver: true, source: 'manual' });
		expect(validateDocStructure(d3)).toMatch(/grades/);
		// Placement mit ungültigem Tag
		const d4 = goodDoc();
		d4.placed.push({ specId: 's', day: 'Sa', period: 1, grade: 5, pinned: false });
		expect(validateDocStructure(d4)).toMatch(/Tag/);
		// Placement mit Periode 0
		const d5 = goodDoc();
		d5.placed.push({ specId: 's', day: 'Mo', period: 0, grade: 5, pinned: false });
		expect(validateDocStructure(d5)).toMatch(/Stunde/);
	});

	it('toleriert Alt-Backup-Eigenheiten (v1 placed ohne grade, v3 specs ohne teachers)', async () => {
		const { validateDocStructure } = await import('./persistence');
		const doc = goodDoc();
		// v3-Spec: `teacher` (singular) statt `teachers` — Migration füllt das.
		doc.specs.push({ id: 's', subject: 'M', teacher: 't', classes: [], grades: [5], weekPattern: 'every', count: 1, includeInSolver: true, source: 'manual' });
		// v1-Placement ohne grade — Migration expandiert.
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, pinned: true });
		expect(validateDocStructure(doc)).toBeNull();
	});
});
