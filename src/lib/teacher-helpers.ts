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

/**
 * Audit A5: DER kanonische Lehrerfarb-Tint für Zell-Hintergründe.
 * Vorher divergierten die Werte (LessonCell 35 %, WeekView 45 %,
 * ExportPanel handgerechnet ≙ 35 %) — jetzt überall 40 %.
 */
export const TEACHER_TINT_PERCENT = 40;

/** Lehrerfarbe als heller Zell-Hintergrund (color-mix Richtung Weiß). */
export function teacherTint(color: string): string {
	return `color-mix(in srgb, ${color} ${TEACHER_TINT_PERCENT}%, white)`;
}

/**
 * N-Streifen-Gradient über die effektiven Lehrer einer Stunde
 * (Team-Teaching): 1 Lehrer = einfacher Tint, N Lehrer = vertikale
 * Streifen zu je 100/N %. Leere Liste = grauer Fallback.
 */
export function teacherStripeBackground(colors: string[]): string {
	if (colors.length === 0) return teacherTint('#9ca3af');
	if (colors.length === 1) return teacherTint(colors[0]);
	const stops = colors.map((c, i) => {
		const from = ((i / colors.length) * 100).toFixed(2);
		const to = (((i + 1) / colors.length) * 100).toFixed(2);
		return `${teacherTint(c)} ${from}% ${to}%`;
	}).join(', ');
	return `linear-gradient(to right, ${stops})`;
}
