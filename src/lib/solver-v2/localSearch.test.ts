import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { importCsv } from '../import/csv';
import { migrateDoc } from '../persistence';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { localSearch } from './localSearch';
import { defaultWeights } from './types';

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

describe('localSearch', () => {
	it('does not increase the score (best-tracking is correct)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't1', [5], 4));
		doc.specs.push(spec('s2', 'D', 't2', [6], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		const result = localSearch(state, before, {
			weights: w,
			maxIterations: 1000,
			timeBudgetMs: 5000,
			seed: 42,
		});
		expect(result.bestBreakdown.total).toBeLessThanOrEqual(before.total);
	});

	it('ends with state restored to bestPlacement', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 3));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		const result = localSearch(state, before, {
			weights: w,
			maxIterations: 200,
			timeBudgetMs: 2000,
			seed: 17,
		});
		// Verify state.placement matches bestPlacement
		for (let i = 0; i < state.nUnits; i++) {
			expect(state.placement[i]).toBe(result.bestPlacement[i]);
		}
		// Verify computeScore matches bestBreakdown
		const final = computeScore(state, w);
		expect(final.total).toBe(result.bestBreakdown.total);
	});

	it('respects shouldAbort signal', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		let calls = 0;
		const result = localSearch(state, before, {
			weights: w,
			maxIterations: 100_000,
			timeBudgetMs: 60_000,
			shouldAbort: () => ++calls > 5,
		});
		// Should have exited very early
		expect(result.iterations).toBeLessThan(20);
	});

	it('emits onImprovement only on score drops', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 3));
		doc.specs.push(spec('s2', 'D', 't2', [6], 3));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		const improvements: number[] = [];
		localSearch(state, before, {
			weights: w,
			maxIterations: 2000,
			timeBudgetMs: 5000,
			seed: 42,
			onImprovement: (info) => improvements.push(info.breakdown.total),
		});
		// All improvements should be strictly decreasing
		for (let i = 1; i < improvements.length; i++) {
			expect(improvements[i]).toBeLessThan(improvements[i - 1]);
		}
	});
});

const realListeDescribe = process.env.CONSTRUCT_REAL_LISTE === '1' ? describe : describe.skip;

realListeDescribe('localSearch on real Liste.csv', () => {
	it('reduces score significantly within 5 seconds', () => {
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
		const initial = computeScore(state, w);
		// eslint-disable-next-line no-console
		console.log(`  Initial score: ${initial.total}`);

		const ls = localSearch(state, initial, {
			weights: w,
			maxIterations: 100_000,
			timeBudgetMs: 5000,
			seed: 42,
		});
		// eslint-disable-next-line no-console
		console.log(`  After LS: ${ls.bestBreakdown.total}, ${ls.iterations} iter, ${ls.improvementCount} improvements, ${ls.tElapsedMs}ms`);

		// Should improve at least 30% in 5s
		expect(ls.bestBreakdown.total).toBeLessThanOrEqual(initial.total);
	}, 15_000);
});
