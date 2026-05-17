// Single source of truth for the entire Stundenplan domain model.
//
// Structural overview, field semantics, schema versions: docs/MODEL.md.
// If you add a field to LessonSpec, ConstraintConfig, ScheduleDoc, or bump
// SCHEMA_VERSION, update MODEL.md §1 and §5 to match.
//
// Plan + change history: ~/.claude/plans/...md (local, gitignored).

export type TeacherId = string;
export type SubjectCode = string;
export type GradeLevel = 5 | 6 | 7 | 8;
export type Day = 'Mo' | 'Di' | 'Mi' | 'Do' | 'Fr';
export type Period = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type WeekPattern = 'every' | 'even' | 'odd';
export type SubjectCategory = 'PG' | 'VÜ' | 'FÖ' | 'KU';
/** Aufteilung der Wochenstunden in Blöcke. [2,2] = 2 Doppelstunden, [1,1,1,1] = 4 Einzelstunden. */
export type BlockPattern = number[];

export const DAYS: readonly Day[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr'] as const;
export const PERIODS: readonly Period[] = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const GRADES: readonly GradeLevel[] = [5, 6, 7, 8] as const;

// Default time slots — the 8 periods of the school day. Editable in settings later.
export const DEFAULT_PERIOD_TIMES: readonly string[] = [
	'08:00-08:50',
	'08:55-09:45',
	'09:50-10:40',
	'10:55-11:45',
	'11:50-12:40',
	'12:45-13:35',
	'14:00-14:50',
	'14:55-15:45'
] as const;

export interface AvailabilityCell {
	day: Day;
	period: Period;
}

export interface Teacher {
	id: TeacherId;
	name: string;                 // "Nagl Tanja" (CSV) or "NAGL" (manual)
	personalNumber?: string;      // e.g. "90391614" from CSV
	shortNumber: number;          // 1..N for "L1" / "L2" badges
	color: string;                // #hex
	isLeader?: boolean;           // " (Leitung)" suffix in CSV
	placeholder?: boolean;        // "Zz_Planung_…" or "N. N." — vacant role
	subjects: SubjectCode[];      // subjects this teacher can teach
	unavailable: AvailabilityCell[]; // hard constraint: solver may not place here
}

export interface Subject {
	code: SubjectCode;            // "M", "BSP", "BBO" — part after prefix underscore
	name: string;                 // "Mathematik"
	category: SubjectCategory;    // PG / VÜ / FÖ / KU
	isMain: boolean;              // Hauptfach? (afternoon ban applies)
	hoursPerWeek: Partial<Record<GradeLevel, number>>;
	maxConsecutive?: number;      // Max Stunden dieses Fachs in Folge (default 2 für isMain, 99 sonst)
}

export interface LessonSpec {
	id: string;
	subject: SubjectCode;
	/**
	 * Lehrer-Team für diese Lerneinheit. Bei normalen Stunden enthält das Array
	 * genau eine Teacher-Id. Bei Team-Teaching (z. B. BSP Knaben + Mädchen
	 * gemeinsam, oder zwei Lehrer einer KU-Stunde) sind es mehrere — sie
	 * unterrichten parallel im selben Slot.
	 *
	 * Solver-Effekt: ALLE Lehrer im Team belegen den Slot, müssen zur Slot-Zeit
	 * verfügbar sein und dürfen woanders nicht doppelt gebucht werden. Siehe
	 * `Unit.teacherIds` in `solver-v2/types.ts` für die solver-interne Sicht.
	 *
	 * v4-Schema (vorher: `teacher: TeacherId`). Migration füllt das Feld aus
	 * dem alten Single-Teacher-String. CSV-Import schreibt immer ein 1-elem-
	 * Array; ein zweiter Lehrer wird im UI per Dropdown ergänzt.
	 */
	teachers: TeacherId[];
	classes: string[];            // ["1a"] or ["1a","2a"] (cross-class) — metadata only
	grades: GradeLevel[];         // [5] or [5,6] (multi-grade) — drives the column placement
	weekPattern: WeekPattern;     // every | even | odd (set manually for BBO/EH)
	/**
	 * Phase 8 v3: split from the old `groupKey`.
	 *
	 * `groupLabel` is the descriptive Sokrates "Gruppe" column ("DGB 1/2",
	 * "PG_REL_RRK_1") — used for display and filtering only. It has NO solver
	 * effect. A label like "1/2" just means "Stufen 5+6" and is informational.
	 */
	groupLabel?: string;
	/**
	 * `couplingId` is a hard solver constraint: all specs sharing the same
	 * couplingId MUST be placed in the exact same (day, period). Used for
	 * parallel teaching where two teachers run different lessons in the same
	 * timeslot (e.g. BSP Knaben + BSP Mädchen). Only set explicitly by the
	 * user via the bulk "Koppeln" action; never populated from CSV.
	 */
	couplingId?: string;
	/**
	 * Optionale Tageszeit-Präferenz für diese Lerneinheit. Nur wirksam wenn
	 * explizit gesetzt — fehlt das Feld, bleibt die Spec überall platzierbar.
	 *
	 *  - `'early'` — Solver bevorzugt P1–P3 (Hauptfach-typisch).
	 *  - `'late'`  — Solver bevorzugt P5–P8 (BSP, BBO, EH, TD, GZ, MU, REL).
	 *
	 * Wirkt als linearer Soft-Penalty pro Periode Abstand vom Wunschbereich
	 * (siehe `time_pref` in `ScoreBreakdown`). Gewicht ist mittel, dominant
	 * sind weiterhin min_daily und no_free.
	 */
	timePref?: 'early' | 'late';
	/**
	 * Phase 13: Feinsteuerung der Nachmittag-Platzierung pro Lerneinheit.
	 *
	 *  - `'never'` (Hard-Constraint H10): die Spec darf nie auf Nachmittagsslots
	 *    (P7-P8 inkl. Block-Reichweite). Default für Hauptfächer (`Subject.isMain=true`)
	 *    via Migration v4→v5.
	 *  - `'allowed'` (Default für Nicht-Hauptfächer): Spec darf nachmittags sein,
	 *    Solver versucht Vormittag aber bevorzugt (siehe `any_aft`-Penalty).
	 *  - `'preferred'` (Soft, Inverse): Spec SOLL nachmittags sein. Penalty wenn
	 *    der Solver sie morgens platziert. Geeignet z. B. für BBO, EH, GZ.
	 *
	 * Migration v4→v5 setzt initial `'never'` für Specs deren Subject `isMain=true`,
	 * sonst `'allowed'`. User kann via SpecList-Dropdown pro Spec überschreiben.
	 */
	afternoonAllowed?: 'never' | 'allowed' | 'preferred';
	count: number;                // Gesamt-Wochenstunden, halbzahlig erlaubt (0.5, 1.5)
	blocks?: BlockPattern;        // Aufteilung in Blöcke; default [1,1,…count]. sum(blocks) === count
	includeInSolver: boolean;     // false → Solver lässt aus (manuell platzierbar)
	source: 'csv' | 'manual';     // provenance
	/**
	 * Phase 17: Team-Teaching mit Segmenten.
	 *
	 * Eine Lehreinheit mit N Lehrern und `count` Stunden kann strukturell in
	 * mehrere Segmente zerlegt werden — jedes Segment hat eine eigene Stunden-
	 * Anzahl und ein eigenes Lehrer-Team aus `teachers[]`.
	 *
	 * Beispiel: Mathematik 5. Stufe, count=4, teachers=[Lindner, Nagel, Titze]
	 *   teachingSegments: [
	 *     { hours: 2, teachers: ['Lindner','Nagel','Titze'] },  // alle drei
	 *     { hours: 1, teachers: ['Lindner','Titze'] },           // Titze zusätzlich
	 *     { hours: 1, teachers: ['Lindner'] }                    // allein
	 *   ]
	 *
	 * Constraints (validiert in `validateTeachingSegments`):
	 *   - sum(segments[i].hours) === count
	 *   - jede TeacherId in segments[i].teachers MUSS in spec.teachers vorkommen
	 *   - segments[i].teachers.length >= 1
	 *
	 * Solver-Effekt (siehe `solver-v2/units.ts`): Eine Spec mit segments wird
	 * intern in N separate Units gesplittet (eine pro Segment, mit `count = hours`
	 * und entsprechendem Teacher-Team). Der bestehende Coupling-/Multi-Teacher-
	 * Mechanismus übernimmt von dort.
	 *
	 * `teachingSegments=undefined` (Default) bedeutet: implizit ein einziges
	 * Segment, alle Lehrer in jeder Stunde dabei — Verhalten wie vor Phase 17.
	 */
	teachingSegments?: TeachingSegment[];
}

/**
 * Phase 17: ein Team-Teaching-Segment innerhalb einer LessonSpec.
 * `hours` ist halbzahlig erlaubt analog zu LessonSpec.count.
 * `teachers` ist Teilmenge von LessonSpec.teachers, nie leer.
 * `label` ist optionaler User-Text zur Beschreibung (z.B. "mit Stütz").
 */
export interface TeachingSegment {
	hours: number;
	teachers: TeacherId[];
	label?: string;
}

/**
 * Phase 17: Validierung der `teachingSegments`-Aufteilung einer Spec.
 * Rückgabe: leeres Array = OK, sonst Fehlermeldungen pro Verstoß.
 */
export function validateTeachingSegments(spec: Pick<LessonSpec, 'count' | 'teachers' | 'teachingSegments'>): string[] {
	const errs: string[] = [];
	const segs = spec.teachingSegments;
	if (!segs || segs.length === 0) return errs; // kein Splitting = OK
	const sum = segs.reduce((s, seg) => s + (Number(seg.hours) || 0), 0);
	// 0.05-Toleranz für Rundungsfehler bei halbzahligen Stunden
	if (Math.abs(sum - spec.count) > 0.05) {
		errs.push(`Segmente-Summe ${sum}h ≠ Stunden ${spec.count}h`);
	}
	const teacherSet = new Set(spec.teachers);
	for (let i = 0; i < segs.length; i++) {
		const seg = segs[i];
		if (!Array.isArray(seg.teachers) || seg.teachers.length === 0) {
			errs.push(`Segment ${i + 1}: kein Lehrer ausgewählt`);
			continue;
		}
		for (const tid of seg.teachers) {
			if (!teacherSet.has(tid)) {
				errs.push(`Segment ${i + 1}: Lehrer ${tid.slice(0, 8)}… nicht im Spec-Team`);
			}
		}
		if (!(seg.hours > 0)) {
			errs.push(`Segment ${i + 1}: Stunden muss > 0 sein`);
		}
	}
	return errs;
}

export interface PlacedLesson {
	specId: string;
	day: Day;
	period: Period;
	grade: GradeLevel;            // Phase 8: grade-column the lesson belongs to.
	                               // Multi-grade specs (e.g. grades=[5,6]) emit ONE
	                               // PlacedLesson per grade — same (day,period) but
	                               // distinct grade.
	pinned: boolean;              // user-fixed, solver may not move
}

export interface ConstraintConfig {
	/**
	 * Sandwich-Lücken (innere Freistunden) zwischen erster und letzter
	 * belegter Stunde einer (Tag, Stufe).
	 *
	 * `strict=true` (Standard): Wird wie eine harte Anforderung behandelt —
	 * Solver versucht in einer ersten Phase mit massivem Gewicht (10000),
	 * jede Lücke zu vermeiden. Bleiben am Ende Lücken übrig, läuft eine
	 * Auto-Lockerungs-Phase mit dem normalen Soft-Gewicht und der UI meldet
	 * `RelaxationInfo.noFreeRelaxed=true`. Mit `strict=false` läuft direkt
	 * der Soft-Modus ohne Lockerungs-Hinweis.
	 */
	noFreePeriodsForClass: { enabled: boolean; weight: number; strict: boolean };
	noMainSubjectAfternoon: {
		enabled: boolean;
		weight: number;
		afternoonStartsAtPeriod: Period;
		applyToAllSubjects: boolean;     // Phase 9: also penalize non-main on afternoon
		weightAllSubjects: number;       // Phase 9: weight for non-main afternoon
	};
	maxConsecutiveMain: { enabled: boolean; weight: number; max: number };
	preferMainEarly: { enabled: boolean; weight: number };
	compactTeacherDays: { enabled: boolean; weight: number };
	/**
	 * Phase 9: hard minimum of lesson slots per day per grade. Enforces that
	 * every grade has at least N slots on every weekday, preventing the
	 * solver from "packing all lessons into Mon-Wed" — pedagogically each
	 * grade must have ≥4 lessons every day at MS SiG.
	 */
	minDailySlotsPerGrade: number;
	/** Phase 11: configurable weight for the min-daily soft penalty. */
	minDailyWeight: number;
	/**
	 * Phase 10: when a (day, grade) is active (≥1 lesson), period 1 must be
	 * one of the active periods. Prevents "school starts at the 4th period"
	 * gaps at the day's beginning. Disabled in last-resort auto-relaxation.
	 */
	mustStartFirstPeriod: { enabled: boolean; weight: number };
	/** Phase 11: configurable weight for "uneven days" (load spread across week). */
	unevenDaysWeight: number;
	/** Phase 11: configurable weight for the per-spec timePref penalty. */
	timePrefWeight: number;
	/**
	 * Phase 12: a subject should appear at most once per (day, grade) — except
	 * across coupling/block boundaries where it makes sense. Untis "max 1× pro Tag".
	 */
	subjectMaxOncePerDay: { enabled: boolean; weight: number };
	/**
	 * Phase 12 follow-up: fairness across teachers — penalize teachers that
	 * regularly start later than P1 across the week. Cumulative penalty per
	 * (teacher, day): late-start-index (0=P1-Start, 1=P2-Start, …). Days
	 * where the teacher is unavailable in P1 (Sperrstunde) are exempt — we
	 * only penalize choices the solver could have made differently.
	 *
	 * Mirrors Untis "Tagesrand-Pause"-Konzept: niemand ist Stamm-P2-Starter,
	 * der späte Start wird über alle Lehrer ausgeglichen.
	 */
	teacherEarlyStartBalance: { enabled: boolean; weight: number };
	/**
	 * Mindest-Stunden pro Tag pro Lehrer. Wenn ein Lehrer an einem Tag
	 * Unterricht hat, soll er mindestens N Stunden haben — sonst lohnt der
	 * Anfahrtsweg nicht. Lehrer-Tage mit 0 Stunden sind nicht betroffen
	 * (der Lehrer ist eh frei). Penalty pro fehlender Stunde.
	 *
	 * Beispiel: min=2, Lehrer hat Mo 1 Stunde → +1 Penalty.
	 */
	teacherMinLessonsPerDay: { enabled: boolean; weight: number; min: number };
	/**
	 * Phase 12: a spec's multiple occurrences should land on different
	 * weekdays. Replaces the previously-defunct preferDoubleLessonsContiguous
	 * setting — keeps the field name as alias in DEFAULT_CONSTRAINTS for
	 * migration compatibility.
	 */
	preferDoubleLessonsContiguous: { enabled: boolean; weight: number };
	/**
	 * Phase 13: Zieltagespensum pro Stufe pro Tag. Quadratische Penalty
	 * `(actual - target)²` pro (Tag, Stufe). Default 6. min_daily bleibt
	 * parallel als Untergrenze.
	 */
	targetDailyLessons: { enabled: boolean; weight: number; target: number };
}

// Phase 10 weight calibration (after solver-side diagnosis):
// Old defaults caused `pen_main_early × 10 = 1680` to dominate the score,
// so Gecode optimized "main subjects to P1-P3" instead of distributing days.
// New defaults boost class/teacher distribution and main-subject afternoon
// avoidance, while shrinking main_early to a tie-breaker.
export const DEFAULT_CONSTRAINTS: ConstraintConfig = {
	// distribution (Mo–Fr balance + no gaps) — must dominate
	noFreePeriodsForClass: { enabled: true, weight: 200, strict: true },
	// main subjects on afternoon — strong hard-ish push
	noMainSubjectAfternoon: {
		enabled: true,
		weight: 200,
		afternoonStartsAtPeriod: 7,
		applyToAllSubjects: true,
		weightAllSubjects: 50
	},
	maxConsecutiveMain: { enabled: true, weight: 40, max: 2 },
	// main-early: tie-breaker only — very small weight so it doesn't
	// dominate the score (was 10 × 168 = 1680, the runaway leader).
	preferMainEarly: { enabled: true, weight: 2 },
	preferDoubleLessonsContiguous: { enabled: true, weight: 30 },
	compactTeacherDays: { enabled: true, weight: 80 },
	minDailySlotsPerGrade: 4,
	minDailyWeight: 500,
	mustStartFirstPeriod: { enabled: true, weight: 300 },
	unevenDaysWeight: 150,
	timePrefWeight: 100,
	subjectMaxOncePerDay: { enabled: true, weight: 60 },
	teacherEarlyStartBalance: { enabled: true, weight: 30 },
	teacherMinLessonsPerDay: { enabled: true, weight: 150, min: 2 },
	// Phase 13: Zieltagespensum 6 ±1, quadratische Penalty. Gewicht moderat
	// — strukturell wirksam ohne andere Constraints zu überlagern.
	targetDailyLessons: { enabled: true, weight: 80, target: 6 }
};

export interface ScheduleDoc {
	schoolYear: string;           // e.g. "2026/27"
	teachers: Teacher[];
	subjects: Subject[];
	specs: LessonSpec[];
	placed: PlacedLesson[];
	constraints: ConstraintConfig;
	meta: { schemaVersion: 5; lastModified: string };
}

export const SCHEMA_VERSION = 5 as const;

export function emptyDoc(schoolYear = '2026/27'): ScheduleDoc {
	return {
		schoolYear,
		teachers: [],
		subjects: [],
		specs: [],
		placed: [],
		constraints: structuredClone(DEFAULT_CONSTRAINTS),
		meta: { schemaVersion: SCHEMA_VERSION, lastModified: new Date().toISOString() }
	};
}
