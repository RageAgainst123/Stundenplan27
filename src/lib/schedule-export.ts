// Phase 18: Stundenplan-Export (User-facing).
//
// Anders als der Solver-Snapshot ist dieser Export schmal und nutzfertig:
// nur die Daten die der User für Analyse, Weiterverwendung oder Druck
// braucht — keine Constraints, kein Schuljahr-Meta, keine Solver-Internas.
//
// Inhalt:
//   - placements[]: alle platzierten Stunden mit aufgelösten Lehrer-Namen,
//     Lehrer-Farben, Team-Teaching-Info, Subject-Name
//   - byDay: dieselben Daten nach Tag → Stunde → Stufe denormalisiert,
//     für direkte Anzeige ohne Lookup
//   - teachers[]: id → name, color, shortNumber
//   - subjects[]: code → name, isMain

import type { ScheduleDoc, Day, GradeLevel, Period } from './types';

interface ExportedTeacher {
	id: string;
	name: string;
	color: string;
	shortNumber: number;
}

interface ExportedPlacement {
	day: Day;
	period: Period;
	grade: GradeLevel;
	subject: string;
	subjectName: string;
	pinned: boolean;
	weekPattern: 'every' | 'even' | 'odd';
	classes: string[];
	/**
	 * Effektive Lehrer dieses Slots. Bei Team-Teaching-Specs mit
	 * teachingSegments enthält ein Slot nur die Lehrer DIESES Segments
	 * — nicht alle Lehrer der Spec. So sieht der Export pro Slot
	 * die WIRKLICH anwesenden Lehrer.
	 */
	teachers: ExportedTeacher[];
	/** Anzahl Lehrer im Slot — Kurz-Info für Filter/Statistik. */
	teacherCount: number;
	/** true wenn die Spec ein teachingSegments-Setup hat. */
	isTeamTeaching: boolean;
}

interface ExportedSchedule {
	exportedAt: string;
	placements: ExportedPlacement[];
	/**
	 * Denormalisierte Sicht: byDay[Tag][Stunde][Stufe] = Placement[]
	 * (mehrere Einträge wenn z.B. Kopplungen vorliegen).
	 */
	byDay: Record<Day, Record<number, Record<number, ExportedPlacement[]>>>;
	teachers: ExportedTeacher[];
	subjects: { code: string; name: string; isMain: boolean }[];
	stats: {
		totalPlacements: number;
		pinnedPlacements: number;
		teachingSlots: number; // distinkte (day, period, grade)
		teamTeachingSlots: number;
	};
}

export function buildScheduleExport(doc: ScheduleDoc): ExportedSchedule {
	const teacherById = new Map(doc.teachers.map(t => [t.id, t]));
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const subjectByCode = new Map(doc.subjects.map(s => [s.code, s]));

	const exportTeacherIds = (ids: string[]): ExportedTeacher[] => {
		const out: ExportedTeacher[] = [];
		for (const tid of ids) {
			const t = teacherById.get(tid);
			if (!t) continue;
			out.push({
				id: t.id,
				name: t.name,
				color: t.color,
				shortNumber: t.shortNumber,
			});
		}
		return out;
	};

	const placements: ExportedPlacement[] = [];
	const byDay: ExportedSchedule['byDay'] = {
		Mo: {}, Di: {}, Mi: {}, Do: {}, Fr: {}
	};

	let teamTeachingSlots = 0;
	const distinctSlots = new Set<string>();

	for (const p of doc.placed) {
		const spec = specById.get(p.specId);
		if (!spec) continue;
		const subj = subjectByCode.get(spec.subject);

		// Effektive Lehrer für DIESEN Slot:
		// - bei PlacedLesson.teachers gesetzt (Team-Teaching mit Segmenten),
		//   nutze diese (= das aktive Segment-Team)
		// - sonst alle Lehrer der Spec
		const effectiveTeacherIds = p.teachers ?? spec.teachers;
		const teachers = exportTeacherIds(effectiveTeacherIds);

		const isTeamTeaching = !!(spec.teachingSegments && spec.teachingSegments.length > 0);
		if (isTeamTeaching) teamTeachingSlots++;

		const placement: ExportedPlacement = {
			day: p.day,
			period: p.period,
			grade: p.grade,
			subject: spec.subject,
			subjectName: subj?.name ?? spec.subject,
			pinned: p.pinned,
			weekPattern: spec.weekPattern,
			classes: [...spec.classes],
			teachers,
			teacherCount: teachers.length,
			isTeamTeaching,
		};

		placements.push(placement);
		distinctSlots.add(`${p.day}|${p.period}|${p.grade}`);

		// Denormalisierte Sicht
		const dayMap = byDay[p.day];
		const periodMap = dayMap[p.period] ?? (dayMap[p.period] = {});
		const gradeArr = periodMap[p.grade] ?? (periodMap[p.grade] = []);
		gradeArr.push(placement);
	}

	// Sortierung: nach Tag, Stunde, Stufe — für stabile, lesbare Exporte
	const dayOrder: Record<Day, number> = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4 };
	placements.sort((a, b) => {
		const dd = dayOrder[a.day] - dayOrder[b.day];
		if (dd !== 0) return dd;
		if (a.period !== b.period) return a.period - b.period;
		return a.grade - b.grade;
	});

	const teachersUsed = new Map<string, ExportedTeacher>();
	for (const p of placements) {
		for (const t of p.teachers) {
			if (!teachersUsed.has(t.id)) teachersUsed.set(t.id, t);
		}
	}

	return {
		exportedAt: new Date().toISOString(),
		placements,
		byDay,
		teachers: [...teachersUsed.values()].sort((a, b) => a.shortNumber - b.shortNumber),
		subjects: doc.subjects.map(s => ({
			code: s.code,
			name: s.name,
			isMain: s.isMain,
		})),
		stats: {
			totalPlacements: placements.length,
			pinnedPlacements: placements.filter(p => p.pinned).length,
			teachingSlots: distinctSlots.size,
			teamTeachingSlots,
		},
	};
}
