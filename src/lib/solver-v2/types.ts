// Solver v2 — internal types.
//
// `Unit` is the atomic placement unit. One Unit may consist of multiple
// `LessonInstance`s if it represents a multi-grade tuple, a contiguous
// block, or a coupling group. A Unit always lands on exactly one
// (day, period) — but can occupy multiple grade columns at once.
//
// Canonical structural reference: docs/MODEL.md §2 ("Solver-internes
// Modell") and §3 (Score-Komponenten). When you add a field to Unit,
// SolverState, ScoreBreakdown, or ScoreWeights, update MODEL.md §2/§3.
//
// Performance note: Units are constructed once, then identified by a numeric
// `idx` in the Solver state. All hot-path data (slot[], teacherUsed[][])
// is dense Int32Array for cache efficiency.

import type { Day, GradeLevel, LessonSpec, PlacedLesson, Period, ScheduleDoc, Teacher, Subject } from '../types';

/**
 * A single lesson instance with concrete (occurrence, grade) coordinates.
 * Several instances form a Unit when they must move together.
 */
export interface LessonInstance {
	/** Source spec id (debug + decode). */
	specId: string;
	/** 0..count-1 within the spec — distinguishes multiple lessons of the same spec. */
	occurrenceIndex: number;
	/** Single grade column this instance occupies. */
	grade: GradeLevel;
	/** Block id (-1 = standalone, >=0 = part of a block — must be consecutive). */
	blockId: number;
	/** Block size (1 = standalone, 2+ = block-group member). */
	blockSize: number;
	/** Position within the block (0..blockSize-1). Used for period offset within Block-Unit. */
	blockPos: number;
}

/** What kind of constraint linkage holds the instances of a Unit together. */
export type UnitKind =
	| 'solo'         // one instance, one grade
	| 'multigrade'   // same occurrence, multiple grades (e.g. spec.grades=[5,6])
	| 'block'        // contiguous periods in the same grade column (blocks=[2,...])
	| 'coupling';    // same couplingId — multiple specs share a slot

/**
 * A Unit is the atom of placement and movement in the solver.
 * Every Unit has ONE primary (day, period). Block-Units occupy P, P+1, ..., P+blockSize-1.
 * Multi-grade Units occupy ONE (day, period) but multiple grade columns.
 */
export interface Unit {
	/** Dense index into solver state arrays (0..nUnits-1). */
	idx: number;
	/** What holds this Unit together. */
	kind: UnitKind;
	/** Lesson instances that make up this Unit. */
	instances: LessonInstance[];
	/**
	 * For block-units: blockSize > 1 means the block occupies blockSize consecutive
	 * periods STARTING at the placed period. For solo/multigrade/coupling: 1.
	 */
	blockSize: number;
	/**
	 * Primary teacher id (the first spec's teacher). Used for display labels
	 * and as a stable cache key. Solo/block/multigrade Units have exactly one
	 * teacher; coupling Units may have several — see `teacherIds` for the
	 * full set used by hard constraints.
	 */
	teacherId: string;
	/**
	 * All teachers that occupy this Unit's slot when placed. For solo/block/
	 * multigrade Units this contains exactly one id (`[teacherId]`). For
	 * coupling Units it contains the teacher of every coupled spec — they
	 * teach in parallel in the same timeslot.
	 *
	 * Hard constraints H2 (availability) and H3 (no double-booking) iterate
	 * over `teacherIds` so a coupling group correctly blocks every involved
	 * teacher elsewhere.
	 */
	teacherIds: string[];
	/** Subject code (block/multigrade/solo: same; coupling: pick first for display). */
	subjectCode: string;
	/** Grade columns this Unit occupies (grades). */
	grades: GradeLevel[];
	/** Pinned: cannot move during Local Search; placed in advance from doc.placed. */
	pinned: boolean;
	/** Pre-pinned (day, period). Solo & block: lessons[0] period; ignored otherwise. */
	pinnedDay?: Day;
	pinnedPeriod?: Period;
	/**
	 * Spec ids represented by this Unit. For coupling-units this is a list of
	 * the coupled specs (>1); otherwise length 1.
	 */
	specIds: string[];
	/** Week pattern of the underlying spec (every/even/odd). */
	weekPattern: 'every' | 'even' | 'odd';
	/**
	 * Phase 13: Nachmittag-Politik der zugrundeliegenden Spec.
	 *  - `'never'` → Hard-Constraint H10: Slot-Periode + blockSize-1 < 7.
	 *  - `'allowed'` → keine zusätzliche Restriktion, normale Soft-Penalty wirkt.
	 *  - `'preferred'` → normale Hard-Checks; Score-Komponente belohnt Nachmittag.
	 *
	 * Coupling-Units übernehmen den restriktivsten Wert aller gekoppelten Specs:
	 * eine 'never'-Spec macht die ganze Coupling-Gruppe 'never'.
	 */
	afternoonAllowed: 'never' | 'allowed' | 'preferred' | 'must';
}

/**
 * Solver state — the working representation during Construction and Local Search.
 *
 * `placement[unit.idx]` = (day, period) where Unit currently sits, or -1 if unplaced.
 * For perf, day and period are packed into a single int slot id (slotFromDP).
 */
export interface SolverState {
	/** Pointer back to source doc — readonly during solve, used for spec/teacher lookups. */
	doc: ScheduleDoc;
	/** Number of Units. */
	nUnits: number;
	/** Units, indexed by `unit.idx`. */
	units: Unit[];
	/**
	 * placement[unit.idx] = SLOT_UNPLACED (-1) or a packed slot index 0..D*P-1.
	 * day  = floor(slot / P), period = (slot mod P) + 1
	 * Day index is 0..4 (Mo=0..Fr=4). Period is 1..8.
	 *
	 * Block units only store the FIRST period of the block here. The block
	 * extends to placement[idx]..placement[idx]+blockSize-1.
	 */
	placement: Int32Array;
	/** Map: spec id → all Units that reference this spec. */
	unitsBySpec: Map<string, Unit[]>;
	/** Map: teacher id → all Units assigned to this teacher. */
	unitsByTeacher: Map<string, Unit[]>;
	/** Map: spec id → ScheduleDoc.specs lookup. */
	specsById: Map<string, LessonSpec>;
	/** Map: subject code → ScheduleDoc.subjects lookup. */
	subjectsByCode: Map<string, Subject>;
	/** Map: teacher id → ScheduleDoc.teachers lookup. */
	teachersById: Map<string, Teacher>;
	/**
	 * Pins die beim Build (in `units.ts`) verworfen werden mussten weil
	 * sie hard-Constraints verletzten (z. B. Lehrer in P1 gesperrt aber
	 * Pin auf P1, oder zwei Pins auf gleichem Slot+Stufe). Nicht leer
	 * heißt: User-Vorgabe konnte nicht respektiert werden — UI sollte
	 * das melden. Optional weil interne Hilfs-States das Feld nicht brauchen.
	 */
	droppedPins?: Array<{ specId: string; subjectCode: string; day: Day; period: Period; reason: string }>;
	/**
	 * Solver-Opt Runde 2, Schritt 2: lazy-allozierte Scratch-Puffer +
	 * statische Per-Unit-Caches für computeScore. Wird beim ersten
	 * computeScore-Aufruf von `ensureScratch()` (score.ts) befüllt —
	 * computeScore läuft pro Move (Full-Scan-Delta), frische Maps/Arrays
	 * pro Aufruf waren der GC-Flaschenhals. Stammdaten (Fächer, Lehrer,
	 * Specs, Units) sind während einer Solver-Session konstant.
	 */
	scoreScratch?: ScoreScratch;
	/**
	 * R3-S1: Scoped-Delta-Cache (scoreDelta.ts). Wenn gesetzt, bewertet
	 * evaluateDelta Moves über Zeilen-Rescans statt Voll-Scan. Wird von
	 * localSearch() zu Chunk-Beginn frisch gebaut; undefined = Full-Scan-
	 * Referenzpfad (Tests, direkte evaluateDelta-Aufrufe).
	 */
	scoreCache?: ScoreCache;
	/**
	 * Solver-Opt Runde 2, Schritt 3: lazy-gebauter Index für scoped
	 * Hard-Checks. `wouldViolate` scannte vorher ALLE nUnits pro Prüfung
	 * (bis 12×/Move) — ein Konflikt erfordert aber gemeinsamen Lehrer ODER
	 * gemeinsame Stufe (H3/H4/H8) bzw. Coupling-Partnerschaft (H7), die
	 * Kandidatenmenge ist also die Vereinigung dieser Listen (typ. 10–40
	 * statt ~130 Units). Von `ensureCheckIndex()` (hardCheck.ts) befüllt;
	 * statisch, weil Units während einer Session unveränderlich sind.
	 */
	checkIndex?: HardCheckIndex;
}

/** Kandidaten-Index für scoped wouldViolate — siehe SolverState.checkIndex. */
export interface HardCheckIndex {
	/** Stufe (5-8) → Units die diese Stufe belegen. */
	unitsByGrade: Map<GradeLevel, Unit[]>;
	/** couplingId → Units deren Specs diese Kopplung tragen (für H7). */
	unitsByCoupling: Map<string, Unit[]>;
	/** Generation-Marker pro Unit-Idx — dedupliziert die Kandidaten-Union
	 *  ohne Set-Allokation pro Aufruf. */
	seenGen: Int32Array;
	/** Aktuelle Generation (inkrementiert pro wouldViolate-Aufruf). */
	gen: number;
}

/** Scratch-Puffer für computeScore — siehe SolverState.scoreScratch. */
export interface ScoreScratch {
	/** Anzahl distinkter Fach-Codes (Index-Raum der Fach-Indizes). */
	S: number;
	/** Anzahl distinkter Spec-Ids (Index-Raum von specDay). */
	NS: number;
	subjectIdxByCode: Map<string, number>;
	specIdxById: Map<string, number>;
	teacherIdxById: Map<string, number>;
	/** isMain pro Fach-Index (statisch). */
	subjIsMain: Uint8Array;
	// --- Footprint-Arrays (R3-S1): von applyUnitFootprint (score.ts) gepflegt.
	// Der Voll-Scan füllt sie via fillFootprints komplett neu; das Scoped-
	// Delta (scoreDelta.ts) hält sie per add/remove synchron zum Placement.
	/** Klassen-Occupancy: occ[d*G*P + g*P + p] (Instanzen-Zähler). */
	occ: Int32Array;
	/** Lehrer-Occupancy: tocc[t*D*P + d*P + p]. */
	tocc: Int32Array;
	/** Hauptfach-Instanzen pro Zelle analog occ (Zähler, >0 = Hauptfach da). */
	mainCnt: Int32Array;
	/** Fach-Index+1 der an (d,g,p) STARTENDEN Unit (0 = keine). */
	rowStartSubj: Int32Array;
	/** blockSize der an (d,g,p) startenden Unit (0 = keine). */
	rowStartSize: Int32Array;
	/** Vorkommen pro (Spec, Tag): specDay[sp*D + d]. */
	specDay: Int32Array;
	/** Statisch: 1 wenn Lehrer t an Tag d in P1 gesperrt ist (Index t*D+d). */
	blockedAtP1: Uint8Array;
	/** Statisch pro Unit: 0=kein timePref, 1=early, 2=late. */
	unitTimePref: Int8Array;
	/** Statisch pro Unit: 1 = exempt von any_aft/main_aft/main_early. */
	unitAfternoonExempt: Uint8Array;
	/** Statisch pro Unit: 1 = Hauptfach. */
	unitIsMain: Uint8Array;
	/** Statisch pro Unit: Fach-Index (in subjectIdxByCode). */
	unitSubjIdx: Int32Array;
	/** Statisch pro Unit: grades[0] der ersten Spec (time_pref-Dedup), -1 wenn Spec fehlt. */
	unitFirstGrade: Int32Array;
}

/**
 * R3-S1: Scoped-Delta-Cache — siehe scoreDelta.ts. Hält die aktuellen
 * Komponenten-Zählerstände plus die Beitrags-Vektoren jeder Zeile, damit
 * ein Move nur die berührten Zeilen neu scannen muss. Wird zu Beginn
 * jedes localSearch-Aufrufs frisch aus dem Placement gebaut (kein
 * Invalidierungs-Protokoll nötig — außerhalb der LS-Schleife mutieren
 * Construction/Perturbation das Placement direkt).
 */
export interface ScoreCache {
	/** Aufgelöste Score-Parameter (identisch für Voll- und Delta-Pfad). */
	cfg: import('./score').ScoreCfg;
	/** Aktuelle Komponenten-Zählerstände (total wird bei Bedarf gewichtet). */
	counts: ScoreBreakdown;
	/** Beitrags-Vektor jeder Klassen-Zeile: classRow[(d*4+g)*9 + c]. */
	classRow: Int32Array;
	/** Beitrags-Vektor jedes Lehrers: teacherRow[t*6 + c]. */
	teacherRow: Int32Array;
}

/** Placement constant for "not placed yet". */
export const SLOT_UNPLACED = -1;

/** Number of weekdays. */
export const D = 5;
/** Number of periods per day. */
export const P = 8;

/**
 * Pack (dayIndex 0..4, period 1..8) into a single slot id 0..39.
 * Period is 1-based on input, 0-based internally.
 */
export function slotFromDP(dayIndex: number, period: number): number {
	return dayIndex * P + (period - 1);
}

/** Inverse of slotFromDP. */
export function dpFromSlot(slot: number): { dayIndex: number; period: number } {
	return { dayIndex: Math.floor(slot / P), period: (slot % P) + 1 };
}

/** Day index 0..4 → Day name. */
export const DAYS_BY_INDEX: readonly Day[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr'] as const;

/** Day name → index 0..4. */
export const DAY_INDEX: Record<Day, number> = {
	Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4
};

// ----- Score breakdown (matches the v1 PenaltyBreakdown semantics) -----

/**
 * Score components. Each is a count (0..N), the weighted sum is `total`.
 * Numbers are non-negative; 0 = constraint perfectly satisfied.
 */
export interface ScoreBreakdown {
	/** Hard-ish: (day, grade) with fewer than min_daily_slots lessons. Counts violations. */
	min_daily: number;
	/** Hard-ish: (day, grade) is active but P1 not occupied. */
	no_p1_start: number;
	/** Soft: count of main-subject lessons in P >= afternoon_start. */
	main_aft: number;
	/** Soft: count of any lesson in P >= afternoon_start. */
	any_aft: number;
	/** Soft: sandwich gaps per (day, grade). */
	no_free: number;
	/** Soft: under-load penalty per (day, grade): max(0, target - lessons_dg). */
	uneven_days: number;
	/** Soft: count of main-subject 3-runs. */
	main_run: number;
	/** Soft: sandwich gaps per (teacher, day). */
	compact_teacher: number;
	/** Soft: sum (period - 1) for main-subject lessons. */
	main_early: number;
	/**
	 * Soft: sum of period-distance penalties for specs with an explicit
	 * `timePref`. 'early' favours P1–P3, 'late' favours P5–P8; specs without
	 * a timePref contribute 0 (no preference).
	 */
	time_pref: number;
	/**
	 * Soft: count of (day, grade, subject) triples where the same subject
	 * appears more than once. Avoids "Mathe morgens, Mathe nachmittags"-
	 * patterns that pedagogy considers fatiguing.
	 */
	subject_twice: number;
	/**
	 * Soft: count of (spec, day) pairs where two or more occurrences of the
	 * SAME spec land on the same weekday. Activates the "Doppelstunden über
	 * verschiedene Tage verteilen"-rule that previously had no effect.
	 */
	spec_spread: number;
	/**
	 * Soft: cumulative late-start index per (teacher, day). Counts how many
	 * periods after P1 a teacher's first lesson lies, summed over all
	 * teacher-days where the teacher COULD have started in P1 (no
	 * unavailability there). Drives fairness — no teacher should systematically
	 * be the late-starter every day.
	 */
	teacher_late_start: number;
	/**
	 * Soft: per (teacher, day) where 0 < lessons < minLessonsPerDay,
	 * sum of (min - lessons). Prevents single-lesson teacher days that
	 * waste the commute. Days with 0 lessons are exempt — the teacher
	 * is simply free that day.
	 */
	teacher_under_min: number;
	/**
	 * Phase 13: Quadratische Penalty pro (Tag, Stufe) für Abweichung vom
	 * Zieltagespensum. `(actual - target)²`, summiert. Ergänzt min_daily
	 * (Untergrenze) durch eine Ist-Soll-Komponente die auch nach OBEN drückt.
	 */
	target_daily: number;
	/**
	 * Phase 13: Penalty für Specs mit `afternoonAllowed='preferred'` die
	 * im Vormittag landen (Periode < 7). Inverse von `any_aft`.
	 */
	afternoon_preferred: number;
	/**
	 * Phase 13.3: pro (Tag, Stufe, Hauptfach) Vorkommen über 2 hinaus.
	 * Beispiel: Mathe 3× an Mo-Stufe-7 = +1; Mathe 4× = +2. Doppelstunde
	 * zählt als 1 Vorkommen (eine Block-Unit). Ergänzt subject_twice das
	 * für ALLE Fächer wirkt; main_twice ist viel höher gewichtet weil
	 * Hauptfach-Häufung pädagogisch besonders kritisch ist.
	 */
	main_twice: number;
	/**
	 * Phase 13.3: bei genau 2 Vorkommen desselben Hauptfachs am Tag —
	 * Anzahl leerer Slots dazwischen. Mathe Mo P1+P2 = 0 (Doppel direkt
	 * hintereinander), Mathe Mo P1+P5 = 3 (P2,P3,P4 dazwischen). Treibt
	 * Doppelstunden gegenüber verstreuten Einzelstunden bei zweimaligem
	 * Auftreten.
	 */
	main_block_split: number;
	/**
	 * Solver-Opt Schritt 3: Wochen-Lücken-Fairness zwischen Lehrern.
	 * Σ pro Lehrer (Wochen-Summe der Springstunden)². compact_teacher
	 * bestraft Klumpen INNERHALB eines Tages (gaps² pro Tag), aber 1 Lehrer
	 * mit 1 Lücke an 5 Tagen kostete gleich viel wie 5 Lehrer mit je 1 Lücke.
	 * Diese Komponente differenziert: 1×5 Lücken = 25 vs 5×1 Lücke = 5 —
	 * Springstunden sollen nicht bei einem Lehrer klumpen.
	 */
	teacher_gap_fairness: number;
	/**
	 * Solver-Opt Schritt 3: Anwesenheitstage-Überhang pro Lehrer.
	 * Σ pro Lehrer max(0, anwesendeT age − ceil(wochenstunden / 6)).
	 * Ein Teilzeit-Lehrer mit 8 Wochenstunden hat Ideal 2 Anwesenheitstage;
	 * jeder Tag darüber kostet 1. Vollzeit-Lehrer (≥25h) sind faktisch
	 * exempt (Ideal 5 Tage).
	 */
	teacher_days_present: number;
	/**
	 * Solver-Opt Schritt 3: fehlende Mittagspause. Pro (Lehrer, Tag) +1 wenn
	 * der Lehrer ≥6 Stunden hat, sowohl im Vormittag (P1-P4) als auch im
	 * Nachmittag (P7-P8) unterrichtet UND P5 und P6 beide belegt sind.
	 * Default deaktiviert (ConstraintConfig.teacherMiddayBreak.enabled=false).
	 */
	teacher_lunch: number;
	/**
	 * Solver-Opt R2: Anzahl NICHT platzierter Units (placement == -1).
	 * Vorher unsichtbar für den Score — eine weggelassene Stunde sparte
	 * sogar Penalties (Nachmittag, Pensum), sodass Best-Tracking und
	 * Diversify unvollständige Pläne bevorzugen konnten. Dominant
	 * gewichtet (Default 100000/Stunde): Vollständigkeit schlägt jede
	 * weiche Verletzung.
	 */
	unplaced: number;
	/** Total weighted sum. Solver minimizes this. */
	total: number;
}

/** Default weights (Phase 11). Higher weight = more important. */
export interface ScoreWeights {
	min_daily: number;
	no_p1_start: number;
	main_aft: number;
	any_aft: number;
	no_free: number;
	uneven_days: number;
	main_run: number;
	compact_teacher: number;
	main_early: number;
	time_pref: number;
	subject_twice: number;
	spec_spread: number;
	teacher_late_start: number;
	teacher_under_min: number;
	target_daily: number;
	afternoon_preferred: number;
	main_twice: number;
	main_block_split: number;
	teacher_gap_fairness: number;
	teacher_days_present: number;
	teacher_lunch: number;
	unplaced: number;
}

/**
 * Default weights derived from `DEFAULT_CONSTRAINTS` in types.ts plus the
 * v2-specific `min_daily` and `no_p1_start` (which were hard in v1 but soft
 * in v2 — see SOLVER-V2-CONCEPT.md §4 "Was nicht mehr Hard-Constraint ist").
 */
/**
 * Compute the soft-penalty weights for a doc.
 *
 * @param strictNoFree When true (default), the "no internal free periods"
 *   penalty gets a massive multiplier (×50). Local Search will then optimize
 *   sandwich-gaps away as the dominant signal — practically a hard constraint.
 *   Used in the first solve pass; a second relaxation pass calls this with
 *   `false` if the strict pass left gaps behind.
 */
export function defaultWeights(doc: ScheduleDoc, strictNoFree = true): ScoreWeights {
	const c = doc.constraints;
	const noFreeBase = c.noFreePeriodsForClass.enabled ? c.noFreePeriodsForClass.weight : 0;
	const noFreeStrict = c.noFreePeriodsForClass.strict !== false; // default true
	const noFreeWeight = strictNoFree && noFreeStrict ? noFreeBase * 50 : noFreeBase;
	// Migration-safe reads: legacy docs may not have the Phase-12 fields yet
	// (they're added by migrateDoc, but defaultWeights can be called from
	// tests on a hand-built doc).
	const cAny = c as unknown as Record<string, unknown>;
	const minDailyWeight = typeof cAny.minDailyWeight === 'number' ? cAny.minDailyWeight as number : 500;
	const unevenDaysWeight = typeof cAny.unevenDaysWeight === 'number' ? cAny.unevenDaysWeight as number : 150;
	const timePrefWeight = typeof cAny.timePrefWeight === 'number' ? cAny.timePrefWeight as number : 100;
	const p1Cfg = c.mustStartFirstPeriod as { enabled: boolean; weight?: number };
	const p1Base = p1Cfg.enabled === false ? 0 : (typeof p1Cfg.weight === 'number' ? p1Cfg.weight : 300);
	// Phase 13.1: im strict-no-free-Modus bekommt no_p1_start denselben ×50
	// Multiplikator wie no_free. Begründung: ein P1-leerer Tag ist
	// pädagogisch genauso schlecht wie sandwich-gaps — Schüler hängen rum.
	// Vorher reichte das Default-Gewicht 300 nicht um Lehrer-Verfügbarkeits-
	// Druck zu kontern; Solver liefert dann „start P3, ende P8"-Pläne.
	const noFreeStrictActive = strictNoFree && noFreeStrict;
	const p1Weight = noFreeStrictActive ? p1Base * 50 : p1Base;
	const subjOnce = c.subjectMaxOncePerDay as { enabled?: boolean; weight?: number } | undefined;
	const subjOnceWeight = subjOnce?.enabled === false ? 0 : (subjOnce?.weight ?? 60);
	const specSpread = c.preferDoubleLessonsContiguous as { enabled?: boolean; weight?: number } | undefined;
	const specSpreadWeight = specSpread?.enabled === false ? 0 : (specSpread?.weight ?? 30);
	const tBalance = c.teacherEarlyStartBalance as { enabled?: boolean; weight?: number } | undefined;
	const tBalanceWeight = tBalance?.enabled === false ? 0 : (tBalance?.weight ?? 30);
	const tMin = c.teacherMinLessonsPerDay as { enabled?: boolean; weight?: number } | undefined;
	const tMinWeight = tMin?.enabled === false ? 0 : (tMin?.weight ?? 150);
	// Phase 13: Zieltagespensum + afternoon_preferred.
	const tDaily = c.targetDailyLessons as { enabled?: boolean; weight?: number; target?: number } | undefined;
	const tDailyWeight = tDaily?.enabled === false ? 0 : (tDaily?.weight ?? 80);
	// Phase 18: konfigurierbar über ConstraintConfig.afternoonPreferred.
	// Default 250 (vorher 100 hardcoded). User kann Wert im RulesPanel-Slider
	// anpassen; bei 0 wird die Komponente effektiv deaktiviert.
	const aftPref = (c as unknown as { afternoonPreferred?: { enabled?: boolean; weight?: number } }).afternoonPreferred;
	const afternoonPreferredWeight = aftPref?.enabled === false ? 0 : (aftPref?.weight ?? 250);
	// Phase 13.3: main_twice = 3+ Vorkommen desselben Hauptfachs am Tag/Stufe.
	// Sehr hohes Gewicht — pädagogisch dürfen niemals 3× M, D, oder E am
	// gleichen Tag in derselben Stufe sein, auch nicht mit Lücken dazwischen.
	// 800 ist 10× subject_twice (60); übertrumpft target_daily (80) und
	// any_aft (50) deutlich.
	const mainTwiceWeight = 800;
	// Phase 13.3: main_block_split = wenn doch 2× Hauptfach am Tag, dann als
	// Doppelstunde direkt hintereinander statt verstreut. 60 pro Lücken-Slot
	// dazwischen. Reicht aus um Solver zu Doppelstunde zu drücken wenn er
	// ohnehin 2× am Tag legt.
	const mainBlockSplitWeight = 60;
	// Solver-Opt Schritt 3: drei Lehrer-Qualitäts-Komponenten, konfigurierbar
	// über ConstraintConfig (RulesPanel-Slider). Defaults konservativ —
	// gap_fairness ist quadratisch und wächst schnell, days_present adressiert
	// Teilzeit-Lehrer, lunch ist per Default AUS (User-Priorität niedrig).
	const gapFair = (c as unknown as { teacherGapFairness?: { enabled?: boolean; weight?: number } }).teacherGapFairness;
	const gapFairnessWeight = gapFair?.enabled === false ? 0 : (gapFair?.weight ?? 15);
	const daysPres = (c as unknown as { teacherDaysPresent?: { enabled?: boolean; weight?: number } }).teacherDaysPresent;
	const daysPresentWeight = daysPres?.enabled === false ? 0 : (daysPres?.weight ?? 120);
	const midday = (c as unknown as { teacherMiddayBreak?: { enabled?: boolean; weight?: number } }).teacherMiddayBreak;
	// ACHTUNG: enabled muss EXPLIZIT true sein — Default ist AUS (anders als
	// die anderen Komponenten, deren Default AN ist).
	const lunchWeight = midday?.enabled === true ? (midday?.weight ?? 100) : 0;
	// Solver-Opt R2: Strafe pro ungeplanter Stunde — dominant, damit
	// Best-Tracking/Diversify nie eine unvollständigere Lösung bevorzugen.
	const unplacedCfg = (c as unknown as { unplacedPenalty?: { enabled?: boolean; weight?: number } }).unplacedPenalty;
	const unplacedWeight = unplacedCfg?.enabled === false ? 0 : (unplacedCfg?.weight ?? 100000);
	return {
		min_daily: minDailyWeight,
		no_p1_start: p1Weight,
		main_aft: c.noMainSubjectAfternoon.enabled ? c.noMainSubjectAfternoon.weight : 0,
		any_aft:
			c.noMainSubjectAfternoon.enabled && c.noMainSubjectAfternoon.applyToAllSubjects
				? c.noMainSubjectAfternoon.weightAllSubjects
				: 0,
		no_free: noFreeWeight,
		uneven_days: unevenDaysWeight,
		main_run: c.maxConsecutiveMain.enabled ? c.maxConsecutiveMain.weight : 0,
		compact_teacher: c.compactTeacherDays.enabled ? c.compactTeacherDays.weight : 0,
		main_early: c.preferMainEarly.enabled ? c.preferMainEarly.weight : 0,
		// Strong push so a flagged spec actually moves to its preferred zone.
		// 'late' specs are exempted from main_aft/any_aft/main_early in score.ts.
		time_pref: timePrefWeight,
		subject_twice: subjOnceWeight,
		spec_spread: specSpreadWeight,
		teacher_late_start: tBalanceWeight,
		teacher_under_min: tMinWeight,
		target_daily: tDailyWeight,
		afternoon_preferred: afternoonPreferredWeight,
		main_twice: mainTwiceWeight,
		main_block_split: mainBlockSplitWeight,
		teacher_gap_fairness: gapFairnessWeight,
		teacher_days_present: daysPresentWeight,
		teacher_lunch: lunchWeight,
		unplaced: unplacedWeight,
	};
}

/** Result of a complete solve session. */
export interface SolverResult {
	placed: PlacedLesson[];
	unplaced: string[];
	score: number;
	breakdown: ScoreBreakdown;
}
