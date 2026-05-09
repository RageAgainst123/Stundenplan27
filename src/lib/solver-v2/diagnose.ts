// Pre-flight diagnostics for the solver. Runs in pure TypeScript and surfaces
// the most common UNSAT causes as actionable hints.
//
// History: previously lived in src/lib/solver/diagnose.ts (the v1 MiniZinc
// solver). Phase 12 moved it into solver-v2/ so the v1 tree could be removed.
// All `spec.teachers[0]`-Compat-Shims from the v1 era are gone — diagnose
// now properly iterates over `spec.teachers` (team-teaching aware).

import type { ScheduleDoc, GradeLevel } from '../types';
import { DAYS, PERIODS } from '../types';

export interface Hint {
	severity: 'error' | 'warn';
	message: string;
}

const D = DAYS.length;
const P = PERIODS.length;

export function diagnose(doc: ScheduleDoc): Hint[] {
	const hints: Hint[] = [];

	// 1) Per-teacher load vs availability
	for (const teacher of doc.teachers) {
		const blocked = teacher.unavailable?.length ?? 0;
		const available = D * P - blocked;
		if (available <= 0) continue; // teacher has no slots at all — handled below
		// Sum hours assigned to this teacher across includeInSolver specs.
		// A team-teaching spec counts the hours for EVERY team member.
		let load = 0;
		for (const spec of doc.specs) {
			if (spec.includeInSolver === false) continue;
			if (!spec.teachers.includes(teacher.id)) continue;
			load += Math.round(spec.count);
		}
		if (load > available) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat ${load} Wochenstunden zugewiesen, aber nur ${available} verfügbare Slots (${blocked} gesperrt). Lehrer-Verfügbarkeit erweitern oder Lehreinheiten reduzieren.`
			});
		} else if (load > 0 && load > available - 4) {
			hints.push({
				severity: 'warn',
				message: `Lehrer "${teacher.name}" ist sehr eng ausgelastet: ${load}/${available} Slots. Bei zusätzlichen Constraints kann es eng werden.`
			});
		}
	}

	// 2) Teacher with 0 slots but specs assigned
	for (const teacher of doc.teachers) {
		const blocked = teacher.unavailable?.length ?? 0;
		const available = D * P - blocked;
		const hasSpecs = doc.specs.some(
			s => s.teachers.includes(teacher.id) && s.includeInSolver !== false
		);
		if (available === 0 && hasSpecs) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat keine verfügbaren Slots (alle gesperrt), aber Lehreinheiten zugewiesen. Verfügbarkeit eintragen.`
			});
		}
	}

	// 3) Grade load vs grade slots — pro Stufe darf Wochenstunden ≤ 40 sein.
	// Achtung: gekoppelte Specs (same couplingId) belegen denselben Zeit-Slot —
	// sie zählen für das Stunden-Pensum nur EINMAL pro Coupling-Gruppe.
	const gradeLoad = new Map<GradeLevel, number>();
	const seenCouplings = new Set<string>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if (spec.couplingId) {
			if (seenCouplings.has(spec.couplingId)) continue;
			seenCouplings.add(spec.couplingId);
		}
		for (const g of spec.grades) {
			gradeLoad.set(g, (gradeLoad.get(g) ?? 0) + Math.round(spec.count));
		}
	}
	for (const [grade, load] of gradeLoad) {
		if (load > D * P) {
			hints.push({
				severity: 'error',
				message: `Schulstufe ${grade}. SSt. hat ${load} Wochenstunden zugewiesen, aber nur ${D * P} Slots/Woche. Stunden reduzieren oder Stufe entlasten.`
			});
		}
	}

	// 3b) Mindest-Tagespensum erfordert pro Stufe ≥ D × min_daily.
	const minDaily = doc.constraints?.minDailySlotsPerGrade ?? 0;
	if (minDaily > 0) {
		const required = D * minDaily;
		for (const [grade, load] of gradeLoad) {
			if (load < required) {
				hints.push({
					severity: 'warn',
					message: `Schulstufe ${grade}. SSt. hat nur ${load} Wochenstunden, für die Regel "≥${minDaily} Stunden pro Tag" wären mindestens ${required} nötig. Bei UNSAT lockert der Solver das Pensum automatisch.`
				});
			}
		}
	}

	// 3c) mustStartFirstPeriod + Lehrer-Verfügbarkeit prüfen.
	// Wenn an einem Tag KEIN einziger Lehrer in P1 verfügbar ist, kann der
	// "Beginn in P1"-Wunsch dort nur durch Tag-leer-lassen erfüllt werden,
	// was wiederum min_daily verletzt. Pragmatisch nur ein Soft-Hint.
	if (doc.constraints?.mustStartFirstPeriod?.enabled && minDaily > 0) {
		let anyDayMissing = false;
		for (let dIdx = 0; dIdx < D; dIdx++) {
			const dayName = DAYS[dIdx];
			const someoneFreeP1 = doc.teachers.some(
				t => !(t.unavailable ?? []).some(u => u.day === dayName && u.period === 1)
			);
			if (!someoneFreeP1) {
				anyDayMissing = true;
				break;
			}
		}
		if (anyDayMissing) {
			hints.push({
				severity: 'warn',
				message: `An mindestens einem Wochentag ist kein Lehrer in der 1. Stunde verfügbar. Die Regel "Beginn in P1" kann an diesem Tag UNSAT auslösen — der Solver lockert dann automatisch.`
			});
		}
	}

	// 3d) Spec mit count > D und striktem Singles-Pattern → konfliktanfällig.
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const blocks = spec.blocks;
		if (!blocks || blocks.length === 0) continue;
		const allSingles = blocks.every(b => b === 1);
		if (allSingles && blocks.length > D) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit ${spec.subject} hat ${blocks.length} Einzelstunden bei nur ${D} Wochentagen. Mit dem "Doppel ⇒ kein Einzel am Tag"-Constraint ist das nicht erfüllbar. Block-Pattern auf Auto setzen oder Doppelstunden zulassen.`
			});
		}
	}

	// 4) Spec mit fehlendem Lehrer oder Subject. Nun team-aware: jeder
	// einzelne Lehrer-Eintrag muss existieren.
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const teacherIds = spec.teachers ?? [];
		if (teacherIds.length === 0) {
			hints.push({
				severity: 'error',
				message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) hat keinen Lehrer zugewiesen.`
			});
		} else {
			for (const tid of teacherIds) {
				if (!doc.teachers.find(t => t.id === tid)) {
					hints.push({
						severity: 'error',
						message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) verweist auf einen nicht existierenden Lehrer (${tid}). Bitte zuweisen.`
					});
				}
			}
		}
		if (!doc.subjects.find(s => s.code === spec.subject)) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit verwendet Fach "${spec.subject}", das in der Fächer-Liste nicht existiert. Solver verwendet einen Fallback-Index.`
			});
		}
		if (spec.grades.length === 0) {
			hints.push({
				severity: 'warn',
				message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) hat keine Schulstufen — wird vom Solver übersprungen.`
			});
		}
	}

	// 5) Pinning-Konflikte: mehrere Pins auf demselben (specId, day, period, grade).
	const pinKeys = new Map<string, number>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const k = `${p.specId}|${p.day}|${p.period}|${p.grade}`;
		pinKeys.set(k, (pinKeys.get(k) ?? 0) + 1);
	}
	for (const [k, n] of pinKeys) {
		if (n > 1) {
			hints.push({
				severity: 'warn',
				message: `Mehrfach-Pin auf demselben Slot (${k}) — Duplikate werden ignoriert.`
			});
		}
	}

	// 6) Pinned-Lehrer-Slot-Kollision: zwei Pins, die denselben Lehrer am
	// selben (day, period) belegen, ohne dass sie eine Coupling teilen.
	// Team-Teaching-aware: wir prüfen jeden Team-Lehrer einzeln gegen alle
	// anderen Pins desselben Slots.
	const pinByTeacherSlot = new Map<string, { specId: string; subject: string; couplingId?: string }[]>();
	const seenSpecSlot = new Set<string>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const dedupKey = `${p.specId}|${p.day}|${p.period}`;
		if (seenSpecSlot.has(dedupKey)) continue;
		seenSpecSlot.add(dedupKey);
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		for (const tid of spec.teachers ?? []) {
			const key = `${tid}|${p.day}|${p.period}`;
			const list = pinByTeacherSlot.get(key) ?? [];
			// Skip if any prior entry shares the same couplingId — that's
			// legitimate parallel teaching.
			const sharedCoupling = list.some(
				e => e.couplingId && spec.couplingId && e.couplingId === spec.couplingId
			);
			if (sharedCoupling) continue;
			list.push({ specId: spec.id, subject: spec.subject, couplingId: spec.couplingId });
			pinByTeacherSlot.set(key, list);
		}
	}
	for (const [key, entries] of pinByTeacherSlot) {
		if (entries.length > 1) {
			const [teacherId, day, period] = key.split('|');
			const teacher = doc.teachers.find(t => t.id === teacherId);
			const subjects = entries.map(e => e.subject).join(', ');
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher?.name ?? teacherId}" ist am ${day} in der ${period}. Stunde mehrfach gepinnt (${subjects}). Pins auflösen oder gleiche Kopplungs-Gruppe vergeben.`
			});
		}
	}

	// 7) Pinned-Slot-Verfügbarkeitskonflikt: Spec gepinnt aber Lehrer ist gesperrt.
	// Team-Teaching-aware: jeder Team-Lehrer muss frei sein.
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		for (const tid of spec.teachers ?? []) {
			const teacher = doc.teachers.find(t => t.id === tid);
			if (!teacher) continue;
			if (teacher.unavailable?.some(u => u.day === p.day && u.period === p.period)) {
				hints.push({
					severity: 'error',
					message: `Lehrer "${teacher.name}" ist am ${p.day} ${p.period}. Stunde als unverfügbar markiert, aber dort ist Lehreinheit ${spec.subject} gepinnt. Pin entfernen oder Verfügbarkeit anpassen.`
				});
			}
		}
	}

	return hints;
}

/** Picks the most relevant hint for the user, or null if nothing actionable. */
export function bestHint(hints: Hint[]): Hint | null {
	if (hints.length === 0) return null;
	const errors = hints.filter(h => h.severity === 'error');
	if (errors.length > 0) return errors[0];
	return hints[0];
}
