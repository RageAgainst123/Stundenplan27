// Pre-flight diagnostics for the solver. Runs in pure TypeScript (no MiniZinc
// roundtrip) and surfaces the most common UNSAT causes as actionable hints.
//
// Strategy: rather than running the solver multiple times with constraints
// disabled (which would cost ~30s per check), we compute simple ratios and
// invariants on the input data. Each check returns a `Hint` if it detects a
// likely problem.

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
		// Sum hours assigned to this teacher across includeInSolver specs
		let load = 0;
		for (const spec of doc.specs) {
			if (spec.includeInSolver === false) continue;
			if (spec.teacher !== teacher.id) continue;
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
		const hasSpecs = doc.specs.some(s => s.teacher === teacher.id && s.includeInSolver !== false);
		if (available === 0 && hasSpecs) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" hat keine verfügbaren Slots (alle gesperrt), aber Lehreinheiten zugewiesen. Verfügbarkeit eintragen.`
			});
		}
	}

	// 3) Grade load vs grade slots — pro Stufe darf Wochenstunden ≤ 40 sein
	const gradeLoad = new Map<GradeLevel, number>();
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
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

	// 4) Spec mit fehlendem Lehrer oder Subject
	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		if (!doc.teachers.find(t => t.id === spec.teacher)) {
			hints.push({
				severity: 'error',
				message: `Lehreinheit ${spec.subject} (${spec.classes.join('+')}) verweist auf einen nicht existierenden Lehrer. Bitte zuweisen.`
			});
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

	// 5) Pinning-Konflikte: mehrere Pins auf demselben (specId, day, period, grade)
	const pinKeys = new Map<string, number>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const k = `${p.specId}|${p.day}|${p.period}`;
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

	// 6) Pinned-Spec-Slot-Lehrer-Kollision: zwei Pins desselben Lehrers auf demselben (day,period)
	const pinByTeacherSlot = new Map<string, string[]>(); // "teacher|day|period" → [spec subjects]
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		const key = `${spec.teacher}|${p.day}|${p.period}`;
		const list = pinByTeacherSlot.get(key) ?? [];
		// Skip if same groupKey (allowed parallel)
		if (list.length > 0) {
			const otherSpec = doc.specs.find(s => list.includes(s.subject));
			if (otherSpec && otherSpec.groupKey && otherSpec.groupKey === spec.groupKey) {
				continue;
			}
		}
		list.push(spec.subject);
		pinByTeacherSlot.set(key, list);
	}
	for (const [key, subjects] of pinByTeacherSlot) {
		if (subjects.length > 1) {
			const [teacherId, day, period] = key.split('|');
			const teacher = doc.teachers.find(t => t.id === teacherId);
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher?.name ?? teacherId}" ist am ${day} in der ${period}. Stunde mehrfach gepinnt (${subjects.join(', ')}). Pins auflösen oder gleiche Kopplungs-Gruppe vergeben.`
			});
		}
	}

	// 7) Pinned-Slot-Verfügbarkeitskonflikt: Spec gepinnt aber Lehrer ist gesperrt
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		const teacher = doc.teachers.find(t => t.id === spec.teacher);
		if (!teacher) continue;
		if (teacher.unavailable?.some(u => u.day === p.day && u.period === p.period)) {
			hints.push({
				severity: 'error',
				message: `Lehrer "${teacher.name}" ist am ${p.day} ${p.period}. Stunde als unverfügbar markiert, aber dort ist Lehreinheit ${spec.subject} gepinnt. Pin entfernen oder Verfügbarkeit anpassen.`
			});
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
