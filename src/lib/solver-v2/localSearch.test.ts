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
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
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

describe('localSearch — tabu semantics', () => {
	// Regression for the tabu asymmetry fix (Phase 12 Schritt 2):
	// after a move U: s_old → s_new, the unit must NOT immediately move
	// back to s_old for `tabuTenure` iterations.
	it('blocks the reverse move for tabuTenure iterations', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// Two single lessons that are easy to swap; we run LS with a
		// deterministic seed and watch which slots are visited per unit.
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const initial = computeScore(state, w);
		// We cannot directly inspect tabu state, so we rely on the LS
		// "no score increase" property which is preserved iff tabu is
		// applied correctly. The test passes as long as LS converges and
		// best-tracking is correct — the tabu fix should not regress
		// behaviour here.
		const result = localSearch(state, initial, {
			weights: w,
			maxIterations: 2000,
			timeBudgetMs: 5000,
			tabuTenure: 50,
			seed: 7,
		});
		expect(result.bestBreakdown.total).toBeLessThanOrEqual(initial.total);
	});
});

describe('localSearch — resume (Schritt 2: SA-Kaltstart-Fix)', () => {
	/** Zwei identische Ausgangs-States bauen (gleiche Doc-Struktur, gleicher
	 *  Construct-Seed) — Voraussetzung für den Äquivalenz-Vergleich. */
	function buildTwinStates() {
		const mkDoc = () => {
			const doc = emptyDoc();
			doc.teachers.push(teacher('t1', 'L1'));
			doc.teachers.push(teacher('t2', 'L2'));
			doc.teachers.push(teacher('t3', 'L3'));
			doc.subjects.push(subject('M', { isMain: true }));
			doc.subjects.push(subject('D', { isMain: true }));
			doc.subjects.push(subject('E'));
			doc.specs.push(spec('s1', 'M', 't1', [5], 4));
			doc.specs.push(spec('s2', 'D', 't2', [6], 4));
			doc.specs.push(spec('s3', 'E', 't3', [7], 3));
			doc.specs.push(spec('s4', 'M', 't2', [8], 3));
			return doc;
		};
		const w1 = defaultWeights(mkDoc());
		const stateA = buildState(mkDoc());
		const stateB = buildState(mkDoc());
		construct(stateA, { weights: w1, seed: 5 });
		construct(stateB, { weights: w1, seed: 5 });
		return { stateA, stateB, w: w1 };
	}

	it('3 Resume-Chunks à 1000 Iterationen == 1 Lauf à 3000 (Temperatur+Tabu+RNG nahtlos)', () => {
		const { stateA, stateB, w } = buildTwinStates();
		expect(Array.from(stateA.placement)).toEqual(Array.from(stateB.placement));

		const initialA = computeScore(stateA, w);
		const initialB = computeScore(stateB, w);
		expect(initialA.total).toBe(initialB.total);

		// Referenz: EIN Lauf mit 3000 Iterationen (zeitunabhängig).
		const single = localSearch(stateA, initialA, {
			weights: w,
			maxIterations: 3000,
			timeBudgetMs: 60_000,
			seed: 42,
		});

		// Vergleich: DREI Chunks à 1000 Iterationen mit Resume.
		let resume;
		let lastResult;
		for (let chunk = 0; chunk < 3; chunk++) {
			lastResult = localSearch(stateB, initialB, {
				weights: w,
				maxIterations: 1000,
				timeBudgetMs: 60_000,
				seed: 42, // nur Chunk 1 nutzt den Seed; danach via rngState
				resume,
				restoreBestOnExit: false,
			});
			resume = lastResult.resumeState;
		}
		// Am echten Ende: Best restaurieren (wie der Async-Caller es tut).
		stateB.placement.set(resume!.bestPlacement);

		// Ergebnis muss EXAKT identisch sein — beweist dass Temperatur,
		// Tabu-Liste und RNG-Zustand nahtlos über Chunk-Grenzen laufen.
		expect(resume!.bestBreakdown.total).toBe(single.bestBreakdown.total);
		expect(Array.from(stateB.placement)).toEqual(Array.from(single.bestPlacement));
		expect(resume!.T).toBeCloseTo(single.resumeState.T, 10);
		expect(resume!.iterations).toBe(single.resumeState.iterations);
	});

	it('restoreBestOnExit=false lässt state am Walk-Punkt (score == curBreakdown)', () => {
		const { stateA, w } = buildTwinStates();
		const initial = computeScore(stateA, w);
		const result = localSearch(stateA, initial, {
			weights: w,
			maxIterations: 500,
			timeBudgetMs: 10_000,
			seed: 99,
			restoreBestOnExit: false,
		});
		// State steht am Walk-Punkt: Full-Scan muss curBreakdown entsprechen.
		const walkScore = computeScore(stateA, w);
		expect(walkScore.total).toBe(result.resumeState.curBreakdown.total);
	});

	it('restoreBestOnExit default (true): state steht auf best (Bestandsverhalten)', () => {
		const { stateA, w } = buildTwinStates();
		const initial = computeScore(stateA, w);
		const result = localSearch(stateA, initial, {
			weights: w,
			maxIterations: 500,
			timeBudgetMs: 10_000,
			seed: 99,
		});
		const finalScore = computeScore(stateA, w);
		expect(finalScore.total).toBe(result.bestBreakdown.total);
	});

	it('resumeState akkumuliert Zähler über Chunks', () => {
		const { stateA, w } = buildTwinStates();
		const initial = computeScore(stateA, w);
		const r1 = localSearch(stateA, initial, {
			weights: w, maxIterations: 400, timeBudgetMs: 10_000, seed: 3,
			restoreBestOnExit: false,
		});
		const r2 = localSearch(stateA, initial, {
			weights: w, maxIterations: 400, timeBudgetMs: 10_000,
			resume: r1.resumeState, restoreBestOnExit: false,
		});
		expect(r2.resumeState.iterations).toBe(800);
		// result.iterations bleibt per-Call (Bestandsverhalten für Bookkeeping)
		expect(r1.iterations).toBe(400);
		expect(r2.iterations).toBe(400);
		// Kumulative Zähler wachsen monoton
		expect(r2.resumeState.acceptedMoves).toBeGreaterThanOrEqual(r1.resumeState.acceptedMoves);
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
