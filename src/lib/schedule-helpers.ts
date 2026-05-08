// Pure helpers for the schedule grid: which cells are filled, conflict detection,
// computing visible specs in the sidebar.

import { type Day, type GradeLevel, type LessonSpec, type PlacedLesson, type Period, type ScheduleDoc } from './types';

export interface CellPlacement {
	placed: PlacedLesson;
	spec: LessonSpec;
}

/**
 * Returns all placements that occupy (day, period, grade) — there can be more than
 * one if multiple specs share a slot via groupKey or pairedWith (parallel teaching).
 *
 * Phase 8 v2: filtering is by p.grade exactly (no more spec.grades fan-out).
 */
export function placementsAt(
	doc: ScheduleDoc,
	day: Day,
	period: Period,
	grade: GradeLevel
): CellPlacement[] {
	const out: CellPlacement[] = [];
	for (const p of doc.placed) {
		if (p.day !== day || p.period !== period) continue;
		if (p.grade !== grade) continue;
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		out.push({ placed: p, spec });
	}
	return out;
}

/**
 * How often a spec has been placed across the week. One pedagogical lesson =
 * one (day, period) timeslot, regardless of how many grade columns it occupies
 * (multi-grade specs emit one PlacedLesson per grade — they all share the same
 * (day, period) and we count the slot once).
 */
export function placedCountForSpec(doc: ScheduleDoc, specId: string): number {
	const slots = new Set<string>();
	for (const p of doc.placed) {
		if (p.specId !== specId) continue;
		slots.add(`${p.day}|${p.period}`);
	}
	return slots.size;
}

/** Specs that still need to be placed (count not fully reached). */
export function unplacedSpecs(doc: ScheduleDoc): { spec: LessonSpec; remaining: number }[] {
	return doc.specs
		.map(s => ({ spec: s, remaining: s.count - placedCountForSpec(doc, s.id) }))
		.filter(x => x.remaining > 0);
}

export interface ConflictCheck {
	hasConflict: boolean;
	reasons: string[];
}

/**
 * Would placing `spec` at (day,period) — across ALL its grades — violate any
 * hard constraint given the current `placed` array? When dragging from another
 * cell, pass `excludeSpecAtDayPeriod` (a "specId|day|period" key set) to skip
 * the source placements being moved.
 */
export function checkPlacementConflict(
	doc: ScheduleDoc,
	spec: LessonSpec,
	day: Day,
	period: Period,
	excludeSpecAtDayPeriod?: string
): ConflictCheck {
	const reasons: string[] = [];
	const reasonSet = new Set<string>();
	const push = (r: string) => { if (!reasonSet.has(r)) { reasonSet.add(r); reasons.push(r); } };

	// Teacher unavailable
	const teacher = doc.teachers.find(t => t.id === spec.teacher);
	if (teacher?.unavailable.some(u => u.day === day && u.period === period)) {
		push(`Lehrer "${teacher.name}" ist hier nicht verfügbar.`);
	}

	const targetGrades = new Set(spec.grades);

	for (const p of doc.placed) {
		if (p.day !== day || p.period !== period) continue;
		// Skip the slot we're moving away from
		if (excludeSpecAtDayPeriod && p.specId === excludeSpecAtDayPeriod) continue;

		const otherSpec = doc.specs.find(s => s.id === p.specId);
		if (!otherSpec) continue;
		if (otherSpec.id === spec.id) continue; // same spec already there is fine for repeat

		const sameGroup =
			(spec.groupKey && otherSpec.groupKey === spec.groupKey) ||
			spec.pairedWith?.includes(otherSpec.id) ||
			otherSpec.pairedWith?.includes(spec.id);

		// Teacher clash (unless paired/group)
		if (!sameGroup && otherSpec.teacher === spec.teacher) {
			const tn = doc.teachers.find(t => t.id === spec.teacher)?.name ?? '?';
			push(`Lehrer "${tn}" hat hier bereits Unterricht (${otherSpec.subject}).`);
		}

		// Grade clash: only if the OTHER placement's grade is one we want to occupy.
		if (!sameGroup && targetGrades.has(p.grade)) {
			push(`Schulstufe ${p.grade} hat hier bereits Unterricht (${otherSpec.subject}).`);
		}

		// Week pattern clash (only if same group/paired)
		if (sameGroup && spec.weekPattern !== otherSpec.weekPattern) {
			if (
				(spec.weekPattern === 'even' && otherSpec.weekPattern === 'odd') ||
				(spec.weekPattern === 'odd' && otherSpec.weekPattern === 'even')
			) {
				push(`Wochen-Muster passt nicht (${spec.weekPattern} vs. ${otherSpec.weekPattern}).`);
			}
		}
	}

	return { hasConflict: reasons.length > 0, reasons };
}
