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

	// 3b) Phase 9: Mindest-Tagespensum erfordert pro Stufe ≥ D × min_daily.
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

	// 3c) Phase 9: Spec mit count > D und striktem Singles-Pattern → konfliktanfällig
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
	//    Phase 8 v2: include grade — multi-grade specs legitimately have one
	//    PlacedLesson per grade, all pinned, all on the same (day, period).
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

	// 6) Pinned-Spec-Slot-Lehrer-Kollision: zwei Pins desselben Lehrers auf demselben (day,period)
	//    Phase 8 v2: a multi-grade spec emits multiple PlacedLessons (one per
	//    grade) on the same slot — all share specId. We dedup by specId to
	//    avoid counting the same pedagogical lesson multiple times.
	const pinByTeacherSlot = new Map<string, string[]>(); // "teacher|day|period" → [spec subjects]
	const seenSpecSlot = new Set<string>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const dedupKey = `${p.specId}|${p.day}|${p.period}`;
		if (seenSpecSlot.has(dedupKey)) continue;
		seenSpecSlot.add(dedupKey);
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		const key = `${spec.teacher}|${p.day}|${p.period}`;
		const list = pinByTeacherSlot.get(key) ?? [];
		// Skip if same couplingId (allowed parallel teaching)
		if (list.length > 0) {
			const otherSpec = doc.specs.find(s => list.includes(s.subject));
			if (otherSpec && otherSpec.couplingId && otherSpec.couplingId === spec.couplingId) {
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
