// Phase 17: defensive Plan-Validierung gegen Lehrer-Doppelbelegung.
//
// Wird beim Doc-Load und nach Stammdaten-Änderungen aufgerufen, um
// inkonsistente Placements zu erkennen (z.B. Lehrer wurde nachträglich
// zu einer Spec hinzugefügt und blockt nun mit einer anderen platzierten
// Spec im gleichen Slot).
//
// Die Funktion ist defensiv: sie ÄNDERT nichts, sondern liefert Konflikt-
// Reports zurück. Der Aufrufer entscheidet ob Placements entfernt werden.

import type { PlacedLesson, ScheduleDoc } from './types';

export interface PlanConflict {
	day: string;
	period: number;
	reason: 'teacher-double' | 'grade-double';
	teacherId?: string;
	grade?: number;
	specIds: string[];
}

/**
 * Findet alle Lehrer-Doppelbelegungen und Stufen-Doppelbelegungen im
 * gegebenen Plan. Coupling-Specs (gleiche couplingId) sind erlaubt parallel
 * im selben Slot — kein Konflikt.
 *
 * Komplexität: O(D × P × placedAvg²) — für eine Schule mit ~150 Placements
 * vernachlässigbar.
 */
export function findPlanConflicts(doc: ScheduleDoc): PlanConflict[] {
	const conflicts: PlanConflict[] = [];
	// Gruppe Placements nach (day, period)
	const bySlot = new Map<string, PlacedLesson[]>();
	for (const pl of doc.placed) {
		const key = `${pl.day}|${pl.period}`;
		const arr = bySlot.get(key) ?? [];
		arr.push(pl);
		bySlot.set(key, arr);
	}
	const specsById = new Map(doc.specs.map(s => [s.id, s]));

	for (const [slotKey, placements] of bySlot) {
		const [day, periodStr] = slotKey.split('|');
		const period = parseInt(periodStr, 10);

		// Lehrer-Doppelbelegung: same teacherId in 2 verschiedenen specIds im selben Slot
		// (außer beide Specs sind gekoppelt).
		const teacherToSpecs = new Map<string, Set<string>>();
		for (const pl of placements) {
			const sp = specsById.get(pl.specId);
			if (!sp) continue;
			for (const tid of sp.teachers) {
				const set = teacherToSpecs.get(tid) ?? new Set();
				set.add(pl.specId);
				teacherToSpecs.set(tid, set);
			}
		}
		for (const [tid, specIds] of teacherToSpecs) {
			if (specIds.size < 2) continue;
			// Erlaubt: alle Specs haben die GLEICHE couplingId
			const couplingIds = new Set(
				[...specIds].map(sid => specsById.get(sid)?.couplingId ?? '')
			);
			const allSharedCoupling = couplingIds.size === 1 && [...couplingIds][0] !== '';
			if (allSharedCoupling) continue;
			conflicts.push({
				day,
				period,
				reason: 'teacher-double',
				teacherId: tid,
				specIds: [...specIds]
			});
		}

		// Stufen-Doppelbelegung: 2 Specs auf gleicher (Stufe, Slot)
		const gradeToSpecs = new Map<number, Set<string>>();
		for (const pl of placements) {
			const set = gradeToSpecs.get(pl.grade) ?? new Set();
			set.add(pl.specId);
			gradeToSpecs.set(pl.grade, set);
		}
		for (const [grade, specIds] of gradeToSpecs) {
			if (specIds.size < 2) continue;
			const couplingIds = new Set(
				[...specIds].map(sid => specsById.get(sid)?.couplingId ?? '')
			);
			const allSharedCoupling = couplingIds.size === 1 && [...couplingIds][0] !== '';
			if (allSharedCoupling) continue;
			conflicts.push({
				day,
				period,
				reason: 'grade-double',
				grade,
				specIds: [...specIds]
			});
		}
	}
	return conflicts;
}

/**
 * Entfernt alle Placements die in den gemeldeten Konflikten beteiligt sind.
 * Konservativ: bei einem Konflikt zwischen Spec A und B werden BEIDE Placements
 * entfernt — der User muss/Solver wird neu platzieren.
 *
 * Pinned-Placements bleiben unangetastet (sie wurden vom User explizit gesetzt
 * und sollen nicht still gelöscht werden — der User muss selbst entscheiden).
 */
export function removeConflictedPlacements(doc: ScheduleDoc, conflicts: PlanConflict[]): number {
	if (conflicts.length === 0) return 0;
	const toRemove = new Set<string>(); // key = `${specId}|${day}|${period}`
	for (const c of conflicts) {
		for (const sid of c.specIds) {
			toRemove.add(`${sid}|${c.day}|${c.period}`);
		}
	}
	const before = doc.placed.length;
	doc.placed = doc.placed.filter(pl => {
		const key = `${pl.specId}|${pl.day}|${pl.period}`;
		if (!toRemove.has(key)) return true;
		// Pinned bleiben — User-Entscheidung
		if (pl.pinned) return true;
		return false;
	});
	return before - doc.placed.length;
}
