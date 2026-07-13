// Feinschliff 2.0 (F2-S3): Tauschvorschläge — das Untis-Prinzip.
//
// Statt eines Black-Box-Solver-Laufs zählt diese Engine für eine gewählte
// Stunde (oder alle Stunden eines Lehrers) ALLE zulässigen Einzel-Züge
// auf und bewertet jeden exakt:
//
//   - VERSCHIEBEN auf jeden freien, hard-zulässigen Slot
//   - 2er-TAUSCH mit jeder anderen beweglichen Stunde (beide Richtungen
//     hard-geprüft, Muster genSlotSwap)
//
// Bewertung über die R3-S1-Maschine (evaluateDelta mit Scoped-Score-
// Cache, Mikrosekunden pro Kandidat) — deterministisch, kein Zufall,
// dieselben Gewichte wie der Generator. Ergebnis: eine nach Gewinn
// sortierte Vorschlagsliste wie Untis' „Tauschvorschläge" (Gewinn-
// Spalte, Auswirkungen, ausführen per Klick).
//
// Kopplungen/Multi-Grade/Blöcke sind automatisch korrekt: die Engine
// arbeitet auf Solver-UNITS (eine Kopplungs-Gruppe = eine Unit, ein
// Block = eine Unit) — buildState(doc, {hotStart:true}) lädt den
// aktuellen Plan verlustfrei in den State (dieselbe Logik wie der
// „Weiter optimieren"-Hot-Start).

import type { PlacedLesson, Period, ScheduleDoc } from './types';
import { buildState } from './solver-v2/units';
import { wouldViolate } from './solver-v2/hardCheck';
import { applyMove, revertMove, type Move } from './solver-v2/moves';
import { evaluateDelta, rebuildScoreCache } from './solver-v2/scoreDelta';
import { placementToPlacedLessons } from './solver-v2/index';
import {
	D, P, defaultWeights, dpFromSlot, DAYS_BY_INDEX, SLOT_UNPLACED,
	type SolverState, type Unit,
} from './solver-v2/types';
import { slotKeyOf } from './schedule-helpers';
import { computeTeacherQuality } from './teacher-quality';

/** Kennzahlen-Änderung eines betroffenen Lehrers (nur wenn ≠ 0). */
export interface SuggestionTeacherDelta {
	name: string;
	color: string;
	gapsBefore: number;
	gapsAfter: number;
}

export interface FinetuneSuggestion {
	id: string;
	kind: 'move' | 'swap';
	/** Klartext: „M: Di P1 → Mo P5 (frei)" / „M Di P1 ⇄ D Mo P2 (Beta)". */
	label: string;
	/** Score-Gewinn: negativ = Plan wird besser. */
	delta: number;
	/** Springstunden-Änderungen der betroffenen Lehrer (für die Anzeige). */
	teacherDeltas: SuggestionTeacherDelta[];
	/** Kompletter Plan-Stand nach dem Zug (Pins korrekt, dekodiert). */
	candidatePlaced: PlacedLesson[];
	/** Grid-Zellen der Quelle(n) — slotKeyOf-Format, fürs Hover-Highlight. */
	sourceCells: string[];
	/** Grid-Zellen des Ziels/Partners — fürs Hover-Highlight. */
	targetCells: string[];
}

export interface SuggestOptions {
	/** Maximal zurückgegebene Vorschläge (Default 10). */
	maxResults?: number;
	/**
	 * Schlechtester noch gezeigter Delta-Wert (Default +50): echte
	 * Verbesserungen zuerst, „fast neutrale" Züge bleiben sichtbar —
	 * wie Untis auch leicht negative Tausche listet.
	 */
	maxDelta?: number;
}

/** Grid-Zellen (slotKeyOf) einer Unit an einem Slot. */
function unitCells(unit: Unit, slot: number): string[] {
	if (slot === SLOT_UNPLACED) return [];
	const { dayIndex, period } = dpFromSlot(slot);
	const day = DAYS_BY_INDEX[dayIndex];
	const cells: string[] = [];
	for (const inst of unit.instances) {
		const p = period + inst.blockPos;
		if (p > P) continue;
		cells.push(slotKeyOf(day, p as Period, inst.grade));
	}
	return [...new Set(cells)];
}

function slotLabel(slot: number): string {
	const { dayIndex, period } = dpFromSlot(slot);
	return `${DAYS_BY_INDEX[dayIndex]} P${period}`;
}

/**
 * Vorschläge für konkrete Stunden (UI-Auswahl: `specId|day|period`-Keys)
 * oder — via leerer keys-Liste + teacherId — für alle beweglichen
 * Stunden eines Lehrers.
 *
 * `doc` muss ein PLAIN Object sein ($state.snapshot im Svelte-Kontext).
 */
export function suggestSwaps(
	doc: ScheduleDoc,
	target: { lessonKeys?: string[]; teacherId?: string },
	opts: SuggestOptions = {}
): FinetuneSuggestion[] {
	const maxResults = opts.maxResults ?? 10;
	const maxDelta = opts.maxDelta ?? 50;

	// Aktuellen Plan verlustfrei in den Solver-State laden (Hot-Start-
	// Logik aus units.ts — Pins bleiben Pins, Rest wird beweglich).
	const state = buildState(doc, { hotStart: true });
	const strictNoFree =
		doc.constraints.noFreePeriodsForClass.strict !== false &&
		doc.constraints.noFreePeriodsForClass.enabled !== false;
	const weights = defaultWeights(doc, strictNoFree);
	const cur = rebuildScoreCache(state, weights);

	// lessonKey (specId|day|period, pro Block-Periode) → Unit-Index.
	const keyToUnit = new Map<string, number>();
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const { dayIndex, period } = dpFromSlot(slot);
		const day = DAYS_BY_INDEX[dayIndex];
		for (let pos = 0; pos < unit.blockSize; pos++) {
			const p = period + pos;
			if (p > P) continue;
			for (const sid of unit.specIds) {
				keyToUnit.set(`${sid}|${day}|${p}`, i);
			}
		}
	}

	// Ziel-Units einsammeln (dedupliziert, Pins ausgeschlossen).
	const targetUnits = new Set<number>();
	if (target.lessonKeys) {
		for (const key of target.lessonKeys) {
			const i = keyToUnit.get(key);
			if (i !== undefined && !state.units[i].pinned) targetUnits.add(i);
		}
	}
	if (target.teacherId) {
		for (let i = 0; i < state.nUnits; i++) {
			if (state.placement[i] === SLOT_UNPLACED) continue;
			if (state.units[i].pinned) continue;
			if (state.units[i].teacherIds.includes(target.teacherId)) targetUnits.add(i);
		}
	}
	if (targetUnits.size === 0) return [];

	// Kandidaten aufzählen: Verschieben auf freie Slots + 2er-Tausche.
	interface Cand { move: Move; kind: 'move' | 'swap'; delta: number }
	const cands: Cand[] = [];
	const seenSwap = new Set<string>();
	for (const i of targetUnits) {
		const unit = state.units[i];
		const fromSlot = state.placement[i];
		// (a) Verschieben: jeder hard-zulässige Slot (der eigene ausgenommen).
		for (let slot = 0; slot < D * P; slot++) {
			if (slot === fromSlot) continue;
			if (wouldViolate(state, unit, slot) !== null) continue;
			const move: Move = { kind: 'slot-move', unitIdx: i, fromSlot, toSlot: slot };
			const { delta } = evaluateDelta(state, move, weights, cur);
			if (delta <= maxDelta) cands.push({ move, kind: 'move', delta });
		}
		// (b) 2er-Tausch: mit jeder anderen beweglichen, platzierten Unit —
		// beide Richtungen hard-geprüft (ignoreUnit = der jeweilige Partner,
		// Muster genSlotSwap in moves.ts).
		for (let j = 0; j < state.nUnits; j++) {
			if (j === i || state.units[j].pinned) continue;
			const other = state.units[j];
			const otherSlot = state.placement[j];
			if (otherSlot === SLOT_UNPLACED || otherSlot === fromSlot) continue;
			const swapKey = i < j ? `${i}:${j}` : `${j}:${i}`;
			if (seenSwap.has(swapKey)) continue;
			seenSwap.add(swapKey);
			if (wouldViolate(state, unit, otherSlot, other) !== null) continue;
			if (wouldViolate(state, other, fromSlot, unit) !== null) continue;
			const move: Move = {
				kind: 'slot-swap',
				aIdx: i, bIdx: j,
				aSlot: fromSlot, bSlot: otherSlot,
			};
			const { delta } = evaluateDelta(state, move, weights, cur);
			if (delta <= maxDelta) cands.push({ move, kind: 'swap', delta });
		}
	}

	// Ranking: bester Gewinn zuerst; deterministischer Tie-Break.
	cands.sort((a, b) => a.delta - b.delta || JSON.stringify(a.move).localeCompare(JSON.stringify(b.move)));
	const top = cands.slice(0, maxResults);

	// Top-N ausarbeiten: Kandidaten-Plan dekodieren + Lehrer-Δ berechnen.
	const beforeQ = computeTeacherQuality(doc);
	const beforeGaps = new Map(beforeQ.map(r => [r.teacherId, r]));
	const out: FinetuneSuggestion[] = [];
	for (const c of top) {
		applyMove(state, c.move);
		const candidatePlaced = placementToPlacedLessons(state, state.placement);
		revertMove(state, c.move);

		const afterQ = computeTeacherQuality({ ...doc, placed: candidatePlaced });
		const afterGaps = new Map(afterQ.map(r => [r.teacherId, r]));
		const teacherDeltas: SuggestionTeacherDelta[] = [];
		for (const [tid, b] of beforeGaps) {
			const a = afterGaps.get(tid);
			const gapsAfter = a?.gaps ?? 0;
			if (gapsAfter !== b.gaps) {
				teacherDeltas.push({ name: b.name, color: b.color, gapsBefore: b.gaps, gapsAfter });
			}
		}
		for (const [tid, a] of afterGaps) {
			if (!beforeGaps.has(tid) && a.gaps > 0) {
				teacherDeltas.push({ name: a.name, color: a.color, gapsBefore: 0, gapsAfter: a.gaps });
			}
		}

		if (c.move.kind === 'slot-move') {
			const unit = state.units[c.move.unitIdx];
			out.push({
				id: `m:${c.move.unitIdx}:${c.move.toSlot}`,
				kind: 'move',
				label: `${unit.subjectCode}: ${slotLabel(c.move.fromSlot)} → ${slotLabel(c.move.toSlot)} (frei)`,
				delta: c.delta,
				teacherDeltas,
				candidatePlaced,
				sourceCells: unitCells(unit, c.move.fromSlot),
				targetCells: unitCells(unit, c.move.toSlot),
			});
		} else if (c.move.kind === 'slot-swap') {
			const a = state.units[c.move.aIdx];
			const b = state.units[c.move.bIdx];
			const partnerTeacher = state.teachersById.get(b.teacherId)?.name?.split(' ')[0] ?? '?';
			out.push({
				id: `s:${c.move.aIdx}:${c.move.bIdx}`,
				kind: 'swap',
				label: `${a.subjectCode} ${slotLabel(c.move.aSlot)} ⇄ ${b.subjectCode} ${slotLabel(c.move.bSlot)} (${partnerTeacher})`,
				delta: c.delta,
				teacherDeltas,
				candidatePlaced,
				sourceCells: unitCells(a, c.move.aSlot),
				targetCells: unitCells(b, c.move.bSlot),
			});
		}
	}
	return out;
}
