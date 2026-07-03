// Solver-Opt Schritt 6: Lehrer-Qualitäts-Report.
//
// Beantwortet die Frage „WARUM ist der Plan gut/schlecht für Lehrer X?"
// direkt aus doc.placed — kein Solver-State nötig, funktioniert also auch
// für manuell gebaute oder importierte Pläne.
//
// Team-Teaching-aware: pro Placement zählen die EFFEKTIVEN Lehrer
// (PlacedLesson.teachers = Segment-Team, Fallback spec.teachers) — wie
// plan-validation.ts.

import type { ScheduleDoc, Day } from './types';
import { DAYS, PERIODS } from './types';

export interface TeacherQualityRow {
	teacherId: string;
	name: string;
	shortNumber: number;
	color: string;
	/** Unterrichts-Slots pro Woche (distinct (Tag, Periode)). */
	weekLessons: number;
	/** Tage mit mindestens 1 Stunde. */
	daysPresent: number;
	/** Ideal-Anwesenheitstage: ceil(weekLessons / 6). */
	idealDays: number;
	/** Springstunden gesamt (innere Lücken über alle Tage). */
	gaps: number;
	/** Schlechtester Tag: meiste Lücken an einem einzelnen Tag. */
	worstDayGaps: number;
	/** Summe der Späteinstiege (firstP-Index pro aktivem Tag; P1-Start = 0). */
	lateStarts: number;
	/** Tage mit genau 1 Stunde (Anfahrt lohnt nicht). */
	miniDays: number;
	/** Lange Tage (≥6h, Vormittag+Nachmittag) ohne freie P5/P6. */
	missedLunch: number;
	/** Pro Tag: belegte Perioden (1-basiert) — für Detail-Anzeige. */
	periodsByDay: Record<Day, number[]>;
}

/**
 * Berechnet den Lehrer-Qualitäts-Report aus dem aktuellen Plan.
 * Sortierung: schlechtester Lehrer zuerst (meiste Lücken, dann Mini-Tage).
 */
export function computeTeacherQuality(doc: ScheduleDoc): TeacherQualityRow[] {
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const P = PERIODS.length;

	// Pro Lehrer: Set belegter (dayIndex, period) — dedupliziert Multi-Grade-
	// Placements (mehrere PlacedLessons pro Slot) automatisch.
	const occByTeacher = new Map<string, Set<number>>();
	for (const pl of doc.placed) {
		const spec = specById.get(pl.specId);
		if (!spec) continue;
		const effectiveTeachers = pl.teachers ?? spec.teachers;
		const dayIdx = DAYS.indexOf(pl.day);
		if (dayIdx === -1) continue;
		const code = dayIdx * P + (pl.period - 1);
		for (const tid of effectiveTeachers) {
			let set = occByTeacher.get(tid);
			if (!set) {
				set = new Set();
				occByTeacher.set(tid, set);
			}
			set.add(code);
		}
	}

	const rows: TeacherQualityRow[] = [];
	for (const teacher of doc.teachers) {
		const occ = occByTeacher.get(teacher.id);
		if (!occ || occ.size === 0) continue; // Lehrer ohne Stunden: kein Report-Eintrag

		let weekLessons = 0;
		let daysPresent = 0;
		let gaps = 0;
		let worstDayGaps = 0;
		let lateStarts = 0;
		let miniDays = 0;
		let missedLunch = 0;
		const periodsByDay = {} as Record<Day, number[]>;
		for (const day of DAYS) periodsByDay[day] = [];

		for (let d = 0; d < DAYS.length; d++) {
			let firstP = -1;
			let lastP = -1;
			let occupied = 0;
			for (let p = 0; p < P; p++) {
				if (occ.has(d * P + p)) {
					if (firstP === -1) firstP = p;
					lastP = p;
					occupied++;
					periodsByDay[DAYS[d]].push(p + 1);
				}
			}
			if (occupied === 0) continue;
			weekLessons += occupied;
			daysPresent++;
			if (occupied === 1) miniDays++;
			lateStarts += firstP;
			let dayGaps = 0;
			for (let p = firstP + 1; p < lastP; p++) {
				if (!occ.has(d * P + p)) dayGaps++;
			}
			gaps += dayGaps;
			if (dayGaps > worstDayGaps) worstDayGaps = dayGaps;
			// Mittagspause: >=6h, Vormittag (P1-P4) UND Nachmittag (P7-P8), P5+P6 belegt
			if (occupied >= 6) {
				const p5 = occ.has(d * P + 4);
				const p6 = occ.has(d * P + 5);
				if (p5 && p6) {
					let hasMorning = false;
					for (let p = 0; p <= 3; p++) if (occ.has(d * P + p)) { hasMorning = true; break; }
					let hasAfternoon = false;
					for (let p = 6; p <= 7; p++) if (occ.has(d * P + p)) { hasAfternoon = true; break; }
					if (hasMorning && hasAfternoon) missedLunch++;
				}
			}
		}

		rows.push({
			teacherId: teacher.id,
			name: teacher.name,
			shortNumber: teacher.shortNumber,
			color: teacher.color,
			weekLessons,
			daysPresent,
			idealDays: Math.ceil(weekLessons / 6),
			gaps,
			worstDayGaps,
			lateStarts,
			miniDays,
			missedLunch,
			periodsByDay,
		});
	}

	// Schlechtester zuerst: meiste Lücken, dann Mini-Tage, dann Tage-Überhang.
	rows.sort((a, b) => {
		if (b.gaps !== a.gaps) return b.gaps - a.gaps;
		if (b.miniDays !== a.miniDays) return b.miniDays - a.miniDays;
		return (b.daysPresent - b.idealDays) - (a.daysPresent - a.idealDays);
	});
	return rows;
}
