// Feinschliff 2.0 (F2-S1): Plan-Qualität als Shared-Helper.
//
// Zwei Bausteine, die vorher nur verstreut/gar nicht existierten:
//
//  - qualityPercent: die R3-S6-Qualitäts-Note (vorher lokal in
//    GenerateButton.svelte) — jetzt überall nutzbar (Feinschliff-Review
//    vergleicht Vorher/Nachher damit).
//
//  - scorePlacedPlan: einen BELIEBIGEN Plan-Stand (placed[]) lokal
//    scoren, ohne Solver-Lauf. Der Feinschliff braucht das doppelt:
//    der aktuelle Plan trägt keinen Score, und der Kandidaten-Score aus
//    dem Solver-done kann im relaxed-Gewichts-Frame gemessen sein —
//    NUR zwei lokale Scorings mit DENSELBEN Gewichten sind ehrlich
//    vergleichbar.

import type { PlacedLesson, ScheduleDoc } from './types';
import { buildState } from './solver-v2/units';
import { computeScore } from './solver-v2/score';
import { defaultWeights, type ScoreBreakdown } from './solver-v2/types';

/**
 * Qualitäts-Note: 100 % bei Score 0, asymptotisch fallend — grobe
 * Vergleichs-Note zwischen Plänen/Snapshots (Untis-Vorbild). Der
 * Roh-Score bleibt maßgeblich; K=15000 kalibriert so, dass ein typischer
 * guter Liste.csv-Plan (~10000) bei ~60 % liegt und jede ungeplante
 * Stunde (100000) die Note unter 15 % drückt.
 */
export function qualityPercent(total: number): number {
	const K = 15_000;
	return Math.max(0, Math.round((100 * K) / (K + Math.max(0, total))));
}

/**
 * Scort einen Plan-Stand lokal: alle Placements werden als Pins in einen
 * frischen SolverState geladen (buildState), dann computeScore mit den
 * Standard-Gewichten des Docs (strict-Flag wie im Produktions-Lauf).
 *
 * `placed` überschreibt optional doc.placed (Kandidaten-Stand) — das Doc
 * selbst wird NICHT mutiert. Kosten: wenige Millisekunden (ein
 * buildState + ein Voll-Scan) — fürs Review völlig unkritisch.
 *
 * Grenzfall: Placements, die buildState als unhaltbare Pins verwirft
 * (droppedPins, z. B. Alt-Daten-Konflikte), fehlen im Score — für
 * Vorher/Nachher-VERGLEICHE desselben Docs ist das symmetrisch und
 * damit unschädlich.
 */
export function scorePlacedPlan(doc: ScheduleDoc, placed?: PlacedLesson[]): ScoreBreakdown {
	const target: ScheduleDoc = {
		...doc,
		placed: (placed ?? doc.placed).map(p => ({ ...p, pinned: true })),
	};
	const strictNoFree =
		doc.constraints.noFreePeriodsForClass.strict !== false &&
		doc.constraints.noFreePeriodsForClass.enabled !== false;
	const state = buildState(target);
	return computeScore(state, defaultWeights(target, strictNoFree));
}
