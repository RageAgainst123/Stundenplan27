// Single source of truth for the entire Stundenplan domain model.
// See plan: C:\Users\Geo\.claude\plans\https-rageagainst123-github-io-std-stund-temporal-oasis.md

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
	teacher: TeacherId;
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
	pairedWith?: string[];        // explicit parallel pairings (BSPK|BSPM) — legacy, prefer couplingId
	count: number;                // Gesamt-Wochenstunden, halbzahlig erlaubt (0.5, 1.5)
	blocks?: BlockPattern;        // Aufteilung in Blöcke; default [1,1,…count]. sum(blocks) === count
	includeInSolver: boolean;     // false → Solver lässt aus (manuell platzierbar)
	source: 'csv' | 'manual';     // provenance
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
	noFreePeriodsForClass: { enabled: boolean; weight: number };
	noMainSubjectAfternoon: {
		enabled: boolean;
		weight: number;
		afternoonStartsAtPeriod: Period;
		applyToAllSubjects: boolean;     // Phase 9: also penalize non-main on afternoon
		weightAllSubjects: number;       // Phase 9: weight for non-main afternoon
	};
	maxConsecutiveMain: { enabled: boolean; weight: number; max: number };
	preferMainEarly: { enabled: boolean; weight: number };
	preferDoubleLessonsContiguous: { enabled: boolean; weight: number };
	compactTeacherDays: { enabled: boolean; weight: number };
	/**
	 * Phase 9: hard minimum of lesson slots per day per grade. Enforces that
	 * every grade has at least N slots on every weekday, preventing the
	 * solver from "packing all lessons into Mon-Wed" — pedagogically each
	 * grade must have ≥4 lessons every day at MS SiG.
	 */
	minDailySlotsPerGrade: number;
}

export const DEFAULT_CONSTRAINTS: ConstraintConfig = {
	noFreePeriodsForClass: { enabled: true, weight: 100 },
	noMainSubjectAfternoon: {
		enabled: true,
		weight: 50,
		afternoonStartsAtPeriod: 7,
		applyToAllSubjects: true,
		weightAllSubjects: 15
	},
	maxConsecutiveMain: { enabled: true, weight: 30, max: 2 },
	preferMainEarly: { enabled: true, weight: 10 },
	preferDoubleLessonsContiguous: { enabled: true, weight: 20 },
	compactTeacherDays: { enabled: true, weight: 15 },
	minDailySlotsPerGrade: 4
};

export interface ScheduleDoc {
	schoolYear: string;           // e.g. "2026/27"
	teachers: Teacher[];
	subjects: Subject[];
	specs: LessonSpec[];
	placed: PlacedLesson[];
	constraints: ConstraintConfig;
	meta: { schemaVersion: 3; lastModified: string };
}

export const SCHEMA_VERSION = 3 as const;

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
