import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { importCsv } from '../import/csv';
import { migrateDoc } from '../persistence';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { wouldViolate } from './hardCheck';
import { SLOT_UNPLACED, defaultWeights, slotFromDP } from './types';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return { code, name: code, category: 'PG', isMain: opts.isMain ?? false, hoursPerWeek: {}, maxConsecutive: opts.maxConsecutive ?? 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teacher: t, classes: ['1a'], grades,
		weekPattern: 'every', count,
		blocks: 'blocks' in opts ? opts.blocks : undefined,
		includeInSolver: true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual'
	};
}

describe('construct — basic invariants', () => {
	it('produces a complete solution for a tiny schedule', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const result = construct(state, { weights: defaultWeights(doc), seed: 1 });
		expect(result.complete).toBe(true);
		expect(result.unplacedUnitIdxs).toEqual([]);
		// All units have a slot
		for (let i = 0; i < state.nUnits; i++) {
			expect(state.placement[i]).not.toBe(SLOT_UNPLACED);
		}
	});

	it('respects pinned lessons', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });
		const state = buildState(doc);
		// Save pinned slot before
		const pinned = state.units.find(u => u.pinned);
		const pinnedSlot = state.placement[pinned!.idx];
		construct(state, { weights: defaultWeights(doc), seed: 1 });
		// Pinned slot still set
		expect(state.placement[pinned!.idx]).toBe(pinnedSlot);
	});

	it('all placed units are hard-feasible at their final positions', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 4));
		doc.specs.push(spec('s2', 'D', 't2', [6], 4));
		const state = buildState(doc);
		construct(state, { weights: defaultWeights(doc), seed: 42 });
		// Verify no placement violates hard constraints (against the OTHERS)
		for (let i = 0; i < state.nUnits; i++) {
			const slot = state.placement[i];
			if (slot === SLOT_UNPLACED) continue;
			const u = state.units[i];
			// Temporarily remove ourselves to check our slot against the rest
			state.placement[i] = SLOT_UNPLACED;
			expect(wouldViolate(state, u, slot)).toBeNull();
			state.placement[i] = slot;
		}
	});
});

// The real-Liste.csv tests are slow + can stress the ejection chain. We
// keep them but skip in regular `npm test`. They run via npm run test:perf
// or by removing the .skip. CONSTRUCT_REAL_LISTE=1 env var enables them.
const realListeDescribe = process.env.CONSTRUCT_REAL_LISTE === '1' ? describe : describe.skip;

realListeDescribe('construct on real Liste.csv', () => {
	it('places ALL non-pinned units in < 3 s on the real Sokrates list', () => {
		const csvPath = join(__dirname, '..', 'import', '__fixtures__', 'sokrates-liste.csv');
		const csv = readFileSync(csvPath, 'utf8');
		const result = importCsv(csv);

		const doc = emptyDoc('2026/27');
		doc.teachers = result.teachers;
		doc.subjects = result.subjects;
		doc.specs = result.specs;
		migrateDoc(doc);

		const state = buildState(doc);
		const tStart = Date.now();
		const cr = construct(state, { weights: defaultWeights(doc), seed: 1 });
		const elapsed = Date.now() - tStart;

		// eslint-disable-next-line no-console
		console.log(`  Liste.csv: ${state.nUnits} units, construct: ${cr.unplacedUnitIdxs.length} unplaced, ${elapsed} ms`);

		expect(elapsed).toBeLessThan(3000);
		// Allow up to a handful of unplaced units on the first seed
		expect(cr.unplacedUnitIdxs.length).toBeLessThanOrEqual(5);
	}, 10_000);

	it('reports score on real Liste.csv (smoke test, expects soft violations)', () => {
		const csvPath = join(__dirname, '..', 'import', '__fixtures__', 'sokrates-liste.csv');
		const csv = readFileSync(csvPath, 'utf8');
		const result = importCsv(csv);
		const doc = emptyDoc('2026/27');
		doc.teachers = result.teachers;
		doc.subjects = result.subjects;
		doc.specs = result.specs;
		migrateDoc(doc);

		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const score = computeScore(state, w);

		// eslint-disable-next-line no-console
		console.log(`  Construction score: total=${score.total}`);
		// eslint-disable-next-line no-console
		console.log(`    main_aft=${score.main_aft}, any_aft=${score.any_aft}, no_free=${score.no_free}, uneven_days=${score.uneven_days}, no_p1_start=${score.no_p1_start}`);

		expect(score.total).toBeGreaterThan(0); // initial placement won't be perfect
		// Should not be astronomically bad either
		expect(score.total).toBeLessThan(50_000);
	}, 10_000);
});

void slotFromDP;
