// Pure helpers for teacher lookups. Used by Svelte components instead of
// inlining the same `doc.teachers.find(...)` pattern in 3-4 places.

import type { ScheduleDoc, Teacher, TeacherId } from './types';

/** Find the Teacher record by id, or undefined if missing. */
export function teacherById(doc: ScheduleDoc, id: TeacherId): Teacher | undefined {
	return doc.teachers.find(t => t.id === id);
}

/** Display color for a teacher, with a fallback grey when the id is unknown. */
export function teacherColor(doc: ScheduleDoc, id: TeacherId): string {
	return teacherById(doc, id)?.color ?? '#9ca3af';
}

/** Display name for a teacher, with an em-dash fallback. */
export function teacherName(doc: ScheduleDoc, id: TeacherId): string {
	return teacherById(doc, id)?.name ?? '–';
}
