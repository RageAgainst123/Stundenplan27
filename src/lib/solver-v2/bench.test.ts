// Solver-Qualitäts-Benchmark auf der echten Liste.csv.
//
// Läuft NUR mit BENCH=1 (npm run bench) — dauert ~60s und ist
// maschinenabhängig (Zeitbudget!). Nicht Teil der normalen Test-Suite.
//
// Zweck: Vorher/Nachher-Vergleich bei Solver-Änderungen. Die Baseline
// liegt in docs/bench-baseline.json — nach jeder Optimierungs-Phase wird
// dort ein neuer Eintrag mit Commit-Hash angehängt.
//
// WICHTIG für Vergleichbarkeit:
//  - Immer auf derselben Maschine messen.
//  - Rohzähler vergleichen (breakdown.*, teacher.*), NICHT weightedTotal —
//    der Total wird bei Gewichts-Änderungen unvergleichbar.
//  - Median über die 5 festen Seeds glättet Zeit-Varianz.
//
// Invarianten (Klassen-Qualität ist Pflicht, siehe Plan):
//  - median(no_free) === 0
//  - median(min_daily) === 0

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDoc } from '../types';
import { importCsv } from '../import/csv';
import { migrateDoc } from '../persistence';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { iteratedLocalSearch, iteratedLocalSearchAsync } from './iteratedLS';
import { defaultWeights } from './types';
import { aggregateBench, computeBenchMetrics, type BenchMetrics } from './bench-metrics';

const benchDescribe = process.env.BENCH === '1' ? describe : describe.skip;

/** Feste Seeds — NIE ändern, sonst bricht die Baseline-Vergleichbarkeit. */
const SEEDS = [42, 1337, 7, 2024, 99999] as const;
/** Budget pro Lauf. 10s ILS wie der etablierte Real-Liste-Test. */
const BUDGET_MS = 10_000;
const INNER_MS = 4_000;
const PLATEAU_MS = 2_000;

function loadRealDoc() {
	const csvPath = join(__dirname, '..', 'import', '__fixtures__', 'sokrates-liste.csv');
	const csv = readFileSync(csvPath, 'utf8');
	const result = importCsv(csv);
	const doc = emptyDoc('2026/27');
	doc.teachers = result.teachers;
	doc.subjects = result.subjects;
	doc.specs = result.specs;
	migrateDoc(doc);
	return doc;
}

benchDescribe('Solver-Bench auf echter Liste.csv (BENCH=1)', () => {
	it(`5 Seeds × ${BUDGET_MS / 1000}s ILS — Rohmetriken-Report`, () => {
		const runs: BenchMetrics[] = [];
		const perSeed: Record<string, unknown>[] = [];

		for (const seed of SEEDS) {
			// Frisches Doc pro Seed — importCsv generiert neue UUIDs, aber die
			// Struktur ist identisch; kein State-Bleed zwischen Läufen.
			const doc = loadRealDoc();
			const state = buildState(doc);
			const w = defaultWeights(doc);
			construct(state, { weights: w, seed });
			const initial = computeScore(state, w);
			const ils = iteratedLocalSearch(state, initial, {
				weights: w,
				totalBudgetMs: BUDGET_MS,
				innerBudgetMs: INNER_MS,
				plateauMs: PLATEAU_MS,
				seed,
			});
			// state.placement ist nach ILS auf best restauriert (finalize) —
			// Metriken direkt vom State berechnen.
			const metrics = computeBenchMetrics(state, ils.bestBreakdown);
			runs.push(metrics);
			perSeed.push({
				seed,
				weightedTotal: metrics.weightedTotal,
				iterations: ils.totalIterations,
				iterPerSec: Math.round(ils.totalIterations / (ils.tElapsedMs / 1000)),
				restarts: ils.restartCount,
				no_free: metrics.breakdown.no_free,
				min_daily: metrics.breakdown.min_daily,
				teacherGaps: metrics.teacher.gapsTotal,
				teacherGapsMax: metrics.teacher.gapsMaxPerTeacher,
				daysPresent: metrics.teacher.daysPresentTotal,
				miniDays: metrics.teacher.miniDays,
			});
		}

		const agg = aggregateBench(runs);

		// Report als JSON — zum manuellen Übertragen nach docs/bench-baseline.json
		// eslint-disable-next-line no-console
		console.log('BENCH per-seed:', JSON.stringify(perSeed, null, 2));
		// eslint-disable-next-line no-console
		console.log('BENCH aggregate:', JSON.stringify(agg, null, 2));

		// --- Harte Invarianten: Klassen-Qualität ist Pflicht ---
		expect(agg.median['breakdown.no_free'], 'median(no_free) muss 0 sein — Klassen-Lücken sind Pflicht-frei').toBe(0);
		expect(agg.median['breakdown.min_daily'], 'median(min_daily) muss 0 sein').toBe(0);
	}, 120_000);

	// Der ASYNC-Pfad ist was die UI wirklich nutzt (iteratedLocalSearchAsync
	// via startSolve). Vor dem Resumable-Fix (Schritt 2) resettet er alle
	// 250ms die SA-Temperatur + Tabu-Liste — dieser Bench-Fall macht den
	// Qualitäts-Gap zum Sync-Pfad sichtbar und nach dem Fix die Angleichung.
	it(`ASYNC-Pfad (Produktions-Pfad): 5 Seeds × ${BUDGET_MS / 1000}s`, async () => {
		const runs: BenchMetrics[] = [];
		const perSeed: Record<string, unknown>[] = [];

		for (const seed of SEEDS) {
			const doc = loadRealDoc();
			const state = buildState(doc);
			const w = defaultWeights(doc);
			construct(state, { weights: w, seed });
			const initial = computeScore(state, w);
			const ils = await iteratedLocalSearchAsync(state, initial, {
				weights: w,
				totalBudgetMs: BUDGET_MS,
				innerBudgetMs: INNER_MS,
				plateauMs: PLATEAU_MS,
				seed,
			});
			const metrics = computeBenchMetrics(state, ils.bestBreakdown);
			runs.push(metrics);
			perSeed.push({
				seed,
				weightedTotal: metrics.weightedTotal,
				iterations: ils.totalIterations,
				iterPerSec: Math.round(ils.totalIterations / (ils.tElapsedMs / 1000)),
				restarts: ils.restartCount,
				no_free: metrics.breakdown.no_free,
				teacherGaps: metrics.teacher.gapsTotal,
			});
		}

		const agg = aggregateBench(runs);
		// eslint-disable-next-line no-console
		console.log('BENCH-ASYNC per-seed:', JSON.stringify(perSeed, null, 2));
		// eslint-disable-next-line no-console
		console.log('BENCH-ASYNC aggregate median:', JSON.stringify(agg.median, null, 2));

		expect(agg.median['breakdown.no_free'], 'median(no_free) muss 0 sein').toBe(0);
	}, 120_000);
});
