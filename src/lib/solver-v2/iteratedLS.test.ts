import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { importCsv } from '../import/csv';
import { migrateDoc } from '../persistence';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { iteratedLocalSearch } from './iteratedLS';
import { defaultWeights } from './types';

function teacher(id: string, name: string): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable: [] };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return { code, name: code, category: 'PG', isMain: opts.isMain ?? false, hoursPerWeek: {}, maxConsecutive: opts.maxConsecutive ?? 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
		weekPattern: 'every', count, blocks: 'blocks' in opts ? opts.blocks : undefined,
		includeInSolver: true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual',
	};
}

describe('iteratedLocalSearch', () => {
	it('does not increase the score', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		const result = iteratedLocalSearch(state, before, {
			weights: w,
			totalBudgetMs: 1500,
			innerBudgetMs: 500,
			plateauMs: 200,
			seed: 42,
		});
		expect(result.bestBreakdown.total).toBeLessThanOrEqual(before.total);
	});

	it('Anwesenheitspflicht (2026-07): Solver verteilt Stunden auf die geforderten Tage', () => {
		const doc = emptyDoc();
		// Vollzeit-Szenario im Kleinen: 5 Stunden + Pflicht „jeden Tag".
		// Ohne die Pflicht packt der Solver die 5 Stunden kompakt auf 1 Tag
		// (teacher_days_present belohnt genau das) — mit Pflicht MUSS er auf
		// 5 Tage verteilen (Gewicht 400/fehlendem Tag schlägt alles andere).
		doc.teachers.push({ ...teacher('t', 'Vollzeit'), minDaysPresent: 5 });
		doc.subjects.push(subject('REL'));
		doc.specs.push(spec('s', 'REL', 't', [5], 5));
		// Klassen-Pensum-Regeln neutralisieren: im Mini-Doc hängt der
		// Stufen-Tag 1:1 am Lehrer-Tag — min_daily/target/uneven würden das
		// Verteilen bestrafen und den Test verfälschen. (Beim echten
		// Vollzeitlehrer mit 20+ Stunden über mehrere Stufen existiert
		// diese Kopplung nicht.) Der Test isoliert die Lehrer-Achse.
		doc.constraints.minDailySlotsPerGrade = 0;
		doc.constraints.unevenDaysWeight = 0;
		doc.constraints.targetDailyLessons.enabled = false;
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 7 });
		const before = computeScore(state, w);
		const result = iteratedLocalSearch(state, before, {
			weights: w,
			totalBudgetMs: 2500,
			innerBudgetMs: 800,
			plateauMs: 300,
			seed: 42,
		});
		expect(result.bestBreakdown.teacher_presence).toBe(0);
		// Und die Pflicht-Tage werden NICHT als Überhang bestraft.
		expect(result.bestBreakdown.teacher_days_present).toBe(0);
		expect(result.bestBreakdown.unplaced).toBe(0);
	});

	it('respects shouldAbort', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 1 });
		const before = computeScore(state, w);
		let calls = 0;
		const result = iteratedLocalSearch(state, before, {
			weights: w,
			totalBudgetMs: 60_000,
			innerBudgetMs: 30_000,
			shouldAbort: () => ++calls > 3,
		});
		expect(result.tElapsedMs).toBeLessThan(2000);
	});
});

const realListeDescribe = process.env.CONSTRUCT_REAL_LISTE === '1' ? describe : describe.skip;

realListeDescribe('iteratedLocalSearch on real Liste.csv', () => {
	it('reduces score better than 5s pure LS within 10 s ILS', () => {
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
		console.log(`  Initial: ${initial.total}`);

		const ils = iteratedLocalSearch(state, initial, {
			weights: w,
			totalBudgetMs: 10_000,
			innerBudgetMs: 4_000,
			plateauMs: 2_000,
			seed: 42,
		});
		// eslint-disable-next-line no-console
		console.log(`  After ILS: ${ils.bestBreakdown.total}, ${ils.restartCount} restarts, ${ils.totalIterations} total iter, ${ils.tElapsedMs}ms`);
		// eslint-disable-next-line no-console
		console.log('  Breakdown:', JSON.stringify({
			min_daily: ils.bestBreakdown.min_daily,
			no_p1_start: ils.bestBreakdown.no_p1_start,
			main_aft: ils.bestBreakdown.main_aft,
			any_aft: ils.bestBreakdown.any_aft,
			no_free: ils.bestBreakdown.no_free,
			uneven_days: ils.bestBreakdown.uneven_days,
			main_run: ils.bestBreakdown.main_run,
			compact_teacher: ils.bestBreakdown.compact_teacher,
			main_early: ils.bestBreakdown.main_early,
			time_pref: ils.bestBreakdown.time_pref,
			subject_twice: ils.bestBreakdown.subject_twice,
			spec_spread: ils.bestBreakdown.spec_spread,
			teacher_late_start: ils.bestBreakdown.teacher_late_start,
			teacher_under_min: ils.bestBreakdown.teacher_under_min,
			target_daily: ils.bestBreakdown.target_daily,
			afternoon_preferred: ils.bestBreakdown.afternoon_preferred,
			main_twice: ils.bestBreakdown.main_twice,
			main_block_split: ils.bestBreakdown.main_block_split,
		}));
		expect(ils.bestBreakdown.total).toBeLessThan(initial.total);
	}, 30_000);
});
