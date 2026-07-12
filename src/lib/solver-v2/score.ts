// Solver v2 — score calculation, zerlegt in Zeilen-Beiträge (R3 Schritt 1).
//
// ARCHITEKTUR (Scoped-Delta-Grundlage): Der Gesamtscore ist die Summe
// unabhängiger Beiträge entlang dreier Achsen plus zwei globaler Zähler:
//
//   - scanClassRow(d, g)    → 9 Komponenten pro (Tag × Stufe)-Zeile
//   - scanTeacherWeek(t)    → 6 Komponenten pro Lehrer (ganze Woche)
//   - unitSlotContrib(i, s) → 5 Komponenten pro platzierter Unit
//   - global: spec_spread (aus specDay-Zählern), unplaced
//
// computeScore() = Summe über ALLE Zeilen; das Scoped-Delta in scoreDelta.ts
// summiert nur die von einem Move BERÜHRTEN Zeilen neu — mit EXAKT denselben
// Scan-Funktionen. Dadurch können Voll- und Delta-Pfad strukturell nicht
// auseinanderlaufen (zusätzlich abgesichert durch den Property-Test in
// scoreDelta.test.ts).
//
// Die Scan-Funktionen lesen NUR die Footprint-Arrays (occ, tocc, mainCnt,
// rowStartSubj/Size, specDay) — nie state.placement direkt. Footprints
// werden über addUnitFootprint/removeUnitFootprint gepflegt; der Voll-Scan
// ist "clear + alle Units adden".
//
// Canonical reference for ALL 22 score components (Stand Solver-Opt R2):
//   docs/MODEL.md §3 "Score-Komponenten"
// Komponenten: min_daily, no_p1_start, time_pref, main_aft, any_aft, no_free,
// uneven_days, main_run, compact_teacher, main_early, subject_twice,
// spec_spread, teacher_late_start, teacher_under_min, target_daily,
// afternoon_preferred, main_twice, main_block_split, teacher_gap_fairness,
// teacher_days_present, teacher_lunch, unplaced.
// Wenn hier eine Komponente geändert/hinzugefügt wird → MODEL.md §3 nachziehen
// UND defaultWeights() in types.ts + UI in GenerateButton.svelte (Score-
// Aufschlüsselung) UND PenaltyBreakdown in index.ts erweitern — UND die
// Achsen-Zuordnung in scoreDelta.ts prüfen (welche Zeile muss bei einem
// Move neu gescannt werden?).

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

/** Anzahl Stufen-Spalten (5.–8. SSt.). */
const G = 4;

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
export function ensureScratch(state: SolverState): ScoreScratch {
	if (state.scoreScratch) return state.scoreScratch;
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

	// R3-S1: P1-Sperre pro (Lehrer, Tag) statisch vorberechnen — ersetzt den
	// per-Call `teacher.unavailable?.some(...)`-Scan in teacher_late_start.
	const blockedAtP1 = new Uint8Array(T * D);
	for (let t = 0; t < state.doc.teachers.length; t++) {
		const teacher = state.doc.teachers[t];
		for (let d = 0; d < D; d++) {
			const dayName = DAYS_BY_INDEX[d];
			blockedAtP1[t * D + d] = teacher.unavailable?.some(
				u => u.day === dayName && u.period === 1
			) ? 1 : 0;
		}
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
		mainCnt: new Int32Array(D * G * P),
		rowStartSubj: new Int32Array(D * G * P),
		rowStartSize: new Int32Array(D * G * P),
		specDay: new Int32Array(NS * D),
		blockedAtP1,
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
 * Aus ConstraintConfig aufgelöste Score-Parameter — EINMAL pro
 * computeScore-Aufruf bzw. Cache-Build berechnet, damit Voll- und
 * Delta-Pfad garantiert dieselben Werte sehen.
 */
export interface ScoreCfg {
	minDaily: number;
	afternoonStart: number;
	maxConsecMain: number;
	targetEnabled: boolean;
	targetDaily: number;
	minLessonsActive: boolean;
	minLessonsTarget: number;
}

export function resolveScoreCfg(state: SolverState): ScoreCfg {
	const c = state.doc.constraints;
	// Phase 13: Zieltagespensum aus ConstraintConfig.
	const targetCfg = (c as unknown as Record<string, unknown>).targetDailyLessons as
		| { enabled?: boolean; target?: number }
		| undefined;
	const minLessonsCfg = c.teacherMinLessonsPerDay as
		| { enabled?: boolean; min?: number }
		| undefined;
	return {
		minDaily: Math.max(0, Math.min(P, Math.round(c.minDailySlotsPerGrade ?? 0))),
		afternoonStart:
			Math.max(1, Math.min(P, Math.round(c.noMainSubjectAfternoon.afternoonStartsAtPeriod ?? 7))),
		maxConsecMain: Math.max(1, Math.min(P, Math.round(c.maxConsecutiveMain.max ?? 2))),
		targetEnabled: targetCfg?.enabled !== false,
		targetDaily: Math.max(1, Math.min(P, Math.round(targetCfg?.target ?? 6))),
		minLessonsActive: minLessonsCfg?.enabled !== false,
		minLessonsTarget: Math.max(1, Math.min(P, Math.round(minLessonsCfg?.min ?? 2))),
	};
}

// ---------------------------------------------------------------------------
// Footprints: welche Zähler eine platzierte Unit belegt.
//
// occ          — Instanzen pro (d, g, p) (Klassen-Occupancy)
// tocc         — Belegungen pro (Lehrer, d, p)
// mainCnt      — Hauptfach-Instanzen pro (d, g, p) (Zähler, >0 = Hauptfach da;
//                Zähler statt 0/1-Maske, damit remove exakt invertierbar ist —
//                Kopplungs-Units können 2 Instanzen in derselben Zelle haben)
// rowStartSubj — Fach-Index+1 der Unit, die an (d, g, p) STARTET (0 = keine;
//                pro Zelle max. eine Unit — H4 verbietet Stufen-Doppel)
// rowStartSize — blockSize der startenden Unit
// specDay      — Vorkommen pro (Spec, Tag) für spec_spread
// ---------------------------------------------------------------------------

/**
 * Fügt die Footprints von Unit i am Slot `slot` hinzu (sign=+1) oder
 * entfernt sie (sign=-1). Gibt das spec_spread-Penalty-Delta zurück
 * (Änderung von Σ max(0, specDay-1) durch diese Operation).
 *
 * WICHTIG für Delta-Korrektheit: exakt symmetrisch — add gefolgt von
 * remove stellt alle Arrays byte-identisch wieder her.
 */
export function applyUnitFootprint(
	state: SolverState,
	scratch: ScoreScratch,
	i: number,
	slot: number,
	sign: 1 | -1
): number {
	const unit = state.units[i];
	const { dayIndex, period } = dpFromSlot(slot);
	const isMain = scratch.unitIsMain[i] === 1;
	const subjIdx = scratch.unitSubjIdx[i];

	// Klassen-Occupancy + Hauptfach-Zähler: pro Instanz.
	for (const inst of unit.instances) {
		const p = period - 1 + inst.blockPos;
		if (p >= P) continue; // shouldn't happen if construction is correct
		const g = inst.grade - 5; // 5..8 → 0..3
		const cell = dayIndex * G * P + g * P + p;
		scratch.occ[cell] += sign;
		if (isMain) scratch.mainCnt[cell] += sign;
	}

	// Lehrer-Occupancy: Kopplungen belegen pro Team-Mitglied die blockSize-
	// Spanne EINMAL (nicht pro Grade-Instanz); sonst pro Instanz — identische
	// Semantik wie die frühere fillTeacherOccupancy (Kommentar dort).
	if (unit.kind === 'coupling') {
		for (const tid of unit.teacherIds) {
			const tIdx = scratch.teacherIdxById.get(tid);
			if (tIdx === undefined) continue;
			for (let pos = 0; pos < unit.blockSize; pos++) {
				const p = period - 1 + pos;
				if (p >= P) continue;
				scratch.tocc[tIdx * D * P + dayIndex * P + p] += sign;
			}
		}
	} else {
		const tIdx = scratch.teacherIdxById.get(unit.teacherId);
		if (tIdx !== undefined) {
			for (const inst of unit.instances) {
				const p = period - 1 + inst.blockPos;
				if (p >= P) continue;
				scratch.tocc[tIdx * D * P + dayIndex * P + p] += sign;
			}
		}
	}

	// Fach-Vorkommen (Block-Start) pro Grade der Unit — Grundlage für
	// subject_twice / main_twice / main_block_split im Zeilen-Scan.
	// Pro (d, g, p)-Zelle startet maximal EINE Unit (H4) → set/clear.
	for (const grade of unit.grades) {
		const cell = dayIndex * G * P + (grade - 5) * P + (period - 1);
		if (sign === 1) {
			scratch.rowStartSubj[cell] = subjIdx + 1;
			scratch.rowStartSize[cell] = unit.blockSize;
		} else {
			scratch.rowStartSubj[cell] = 0;
			scratch.rowStartSize[cell] = 0;
		}
	}

	// spec_spread: Vorkommen pro (Spec, Tag). Penalty = Σ max(0, v-1);
	// Delta hier direkt mitberechnet (globale Komponente ohne Zeilen-Scan).
	let spreadDelta = 0;
	for (const sid of unit.specIds) {
		const spIdx = scratch.specIdxById.get(sid);
		if (spIdx === undefined) continue;
		const k = spIdx * D + dayIndex;
		if (sign === 1) {
			const v = ++scratch.specDay[k];
			if (v >= 2) spreadDelta++;
		} else {
			const v = scratch.specDay[k]--;
			if (v >= 2) spreadDelta--;
		}
	}
	return spreadDelta;
}

/** Alle Footprint-Arrays leeren und aus state.placement komplett neu füllen. */
export function fillFootprints(state: SolverState, scratch: ScoreScratch): void {
	scratch.occ.fill(0);
	scratch.tocc.fill(0);
	scratch.mainCnt.fill(0);
	scratch.rowStartSubj.fill(0);
	scratch.rowStartSize.fill(0);
	scratch.specDay.fill(0);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		applyUnitFootprint(state, scratch, i, slot, 1);
	}
}

// ---------------------------------------------------------------------------
// Zeilen-Scans — die geteilte Logik von Voll-Scan und Scoped-Delta.
// ---------------------------------------------------------------------------

/** Indizes ins 9er-Ergebnis von scanClassRow. */
export const CLASS_ROW_COMPONENTS = [
	'min_daily', 'no_p1_start', 'no_free', 'uneven_days', 'target_daily',
	'main_run', 'subject_twice', 'main_twice', 'main_block_split',
] as const;

/** Indizes ins 6er-Ergebnis von scanTeacherWeek. */
export const TEACHER_ROW_COMPONENTS = [
	'compact_teacher', 'teacher_late_start', 'teacher_under_min',
	'teacher_lunch', 'teacher_gap_fairness', 'teacher_days_present',
] as const;

/** Indizes ins 5er-Ergebnis von unitSlotContrib. */
export const UNIT_COMPONENTS = [
	'any_aft', 'main_aft', 'afternoon_preferred', 'main_early', 'time_pref',
] as const;

// Wiederverwendete Mini-Puffer für den Subjekt-Teil von scanClassRow
// (max. P=8 Starts pro Zeile). Single-threaded — kein Reentrancy-Problem.
const rowSubj = new Int32Array(P);
const rowStart = new Int32Array(P);
const rowSize = new Int32Array(P);

/**
 * Beitrag der (Tag d, Stufe g)-Zeile: min_daily, no_p1_start, no_free,
 * uneven_days, target_daily (aus occ), main_run (aus mainCnt),
 * subject_twice, main_twice, main_block_split (aus rowStartSubj/Size).
 * Ergebnis wird in `out` (Länge 9) geschrieben.
 */
export function scanClassRow(
	scratch: ScoreScratch,
	cfg: ScoreCfg,
	d: number,
	g: number,
	out: Int32Array
): void {
	out.fill(0);
	const base = d * G * P + g * P;

	let occupiedPeriods = 0;
	let firstP = -1;
	let lastP = -1;
	let p1Active = false;
	for (let p = 0; p < P; p++) {
		if (scratch.occ[base + p] > 0) {
			occupiedPeriods++;
			if (firstP === -1) firstP = p;
			lastP = p;
			if (p === 0) p1Active = true;
		}
	}
	// min_daily: how many slots are missing to reach the target?
	if (cfg.minDaily > 0 && occupiedPeriods > 0 && occupiedPeriods < cfg.minDaily) {
		out[0] = cfg.minDaily - occupiedPeriods;
	}
	// no_p1_start: day active but P1 empty
	if (occupiedPeriods > 0 && !p1Active) {
		out[1] = 1;
	}
	// no_free: gaps WITHIN the active span (firstP..lastP)
	// PLUS leading gaps before firstP (Phase 13.1 Korrektur — Tagesrand-
	// Lücken am Anfang zählen, sonst belegt der Solver P3-P8 statt P1-P6).
	if (firstP !== -1) {
		let noFree = firstP; // Lücken P1..firstP-1
		for (let p = firstP + 1; p < lastP; p++) {
			if (scratch.occ[base + p] === 0) noFree++;
		}
		out[2] = noFree;
	}
	// uneven_days: under-load penalty (re-uses minDaily target). Inaktive
	// Tage (0 Stunden) sind ausgenommen — min_daily/target_daily behandeln
	// den Fall bereits korrekt (beide skippen occupiedPeriods===0).
	const target = Math.max(cfg.minDaily, 4);
	if (occupiedPeriods > 0 && occupiedPeriods < target) {
		out[3] = target - occupiedPeriods;
	}
	// Phase 13: target_daily — quadratische Penalty für Abweichung vom
	// Zieltagespensum, in BEIDE Richtungen. Inaktive Tage ausgenommen.
	if (cfg.targetEnabled && occupiedPeriods > 0) {
		const diff = occupiedPeriods - cfg.targetDaily;
		out[4] = diff * diff;
	}
	// main_run: count windows of (max_consec+1) consecutive main periods.
	const win = cfg.maxConsecMain + 1;
	let run = 0;
	for (let p = 0; p < P; p++) {
		if (scratch.mainCnt[base + p] > 0) {
			run++;
			if (run >= win) out[5]++;
		} else {
			run = 0;
		}
	}
	// Fach-Vorkommen dieser Zeile aus den Block-Starts rekonstruieren
	// (max. 8) — daraus subject_twice, main_twice, main_block_split mit
	// identischer Semantik zum früheren subjCount/occA/occB-Code.
	let nStarts = 0;
	for (let p = 0; p < P; p++) {
		const sv = scratch.rowStartSubj[base + p];
		if (sv !== 0) {
			rowSubj[nStarts] = sv - 1;
			rowStart[nStarts] = p + 1; // 1-basierte Periode (wie früher occAStart)
			rowSize[nStarts] = scratch.rowStartSize[base + p];
			nStarts++;
		}
	}
	// Pro distinktem Fach: v = Anzahl Starts. Starts sind nach Periode
	// aufsteigend sortiert (Scan-Reihenfolge) — für v==2 sind erste/zweite
	// Position damit bereits geordnet (früher: Insertion-Order + Sort).
	for (let a = 0; a < nStarts; a++) {
		const s = rowSubj[a];
		// Nur beim ERSTEN Vorkommen des Fachs auswerten (Dedup).
		let seenBefore = false;
		for (let b = 0; b < a; b++) {
			if (rowSubj[b] === s) { seenBefore = true; break; }
		}
		if (seenBefore) continue;
		let v = 0;
		let firstStart = 0;
		let firstSize = 0;
		let secondStart = 0;
		for (let b = a; b < nStarts; b++) {
			if (rowSubj[b] !== s) continue;
			v++;
			if (v === 1) { firstStart = rowStart[b]; firstSize = rowSize[b]; }
			else if (v === 2) { secondStart = rowStart[b]; }
		}
		if (v > 1) out[6] += v - 1;
		const isMain = scratch.subjIsMain[s] === 1;
		// Phase 13.3 main_twice: 3+ Vorkommen Hauptfach am gleichen Tag/Stufe.
		if (isMain && v > 2) out[7] += v - 2;
		// Phase 13.3 main_block_split: bei genau 2 Vorkommen — exakte Lücke
		// zwischen Ende des ersten Blocks und Anfang des zweiten.
		if (isMain && v === 2) {
			const firstEnd = firstStart + firstSize - 1;
			out[8] += Math.max(0, secondStart - firstEnd - 1);
		}
	}
}

/**
 * Wochen-Beitrag von Lehrer t: compact_teacher, teacher_late_start,
 * teacher_under_min, teacher_lunch, teacher_gap_fairness,
 * teacher_days_present. Ergebnis in `out` (Länge 6).
 *
 * Ganze Woche pro Lehrer, weil gap_fairness/days_present Wochen-Aggregate
 * sind — ändert ein Move einen Tag, muss der Lehrer komplett neu.
 */
export function scanTeacherWeek(
	scratch: ScoreScratch,
	cfg: ScoreCfg,
	t: number,
	out: Int32Array
): void {
	out.fill(0);
	let weekGaps = 0;
	let weekLessons = 0;
	let daysPresent = 0;
	for (let d = 0; d < D; d++) {
		const base = t * D * P + d * P;
		let firstP = -1;
		let lastP = -1;
		let occupiedPeriods = 0;
		for (let p = 0; p < P; p++) {
			if (scratch.tocc[base + p] > 0) {
				if (firstP === -1) firstP = p;
				lastP = p;
				occupiedPeriods++;
			}
		}
		if (occupiedPeriods > 0) {
			daysPresent++;
			weekLessons += occupiedPeriods;
		}
		// compact_teacher: QUADRATIC penalty per (teacher, day) — 1 Lücke = 1,
		// 2 = 4, 3 = 9 (User-Logik: 1 Freistunde ok, 3+ inakzeptabel).
		if (firstP !== -1 && lastP > firstP) {
			let gapsThisDay = 0;
			for (let p = firstP + 1; p < lastP; p++) {
				if (scratch.tocc[base + p] === 0) gapsThisDay++;
			}
			out[0] += gapsThisDay * gapsThisDay;
			weekGaps += gapsThisDay;
		}
		// teacher_lunch: langer Tag (>=6 Stunden) mit Vormittag (P1-P4) UND
		// Nachmittag (P7-P8), aber P5 UND P6 beide belegt → keine Mittagspause.
		if (occupiedPeriods >= 6) {
			const p5busy = scratch.tocc[base + 4] > 0;
			const p6busy = scratch.tocc[base + 5] > 0;
			if (p5busy && p6busy) {
				let hasMorning = false;
				for (let p = 0; p <= 3; p++) if (scratch.tocc[base + p] > 0) { hasMorning = true; break; }
				if (hasMorning) {
					let hasAfternoon = false;
					for (let p = 6; p <= 7; p++) if (scratch.tocc[base + p] > 0) { hasAfternoon = true; break; }
					if (hasAfternoon) out[3]++;
				}
			}
		}
		// teacher_late_start: nur wenn der Lehrer an dem Tag Stunden hat UND
		// P1 nicht per Sperrstunde blockiert war (sonst war der Spätstart
		// erzwungen, nicht Solver-Wahl). Penalty = Perioden-Distanz zu P1.
		if (firstP > 0 && scratch.blockedAtP1[t * D + d] === 0) {
			out[1] += firstP;
		}
		// teacher_under_min: Arbeits-Tag unter dem Minimum. 0 Stunden = freier
		// Tag, keine Penalty.
		if (
			cfg.minLessonsActive &&
			occupiedPeriods > 0 &&
			occupiedPeriods < cfg.minLessonsTarget
		) {
			out[2] += cfg.minLessonsTarget - occupiedPeriods;
		}
	}
	// Solver-Opt Schritt 3 — Wochen-Auswertung:
	// teacher_gap_fairness: (Wochen-Lücken)² — Springstunden sollen nicht
	// bei einem Lehrer klumpen. 1 Lehrer × 5 Lücken = 25, 5 × 1 = 5.
	out[4] = weekGaps * weekGaps;
	// teacher_days_present: Anwesenheitstage über dem Ideal
	// ceil(wochenstunden / 6). Lehrer ohne Stunden sind exempt.
	if (weekLessons > 0) {
		const idealDays = Math.ceil(weekLessons / 6);
		if (daysPresent > idealDays) {
			out[5] = daysPresent - idealDays;
		}
	}
}

/**
 * Slot-abhängiger Beitrag von Unit i am (hypothetischen) Slot `slot`:
 * any_aft, main_aft, afternoon_preferred, main_early, time_pref.
 * Reine Funktion von (Unit, Slot) — braucht keine Footprints.
 * Ergebnis in `out` (Länge 5).
 */
export function unitSlotContrib(
	state: SolverState,
	scratch: ScoreScratch,
	i: number,
	slot: number,
	cfg: ScoreCfg,
	out: Int32Array
): void {
	out.fill(0);
	if (slot === SLOT_UNPLACED) return;
	const unit = state.units[i];
	const isMain = scratch.unitIsMain[i] === 1;
	const timePref = scratch.unitTimePref[i]; // 0 none, 1 early, 2 late
	const afternoonExempt = scratch.unitAfternoonExempt[i] === 1;
	const firstGrade = scratch.unitFirstGrade[i];
	const { period } = dpFromSlot(slot);
	for (const inst of unit.instances) {
		const p = period - 1 + inst.blockPos;
		if (p >= P) continue;
		if (p + 1 >= cfg.afternoonStart && !afternoonExempt) {
			out[0]++; // any_aft
			if (isMain) out[1]++; // main_aft
		}
		// Phase 13: afternoon_preferred — Spec SOLL nachmittags sein, liegt
		// aber im Vormittag. Nur für 'preferred' — 'must' ist via H11 hart.
		if (unit.afternoonAllowed === 'preferred' && p + 1 < cfg.afternoonStart) {
			out[2]++;
		}
		if (isMain && !afternoonExempt) out[3] += p; // main_early (period-1)
		// time_pref accumulates once per distinct period the unit occupies.
		// Dedup via (specId === specIds[0]) AND (grade === firstGrade) so
		// multi-grade tuples and couplings don't multiply the penalty.
		if (timePref !== 0 && inst.specId === unit.specIds[0] && inst.grade === firstGrade) {
			if (timePref === 1) out[4] += p; // distance from P1
			else out[4] += P - 1 - p; // distance from P8
		}
	}
}

/** Gewichtete Summe eines Breakdown-Zählerstands. */
export function weightedTotal(b: ScoreBreakdown, weights: ScoreWeights): number {
	return (
		weights.min_daily * b.min_daily +
		weights.no_p1_start * b.no_p1_start +
		weights.main_aft * b.main_aft +
		weights.any_aft * b.any_aft +
		weights.no_free * b.no_free +
		weights.uneven_days * b.uneven_days +
		weights.main_run * b.main_run +
		weights.compact_teacher * b.compact_teacher +
		weights.main_early * b.main_early +
		weights.time_pref * b.time_pref +
		weights.subject_twice * b.subject_twice +
		weights.spec_spread * b.spec_spread +
		weights.teacher_late_start * b.teacher_late_start +
		weights.teacher_under_min * b.teacher_under_min +
		weights.target_daily * b.target_daily +
		weights.afternoon_preferred * b.afternoon_preferred +
		weights.main_twice * b.main_twice +
		weights.main_block_split * b.main_block_split +
		weights.teacher_gap_fairness * b.teacher_gap_fairness +
		weights.teacher_days_present * b.teacher_days_present +
		weights.teacher_lunch * b.teacher_lunch +
		weights.unplaced * b.unplaced
	);
}

/** Leerer Breakdown (alle 22 Komponenten + total auf 0). */
export function emptyBreakdown(): ScoreBreakdown {
	return {
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
		unplaced: 0,
		total: 0,
	};
}

// Scan-Ausgabepuffer für computeScore (wiederverwendet, single-threaded).
const classOut = new Int32Array(9);
const teacherOut = new Int32Array(6);
const unitOut = new Int32Array(5);

/**
 * Compute the full score breakdown for a given solver state.
 * O(nUnits + D*G*P + T*D*P) — Summe der Zeilen-Scans über alle Zeilen.
 */
export function computeScore(state: SolverState, weights: ScoreWeights): ScoreBreakdown {
	const scratch = ensureScratch(state);
	const cfg = resolveScoreCfg(state);
	fillFootprints(state, scratch);

	const breakdown = emptyBreakdown();

	// unplaced: ungeplante Units zählen (Solver-Opt R2). Dominant gewichtet.
	for (let i = 0; i < state.nUnits; i++) {
		if (state.placement[i] === SLOT_UNPLACED) breakdown.unplaced++;
	}

	// Klassen-Zeilen (Tag × Stufe).
	for (let d = 0; d < D; d++) {
		for (let g = 0; g < G; g++) {
			scanClassRow(scratch, cfg, d, g, classOut);
			breakdown.min_daily += classOut[0];
			breakdown.no_p1_start += classOut[1];
			breakdown.no_free += classOut[2];
			breakdown.uneven_days += classOut[3];
			breakdown.target_daily += classOut[4];
			breakdown.main_run += classOut[5];
			breakdown.subject_twice += classOut[6];
			breakdown.main_twice += classOut[7];
			breakdown.main_block_split += classOut[8];
		}
	}

	// Lehrer-Zeilen (ganze Woche pro Lehrer).
	const T = state.doc.teachers.length;
	for (let t = 0; t < T; t++) {
		scanTeacherWeek(scratch, cfg, t, teacherOut);
		breakdown.compact_teacher += teacherOut[0];
		breakdown.teacher_late_start += teacherOut[1];
		breakdown.teacher_under_min += teacherOut[2];
		breakdown.teacher_lunch += teacherOut[3];
		breakdown.teacher_gap_fairness += teacherOut[4];
		breakdown.teacher_days_present += teacherOut[5];
	}

	// Slot-abhängige Unit-Beiträge.
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		unitSlotContrib(state, scratch, i, slot, cfg, unitOut);
		breakdown.any_aft += unitOut[0];
		breakdown.main_aft += unitOut[1];
		breakdown.afternoon_preferred += unitOut[2];
		breakdown.main_early += unitOut[3];
		breakdown.time_pref += unitOut[4];
	}

	// spec_spread aus den specDay-Zählern.
	for (let k = 0; k < scratch.NS * D; k++) {
		const v = scratch.specDay[k];
		if (v > 1) breakdown.spec_spread += v - 1;
	}

	breakdown.total = weightedTotal(breakdown, weights);
	return breakdown;
}

/**
 * Build a 2D teacher-occupancy bitmap for compact-teacher-day scoring.
 *   tocc[t * D * P + d * P + p] = number of lessons by teacher t at (d, p)
 *
 * Exported for bench-metrics.ts (Lehrer-Qualitäts-Metriken nutzen dieselbe
 * Occupancy-Logik — keine Duplikation, keine Drift). Liefert eine FRISCHE
 * Kopie (unabhängig vom Scratch, das der Score-Cache pflegt).
 */
export function buildTeacherOccupancy(state: SolverState): { tocc: Int32Array; teacherIdx: Map<string, number> } {
	const scratch = ensureScratch(state);
	fillFootprints(state, scratch);
	return { tocc: new Int32Array(scratch.tocc), teacherIdx: scratch.teacherIdxById };
}
