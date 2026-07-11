// Pure helpers for the schedule grid: which cells are filled, conflict detection,
// computing visible specs in the sidebar.

import { type Day, type GradeLevel, type LessonSpec, type PlacedLesson, type Period, type ScheduleDoc } from './types';

export interface CellPlacement {
	placed: PlacedLesson;
	spec: LessonSpec;
}

/**
 * Returns all placements that occupy (day, period, grade) — there can be more than
 * one if multiple specs share a slot via couplingId or pairedWith (parallel teaching).
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

/**
 * Audit A3 — DIE kanonische Slot-Zahl einer Spec: so viele volle
 * Wochen-Slots belegt der Solver für sie (units.ts resolveBlocks nutzt
 * dieselbe Formel). Halbzahlige counts (BBO/EH 0.5/1.5 aus Sokrates)
 * werden AUFGERUNDET — eine 0.5-Stunde belegt einen vollen Slot; die
 * G/U-Halbierung modelliert man über `weekPattern` (even/odd), nicht
 * über den count (die Diagnose warnt bei 0.5 ohne G/U-Pattern).
 *
 * Vor diesem Helper rechneten Sidebar/Diagnose mit dem ROHEN count —
 * eine 1.5er-Spec zeigte ewig „×0.5 ungeplant", eine 0.5er-Spec
 * verschwand aus der Liste obwohl der Solver 1 vollen Slot belegt.
 */
export function effectiveSlotCount(spec: Pick<LessonSpec, 'count'>): number {
	return Math.max(1, Math.round(spec.count));
}

/** Specs that still need to be placed (count not fully reached). */
export function unplacedSpecs(doc: ScheduleDoc): { spec: LessonSpec; remaining: number }[] {
	return doc.specs
		.map(s => ({ spec: s, remaining: effectiveSlotCount(s) - placedCountForSpec(doc, s.id) }))
		.filter(x => x.remaining > 0);
}

export interface ConflictCheck {
	hasConflict: boolean;
	reasons: string[];
}

/** Quell-Slot eines Drag-Moves (die Stunde, die gerade bewegt wird). */
export interface MoveSource {
	specId: string;
	day: Day;
	period: Period;
}

/**
 * Would placing `spec` at (day,period) — across ALL its grades — violate any
 * hard constraint given the current `placed` array? When dragging from another
 * cell, pass `moveSource` (the origin slot) so the lesson being moved doesn't
 * conflict with itself when dropped back onto its own cell.
 *
 * Audit-Fix A1c — Solver-Parität:
 *  - Doppellage verboten: eine ZWEITE Wochenstunde derselben Lehreinheit am
 *    selben (Tag, Periode) ist jetzt ein Konflikt (H8-Gegenstück; vorher
 *    „same spec is fine for repeat" — exakt der im Solver gefixte
 *    Doppellage-Bug, nur per Hand baubar). Kopplungs-Parallelität
 *    (VERSCHIEDENE Specs, gleiche couplingId) bleibt erlaubt.
 *  - Team-Teaching-Segmente: es zählen die EFFEKTIVEN Lehrer — beim Move die
 *    `teachers` der Quell-Lesson, bei liegenden Lessons deren `p.teachers`
 *    (Fallback jeweils spec.teachers). Vorher prüfte der Check immer das
 *    volle Spec-Team → False-Positives gegen abwesende Segment-Lehrer.
 */
export function checkPlacementConflict(
	doc: ScheduleDoc,
	spec: LessonSpec,
	day: Day,
	period: Period,
	moveSource?: MoveSource
): ConflictCheck {
	const reasons: string[] = [];
	const reasonSet = new Set<string>();
	const push = (r: string) => { if (!reasonSet.has(r)) { reasonSet.add(r); reasons.push(r); } };

	// Effektive Lehrer der zu platzierenden Stunde: beim Move das
	// Segment-Team der Quell-Lesson, sonst das volle Spec-Team.
	const movingLesson = moveSource
		? doc.placed.find(p =>
			p.specId === moveSource.specId && p.day === moveSource.day && p.period === moveSource.period)
		: undefined;
	const movingTeachers = movingLesson?.teachers ?? spec.teachers;

	// Teacher unavailable — every effective team member must be free
	for (const tid of movingTeachers) {
		const teacher = doc.teachers.find(t => t.id === tid);
		if (teacher?.unavailable.some(u => u.day === day && u.period === period)) {
			push(`Lehrer "${teacher.name}" ist hier nicht verfügbar.`);
		}
	}

	// Phase 13/18: afternoonAllowed-Hard-Constraints (H10/H11) für Drag&Drop.
	// (Block-Reichweite ist hier bewusst KEIN Thema: doc.placed kennt nur
	// Einzelperioden — Block-Units dekodiert der Solver zu einzelnen Lessons.)
	const afternoonStart = Math.max(1, Math.min(8, Math.round(
		doc.constraints?.noMainSubjectAfternoon?.afternoonStartsAtPeriod ?? 7
	)));
	if (spec.afternoonAllowed === 'never' && period >= afternoonStart) {
		push(`Lerneinheit "${spec.subject}" darf nicht am Nachmittag (P${afternoonStart}+) liegen.`);
	}
	if (spec.afternoonAllowed === 'must' && period < afternoonStart) {
		push(`Lerneinheit "${spec.subject}" muss am Nachmittag (P${afternoonStart}+) liegen.`);
	}

	const targetGrades = new Set(spec.grades);

	for (const p of doc.placed) {
		if (p.day !== day || p.period !== period) continue;
		// Nur die Quell-Lesson SELBST ausschließen (Drop zurück auf die eigene
		// Zelle). Vorher wurde pauschal jede Lesson derselben Spec am Ziel
		// übersprungen — dadurch rutschte die Doppellage beim Move durch.
		if (
			moveSource &&
			p.specId === moveSource.specId &&
			moveSource.day === day &&
			moveSource.period === period
		) continue;

		const otherSpec = doc.specs.find(s => s.id === p.specId);
		if (!otherSpec) continue;

		// H8-Gegenstück: zweite Wochenstunde derselben Lehreinheit am selben
		// Slot ist eine Doppellage (im Grid übereinander, in der Sidebar als
		// „ungeplant" gezählt) — im Solver hart verboten, hier jetzt auch.
		if (otherSpec.id === spec.id) {
			push(`Lehreinheit "${spec.subject}" liegt hier bereits — eine zweite Wochenstunde derselben Einheit auf demselben Slot ist nicht erlaubt.`);
			continue;
		}

		// Phase 8 v3: coupling check uses couplingId (solver-relevant), NOT
		// groupLabel (display-only). The legacy pairedWith field was removed
		// in Phase 12 — couplingId is the single source of truth.
		const sameGroup = !!(spec.couplingId && otherSpec.couplingId === spec.couplingId);

		// Effektive Lehrer der LIEGENDEN Stunde (Segment-Team, Fallback Spec-Team).
		const otherTeachers = p.teachers ?? otherSpec.teachers;

		// Teacher clash (unless paired/group) — any shared effective member counts
		if (!sameGroup) {
			const sharedTeacher = movingTeachers.find(tid => otherTeachers.includes(tid));
			if (sharedTeacher) {
				const tn = doc.teachers.find(t => t.id === sharedTeacher)?.name ?? '?';
				push(`Lehrer "${tn}" hat hier bereits Unterricht (${otherSpec.subject}).`);
			}
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
