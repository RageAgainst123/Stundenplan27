// Solver v2 — score delta for moves (R3 Schritt 1: Scoped-Delta).
//
// VORHER: apply → voller computeScore → revert (~50-100 µs pro Move, real
// 5-12k Iterationen/s im Bench). JETZT: nur die von einem Move berührten
// Zeilen werden neu bewertet — mit EXAKT den Scan-Funktionen aus score.ts
// (scanClassRow / scanTeacherWeek / unitSlotContrib), die auch der
// Voll-Scan summiert. Ein slot-move berührt ≤2 Tage × Stufen-Zeilen und
// 1-3 Lehrer statt aller 20 Zeilen + aller Lehrer + aller Units.
//
// SICHERHEIT:
//  - Ohne Cache (state.scoreCache undefined) läuft der bewährte
//    Full-Scan-Pfad — Referenz für Tests und direkter Fallback.
//  - Der Property-Test in scoreDelta.test.ts vergleicht beide Pfade auf
//    hunderten Random-States × Random-Moves: Breakdown muss FELDGENAU
//    übereinstimmen.
//  - Der Cache wird zu Beginn jedes localSearch-Aufrufs frisch aus dem
//    Placement gebaut (rebuildScoreCache) — Placement-Mutationen außerhalb
//    der LS-Schleife (Construction, ILS-Perturbation, Diversify-Reset)
//    brauchen deshalb KEIN Invalidierungs-Protokoll.

import {
	applyUnitFootprint,
	computeScore,
	ensureScratch,
	resolveScoreCfg,
	scanClassRow,
	scanTeacherWeek,
	unitSlotContrib,
	weightedTotal,
} from './score';
import { applyMove, revertMove, type Move } from './moves';
import {
	D,
	dpFromSlot,
	SLOT_UNPLACED,
	type ScoreBreakdown,
	type ScoreCache,
	type ScoreScratch,
	type ScoreWeights,
	type SolverState,
} from './types';

const G = 4;

/** Ein Move, normalisiert auf (Unit, von-Slot, nach-Slot)-Paare. */
interface MovedPair {
	unitIdx: number;
	from: number;
	to: number;
}

const CLASS_KEYS = [
	'min_daily', 'no_p1_start', 'no_free', 'uneven_days', 'target_daily',
	'main_run', 'subject_twice', 'main_twice', 'main_block_split',
	'subject_run',
] as const;
/** Stride von cache.classRow — MUSS CLASS_ROW_COMPONENTS (score.ts) entsprechen. */
const NC = CLASS_KEYS.length;

// Wiederverwendete Puffer (single-threaded, wie die Scan-Puffer in score.ts).
const pairBuf: MovedPair[] = [];
const affectedRows: number[] = []; // Zeilen-Index d*G+g
const affectedTeachers: number[] = [];
const tmpClass = new Int32Array(NC);
const tmp6 = new Int32Array(6);
const tmp5 = new Int32Array(5);

function collectPairs(move: Move): MovedPair[] {
	pairBuf.length = 0;
	switch (move.kind) {
		case 'slot-move':
			pairBuf.push({ unitIdx: move.unitIdx, from: move.fromSlot, to: move.toSlot });
			break;
		case 'slot-swap':
			pairBuf.push({ unitIdx: move.aIdx, from: move.aSlot, to: move.bSlot });
			pairBuf.push({ unitIdx: move.bIdx, from: move.bSlot, to: move.aSlot });
			break;
		case 'kempe-chain':
			for (let k = 0; k < move.unitIdxs.length; k++) {
				pairBuf.push({ unitIdx: move.unitIdxs[k], from: move.fromSlots[k], to: move.toSlots[k] });
			}
			break;
	}
	return pairBuf;
}

/** (d,g)-Zeilen einer Unit an einem Slot in affectedRows aufnehmen (dedupliziert). */
function collectRows(state: SolverState, unitIdx: number, slot: number): void {
	const { dayIndex } = dpFromSlot(slot);
	for (const grade of state.units[unitIdx].grades) {
		const row = dayIndex * G + (grade - 5);
		if (!affectedRows.includes(row)) affectedRows.push(row);
	}
}

/** Lehrer einer Unit in affectedTeachers aufnehmen (dedupliziert). */
function collectTeachers(state: SolverState, scratch: ScoreScratch, unitIdx: number): void {
	const unit = state.units[unitIdx];
	// Kopplungen belegen alle Team-Lehrer, sonst nur den Primär-Lehrer —
	// dieselbe Fallunterscheidung wie der tocc-Footprint in score.ts.
	const ids = unit.kind === 'coupling' ? unit.teacherIds : [unit.teacherId];
	for (const tid of ids) {
		const tIdx = scratch.teacherIdxById.get(tid);
		if (tIdx !== undefined && !affectedTeachers.includes(tIdx)) affectedTeachers.push(tIdx);
	}
}

const TEACHER_KEYS = [
	'compact_teacher', 'teacher_late_start', 'teacher_under_min',
	'teacher_lunch', 'teacher_gap_fairness', 'teacher_days_present',
] as const;
const UNIT_KEYS = ['any_aft', 'main_aft', 'afternoon_preferred', 'main_early', 'time_pref'] as const;

/**
 * Baut den Scoped-Delta-Cache frisch aus dem aktuellen Placement:
 * ein Voll-Scan (computeScore füllt die Footprints) plus die
 * Beitrags-Vektoren aller Zeilen. Kosten ≈ 2 Voll-Scans — vernachlässigbar,
 * weil pro localSearch-Chunk nur EINMAL fällig.
 */
export function rebuildScoreCache(state: SolverState, weights: ScoreWeights): ScoreBreakdown {
	const scratch = ensureScratch(state);
	const counts = computeScore(state, weights); // füllt zugleich die Footprints
	const cfg = resolveScoreCfg(state);
	const T = Math.max(1, state.doc.teachers.length);

	const cache: ScoreCache = state.scoreCache && state.scoreCache.teacherRow.length === T * 6
		? state.scoreCache
		: {
			cfg,
			counts,
			classRow: new Int32Array(D * G * NC),
			teacherRow: new Int32Array(T * 6),
		};
	cache.cfg = cfg;
	cache.counts = counts;

	for (let d = 0; d < D; d++) {
		for (let g = 0; g < G; g++) {
			scanClassRow(scratch, cfg, d, g, tmpClass);
			cache.classRow.set(tmpClass, (d * G + g) * NC);
		}
	}
	for (let t = 0; t < state.doc.teachers.length; t++) {
		scanTeacherWeek(scratch, cfg, t, tmp6);
		cache.teacherRow.set(tmp6, t * 6);
	}
	state.scoreCache = cache;
	return counts;
}

/** Cache verwerfen (z. B. vor Läufen, die den Full-Scan-Referenzpfad wollen). */
export function dropScoreCache(state: SolverState): void {
	state.scoreCache = undefined;
}

/**
 * Kern des Scoped-Pfads: Footprints der bewegten Units umsetzen, berührte
 * Zeilen neu scannen, Komponenten-Deltas auf `next` anwenden.
 * `store=true` (Commit) schreibt die neuen Zeilen-Vektoren in den Cache;
 * `store=false` (Evaluation) lässt den Cache unverändert.
 * Gibt NICHT zurück — Footprints bleiben im NEUEN Zustand (Caller revertiert
 * bei der Evaluation selbst über applyFootprints mit vertauschten Slots).
 */
function applyPairsToCounts(
	state: SolverState,
	scratch: ScoreScratch,
	cache: ScoreCache,
	pairs: MovedPair[],
	next: ScoreBreakdown,
	store: boolean
): void {
	affectedRows.length = 0;
	affectedTeachers.length = 0;

	// Unit-Beiträge (reine Funktion von Slot) + unplaced.
	for (const pr of pairs) {
		if (pr.from !== SLOT_UNPLACED) {
			unitSlotContrib(state, scratch, pr.unitIdx, pr.from, cache.cfg, tmp5);
			for (let c = 0; c < 5; c++) next[UNIT_KEYS[c]] -= tmp5[c];
		} else {
			next.unplaced--;
		}
		if (pr.to !== SLOT_UNPLACED) {
			unitSlotContrib(state, scratch, pr.unitIdx, pr.to, cache.cfg, tmp5);
			for (let c = 0; c < 5; c++) next[UNIT_KEYS[c]] += tmp5[c];
		} else {
			next.unplaced++;
		}
		collectTeachers(state, scratch, pr.unitIdx);
	}

	// Footprints umsetzen: erst ALLE alten entfernen, dann alle neuen setzen
	// (verhindert transienten Doppel-Start in rowStartSubj bei Swaps).
	let spreadDelta = 0;
	for (const pr of pairs) {
		if (pr.from === SLOT_UNPLACED) continue;
		spreadDelta += applyUnitFootprint(state, scratch, pr.unitIdx, pr.from, -1);
		collectRows(state, pr.unitIdx, pr.from);
	}
	for (const pr of pairs) {
		if (pr.to === SLOT_UNPLACED) continue;
		spreadDelta += applyUnitFootprint(state, scratch, pr.unitIdx, pr.to, 1);
		collectRows(state, pr.unitIdx, pr.to);
	}
	next.spec_spread += spreadDelta;

	// Berührte Klassen-Zeilen neu scannen; Delta gegen den gespeicherten Vektor.
	for (const row of affectedRows) {
		const d = Math.floor(row / G);
		const g = row % G;
		scanClassRow(scratch, cache.cfg, d, g, tmpClass);
		const base = row * NC;
		for (let c = 0; c < NC; c++) {
			next[CLASS_KEYS[c]] += tmpClass[c] - cache.classRow[base + c];
		}
		if (store) cache.classRow.set(tmpClass, base);
	}
	// Berührte Lehrer (ganze Woche — gap_fairness/days_present sind Aggregate).
	for (const t of affectedTeachers) {
		scanTeacherWeek(scratch, cache.cfg, t, tmp6);
		const base = t * 6;
		for (let c = 0; c < 6; c++) {
			next[TEACHER_KEYS[c]] += tmp6[c] - cache.teacherRow[base + c];
		}
		if (store) cache.teacherRow.set(tmp6, base);
	}
}

/** Footprints einer Paar-Liste exakt rückgängig machen (inverse Reihenfolge). */
function revertPairFootprints(state: SolverState, scratch: ScoreScratch, pairs: MovedPair[]): void {
	for (const pr of pairs) {
		if (pr.to === SLOT_UNPLACED) continue;
		applyUnitFootprint(state, scratch, pr.unitIdx, pr.to, -1);
	}
	for (const pr of pairs) {
		if (pr.from === SLOT_UNPLACED) continue;
		applyUnitFootprint(state, scratch, pr.unitIdx, pr.from, 1);
	}
}

/**
 * Evaluate the score delta for applying `move`. Does NOT keep the move
 * applied — state is identical before and after the call.
 *
 * Mit Score-Cache (state.scoreCache): Scoped-Pfad über Zeilen-Rescans.
 * Ohne Cache: bewährter Full-Scan (apply → computeScore → revert).
 *
 * Returns: deltaTotal (positive = score got worse) und den vollständigen
 * neuen Breakdown.
 */
export function evaluateDelta(
	state: SolverState,
	move: Move,
	weights: ScoreWeights,
	currentBreakdown: ScoreBreakdown
): { delta: number; nextBreakdown: ScoreBreakdown } {
	const cache = state.scoreCache;
	if (!cache) {
		// Full-Scan-Referenzpfad (Tests, Bench-A/B, defensiver Fallback).
		applyMove(state, move);
		const nextBreakdown = computeScore(state, weights);
		revertMove(state, move);
		return { delta: nextBreakdown.total - currentBreakdown.total, nextBreakdown };
	}

	const scratch = state.scoreScratch!; // Cache existiert nur mit Scratch
	const pairs = collectPairs(move);
	const next: ScoreBreakdown = { ...cache.counts };
	applyPairsToCounts(state, scratch, cache, pairs, next, false);
	revertPairFootprints(state, scratch, pairs);
	next.total = weightedTotal(next, weights);
	return { delta: next.total - currentBreakdown.total, nextBreakdown: next };
}

/**
 * Move ANWENDEN und den Score-Cache mitführen — das Gegenstück zu
 * evaluateDelta für den Accept-Pfad der Local Search. Ohne Cache exakt
 * applyMove (bisheriges Verhalten).
 *
 * `nextBreakdown` (aus evaluateDelta) wird als neuer Zählerstand
 * übernommen — kein zweiter Rescan der Komponenten-Summen nötig; nur die
 * Zeilen-Vektoren der berührten Zeilen werden aktualisiert.
 */
export function commitMove(
	state: SolverState,
	move: Move,
	nextBreakdown: ScoreBreakdown
): void {
	applyMove(state, move);
	const cache = state.scoreCache;
	if (!cache) return;
	const scratch = state.scoreScratch!;
	const pairs = collectPairs(move);
	// Footprints erneut umsetzen und dabei die Zeilen-Vektoren SPEICHERN.
	// Die Komponenten-Summen kommen aus nextBreakdown (identische Arithmetik
	// wie bei der Evaluation — der Property-Test deckt beide Pfade).
	const scratchCounts: ScoreBreakdown = { ...cache.counts };
	applyPairsToCounts(state, scratch, cache, pairs, scratchCounts, true);
	cache.counts = { ...nextBreakdown };
}
