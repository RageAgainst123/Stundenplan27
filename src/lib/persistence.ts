// localStorage save/load + JSON file download/upload for backups.
// Includes forward-compatible migrations.

import { SCHEMA_VERSION, type ConstraintConfig, type GradeLevel, type PlacedLesson, type ScheduleDoc, type LessonSpec, type Subject } from './types';

const STORAGE_KEY = 'stundenplan27.doc';

/**
 * Apply in-place migrations to a loaded doc. Runs on every load so that
 * older backups (or older localStorage state) get filled with defaults.
 *
 * Phase 7B migration: blocks that match the legacy default pattern
 * (= count singles, e.g. [1,1,1,1] for count=4) are interpreted as
 * "user never picked anything" and reset to undefined, which now means
 * "automatic — solver decides". Explicit non-default patterns like
 * [2,1] stay strict.
 *
 * Phase 8 v1→v2 migration: PlacedLesson.grade was missing in v1 — multi-grade
 * specs were rendered into every grade column at once. v2 stores one
 * PlacedLesson per grade. We expand each v1 placement into spec.grades.length
 * v2 placements (one per grade column).
 *
 * Phase 8 v2→v3 migration: split LessonSpec.groupKey into:
 *   - groupLabel  (descriptive Sokrates "Gruppe" — no solver effect)
 *   - couplingId  (hard solver constraint: same slot)
 * Option A (conservative): all old groupKey values move to groupLabel; no
 * spec gets a couplingId automatically. The user re-creates real couplings
 * via the bulk action. Reasoning: in real Sokrates exports the "Gruppe"
 * column is unique per spec, so it never represented a parallel-teaching
 * coupling — the previous code treated it as one and produced wrong solver
 * constraints.
 */
export function migrateDoc(doc: ScheduleDoc): ScheduleDoc {
	for (const spec of doc.specs ?? []) {
		const s = spec as LessonSpec & {
			blocks?: number[];
			includeInSolver?: boolean;
			groupKey?: string;
			groupLabel?: string;
			couplingId?: string;
			teacher?: string;          // v3 single teacher field
			teachers?: string[];       // v4 team field
		};

		// v3 → v4: teacher (single) → teachers (array). Idempotent: if v4
		// data already has `teachers`, we keep it; we still strip `teacher`
		// to avoid stale state. If the array is empty/missing but `teacher`
		// is present, populate from it.
		if (!Array.isArray(s.teachers) || s.teachers.length === 0) {
			s.teachers = typeof s.teacher === 'string' && s.teacher ? [s.teacher] : [];
		}
		if ('teacher' in s) {
			delete (s as unknown as Record<string, unknown>).teacher;
		}
		if (Array.isArray(s.blocks) && s.blocks.length > 0) {
			const isLegacyAllSingles = s.blocks.every(n => n === 1) && s.blocks.length === Math.round(s.count);
			if (isLegacyAllSingles) {
				// Legacy default — was implicit, now means "auto mode"
				s.blocks = undefined;
			}
			// else: explicit pattern, keep
		} else if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
			s.blocks = undefined;
		}
		if (typeof s.includeInSolver !== 'boolean') {
			s.includeInSolver = true;
		}

		// v2 → v3: groupKey → groupLabel (Option A — no auto-coupling).
		// Only migrate if the new fields don't already exist (idempotent).
		if (s.groupKey && !s.groupLabel && !s.couplingId) {
			s.groupLabel = s.groupKey;
		}
		// Always strip the obsolete field so it doesn't linger in JSON backups.
		if ('groupKey' in s) {
			delete (s as unknown as Record<string, unknown>).groupKey;
		}
	}
	for (const subject of doc.subjects ?? []) {
		const sub = subject as Subject & { maxConsecutive?: number };
		if (typeof sub.maxConsecutive !== 'number') {
			sub.maxConsecutive = sub.isMain ? 2 : 99;
		}
	}

	// Phase 9 + 10 additive migration: ConstraintConfig new fields.
	if (doc.constraints) {
		const c = doc.constraints as ConstraintConfig & {
			noMainSubjectAfternoon?: { applyToAllSubjects?: boolean; weightAllSubjects?: number };
			minDailySlotsPerGrade?: number;
			mustStartFirstPeriod?: { enabled?: boolean };
		};
		if (typeof c.minDailySlotsPerGrade !== 'number') {
			c.minDailySlotsPerGrade = 4;
		}
		if (c.noMainSubjectAfternoon) {
			if (typeof c.noMainSubjectAfternoon.applyToAllSubjects !== 'boolean') {
				c.noMainSubjectAfternoon.applyToAllSubjects = true;
			}
			if (typeof c.noMainSubjectAfternoon.weightAllSubjects !== 'number') {
				c.noMainSubjectAfternoon.weightAllSubjects = 15;
			}
		}
		// mustStartFirstPeriod: was previously {enabled} only — promote to {enabled, weight}.
		if (!c.mustStartFirstPeriod || typeof c.mustStartFirstPeriod.enabled !== 'boolean') {
			c.mustStartFirstPeriod = { enabled: true, weight: 300 };
		} else if (typeof (c.mustStartFirstPeriod as { weight?: number }).weight !== 'number') {
			(c.mustStartFirstPeriod as { weight: number }).weight = 300;
		}
		// Phase 11: noFreePeriodsForClass.strict (auto-relaxation flag).
		// Default: true — behave as a hard constraint with auto-relaxation.
		if (c.noFreePeriodsForClass && typeof (c.noFreePeriodsForClass as { strict?: boolean }).strict !== 'boolean') {
			(c.noFreePeriodsForClass as { strict?: boolean }).strict = true;
		}
		// Phase 11 tuning: bump the default compactTeacherDays weight from
		// 30 (too weak — solver ignored teacher sandwich gaps) to 80. We only
		// touch values still at the legacy default; user-customized weights
		// stay as they are.
		if (c.compactTeacherDays && c.compactTeacherDays.weight === 30) {
			c.compactTeacherDays.weight = 80;
		}
		// Phase 12: expose previously hard-coded weights + new constraints.
		const c12 = c as unknown as Record<string, unknown>;
		if (typeof c12.minDailyWeight !== 'number') c12.minDailyWeight = 500;
		if (typeof c12.unevenDaysWeight !== 'number') c12.unevenDaysWeight = 150;
		if (typeof c12.timePrefWeight !== 'number') c12.timePrefWeight = 100;
		if (typeof c12.subjectMaxOncePerDay !== 'object' || c12.subjectMaxOncePerDay === null) {
			c12.subjectMaxOncePerDay = { enabled: true, weight: 60 };
		}
		if (typeof c12.teacherDailyLoad !== 'object' || c12.teacherDailyLoad === null) {
			c12.teacherDailyLoad = { enabled: true, weight: 50 };
		}
		if (typeof c12.teacherLunchBreak !== 'object' || c12.teacherLunchBreak === null) {
			c12.teacherLunchBreak = { enabled: true, weight: 40, midayPeriods: [5, 6] };
		}
		// Reactivate the previously-defunct preferDoubleLessonsContiguous
		// (it was tied to no scoring code). Bump its old "20" default so the
		// re-implementation is actually noticeable.
		if (c.preferDoubleLessonsContiguous && c.preferDoubleLessonsContiguous.weight === 20) {
			c.preferDoubleLessonsContiguous.weight = 30;
		}
	}

	// Phase 8 v1→v2: expand grade-less PlacedLessons. Detect by absence of
	// `grade` on any entry — also covers JSON backups from v1.
	const specsById = new Map((doc.specs ?? []).map(s => [s.id, s]));
	const v1Mode = (doc.placed ?? []).some(p => typeof (p as PlacedLesson).grade !== 'number');
	if (v1Mode) {
		const expanded: PlacedLesson[] = [];
		const seen = new Set<string>();
		for (const p of doc.placed ?? []) {
			const spec = specsById.get(p.specId);
			if (!spec) continue;
			const gradesForRow: GradeLevel[] = typeof (p as PlacedLesson).grade === 'number'
				? [(p as PlacedLesson).grade]
				: spec.grades.length > 0 ? spec.grades : [5];
			for (const g of gradesForRow) {
				const key = `${p.specId}|${p.day}|${p.period}|${g}`;
				if (seen.has(key)) continue;
				seen.add(key);
				expanded.push({
					specId: p.specId,
					day: p.day,
					period: p.period,
					grade: g,
					pinned: !!p.pinned
				});
			}
		}
		doc.placed = expanded;
	}

	if (doc.meta) {
		doc.meta.schemaVersion = SCHEMA_VERSION;
	}
	return doc;
}

export function saveToLocalStorage(doc: ScheduleDoc): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
	} catch (e) {
		console.warn('localStorage save failed', e);
	}
}

export function loadFromLocalStorage(): ScheduleDoc | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as ScheduleDoc;
		if (parsed?.meta?.schemaVersion !== SCHEMA_VERSION) {
			console.warn(
				`Schema version mismatch (found ${parsed?.meta?.schemaVersion}, expected ${SCHEMA_VERSION}). Loaded as-is.`
			);
		}
		return migrateDoc(parsed);
	} catch (e) {
		console.warn('localStorage load failed', e);
		return null;
	}
}

export function clearLocalStorage(): void {
	localStorage.removeItem(STORAGE_KEY);
}

export function downloadAsJson(doc: ScheduleDoc, filename?: string): void {
	const safeYear = doc.schoolYear.replace(/[/\\: ]/g, '-');
	const name = filename ?? `stundenplan-${safeYear}.json`;
	const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<ScheduleDoc> {
	const text = await file.text();
	const parsed = JSON.parse(text) as ScheduleDoc;
	if (!parsed?.meta) {
		throw new Error('JSON ohne meta-Feld — keine Stundenplan-Datei.');
	}
	// schemaVersion is typed as the current literal, but old backups may hold
	// older numbers → cast to number for the runtime comparison.
	const v = parsed.meta.schemaVersion as number;
	// Accept v1, v2, v3 (all auto-migrated by migrateDoc) and the current version.
	if (v !== 1 && v !== 2 && v !== 3 && v !== SCHEMA_VERSION) {
		throw new Error(
			`Inkompatibles Schema (gefunden: ${v ?? 'unbekannt'}, erwartet: 1, 2, 3 oder ${SCHEMA_VERSION})`
		);
	}
	return migrateDoc(parsed);
}
