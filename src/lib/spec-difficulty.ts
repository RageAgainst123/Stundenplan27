// R3-S6: Platzierungs-Schwierigkeit pro Lehreinheit (aSc-Vorbild
// „Analyze by generation": WELCHE Stunden verstopfen den Plan?).
//
// Die Punkte-Heuristik spiegelt die Construction-Reihenfolge des Solvers
// (construct.ts computeOrdering: schwierigste zuerst) auf Doc-Ebene —
// statisch aus den Stammdaten berechnet, kein Solver-Lauf nötig. Der
// Report im Generator kombiniert sie mit dem tatsächlichen Ergebnis
// (ungeplante Specs werden markiert).

import type { LessonSpec, ScheduleDoc } from './types';
import { effectiveSlotCount } from './schedule-helpers';

export interface SpecDifficulty {
	spec: LessonSpec;
	/** Heuristik-Punkte — höher = schwerer zu platzieren. */
	score: number;
	/** Menschlich lesbare Gründe (Chips im UI). */
	reasons: string[];
}

/**
 * Schwierigkeits-Punkte pro Spec, absteigend sortiert. Nur Specs mit
 * `includeInSolver` — was der Generator nicht anfasst, kann ihn auch
 * nicht verstopfen.
 */
export function computeSpecDifficulties(doc: ScheduleDoc): SpecDifficulty[] {
	const out: SpecDifficulty[] = [];
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		let score = 0;
		const reasons: string[] = [];

		if (spec.couplingId) {
			score += 500;
			reasons.push('gekoppelt');
		}
		if (spec.grades.length > 1) {
			score += 200 * (spec.grades.length - 1);
			reasons.push(`mehrstufig (${spec.grades.join('+')})`);
		}
		if (spec.blocks?.some(b => b > 1)) {
			score += 100;
			reasons.push('Doppelstunden-Block');
		}
		if (spec.teachers.length > 1) {
			score += 150 * (spec.teachers.length - 1);
			reasons.push(`Team (${spec.teachers.length} Lehrer)`);
		}
		// Lehrer-Sperren: die Spec kann nur in Slots, in denen ALLE ihre
		// Lehrer frei sind — die Vereinigung der Sperren zählt.
		const blockedSlots = new Set<string>();
		for (const tid of spec.teachers) {
			const t = doc.teachers.find(x => x.id === tid);
			for (const u of t?.unavailable ?? []) blockedSlots.add(`${u.day}|${u.period}`);
		}
		if (blockedSlots.size > 0) {
			score += 30 * blockedSlots.size;
			if (blockedSlots.size >= 10) reasons.push(`Lehrer stark gesperrt (${blockedSlots.size} Slots)`);
		}
		if (spec.afternoonAllowed === 'never') {
			score += 80;
			reasons.push('nur Vormittag');
		}
		if (spec.afternoonAllowed === 'must') {
			score += 120;
			reasons.push('nur Nachmittag');
		}
		if (spec.weekPattern !== 'every') {
			score += 50;
			reasons.push(spec.weekPattern === 'even' ? 'G-Woche' : 'U-Woche');
		}
		score += 20 * effectiveSlotCount(spec);
		if (effectiveSlotCount(spec) >= 4) reasons.push(`${effectiveSlotCount(spec)} Wochenstunden`);

		out.push({ spec, score, reasons });
	}
	out.sort((a, b) => b.score - a.score);
	return out;
}
