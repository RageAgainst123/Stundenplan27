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
import { aggregateBench, computeBenchMetrics, computeTeacherMetrics, type BenchMetrics } from './bench-metrics';
import { placementToPlacedLessons, startSolve, type SolverOutput } from './index';

const benchDescribe = process.env.BENCH === '1' ? describe : describe.skip;

/**
 * R3-S3: Akzeptanz-A/B über Env — `BENCH_ACCEPT=sa npm run bench` fährt
 * dieselben Fälle mit dem klassischen SA-Referenzpfad. Default folgt der
 * Produktion: LAHC (seit r3-schritt-3, siehe bench-baseline.json).
 */
const BENCH_ACCEPT: 'sa' | 'lahc' = process.env.BENCH_ACCEPT === 'sa' ? 'sa' : 'lahc';

/** R3-S4: Move-Auswahl-A/B — `BENCH_MOVESEL=alns npm run bench`. Default: fixed. */
const BENCH_MOVESEL: 'fixed' | 'alns' = process.env.BENCH_MOVESEL === 'alns' ? 'alns' : 'fixed';

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
				acceptance: BENCH_ACCEPT,
				moveSelection: BENCH_MOVESEL,
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

	// Audit A3: ZWEITER, LÖSBARER Bench-Fall. Die rohe Liste.csv ist ohne
	// Kopplungen strukturell überlastet (Stufe 7: 42h > 40 Slots) — dort ist
	// unplaced > 0 unvermeidbar und die Vollständigkeits-Invariante nicht
	// prüfbar. Dieser Fall koppelt die Parallel-Gruppen wie im echten
	// Workflow und verlangt BEIDES: alles platziert UND keine Klassen-Lücken.
	it(`coupled-solvable: 5 Seeds × ${BUDGET_MS / 1000}s — unplaced=0 UND no_free=0`, () => {
		const runs: BenchMetrics[] = [];
		const perSeed: Record<string, unknown>[] = [];
		for (const seed of SEEDS) {
			const doc = loadRealDoc();
			for (const s of doc.specs.filter(s => s.subject === 'BSP' && s.count === 3)) s.couplingId = 'bench-bsp';
			for (const s of doc.specs.filter(s => s.subject === 'REL' && s.count === 2)) s.couplingId = 'bench-rel';
			const state = buildState(doc);
			const w = defaultWeights(doc);
			construct(state, { weights: w, seed });
			const ils = iteratedLocalSearch(state, computeScore(state, w), {
				weights: w,
				totalBudgetMs: BUDGET_MS,
				innerBudgetMs: INNER_MS,
				plateauMs: PLATEAU_MS,
				seed,
				acceptance: BENCH_ACCEPT,
				moveSelection: BENCH_MOVESEL,
			});
			const metrics = computeBenchMetrics(state, ils.bestBreakdown);
			runs.push(metrics);
			perSeed.push({
				seed,
				unplaced: metrics.breakdown.unplaced,
				no_free: metrics.breakdown.no_free,
				teacherGaps: metrics.teacher.gapsTotal,
				iterPerSec: Math.round(ils.totalIterations / (ils.tElapsedMs / 1000)),
			});
		}
		const agg = aggregateBench(runs);
		// eslint-disable-next-line no-console
		console.log('BENCH-COUPLED per-seed:', JSON.stringify(perSeed, null, 2));
		// Vollständigkeits- UND Klassen-Invariante — beides Pflicht auf
		// lösbaren Daten. (VS-NaSt ohne Stufen wird von buildState geskippt
		// und zählt nicht als Unit — beeinflusst unplaced nicht.)
		expect(agg.median['breakdown.unplaced'], 'median(unplaced) muss 0 sein — Daten sind lösbar').toBe(0);
		expect(agg.median['breakdown.no_free'], 'median(no_free) muss 0 sein').toBe(0);
		expect(agg.median['breakdown.min_daily'], 'median(min_daily) muss 0 sein').toBe(0);
	}, 120_000);

	// Runde 2, Schritt 1: Diversify-Destroy-Strategien im Vergleich.
	// Pro Seed: Basis-Plan (construct + 8s Sync-ILS), dann von IDENTISCHER
	// Basis 3 Diversify-Zyklen à 2.5s — einmal 'random', einmal
	// 'worst-teacher' (startSolve mit seed-Option). Vergleich der
	// Lehrer-Springstunden (gapsTotal) nach den Zyklen.
	//
	// ACHTUNG: startSolve macht Pre-Flight-Diagnose. Die rohe Liste.csv hat
	// ohne Kopplungen 42 Wochenstunden auf Stufe 7 → fatal. Wir koppeln
	// deshalb (wie im echten Workflow) die Parallel-Gruppen BSP und REL —
	// nur in DIESEM Testfall; die ILS-Bench-Fälle oben bleiben unverändert
	// mit der Baseline vergleichbar.
	it('Diversify-Strategien: random vs worst-teacher vs related-day', async () => {
		// 2 Zyklen à 6s: lang genug, dass der Repair einen komplett zerstörten
		// Lehrer-Plan wieder aufbauen kann (2.5s-Zyklen underschätzen
		// zielgerichtetes Destroy systematisch — im echten Autopilot sind
		// Zyklen 60-90s lang).
		const CYCLES = 2;
		const CYCLE_MS = 6_000;
		const report: Record<string, unknown>[] = [];

		for (const seed of SEEDS) {
			const doc = loadRealDoc();
			for (const s of doc.specs.filter(s => s.subject === 'BSP' && s.count === 3)) s.couplingId = 'bench-bsp';
			for (const s of doc.specs.filter(s => s.subject === 'REL' && s.count === 2)) s.couplingId = 'bench-rel';
			const state = buildState(doc);
			const w = defaultWeights(doc);
			construct(state, { weights: w, seed });
			const ils = iteratedLocalSearch(state, computeScore(state, w), {
				weights: w,
				totalBudgetMs: 8_000,
				innerBudgetMs: INNER_MS,
				plateauMs: PLATEAU_MS,
				seed,
			});
			const basePlaced = placementToPlacedLessons(state, ils.bestPlacement);
			const baseGaps = computeTeacherMetrics(state).gapsTotal;

			const runStrategy = async (strategy: 'random' | 'worst-teacher' | 'related-day'): Promise<number> => {
				// Frische Doc-Kopie pro Arm — beide Arme starten von identischer Basis.
				const d = JSON.parse(JSON.stringify(doc)) as typeof doc;
				d.placed = basePlaced.map(p => ({ ...p }));
				for (let i = 0; i < CYCLES; i++) {
					const out = await new Promise<SolverOutput>(resolve => {
						const session = startSolve(d, {
							hotStart: true,
							seed: seed + i * 7919,
							diversify: { fraction: 0.25, durationMs: CYCLE_MS, strategy },
						});
						session.on('done', ev => resolve(ev.final));
					});
					if (out.status === 'SAT' || out.status === 'TIMEOUT') {
						d.placed = out.placed.map(p => ({ ...p }));
					}
				}
				const st = buildState(d, { hotStart: true });
				return computeTeacherMetrics(st).gapsTotal;
			};

			const gapsRandom = await runStrategy('random');
			const gapsWorst = await runStrategy('worst-teacher');
			const gapsRelated = await runStrategy('related-day');
			report.push({ seed, baseGaps, gapsRandom, gapsWorst, gapsRelated });
		}

		// eslint-disable-next-line no-console
		console.log('BENCH-DIVERSIFY:', JSON.stringify(report, null, 2));
		// Kein harter Besser-Assert (stochastisch) — der Report ist das Ergebnis;
		// Übernahme-Entscheidung fällt manuell anhand der Median-Zahlen.
		expect(report).toHaveLength(SEEDS.length);
	}, 300_000);
});
