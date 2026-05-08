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
			id: 's', subject: 'BSP', teacher: 't', classes: ['1a'], grades: [5, 6],
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
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
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
			id: 's', subject: 'M', teacher: 't', classes: [], grades: [5],
			weekPattern: 'every', count: 4, blocks: [1, 1, 1, 1],
			includeInSolver: true, source: 'manual'
		});
		migrateDoc(doc);
		expect(doc.specs[0].blocks).toBeUndefined();
	});

	it('preserves explicit non-default block patterns', () => {
		const doc = emptyDoc();
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: [], grades: [5],
			weekPattern: 'every', count: 3, blocks: [2, 1],
			includeInSolver: true, source: 'manual'
		});
		migrateDoc(doc);
		expect(doc.specs[0].blocks).toEqual([2, 1]);
	});
});
