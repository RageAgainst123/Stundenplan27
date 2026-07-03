// Solver v2 — LNS-Destroy-Strategien für den Diversify-Modus.
//
// Solver-Opt Runde 2, Schritt 1: Diversify wählte die zurückzusetzenden
// Units bisher rein zufällig. Die LNS-Literatur (Shaw 1998, Ropke &
// Pisinger 2006) zeigt: *related removal* und *worst removal* schlagen
// random deutlich — der Repair kann zusammengehörige Stunden tatsächlich
// neu kombinieren, statt zufällige Einzelteile zu verschieben.
//
// Strategien:
//  - 'random'        — heutiges Verhalten (Fisher-Yates-Auswahl).
//  - 'worst-teacher' — Lehrer mit den meisten Wochen-Springstunden ranken,
//                      dessen Units (Top-2 Lehrer) zuerst zurücksetzen.
//                      Zielt direkt auf die User-Priorität Springstunden.
//  - 'related-day'   — (Tag, Stufe)-Streifen mit Klassen-Lücke (no_free)
//                      oder größter Tagespensum-Abweichung wählen und
//                      alle Units des Streifens zurücksetzen.
//
// Alle Strategien füllen mit zufälligen Kandidaten bis zur Ziel-Fraction
// auf — die Diversifikations-Breite bleibt also vergleichbar, nur die
// SEED-Auswahl ist zielgerichtet.

import { buildTeacherOccupancy } from './score';
import { Rng } from './moves';
import { D, P, SLOT_UNPLACED, dpFromSlot, type SolverState } from './types';

export type DiversifyStrategy = 'random' | 'worst-teacher' | 'related-day';

/**
 * Wählt die zurückzusetzenden Unit-Indizes für einen Diversify-Lauf.
 *
 * @param fraction Ziel-Anteil der nicht-gepinnten, platzierten Units
 *                 (bereits geclamped vom Caller, typ. 0.05–0.5).
 * @returns Unit-Indizes (Teilmenge der movable Units). Leer wenn es
 *          keine beweglichen Units gibt.
 */
export function pickDiversifyResetUnits(
	state: SolverState,
	fraction: number,
	strategy: DiversifyStrategy,
	rng: Rng
): number[] {
	const candidates: number[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		if (!state.units[i].pinned && state.placement[i] !== SLOT_UNPLACED) {
			candidates.push(i);
		}
	}
	if (candidates.length === 0) return [];
	const target = Math.max(1, Math.floor(candidates.length * fraction));

	// Strategie-Seeds: zielgerichtete Auswahl. Kann kleiner als target sein
	// (dann random auffüllen) und ist auf 50% der Kandidaten gedeckelt,
	// damit ein Lehrer mit sehr vielen Stunden nicht den halben Plan abreißt.
	const seedCap = Math.max(target, Math.floor(candidates.length * 0.5));
	const chosen = new Set<number>();

	if (strategy === 'worst-teacher') {
		// Lehrer in Rang-Reihenfolge KOMPLETT zerstören (das ist die
		// LNS-Idee: zusammengehörige Menge), aber keinen weiteren Lehrer
		// anfangen sobald das Fraction-Ziel erreicht ist — sonst würde ein
		// 10%-Feinschliff-Zyklus zwei volle Lehrer-Pläne abreißen.
		for (const tid of rankTeachersByWeekGaps(state)) {
			if (chosen.size >= target) break;
			const units = state.unitsByTeacher.get(tid) ?? [];
			for (const u of units) {
				if (chosen.size >= seedCap) break;
				if (u.pinned || state.placement[u.idx] === SLOT_UNPLACED) continue;
				chosen.add(u.idx);
			}
		}
	} else if (strategy === 'related-day') {
		const stripe = pickWorstStripe(state, rng);
		if (stripe !== null) {
			const { day, grade } = stripe;
			for (const idx of candidates) {
				if (chosen.size >= seedCap) break;
				const u = state.units[idx];
				if (!u.grades.includes(grade)) continue;
				if (dpFromSlot(state.placement[idx]).dayIndex !== day) continue;
				chosen.add(idx);
			}
		}
	}

	// Random-Auffüllung bis target (bzw. komplette Random-Auswahl bei
	// strategy='random' oder wenn die Strategie nichts gefunden hat).
	// Fisher-Yates-Partial-Shuffle über die Kandidaten.
	if (chosen.size < target) {
		const pool = candidates.filter(idx => !chosen.has(idx));
		const need = target - chosen.size;
		for (let i = 0; i < need && i < pool.length; i++) {
			const j = i + rng.int(0, pool.length - i);
			[pool[i], pool[j]] = [pool[j], pool[i]];
			chosen.add(pool[i]);
		}
	}

	return Array.from(chosen);
}

/**
 * Lehrer-IDs absteigend nach Wochen-Springstunden (innere Tageslücken,
 * Wochensumme). Lehrer ohne Lücken tauchen nicht auf.
 */
function rankTeachersByWeekGaps(state: SolverState): string[] {
	const { tocc, teacherIdx } = buildTeacherOccupancy(state);
	const ranked: Array<{ tid: string; gaps: number }> = [];
	for (const [tid, tIdx] of teacherIdx) {
		let weekGaps = 0;
		for (let d = 0; d < D; d++) {
			let firstP = -1;
			let lastP = -1;
			for (let p = 0; p < P; p++) {
				if (tocc[tIdx * D * P + d * P + p] > 0) {
					if (firstP === -1) firstP = p;
					lastP = p;
				}
			}
			if (firstP === -1) continue;
			for (let p = firstP + 1; p < lastP; p++) {
				if (tocc[tIdx * D * P + d * P + p] === 0) weekGaps++;
			}
		}
		if (weekGaps > 0) ranked.push({ tid, gaps: weekGaps });
	}
	ranked.sort((a, b) => b.gaps - a.gaps);
	return ranked.map(r => r.tid);
}

/**
 * Wählt den „schlechtesten" (Tag, Stufe)-Streifen: bevorzugt einen mit
 * Klassen-Lücken (innere + führende — beides zählt für no_free), sonst
 * den mit der größten quadratischen Abweichung vom Zieltagespensum.
 * Bei mehreren Lücken-Streifen entscheidet rng (Diversität über Zyklen).
 */
function pickWorstStripe(
	state: SolverState,
	rng: Rng
): { day: number; grade: 5 | 6 | 7 | 8 } | null {
	const G = 4;
	// Occupancy (bool) pro (Tag, Stufe, Periode) aus den Placements.
	const occ = new Uint8Array(D * G * P);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const u = state.units[i];
		const { dayIndex, period } = dpFromSlot(slot);
		for (const g of u.grades) {
			for (let pos = 0; pos < u.blockSize; pos++) {
				const pIdx = period - 1 + pos;
				if (pIdx < P) occ[dayIndex * G * P + (g - 5) * P + pIdx] = 1;
			}
		}
	}

	const targetCfg = (state.doc.constraints as unknown as Record<string, unknown>)
		.targetDailyLessons as { target?: number } | undefined;
	const targetDaily = Math.max(1, Math.min(P, Math.round(targetCfg?.target ?? 6)));

	const gapped: Array<{ day: number; grade: 5 | 6 | 7 | 8 }> = [];
	let worstDev: { day: number; grade: 5 | 6 | 7 | 8 } | null = null;
	let worstDevValue = 0;
	for (let d = 0; d < D; d++) {
		for (let g = 0; g < G; g++) {
			let firstP = -1;
			let lastP = -1;
			let occupied = 0;
			for (let p = 0; p < P; p++) {
				if (occ[d * G * P + g * P + p]) {
					if (firstP === -1) firstP = p;
					lastP = p;
					occupied++;
				}
			}
			if (occupied === 0) continue;
			const grade = (g + 5) as 5 | 6 | 7 | 8;
			// Lücken = führende (vor firstP) + innere (firstP..lastP).
			let gaps = firstP;
			for (let p = firstP + 1; p < lastP; p++) {
				if (!occ[d * G * P + g * P + p]) gaps++;
			}
			if (gaps > 0) gapped.push({ day: d, grade });
			const dev = (occupied - targetDaily) * (occupied - targetDaily);
			if (dev > worstDevValue) {
				worstDevValue = dev;
				worstDev = { day: d, grade };
			}
		}
	}

	if (gapped.length > 0) return gapped[rng.int(0, gapped.length)];
	return worstDev;
}
