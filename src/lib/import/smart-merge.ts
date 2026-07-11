// Smart-Merge: Post-Processing für Sokrates-Import.
//
// Erkennt drei Muster die in der MS-SiG-Liste NICHT vorkommen, in anderen
// Schulen aber sehr wohl:
//
//   A) TEAM-TEACHING: 1 Lehrer mit Stunden>0 (Hauptlehrer) plus ≥1 Lehrer
//      mit nur ErgStunden>0 (Stütz-/Co-Lehrer). Die Stütz-Lehrer sind in
//      EINIGEN der Hauptlehrer-Stunden mit drin, nicht zusätzlich.
//      → Eine Spec mit `count = HauptlehrerStunden`, `teachers = [Haupt, …Stütz]`.
//
//   B) SELBE-LEHRER-MEHRFACHZEILEN: Sokrates spaltet manchmal denselben
//      Lehrer auf mehrere Zeilen (Stand+Erg, oder zwei Erg-Einträge).
//      → Eine Spec mit `count = Σ Stunden+ErgStunden`, ein Lehrer.
//
//   C) LEISTUNGSGRUPPEN-KOPPLUNG: zwei Specs derselben (Subject, Klasse,
//      Stufe) mit unterschiedlichen Gruppen (z.B. PG_D_Stand_3 vs
//      PG_D_AHS_3) → laufen parallel, brauchen `couplingId`.
//
// Wichtig: Dieses Modul VERÄNDERT das Verhalten nur wenn aktiviert. Default
// im Parser ist `smartMerge=false` → bit-identisch zum Stand vor Phase 17.

import type { LessonSpec, TeachingSegment } from '../types';
import type { ImportResult } from './csv';

export interface SmartMergeStats {
	teamGroupsMerged: number;
	sameTeacherRowsCollapsed: number;
	leistungsCouplings: number;
	warnings: string[];
}

/**
 * Raw row variant — Sokrates row WITH the original Stunden/ErgStunden split.
 * The parser must call this BEFORE building LessonSpec[] from rows.
 */
export interface SmartMergeInput {
	rows: SmartRow[];
	teachers: ImportResult['teachers'];
	subjects: ImportResult['subjects'];
	warnings: string[];
	makeId: () => string;
}

export interface SmartRow {
	rowIndex: number;          // CSV line number (for warnings)
	subjectCode: string;
	classes: string[];
	groupLabel: string;        // "" if empty
	stunden: number;
	ergStunden: number;
	grades: number[];
	teacherId: string;
}

/**
 * Apply smart-merge at the row level. Replaces the per-row LessonSpec
 * production in csv.ts when `smartMerge=true`.
 */
export function buildSpecsWithSmartMerge(input: SmartMergeInput): {
	specs: LessonSpec[];
	stats: SmartMergeStats;
} {
	const { rows, makeId } = input;
	const stats: SmartMergeStats = {
		teamGroupsMerged: 0,
		sameTeacherRowsCollapsed: 0,
		leistungsCouplings: 0,
		warnings: []
	};
	const specs: LessonSpec[] = [];

	// Step 1: Group by (subject + classes + groupLabel + grades).
	// Inside a group, rows are candidates for team-teaching or same-teacher
	// collapse.
	const groupKey = (r: SmartRow) =>
		`${r.subjectCode}|${r.classes.slice().sort().join('+')}|${r.groupLabel}|${r.grades.slice().sort().join(',')}`;

	const groups = new Map<string, SmartRow[]>();
	for (const row of rows) {
		const k = groupKey(row);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k)!.push(row);
	}

	// We need to remember "which group did this spec come from" so we can do
	// Step 2 (Leistungsgruppen-Kopplung) afterwards. Track spec → (subject,
	// classes, grades) mapping for that.
	const specGroupKey = (spec: LessonSpec) =>
		`${spec.subject}|${spec.classes.slice().sort().join('+')}|${spec.grades.slice().sort().join(',')}`;

	for (const [, groupRows] of groups) {
		if (groupRows.length === 1) {
			// Trivial: single row → one spec, no merge.
			specs.push(rowToSpec(groupRows[0], makeId));
			continue;
		}

		// Multi-row group → check patterns.
		const uniqueTeachers = new Set(groupRows.map(r => r.teacherId));
		const stundenRows = groupRows.filter(r => r.stunden > 0);
		const ergRows = groupRows.filter(r => r.stunden === 0 && r.ergStunden > 0);
		const uniqueHaupt = new Set(stundenRows.map(r => r.teacherId));

		// Pattern B: SAME teacher across all rows → collapse to one spec.
		if (uniqueTeachers.size === 1) {
			const r0 = groupRows[0];
			const totalCount = groupRows.reduce((s, r) => s + r.stunden + r.ergStunden, 0);
			specs.push({
				...rowToSpec(r0, makeId),
				count: totalCount
			});
			stats.sameTeacherRowsCollapsed += groupRows.length - 1;
			continue;
		}

		// Pattern A: TEAM-TEACHING — exactly 1 unique main teacher with
		// Stunden>0, plus 1+ Erg-only rows.
		if (uniqueHaupt.size === 1 && ergRows.length >= 1 && stundenRows.length === 1) {
			const main = stundenRows[0];
			// Pro Stütz-Lehrer: Summe seiner Erg-Stunden (multiple Zeilen werden summiert).
			const supportHoursByTeacher = new Map<string, number>();
			for (const er of ergRows) {
				if (er.teacherId === main.teacherId) continue;
				supportHoursByTeacher.set(
					er.teacherId,
					(supportHoursByTeacher.get(er.teacherId) ?? 0) + er.ergStunden
				);
			}
			const supportTeachers = [...supportHoursByTeacher.keys()];
			// Cap auf Hauptlehrer-Stunden — kein Stütz kann in mehr Slots sitzen
			// als der Hauptlehrer überhaupt hat.
			const supportHours = supportTeachers.map(tid =>
				Math.min(supportHoursByTeacher.get(tid)!, main.stunden)
			);
			// Phase 17: Best-Guess-Aufteilung in teachingSegments. Algorithmus
			// "nested coverage": die Stütz-Lehrer sind absteigend nach Stunden
			// gestaffelt, jeder Stütz ist in den ersten N Slots dabei.
			const teachingSegments = buildBestGuessSegments(
				main.stunden,
				main.teacherId,
				supportTeachers,
				supportHours
			);

			specs.push({
				...rowToSpec(main, makeId),
				count: main.stunden, // ← The KEY: Slot-count = main teacher hours, NOT sum
				teachers: [main.teacherId, ...supportTeachers],
				teachingSegments
			});
			stats.teamGroupsMerged++;
			continue;
		}

		// Edge case D: multiple "Hauptlehrer" (≥2 with Stunden>0) without
		// clear grouping → emit one spec per row + warning.
		if (uniqueHaupt.size >= 2 && !groupRows[0].groupLabel) {
			stats.warnings.push(
				`${groupRows[0].subjectCode} Klasse ${groupRows[0].classes.join('+')}: ` +
				`${uniqueHaupt.size} verschiedene Hauptlehrer ohne Gruppe — keine automatische ` +
				`Zusammenführung, bitte manuell prüfen.`
			);
			for (const r of groupRows) specs.push(rowToSpec(r, makeId));
			continue;
		}

		// Fallback: emit one spec per row, no merge.
		for (const r of groupRows) specs.push(rowToSpec(r, makeId));
	}

	// Step 2: Leistungsgruppen-Kopplung. KONSERVATIV — wir koppeln nur
	// wenn das Muster eindeutig auf Leistungsdifferenzierung schließen lässt.
	// Konkret: gleicher Subject-Code, gleiche Klasse, gleiche Stufe, UND
	// die GroupLabels enthalten typische Marker (Stand, AHS, MAR, NMS, Std).
	//
	// Verschiedene Förderkurse (FÖ_D, FÖ_M, FÖ_E) werden NICHT gekoppelt —
	// sie sind separate Lehreinheiten verschiedener Subjects, die zufällig
	// im selben Slot stattfinden können.
	// `_` zählt für \b nicht als Wortgrenze, deshalb explizit `(_|^)` und `(_|$)`.
	const LEISTUNGS_MARKERS = /(?:^|_)(stand(?:ard)?|ahs|nms|mar|std)(?:_|$)/i;
	const parallelGroups = new Map<string, LessonSpec[]>();
	for (const spec of specs) {
		if (!spec.groupLabel) continue;
		// Filter: nur Specs mit Leistungs-Marker im Group-Label
		if (!LEISTUNGS_MARKERS.test(spec.groupLabel)) continue;
		const k = specGroupKey(spec);
		if (!parallelGroups.has(k)) parallelGroups.set(k, []);
		parallelGroups.get(k)!.push(spec);
	}
	for (const [, parallelSpecs] of parallelGroups) {
		if (parallelSpecs.length < 2) continue;
		const distinctLabels = new Set(parallelSpecs.map(s => s.groupLabel));
		if (distinctLabels.size < 2) continue;
		const couplingId = makeId();
		for (const s of parallelSpecs) {
			s.couplingId = couplingId;
		}
		stats.leistungsCouplings++;
	}

	stats.warnings.forEach(w => input.warnings.push(`Smart-Merge: ${w}`));

	return { specs, stats };
}

/**
 * Best-Guess für die Aufteilung einer Team-Teaching-Spec in `teachingSegments`.
 *
 * Algorithmus (nested coverage):
 *  - Hauptlehrer ist in JEDEM Segment dabei (in allen `mainHours` Slots)
 *  - Stütz-Lehrer sind absteigend nach Stunden gestaffelt: der Stütz mit den
 *    meisten Stunden sitzt in den ersten N Slots dabei, der zweite in den
 *    ersten M < N Slots, usw.
 *  - Segment-Breakpoints = sortierte Unique-Set der Stunden-Werte
 *
 * Beispiel: main 4h, stützen [3h, 2h] →
 *   Breakpoints: [0, 2, 3, 4]
 *   Segment 1 (0..2 = 2h): main + beide stützen
 *   Segment 2 (2..3 = 1h): main + 3h-Stütz (2h-Stütz raus)
 *   Segment 3 (3..4 = 1h): nur main
 */
function buildBestGuessSegments(
	mainHours: number,
	mainTeacherId: string,
	supportTeachers: string[],
	supportHours: number[]
): TeachingSegment[] {
	if (supportTeachers.length === 0 || mainHours <= 0) {
		return [{ hours: mainHours, teachers: [mainTeacherId] }];
	}
	// Paare (tid, hours) absteigend nach Stunden sortieren
	const pairs = supportTeachers
		.map((tid, i) => ({ tid, hours: supportHours[i] }))
		.sort((a, b) => b.hours - a.hours);
	// Breakpoints zwischen 0 und mainHours
	const breakpoints = [0, ...pairs.map(p => p.hours), mainHours]
		.filter((v, i, a) => a.indexOf(v) === i)
		.filter(v => v >= 0 && v <= mainHours)
		.sort((a, b) => a - b);
	const segments: TeachingSegment[] = [];
	for (let i = 0; i + 1 < breakpoints.length; i++) {
		const segStart = breakpoints[i];
		const segEnd = breakpoints[i + 1];
		const segH = segEnd - segStart;
		if (segH <= 0) continue;
		const teachers = [mainTeacherId];
		for (const p of pairs) {
			if (p.hours > segStart) teachers.push(p.tid);
		}
		segments.push({ hours: segH, teachers });
	}
	return segments;
}

function rowToSpec(row: SmartRow, makeId: () => string): LessonSpec {
	const count = row.stunden + row.ergStunden;
	return {
		id: makeId(),
		subject: row.subjectCode,
		teachers: [row.teacherId],
		classes: [...row.classes],
		grades: row.grades as LessonSpec['grades'],
		weekPattern: 'every',
		groupLabel: row.groupLabel || undefined,
		couplingId: undefined,
		count,
		blocks: undefined,
		includeInSolver: true,
		source: 'csv'
	};
}
