// Pure helpers for the schedule grid: which cells are filled, conflict detection,
// computing visible specs in the sidebar.

import { GRADES, type Day, type GradeLevel, type LessonSpec, type PlacedLesson, type Period, type ScheduleDoc, type WeekPattern } from './types';

export interface CellPlacement {
	placed: PlacedLesson;
	spec: LessonSpec;
}

/**
 * Returns all placements that occupy (day, period, grade) — there can be more than
 * one if multiple specs share a slot via groupKey or pairedWith (parallel teaching).
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
		const spec = doc.specs.find(s => s.id === p.specId);
		if (!spec) continue;
		if (!spec.grades.includes(grade)) continue;
		out.push({ placed: p, spec });
	}
	return out;
}

/**
 * How often a spec has been placed across the week (counts each placement once
 * regardless of how many grades it spans, since one placement = one lesson).
 */
export function placedCountForSpec(doc: ScheduleDoc, specId: string): number {
	return doc.placed.filter(p => p.specId === specId).length;
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
 * Would placing `spec` at (day,period) violate any hard constraint given the
 * current `placed` array (excluding any placement with id `excludePlacedKey`)?
 */
export function checkPlacementConflict(
	doc: ScheduleDoc,
	spec: LessonSpec,
	day: Day,
	period: Period,
	excludeSpecAtDayPeriod?: string
): ConflictCheck {
	const reasons: string[] = [];

	// Teacher unavailable
	const teacher = doc.teachers.find(t => t.id === spec.teacher);
	if (teacher?.unavailable.some(u => u.day === day && u.period === period)) {
		reasons.push(`Lehrer "${teacher.name}" ist hier nicht verfügbar.`);
	}

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
			reasons.push(`Lehrer "${tn}" hat hier bereits Unterricht (${otherSpec.subject}).`);
		}

		// Grade clash (same grade in two specs at same time, unless paired)
		const overlap = spec.grades.filter(g => otherSpec.grades.includes(g));
		if (!sameGroup && overlap.length > 0) {
			reasons.push(`Schulstufe ${overlap.join(',')} hat hier bereits Unterricht (${otherSpec.subject}).`);
		}

		// Week pattern clash (only if same group/paired — they should match week pattern)
		if (sameGroup && spec.weekPattern !== otherSpec.weekPattern) {
			// Note: every+even or every+odd is fine semantically (every=both weeks).
			// Only flag if both are "even" vs "odd".
			if (
				(spec.weekPattern === 'even' && otherSpec.weekPattern === 'odd') ||
				(spec.weekPattern === 'odd' && otherSpec.weekPattern === 'even')
			) {
				reasons.push(`Wochen-Muster passt nicht (${spec.weekPattern} vs. ${otherSpec.weekPattern}).`);
			}
		}
	}

	return { hasConflict: reasons.length > 0, reasons };
}
