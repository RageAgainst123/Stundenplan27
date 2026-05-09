// Solver v2 — full-scan score calculation.
//
// This module computes the score by walking the entire solver state. It's
// used:
//   - Once at the start of Local Search (initial best score)
//   - In tests to verify incremental score-delta correctness (Property test)
//
// Hot path during Local Search uses scoreDelta.ts (incremental, O(1) per move).

import type { GradeLevel, Period, ScheduleDoc } from '../types';
import {
	D,
	P,
	dpFromSlot,
	type ScoreBreakdown,
	type ScoreWeights,
	type SolverState,
	SLOT_UNPLACED,
} from './types';

/**
 * Build a 3D occupancy bitmap for fast counting.
 *   occ[d * G * P + g * P + p] = number of lesson INSTANCES at (d, g, p)
 *
 * (We index by g 0..3 = grade 5..8.)
 */
function buildOccupancy(state: SolverState): Int32Array {
	const G = 4;
	const occ = new Int32Array(D * G * P);
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
	return occ;
}

/**
 * Build a 2D teacher-occupancy bitmap for compact-teacher-day scoring.
 *   tocc[t * D * P + d * P + p] = number of lessons by teacher t at (d, p)
 *
 * Teachers indexed 0..T-1 by document order (we use a Map for the lookup).
 */
function buildTeacherOccupancy(state: SolverState): { tocc: Int32Array; teacherIdx: Map<string, number> } {
	const teacherIdx = new Map<string, number>();
	state.doc.teachers.forEach((t, i) => teacherIdx.set(t.id, i));
	const T = state.doc.teachers.length;
	const tocc = new Int32Array(T * D * P);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const tIdx = teacherIdx.get(unit.teacherId);
		if (tIdx === undefined) continue;
		const { dayIndex, period } = dpFromSlot(slot);
		for (const inst of unit.instances) {
			const p = period - 1 + inst.blockPos;
			if (p >= P) continue;
			tocc[tIdx * D * P + dayIndex * P + p]++;
		}
	}
	return { tocc, teacherIdx };
}

/**
 * Compute the full score breakdown for a given solver state.
 * O(nUnits + D*G*P + T*D*P) — used at start of LS and in tests.
 */
export function computeScore(state: SolverState, weights: ScoreWeights): ScoreBreakdown {
	const occ = buildOccupancy(state);
	const { tocc } = buildTeacherOccupancy(state);
	const G = 4;
	const c = state.doc.constraints;
	const minDaily = Math.max(0, Math.min(P, Math.round(c.minDailySlotsPerGrade ?? 0)));
	const afternoonStart =
		Math.max(1, Math.min(P, Math.round(c.noMainSubjectAfternoon.afternoonStartsAtPeriod ?? 7)));
	const maxConsecMain = Math.max(1, Math.min(P, Math.round(c.maxConsecutiveMain.max ?? 2)));

	const breakdown: ScoreBreakdown = {
		min_daily: 0,
		no_p1_start: 0,
		main_aft: 0,
		any_aft: 0,
		no_free: 0,
		uneven_days: 0,
		main_run: 0,
		compact_teacher: 0,
		main_early: 0,
		total: 0,
	};

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
			// no_free: gaps between firstP and lastP
			if (firstP !== -1 && lastP > firstP) {
				for (let p = firstP + 1; p < lastP; p++) {
					if (occ[d * G * P + g * P + p] === 0) breakdown.no_free++;
				}
			}
			// uneven_days: under-load penalty (re-uses minDaily target)
			const target = Math.max(minDaily, 4);
			if (occupiedPeriods < target) {
				breakdown.uneven_days += target - occupiedPeriods;
			}
		}
	}

	// --- Per Unit walk: main_aft, any_aft, main_run-precursor, main_early
	// main_run: count 3-runs of main subjects in the same (day, grade).
	// We compute that per (day, grade) from the occupancy + a "main mask".
	const mainMask = new Int32Array(D * G * P);
	for (let i = 0; i < state.nUnits; i++) {
		const slot = state.placement[i];
		if (slot === SLOT_UNPLACED) continue;
		const unit = state.units[i];
		const subj = state.subjectsByCode.get(unit.subjectCode);
		const isMain = subj?.isMain ?? false;
		const { dayIndex, period } = dpFromSlot(slot);
		for (const inst of unit.instances) {
			const p = period - 1 + inst.blockPos;
			if (p >= P) continue;
			const g = inst.grade - 5;
			if (p + 1 >= afternoonStart) {
				breakdown.any_aft++;
				if (isMain) breakdown.main_aft++;
			}
			if (isMain) {
				breakdown.main_early += p; // (period-1)
				mainMask[dayIndex * G * P + g * P + p] = 1;
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

	// --- Per (teacher, day) walk: compact_teacher (sandwich gaps)
	const T = state.doc.teachers.length;
	for (let t = 0; t < T; t++) {
		for (let d = 0; d < D; d++) {
			let firstP = -1;
			let lastP = -1;
			for (let p = 0; p < P; p++) {
				if (tocc[t * D * P + d * P + p] > 0) {
					if (firstP === -1) firstP = p;
					lastP = p;
				}
			}
			if (firstP !== -1 && lastP > firstP) {
				for (let p = firstP + 1; p < lastP; p++) {
					if (tocc[t * D * P + d * P + p] === 0) breakdown.compact_teacher++;
				}
			}
		}
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
		weights.main_early * breakdown.main_early;

	return breakdown;
}

// Suppress unused parameter warnings for types-only imports
void (null as unknown as ScheduleDoc);
void (null as unknown as Period);
void (null as unknown as GradeLevel);
