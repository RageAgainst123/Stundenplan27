// Bench-Metriken: gewichtsUNabhängige Qualitäts-Rohzähler für den
// Solver-Benchmark (bench.test.ts) und den Lehrer-Qualitäts-Report.
//
// Warum Rohzähler statt `breakdown.total`? Der gewichtete Total wird
// unvergleichbar, sobald Default-Gewichte geändert werden (Schritt 3 der
// Solver-Optimierung). Die Rohzähler (Anzahl Lücken, Anzahl Tage, ...)
// bleiben über Gewichts-Änderungen hinweg vergleichbar — sie sind die
// eigentliche Qualitäts-Währung.
//
// Alle Lehrer-Metriken basieren auf `buildTeacherOccupancy` aus score.ts —
// dieselbe Occupancy-Logik wie der Score selbst, keine Drift möglich.

import { buildTeacherOccupancy } from './score';
import { D, P, type ScoreBreakdown, type SolverState } from './types';

/** Lehrer-Qualitäts-Rohmetriken über den ganzen Plan. */
export interface TeacherBenchMetrics {
	/** Summe aller inneren Lücken (Springstunden) über alle (Lehrer, Tag). */
	gapsTotal: number;
	/** Höchste Wochen-Lücken-Summe eines einzelnen Lehrers (Fairness-Indikator). */
	gapsMaxPerTeacher: number;
	/** Summe der Anwesenheitstage über alle Lehrer (Tag zählt ab 1 Stunde). */
	daysPresentTotal: number;
	/** Summe der Späteinstiege: firstP-Index pro aktivem (Lehrer, Tag). */
	lateStartsTotal: number;
	/** Anzahl Lehrer-Tage mit genau 1 Stunde (Mini-Tage, Anfahrt lohnt nicht). */
	miniDays: number;
	/** Anzahl (Lehrer, Tag) mit >=6 Stunden UND belegtem P5+P6 (fehlende Mittagspause). */
	missedLunchDays: number;
}

export interface BenchMetrics {
	/** Ungewichtete Rohzähler aus dem ScoreBreakdown (alle Komponenten). */
	breakdown: Omit<ScoreBreakdown, 'total'>;
	/** Gewichteter Gesamt-Score (nur informativ, NICHT für Phasen-Vergleiche). */
	weightedTotal: number;
	teacher: TeacherBenchMetrics;
}

/**
 * Berechnet Lehrer-Rohmetriken aus dem aktuellen `state.placement`.
 * Pure Funktion — mutiert nichts.
 */
export function computeTeacherMetrics(state: SolverState): TeacherBenchMetrics {
	const { tocc } = buildTeacherOccupancy(state);
	const T = state.doc.teachers.length;

	let gapsTotal = 0;
	let gapsMaxPerTeacher = 0;
	let daysPresentTotal = 0;
	let lateStartsTotal = 0;
	let miniDays = 0;
	let missedLunchDays = 0;

	for (let t = 0; t < T; t++) {
		let weekGaps = 0;
		for (let d = 0; d < D; d++) {
			let firstP = -1;
			let lastP = -1;
			let occupied = 0;
			for (let p = 0; p < P; p++) {
				if (tocc[t * D * P + d * P + p] > 0) {
					if (firstP === -1) firstP = p;
					lastP = p;
					occupied++;
				}
			}
			if (occupied === 0) continue;
			daysPresentTotal++;
			if (occupied === 1) miniDays++;
			lateStartsTotal += firstP;
			// Innere Lücken zwischen firstP und lastP
			for (let p = firstP + 1; p < lastP; p++) {
				if (tocc[t * D * P + d * P + p] === 0) weekGaps++;
			}
			// Mittagspause: langer Tag (>=6h) mit Stunden im Vormittag (P1-P4,
			// idx 0-3) UND Nachmittag (P7-P8, idx 6-7), aber P5 UND P6
			// (idx 4+5) beide belegt → keine Pause möglich gewesen.
			if (occupied >= 6) {
				let hasMorning = false;
				let hasAfternoon = false;
				for (let p = 0; p <= 3; p++) if (tocc[t * D * P + d * P + p] > 0) { hasMorning = true; break; }
				for (let p = 6; p <= 7; p++) if (tocc[t * D * P + d * P + p] > 0) { hasAfternoon = true; break; }
				const p5busy = tocc[t * D * P + d * P + 4] > 0;
				const p6busy = tocc[t * D * P + d * P + 5] > 0;
				if (hasMorning && hasAfternoon && p5busy && p6busy) missedLunchDays++;
			}
		}
		gapsTotal += weekGaps;
		if (weekGaps > gapsMaxPerTeacher) gapsMaxPerTeacher = weekGaps;
	}

	return { gapsTotal, gapsMaxPerTeacher, daysPresentTotal, lateStartsTotal, miniDays, missedLunchDays };
}

/** Kombiniert Breakdown-Rohzähler + Lehrer-Metriken zu einem Bench-Datensatz. */
export function computeBenchMetrics(state: SolverState, breakdown: ScoreBreakdown): BenchMetrics {
	const { total, ...raw } = breakdown;
	return {
		breakdown: raw,
		weightedTotal: total,
		teacher: computeTeacherMetrics(state),
	};
}

/** Median einer Zahlenliste (für Seed-Aggregation im Bench). */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregiert eine Liste von BenchMetrics (ein Eintrag pro Seed) zu
 * Median/Min/Max pro Metrik. Rückgabe ist JSON-serialisierbar für den
 * Baseline-Vergleich in docs/bench-baseline.json.
 */
export function aggregateBench(runs: BenchMetrics[]): {
	median: Record<string, number>;
	min: Record<string, number>;
	max: Record<string, number>;
} {
	const keys: string[] = [];
	if (runs.length > 0) {
		for (const k of Object.keys(runs[0].breakdown)) keys.push(`breakdown.${k}`);
		for (const k of Object.keys(runs[0].teacher)) keys.push(`teacher.${k}`);
		keys.push('weightedTotal');
	}
	const get = (m: BenchMetrics, key: string): number => {
		if (key === 'weightedTotal') return m.weightedTotal;
		const [group, field] = key.split('.');
		if (group === 'breakdown') return (m.breakdown as unknown as Record<string, number>)[field];
		return (m.teacher as unknown as Record<string, number>)[field];
	};
	const med: Record<string, number> = {};
	const mins: Record<string, number> = {};
	const maxs: Record<string, number> = {};
	for (const key of keys) {
		const vals = runs.map(r => get(r, key));
		med[key] = median(vals);
		mins[key] = Math.min(...vals);
		maxs[key] = Math.max(...vals);
	}
	return { median: med, min: mins, max: maxs };
}
