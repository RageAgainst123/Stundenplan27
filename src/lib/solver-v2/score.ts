// Solver v2 — full-scan score calculation.
//
// This module computes the score by walking the entire solver state. It's
// used:
//   - Once at the start of Local Search (initial best score)
//   - In tests to verify incremental score-delta correctness (Property test)
//
// Hot path during Local Search uses scoreDelta.ts (incremental, O(1) per move).
//
// Canonical reference for ALL 21 score components (Stand Solver-Opt Schritt 3):
//   docs/MODEL.md §3 "Score-Komponenten"
// Komponenten: min_daily, no_p1_start, time_pref, main_aft, any_aft, no_free,
// uneven_days, main_run, compact_teacher, main_early, subject_twice,
// spec_spread, teacher_late_start, teacher_under_min, target_daily,
// afternoon_preferred, main_twice, main_block_split, teacher_gap_fairness,
// teacher_days_present, teacher_lunch.
// Wenn hier eine Komponente geändert/hinzugefügt wird → MODEL.md §3 nachziehen
// UND defaultWeights() in types.ts + UI in GenerateButton.svelte (Score-
// Aufschlüsselung) UND PenaltyBreakdown in index.ts erweitern.

import type { GradeLevel, Period, ScheduleDoc } from '../types';
import {
	D,
	DAYS_BY_INDEX,
	P,
	dpFromSlot,
	type ScoreBreakdown,
	type ScoreScratch,
	type ScoreWeights,
	type SolverState,
	SLOT_UNPLACED,
} from './types';

/**
 * Solver-Opt Runde 2, Schritt 2: Scratch-Puffer + statische Per-Unit-Caches.
 *
 * computeScore läuft pro Move (Full-Scan-Delta, scoreDelta.ts) — vorher
 * allozierte jeder Aufruf 3 Int32Arrays, 3 Maps mit String-Keys
 * (`${d}|${g}|${code}`), Occurrence-Arrays + Sort und pro Unit ein
 * map/filter/Set-Trio für timePref. Alles davon ist entweder pro Aufruf
 * resetbar (Puffer) oder über die Session statisch (Unit-Eigenschaften).
 *
 * Lazy: beim ersten computeScore-Aufruf gebaut und am State gecacht.
 * Voraussetzung (gilt im ganzen Solver): doc/units sind während einer
 * Session unveränderlich, nur state.placement mutiert.
 */
function ensureScratch(state: SolverState): ScoreScratch {
	if (state.scoreScratch) return state.scoreScratch;
	const G = 4;
	const T = Math.max(1, state.doc.teachers.length);
	const n = state.nUnits;

	// Fach-Index: doc.subjects zuerst, danach defensiv Unit-Codes die dort
	// fehlen (Verhalten muss identisch zum alten String-Key bleiben — auch
	// unbekannte Codes zählten für subject_twice).
	const subjectIdxByCode = new Map<string, number>();
	for (const s of state.doc.subjects) {
		if (!subjectIdxByCode.has(s.code)) subjectIdxByCode.set(s.code, subjectIdxByCode.size);
	}
	for (let i = 0; i < n; i++) {
		const code = state.units[i].subjectCode;
		if (!subjectIdxByCode.has(code)) subjectIdxByCode.set(code, subjectIdxByCode.size);
	}
	const S = Math.max(1, subjectIdxByCode.size);

	const specIdxById = new Map<string, number>();
	for (const sp of state.doc.specs) {
		if (!specIdxById.has(sp.id)) specIdxById.set(sp.id, specIdxById.size);
	}
	for (let i = 0; i < n; i++) {
		for (const sid of state.units[i].specIds) {
			if (!specIdxById.has(sid)) specIdxById.set(sid, specIdxById.size);
		}
	}
	const NS = Math.max(1, specIdxById.size);

	const teacherIdxById = new Map<string, number>();
	state.doc.teachers.forEach((t, i) => teacherIdxById.set(t.id, i));

	const subjIsMain = new Uint8Array(S);
	for (const [code, idx] of subjectIdxByCode) {
		subjIsMain[idx] = state.subjectsByCode.get(code)?.isMain ? 1 : 0;
	}

	const unitTimePref = new Int8Array(n);
	const unitAfternoonExempt = new Uint8Array(n);
	const unitIsMain = new Uint8Array(n);
	const unitSubjIdx = new Int32Array(n);
	const unitFirstGrade = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		const unit = state.units[i];
		// timePref-Logik unverändert aus dem alten Per-Call-Code: Preference
		// gilt nur wenn alle gesetzten Prefs der gekoppelten Specs übereinstimmen.
		const prefs = unit.specIds
			.map(sid => state.specsById.get(sid)?.timePref)
			.filter((v): v is 'early' | 'late' => v === 'early' || v === 'late');
		const uniquePrefs = new Set(prefs);
		const timePref: 'early' | 'late' | undefined =
			uniquePrefs.size === 1 ? prefs[0] : undefined;
		unitTimePref[i] = timePref === 'early' ? 1 : timePref === 'late' ? 2 : 0;
		unitAfternoonExempt[i] =
			timePref === 'late'
			|| unit.afternoonAllowed === 'preferred'
			|| unit.afternoonAllowed === 'must'
				? 1 : 0;
		unitIsMain[i] = state.subjectsByCode.get(unit.subjectCode)?.isMain ? 1 : 0;
		unitSubjIdx[i] = subjectIdxByCode.get(unit.subjectCode)!;
		const firstSpec = state.specsById.get(unit.specIds[0]);
		unitFirstGrade[i] = firstSpec ? firstSpec.grades[0] : -1;
	}

	const scratch: ScoreScratch = {
		S,
		NS,
		subjectIdxByCode,
		specIdxById,
		teacherIdxById,
		subjIsMain,
		occ: new Int32Array(D * G * P),
		tocc: new Int32Array(T * D * P),
		mainMask: new Int32Array(D * G * P),
		subjCount: new Int32Array(D * G * S),
		occAStart: new Int32Array(D * G * S),
		occASize: new Int32Array(D * G * S),
		occBStart: new Int32Array(D * G * S),
		occBSize: new Int32Array(D * G * S),
		specDay: new Int32Array(NS * D),
		unitTimePref,
		unitAfternoonExempt,
		unitIsMain,
		unitSubjIdx,
		unitFirstGrade,
	};
	state.scoreScratch = scratch;
	return scratch;
}

/**
 * Fill the 3D occupancy bitmap for fast counting.
 *   occ[d * G * P + g * P + p] = number of lesson INSTANCES at (d, g, p)
 *
 * (We index by g 0..3 = grade 5..8.)
 */
function fillOccupancy(state: SolverState, occ: Int32Array): void {
	const G = 4;
	occ.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const { dayIndex, period } = dpFromSlot(slot);
		// Iterate the unit's instances. Block units occupy multiple periods.
		for (const inst of unit.instances) {
			const p = period - 1 + inst.blockPos;
			if (p >= P) continue; // shouldn't happen if construction is correct
			const g = inst.grade - 5; // 5..8 → 0..3
			occ[dayIndex * G * P + g * P + p]++;
		}
	}
}

/**
 * Build a 2D teacher-occupancy bitmap for compact-teacher-day scoring.
 *   tocc[t * D * P + d * P + p] = number of lessons by teacher t at (d, p)
 *
 * Teachers indexed 0..T-1 by document order (we use a Map for the lookup).
 *
 * Exported for bench-metrics.ts (Lehrer-Qualitäts-Metriken nutzen dieselbe
 * Occupancy-Logik — keine Duplikation, keine Drift).
 */
export function buildTeacherOccupancy(state: SolverState): { tocc: Int32Array; teacherIdx: Map<string, number> } {
	const teacherIdx = new Map<string, number>();
	state.doc.teachers.forEach((t, i) => teacherIdx.set(t.id, i));
	const T = Math.max(1, state.doc.teachers.length);
	const tocc = new Int32Array(T * D * P);
	fillTeacherOccupancy(state, tocc, teacherIdx);
	return { tocc, teacherIdx };
}

/** In-place-Variante für den Hot-Path (computeScore mit Scratch-Puffer). */
function fillTeacherOccupancy(state: SolverState, tocc: Int32Array, teacherIdx: Map<string, number>): void {
	tocc.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const { dayIndex, period } = dpFromSlot(slot);
		// Coupling-units have multiple teachers — every team member is busy
		// during this slot, so each one's occupancy bumps. The block-period
		// loop is per teacher; we use distinct period offsets from `instances`
		// only for non-coupling units (each instance maps to one grade column
		// in the same teacher). For couplings, all teachers occupy the same
		// (day, period[..+blockSize-1]) span once, so we iterate blockSize
		// directly for them to avoid double-counting per-grade instances.
		if (unit.kind === 'coupling') {
			for (const tid of unit.teacherIds) {
				const tIdx = teacherIdx.get(tid);
				if (tIdx === undefined) continue;
				for (let pos = 0; pos < unit.blockSize; pos++) {
					const p = period - 1 + pos;
					if (p >= P) continue;
					tocc[tIdx * D * P + dayIndex * P + p]++;
				}
			}
		} else {
			const tIdx = teacherIdx.get(unit.teacherId);
			if (tIdx === undefined) continue;
			for (const inst of unit.instances) {
				const p = period - 1 + inst.blockPos;
				if (p >= P) continue;
				tocc[tIdx * D * P + dayIndex * P + p]++;
			}
		}
	}
}

/**
 * Compute the full score breakdown for a given solver state.
 * O(nUnits + D*G*P + T*D*P) — used at start of LS and in tests.
 */
export function computeScore(state: SolverState, weights: ScoreWeights): ScoreBreakdown {
	const scratch = ensureScratch(state);
	const occ = scratch.occ;
	const tocc = scratch.tocc;
	fillOccupancy(state, occ);
	fillTeacherOccupancy(state, tocc, scratch.teacherIdxById);
	const G = 4;
	const c = state.doc.constraints;
	const minDaily = Math.max(0, Math.min(P, Math.round(c.minDailySlotsPerGrade ?? 0)));
	const afternoonStart =
		Math.max(1, Math.min(P, Math.round(c.noMainSubjectAfternoon.afternoonStartsAtPeriod ?? 7)));
	const maxConsecMain = Math.max(1, Math.min(P, Math.round(c.maxConsecutiveMain.max ?? 2)));

	const breakdown: ScoreBreakdown = {
		min_daily: 0,
		no_p1_start: 0,
		time_pref: 0,
		main_aft: 0,
		any_aft: 0,
		no_free: 0,
		uneven_days: 0,
		main_run: 0,
		compact_teacher: 0,
		main_early: 0,
		subject_twice: 0,
		spec_spread: 0,
		teacher_late_start: 0,
		teacher_under_min: 0,
		target_daily: 0,
		afternoon_preferred: 0,
		main_twice: 0,
		main_block_split: 0,
		teacher_gap_fairness: 0,
		teacher_days_present: 0,
		teacher_lunch: 0,
		total: 0,
	};

	// Phase 13: Zieltagespensum aus ConstraintConfig.
	const targetCfg = (state.doc.constraints as unknown as Record<string, unknown>).targetDailyLessons as
		| { enabled?: boolean; target?: number }
		| undefined;
	const targetEnabled = targetCfg?.enabled !== false;
	const targetDaily = Math.max(1, Math.min(P, Math.round(targetCfg?.target ?? 6)));

	// --- Per (day, grade) walk: lessons_dg, p1-start, no-free, uneven_days
	// lessons_dg counts DISTINCT periods occupied (Slots), not lessons.
	for (let d = 0; d < D; d++) {
		for (let g = 0; g < G; g++) {
			let occupiedPeriods = 0;
			let firstP = -1;
			let lastP = -1;
			let p1Active = false;
			for (let p = 0; p < P; p++) {
				const cnt = occ[d * G * P + g * P + p];
				if (cnt > 0) {
					occupiedPeriods++;
					if (firstP === -1) firstP = p;
					lastP = p;
					if (p === 0) p1Active = true;
				}
			}
			// min_daily: how many slots are missing to reach the target?
			if (minDaily > 0 && occupiedPeriods > 0 && occupiedPeriods < minDaily) {
				breakdown.min_daily += minDaily - occupiedPeriods;
			}
			// no_p1_start: day active but P1 empty
			if (occupiedPeriods > 0 && !p1Active) {
				breakdown.no_p1_start++;
			}
			// no_free: gaps WITHIN the active span (firstP..lastP)
			// PLUS leading gaps before firstP (Phase 13.1 Korrektur).
			// Vorher: Tagesrand-Lücken am Anfang waren "kostenlos" — der Solver
			// hat 7. Stufe Mo P3-P8 statt P1-P6 belegt weil 0 inner gaps
			// = 0 inner gaps, no_p1_start aber nur Gewicht 300. Jetzt zählt
			// firstP selbst als Anzahl leerer Slots davor.
			if (firstP !== -1) {
				breakdown.no_free += firstP; // Lücken P1..firstP-1
				for (let p = firstP + 1; p < lastP; p++) {
					if (occ[d * G * P + g * P + p] === 0) breakdown.no_free++;
				}
			}
			// uneven_days: under-load penalty (re-uses minDaily target).
			// Inaktive Tage (0 Stunden) sind ausgenommen — sonst würden komplett
			// freie Tage (z.B. Freitag Stufe 8) den Solver dazu drängen, Stunden
			// hinzuschieben, obwohl min_daily und target_daily diesen Fall schon
			// korrekt behandeln (beide skippen occupiedPeriods===0).
			const target = Math.max(minDaily, 4);
			if (occupiedPeriods > 0 && occupiedPeriods < target) {
				breakdown.uneven_days += target - occupiedPeriods;
			}
			// Phase 13: target_daily — quadratische Penalty für Abweichung
			// vom Zieltagespensum, in BEIDE Richtungen. min_daily deckt nur
			// den Boden ab; target_daily zwingt den Solver auch von 8 → 6.
			// Inaktive Tage (0 Stunden) sind ausgenommen.
			if (targetEnabled && occupiedPeriods > 0) {
				const diff = occupiedPeriods - targetDaily;
				breakdown.target_daily += diff * diff;
			}
		}
	}

	// --- Per Unit walk: main_aft, any_aft, main_run-precursor, main_early
	// main_run: count 3-runs of main subjects in the same (day, grade).
	// We compute that per (day, grade) from the occupancy + a "main mask".
	//
	// timePref/isMain/afternoonExempt sind statisch pro Unit — vorberechnet
	// in ensureScratch (unitTimePref/unitIsMain/unitAfternoonExempt). Die
	// Original-Semantik (Kopplungs-Konfliktregel, 'late'/'preferred'/'must'-
	// Exemption) ist dort dokumentiert und identisch übernommen.
	const mainMask = scratch.mainMask;
	mainMask.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const isMain = scratch.unitIsMain[i] === 1;
		const timePref = scratch.unitTimePref[i]; // 0 none, 1 early, 2 late
		const afternoonExempt = scratch.unitAfternoonExempt[i] === 1;
		const firstGrade = scratch.unitFirstGrade[i];
		const { dayIndex, period } = dpFromSlot(slot);
		for (const inst of unit.instances) {
			const p = period - 1 + inst.blockPos;
			if (p >= P) continue;
			const g = inst.grade - 5;
			if (p + 1 >= afternoonStart && !afternoonExempt) {
				breakdown.any_aft++;
				if (isMain) breakdown.main_aft++;
			}
			// Phase 13: afternoon_preferred — Spec SOLL nachmittags sein,
			// liegt aber im Vormittag. Penalty pro Vormittag-Slot. Reziprok
			// zu any_aft/main_aft. Nur für 'preferred' — 'must' ist via H11
			// schon hart erzwungen.
			if (unit.afternoonAllowed === 'preferred' && p + 1 < afternoonStart) {
				breakdown.afternoon_preferred++;
			}
			if (isMain) {
				if (!afternoonExempt) breakdown.main_early += p; // (period-1)
				mainMask[dayIndex * G * P + g * P + p] = 1;
			}
			// time_pref accumulates once per distinct period the unit occupies.
			// Deduplicate via (specId === unit.specIds[0]) AND (grade is the
			// first grade of that spec) so multi-grade tuples and couplings
			// don't multiply the penalty.
			if (timePref !== 0 && inst.specId === unit.specIds[0] && inst.grade === firstGrade) {
				if (timePref === 1) {
					breakdown.time_pref += p; // distance from P1 (idx 0)
				} else {
					breakdown.time_pref += P - 1 - p; // distance from P8 (idx 7)
				}
			}
		}
	}

	// main_run: count windows of (max_consec+1) consecutive ones in mainMask.
	const win = maxConsecMain + 1;
	for (let d = 0; d < D; d++) {
		for (let g = 0; g < G; g++) {
			let run = 0;
			for (let p = 0; p < P; p++) {
				if (mainMask[d * G * P + g * P + p] === 1) {
					run++;
					if (run >= win) breakdown.main_run++;
				} else {
					run = 0;
				}
			}
		}
	}

	// --- Per (teacher, day) walk: compact_teacher (sandwich gaps),
	//     teacher_late_start (fairness across teachers),
	//     teacher_under_min (avoid 1-lesson days).
	const minLessonsCfg = state.doc.constraints.teacherMinLessonsPerDay as
		| { enabled?: boolean; min?: number }
		| undefined;
	const minLessonsActive = minLessonsCfg?.enabled !== false;
	const minLessonsTarget = Math.max(1, Math.min(P, Math.round(minLessonsCfg?.min ?? 2)));
	const T = state.doc.teachers.length;
	for (let t = 0; t < T; t++) {
		const teacher = state.doc.teachers[t];
		// Solver-Opt Schritt 3: Wochen-Akkumulatoren pro Lehrer — im selben
		// Loop mitgeführt (KEIN zweiter Scan, computeScore läuft pro Move!).
		let weekGaps = 0;
		let weekLessons = 0;
		let daysPresent = 0;
		for (let d = 0; d < D; d++) {
			let firstP = -1;
			let lastP = -1;
			let occupiedPeriods = 0;
			for (let p = 0; p < P; p++) {
				if (tocc[t * D * P + d * P + p] > 0) {
					if (firstP === -1) firstP = p;
					lastP = p;
					occupiedPeriods++;
				}
			}
			if (occupiedPeriods > 0) {
				daysPresent++;
				weekLessons += occupiedPeriods;
			}
			// compact_teacher uses QUADRATIC penalty per (teacher, day):
			// N gaps cost N² instead of N. Means 0 gaps = 0, 1 gap = 1
			// (same as before), 2 gaps = 4 (vs. 2 before), 3 gaps = 9.
			// User-Logik: 1 Freistunde ist ok, 2 ist schlecht, 3+ ist
			// inakzeptabel — exponentielle Eskalation passt das ab.
			if (firstP !== -1 && lastP > firstP) {
				let gapsThisDay = 0;
				for (let p = firstP + 1; p < lastP; p++) {
					if (tocc[t * D * P + d * P + p] === 0) gapsThisDay++;
				}
				breakdown.compact_teacher += gapsThisDay * gapsThisDay;
				weekGaps += gapsThisDay;
			}
			// teacher_lunch: langer Tag (>=6 Stunden) der Vormittag (P1-P4,
			// idx 0-3) UND Nachmittag (P7-P8, idx 6-7) umfasst, aber P5 UND P6
			// (idx 4+5) beide belegt hat → keine Mittagspause möglich.
			// Nur zählen wenn die Komponente aktiviert ist (Gewicht > 0 spart
			// den Scan nicht, aber die Bedingung ist billig).
			if (occupiedPeriods >= 6) {
				const base = t * D * P + d * P;
				const p5busy = tocc[base + 4] > 0;
				const p6busy = tocc[base + 5] > 0;
				if (p5busy && p6busy) {
					let hasMorning = false;
					for (let p = 0; p <= 3; p++) if (tocc[base + p] > 0) { hasMorning = true; break; }
					if (hasMorning) {
						let hasAfternoon = false;
						for (let p = 6; p <= 7; p++) if (tocc[base + p] > 0) { hasAfternoon = true; break; }
						if (hasAfternoon) breakdown.teacher_lunch++;
					}
				}
			}
			// teacher_late_start: only counts when teacher has lessons that
			// day AND was actually free in P1 (otherwise the late start was
			// forced by Sperrstunde, not by solver choice). Penalty is the
			// distance in periods from P1 — so a P3-Start counts more than
			// a P2-Start. The penalty grows linearly to nudge the solver
			// toward fairness across teachers without forbidding late
			// starts where they're necessary.
			if (firstP > 0) {
				const dayName = DAYS_BY_INDEX[d];
				const blockedAtP1 = teacher.unavailable?.some(
					u => u.day === dayName && u.period === 1
				) ?? false;
				if (!blockedAtP1) {
					breakdown.teacher_late_start += firstP;
				}
			}
			// teacher_under_min: a teacher's working day should reach the
			// minimum. 0 lessons → free day, no penalty. 1 lesson with min=2
			// → penalty 1. The solver can fix this by either pulling another
			// lesson to this day or by moving the lonely lesson elsewhere.
			if (
				minLessonsActive &&
				occupiedPeriods > 0 &&
				occupiedPeriods < minLessonsTarget
			) {
				breakdown.teacher_under_min += minLessonsTarget - occupiedPeriods;
			}
		}

		// Solver-Opt Schritt 3 — Wochen-Auswertung pro Lehrer:
		// teacher_gap_fairness: (Wochen-Lücken)² — Springstunden sollen nicht
		// bei einem Lehrer klumpen. 1 Lehrer × 5 Lücken = 25, 5 Lehrer × 1 = 5.
		breakdown.teacher_gap_fairness += weekGaps * weekGaps;
		// teacher_days_present: Anwesenheitstage über dem Ideal
		// ceil(wochenstunden / 6). Teilzeit mit 8h → Ideal 2 Tage; jeder Tag
		// darüber +1. Lehrer ohne Stunden sind exempt.
		if (weekLessons > 0) {
			const idealDays = Math.ceil(weekLessons / 6);
			if (daysPresent > idealDays) {
				breakdown.teacher_days_present += daysPresent - idealDays;
			}
		}
	}

	// --- subject_twice: same subject more than once per (day, grade).
	// Integer-Zähler subjCount[(d*G+g)*S + subjIdx] statt Map mit String-
	// Keys. Allowed bonus: same coupling/multi-grade instances at the same
	// slot don't trigger (one Unit = one teaching event, Zählung pro Unit).
	//
	// Phase 13.3: zusätzlich main_twice (Hauptfach 3+ am Tag) und
	// main_block_split (zwei Hauptfach-Vorkommen, nicht konsekutiv). Für
	// block_split merken wir die ersten ZWEI Vorkommen (Start, Größe) pro
	// Zelle — mehr braucht die Formel nicht (sie gilt nur bei exakt 2).
	const S = scratch.S;
	const subjCount = scratch.subjCount;
	subjCount.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const { dayIndex, period } = dpFromSlot(slot);
		const subjIdx = scratch.unitSubjIdx[i];
		for (const grade of unit.grades) {
			const k = (dayIndex * G + (grade - 5)) * S + subjIdx;
			const c = ++subjCount[k];
			if (c === 1) {
				scratch.occAStart[k] = period; // period ist 1-basiert
				scratch.occASize[k] = unit.blockSize;
			} else if (c === 2) {
				scratch.occBStart[k] = period;
				scratch.occBSize[k] = unit.blockSize;
			}
		}
	}
	for (let k = 0; k < D * G * S; k++) {
		const v = subjCount[k];
		if (v === 0) continue;
		if (v > 1) breakdown.subject_twice += v - 1;
		const isMain = scratch.subjIsMain[k % S] === 1;
		// Phase 13.3 main_twice: 3+ Vorkommen Hauptfach am gleichen Tag/Stufe.
		if (isMain && v > 2) {
			breakdown.main_twice += v - 2;
		}
		// Phase 13.3 main_block_split: bei genau 2 Vorkommen — exakte
		// Lücke zwischen Ende des ersten Blocks und Anfang des zweiten.
		// Mathe Doppel P1-P2 + Einzel P3 = Ende=P2, Anfang=P3 → 0 (konsekutiv)
		// Mathe Einzel P1 + Einzel P3 = Ende=P1, Anfang=P3 → 1 (P2 dazwischen)
		// Mathe Doppel P1-P2 + Einzel P5 = Ende=P2, Anfang=P5 → 2 (P3,P4 frei)
		if (isMain && v === 2) {
			// Die zwei Vorkommen nach Start-Periode ordnen (Einfüge-Reihenfolge
			// ist nicht sortiert — wie vorher der Sort über die Occurrence-Liste).
			let firstStart = scratch.occAStart[k];
			let firstSize = scratch.occASize[k];
			let secondStart = scratch.occBStart[k];
			if (secondStart < firstStart) {
				secondStart = firstStart;
				firstStart = scratch.occBStart[k];
				firstSize = scratch.occBSize[k];
			}
			const firstEnd = firstStart + firstSize - 1; // letzte belegte Periode des ersten Blocks
			const gap = Math.max(0, secondStart - firstEnd - 1);
			breakdown.main_block_split += gap;
		}
	}

	// --- spec_spread: occurrences of the SAME spec on the SAME weekday count
	// as a violation (we want them spread across the week). One penalty per
	// extra same-day occurrence beyond the first.
	const specDay = scratch.specDay;
	specDay.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const { dayIndex } = dpFromSlot(slot);
		for (const sid of unit.specIds) {
			const spIdx = scratch.specIdxById.get(sid);
			if (spIdx !== undefined) specDay[spIdx * D + dayIndex]++;
		}
	}
	for (let k = 0; k < scratch.NS * D; k++) {
		const v = specDay[k];
		if (v > 1) breakdown.spec_spread += v - 1;
	}

	// --- Final weighted sum
	breakdown.total =
		weights.min_daily * breakdown.min_daily +
		weights.no_p1_start * breakdown.no_p1_start +
		weights.main_aft * breakdown.main_aft +
		weights.any_aft * breakdown.any_aft +
		weights.no_free * breakdown.no_free +
		weights.uneven_days * breakdown.uneven_days +
		weights.main_run * breakdown.main_run +
		weights.compact_teacher * breakdown.compact_teacher +
		weights.main_early * breakdown.main_early +
		weights.time_pref * breakdown.time_pref +
		weights.subject_twice * breakdown.subject_twice +
		weights.spec_spread * breakdown.spec_spread +
		weights.teacher_late_start * breakdown.teacher_late_start +
		weights.teacher_under_min * breakdown.teacher_under_min +
		weights.target_daily * breakdown.target_daily +
		weights.afternoon_preferred * breakdown.afternoon_preferred +
		weights.main_twice * breakdown.main_twice +
		weights.main_block_split * breakdown.main_block_split +
		weights.teacher_gap_fairness * breakdown.teacher_gap_fairness +
		weights.teacher_days_present * breakdown.teacher_days_present +
		weights.teacher_lunch * breakdown.teacher_lunch;

	return breakdown;
}

// Suppress unused parameter warnings for types-only imports
void (null as unknown as ScheduleDoc);
void (null as unknown as Period);
void (null as unknown as GradeLevel);
