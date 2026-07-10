// Stundenplan-Import (Gegenstück zu schedule-export.ts).
//
// User-Anlass: Nach einem Datenverlust (localStorage weg) ist der
// Plan-Export oft das einzige Überbleibsel — er muss sich wieder
// einspielen lassen, auch wenn die Stammdaten inzwischen NEU importiert
// wurden (frische UUIDs!). Deshalb matcht der Import kaskadiert:
//
//   Eintrag → Spec über (Fach-Code + Stufe + Lehrer), Lehrer erst per
//   ID, dann per NAME (normalisiert). So funktioniert der Import sowohl
//   ins selbe Doc (IDs identisch) als auch in ein frisch aus der CSV
//   aufgebautes Doc (IDs neu, Namen gleich).
//
// Kopplungen brauchen keine Sonderbehandlung: der Export enthält pro
// PlacedLesson (= pro Spec) einen Eintrag — gekoppelte Specs erscheinen
// als getrennte Einträge am selben Slot und werden einzeln zugeordnet.

import type { Day, GradeLevel, LessonSpec, Period, PlacedLesson, ScheduleDoc } from './types';
import { DAYS, GRADES, PERIODS } from './types';

/** Schmale Sicht auf einen Export-Eintrag — nur was der Import braucht. */
export interface ImportedPlacement {
	day: Day;
	period: Period;
	grade: GradeLevel;
	subject: string;
	pinned: boolean;
	weekPattern?: 'every' | 'even' | 'odd';
	classes?: string[];
	teachers: { id?: string; name?: string }[];
	isTeamTeaching?: boolean;
}

export interface ScheduleImportResult {
	/** Fertige PlacedLessons (specId auf das AKTUELLE Doc gemappt). */
	placed: PlacedLesson[];
	/** Anzahl Export-Einträge gesamt. */
	total: number;
	/** Davon erfolgreich zugeordnet. */
	matched: number;
	/** Nicht zuordenbare Einträge (kein Spec-Match im aktuellen Doc). */
	skipped: { day: Day; period: Period; grade: GradeLevel; subject: string }[];
}

/**
 * Parst und validiert eine Plan-Export-Datei (JSON-String).
 * Gibt null zurück wenn das Format nicht passt (kein Plan-Export).
 */
export function parseScheduleExport(json: string): ImportedPlacement[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const placements = (parsed as { placements?: unknown }).placements;
	if (!Array.isArray(placements)) return null;

	const daySet = new Set<string>(DAYS);
	const gradeSet = new Set<number>(GRADES);
	const periodSet = new Set<number>(PERIODS);
	const out: ImportedPlacement[] = [];
	for (const raw of placements) {
		if (typeof raw !== 'object' || raw === null) continue;
		const p = raw as Record<string, unknown>;
		if (!daySet.has(p.day as string)) continue;
		if (!periodSet.has(p.period as number)) continue;
		if (!gradeSet.has(p.grade as number)) continue;
		if (typeof p.subject !== 'string' || !p.subject) continue;
		const teachers = Array.isArray(p.teachers)
			? (p.teachers as unknown[])
				.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
				.map(t => ({
					id: typeof t.id === 'string' ? t.id : undefined,
					name: typeof t.name === 'string' ? t.name : undefined,
				}))
			: [];
		out.push({
			day: p.day as Day,
			period: p.period as Period,
			grade: p.grade as GradeLevel,
			subject: p.subject,
			pinned: p.pinned === true,
			weekPattern: p.weekPattern === 'even' || p.weekPattern === 'odd' || p.weekPattern === 'every'
				? p.weekPattern : undefined,
			classes: Array.isArray(p.classes) ? (p.classes as unknown[]).filter((c): c is string => typeof c === 'string') : undefined,
			teachers,
			isTeamTeaching: p.isTeamTeaching === true,
		});
	}
	// Eine Export-Datei ganz ohne gültige Einträge behandeln wir als
	// Format-Fehler — sonst würde ein versehentlich gewähltes JSON-Backup
	// (anderes Format) still einen leeren Plan importieren.
	return out.length > 0 ? out : null;
}

function normName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Ordnet Export-Einträge den Specs des AKTUELLEN Docs zu und baut die
 * PlacedLesson-Liste. Kaskadiertes Lehrer-Matching: erst Teacher-ID,
 * dann normalisierter Name (übersteht frisch importierte Stammdaten).
 */
export function mapScheduleImport(doc: ScheduleDoc, entries: ImportedPlacement[]): ScheduleImportResult {
	const teacherNameById = new Map(doc.teachers.map(t => [t.id, normName(t.name)]));
	const teacherIdByName = new Map(doc.teachers.map(t => [normName(t.name), t.id]));

	/** Lehrer-Übereinstimmung Spec ↔ Eintrag: Anzahl gemeinsamer Lehrer. */
	function teacherOverlap(spec: LessonSpec, e: ImportedPlacement): number {
		if (e.teachers.length === 0) return 0;
		const specIds = new Set(spec.teachers);
		const specNames = new Set(spec.teachers.map(id => teacherNameById.get(id)).filter(Boolean));
		let overlap = 0;
		for (const t of e.teachers) {
			if (t.id && specIds.has(t.id)) { overlap++; continue; }
			if (t.name && specNames.has(normName(t.name))) overlap++;
		}
		return overlap;
	}

	/** Eintrags-Lehrer auf AKTUELLE Doc-Teacher-IDs mappen (für Team-Teaching). */
	function mapTeacherIds(e: ImportedPlacement): string[] | undefined {
		const ids: string[] = [];
		for (const t of e.teachers) {
			if (t.id && teacherNameById.has(t.id)) { ids.push(t.id); continue; }
			const byName = t.name ? teacherIdByName.get(normName(t.name)) : undefined;
			if (byName) { ids.push(byName); continue; }
			return undefined; // unvollständig → lieber Fallback auf spec.teachers
		}
		return ids.length > 0 ? ids : undefined;
	}

	const placed: PlacedLesson[] = [];
	const seen = new Set<string>();
	const skipped: ScheduleImportResult['skipped'] = [];
	let matched = 0;

	for (const e of entries) {
		// Kandidaten: Fach + Stufe müssen passen, Lehrer-Überlappung > 0
		// (wenn der Eintrag Lehrer nennt). Bei mehreren Kandidaten gewinnt
		// die größte Lehrer-Überlappung, dann exakte Team-Größe, dann
		// Wochen-Pattern-Gleichheit.
		let best: LessonSpec | null = null;
		let bestScore = -1;
		const subjectGradeMatches: LessonSpec[] = [];
		for (const spec of doc.specs) {
			if (spec.subject !== e.subject) continue;
			if (!spec.grades.includes(e.grade)) continue;
			subjectGradeMatches.push(spec);
			const overlap = teacherOverlap(spec, e);
			if (e.teachers.length > 0 && overlap === 0) continue;
			let score = overlap * 100;
			if (spec.teachers.length === e.teachers.length) score += 10;
			if (e.weekPattern && spec.weekPattern === e.weekPattern) score += 5;
			if (e.classes && e.classes.length > 0 && e.classes.every(c => spec.classes.includes(c))) score += 1;
			if (score > bestScore) {
				bestScore = score;
				best = spec;
			}
		}
		// Fallback-Stufe 3: Kein Lehrer-Match (Lehrer wurde inzwischen
		// umbenannt oder die Stunde einem anderen Lehrer zugeteilt), aber
		// (Fach + Stufe) hat GENAU einen Kandidaten → Zuordnung ist logisch
		// eindeutig. Bei mehreren Kandidaten bleibt der Eintrag übersprungen
		// (lieber transparent melden als falsch raten).
		if (!best && subjectGradeMatches.length === 1) {
			best = subjectGradeMatches[0];
		}
		if (!best) {
			skipped.push({ day: e.day, period: e.period, grade: e.grade, subject: e.subject });
			continue;
		}
		matched++;
		const key = `${best.id}|${e.day}|${e.period}|${e.grade}`;
		if (seen.has(key)) continue; // Dedup (defensiv gegen doppelte Export-Zeilen)
		seen.add(key);
		const lesson: PlacedLesson = {
			specId: best.id,
			day: e.day,
			period: e.period,
			grade: e.grade,
			pinned: e.pinned,
		};
		// Team-Teaching mit Segmenten: effektives Slot-Team übernehmen —
		// aber nur wenn ALLE Lehrer aufs aktuelle Doc mappbar sind.
		if (e.isTeamTeaching && best.teachingSegments && best.teachingSegments.length > 0) {
			const ids = mapTeacherIds(e);
			if (ids) lesson.teachers = ids;
		}
		placed.push(lesson);
	}

	return { placed, total: entries.length, matched, skipped };
}
