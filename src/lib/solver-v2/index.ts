// Solver v2 — public API. Drop-in replacement for the old `solver/service.ts`.
//
// Same `startSolve(doc, opts)` signature, same event types, same SolveSession
// interface — UI doesn't need to change. Internally drives the three phases:
// Construction → Local Search → Iterated Local Search.

import type { PlacedLesson, ScheduleDoc } from '../types';
import { diagnose, bestHint, type Hint } from './diagnose';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { findHardViolations } from './hardCheck';
import { iteratedLocalSearchAsync } from './iteratedLS';
import {
	DAYS_BY_INDEX,
	defaultWeights,
	dpFromSlot,
	SLOT_UNPLACED,
	type ScoreBreakdown,
	type SolverState,
} from './types';

// ----- Re-exported types (API-compatible with v1) ---------------------------

/** Match the v1 PenaltyBreakdown for UI compatibility. */
export interface PenaltyBreakdown {
	main_aft: number;
	any_aft: number;
	main_early: number;
	main_run: number;
	no_free: number;
	uneven_days: number;
	compact: number;
	/** Sum of period-distance penalties for specs with explicit timePref. */
	time_pref: number;
	subject_twice: number;
	spec_spread: number;
	teacher_late_start: number;
	teacher_under_min: number;
	/** Phase 13: quadratische Abweichung pro (day, grade) vom Zieltagespensum. */
	target_daily: number;
	/** Phase 13: Specs die nachmittags sein sollten aber morgens landen. */
	afternoon_preferred: number;
	/** Phase 13.3: Hauptfach 3+ am gleichen Tag/Stufe — sehr unerwünscht. */
	main_twice: number;
	/** Phase 13.3: Hauptfach 2× am Tag, nicht konsekutiv — Lücken-Slot-Penalty. */
	main_block_split: number;
	/** Solver-Opt Schritt 3: Springstunden-Klumpung pro Lehrer, quadratisch. */
	teacher_gap_fairness: number;
	/** Solver-Opt Schritt 3: Anwesenheitstage über dem Teilzeit-Ideal. */
	teacher_days_present: number;
	/** Solver-Opt Schritt 3: fehlende Mittagspausen (default deaktiviert). */
	teacher_lunch: number;
	total: number;
}

export interface RelaxationInfo {
	blocksRelaxed: string[];
	minDailyReducedTo: number | null;
	startInP1Disabled: boolean;
	/**
	 * Wenn `true`: die strikte „keine Freistunden"-Anforderung konnte nicht
	 * erfüllt werden, der zweite Solver-Lauf hat das Soft-Gewicht reduziert
	 * und den Plan akzeptiert. UI zeigt einen Lockerungs-Hinweis an.
	 */
	noFreeRelaxed: boolean;
}

export interface SolverOutput {
	status: 'SAT' | 'UNSAT' | 'TIMEOUT' | 'ERROR';
	placed: PlacedLesson[];
	unplaced: string[];
	message?: string;
	penalties?: PenaltyBreakdown;
	relaxation?: RelaxationInfo;
	relaxedSpecIds?: string[];
}

export type SolvePhase = 'init' | 'satisfy' | 'optimize' | 'relax' | 'variant';

export interface SolveSolutionEvent {
	placed: PlacedLesson[];
	score: number | null;
	tElapsedMs: number;
	phase: SolvePhase;
}

export interface SolveProgressEvent {
	phase: SolvePhase;
	phaseLabel: string;
	tElapsedMs: number;
	tLimitMs: number;
	phaseIndex: number;
	phaseCount: number;
}

export interface SolveDoneEvent {
	final: SolverOutput;
	totalElapsedMs: number;
}

export interface SolveLogEvent {
	tElapsedMs: number;
	level: 'info' | 'warn' | 'error' | 'stat' | 'phase';
	message: string;
	data?: Record<string, unknown>;
}

type EventMap = {
	phase: SolvePhase;
	progress: SolveProgressEvent;
	solution: SolveSolutionEvent;
	relaxation: RelaxationInfo;
	done: SolveDoneEvent;
	error: Error;
	log: SolveLogEvent;
};

export interface SolveSession {
	abort(): void;
	on<K extends keyof EventMap>(event: K, cb: (e: EventMap[K]) => void): () => void;
	/** Returns a JSON dump of the solver input for debug. */
	getDzn(): string;
}

export interface StartSolveOptions {
	/** Hard wall-clock budget for the entire solve. Default 60_000. */
	totalBudgetMs?: number;
	/** Inner LS budget per restart cycle. Default 15_000. */
	innerBudgetMs?: number;
	/**
	 * Phase 14: Construction-Pool-Phase. Vor dem Local Search werden N
	 * verschiedene Constructions mit unterschiedlichen Seeds erzeugt; die
	 * Lösung mit dem besten Score wird als Startlösung für Local Search
	 * verwendet. Dauer in ms — `0` deaktiviert Pool (= heutiges Verhalten:
	 * 1 Construction, dann sofort LS). Default 0 für Backward-Compat.
	 *
	 * Realistische Werte: 3000-15000 ms. Construction dauert ~50-150ms,
	 * also liefert 10s Pool ~60-200 Pool-Versuche je nach Daten-Größe.
	 *
	 * Während der Pool läuft, emittiert der Solver `solution`-Events
	 * mit Phase `'satisfy'` für jede neue Best-Construction → User sieht
	 * den Pool im Grid live wachsen.
	 */
	poolBudgetMs?: number;
	/**
	 * Phase 14 — Hot-Start: aktueller Plan-Stand aus `doc.placed` wird als
	 * Startposition für Local Search verwendet. Pool-Phase und initiale
	 * Construction werden übersprungen. Wenn nach Hot-Start-Loading noch
	 * Units unplaced sind (z. B. neue Specs hinzugekommen oder Hot-Start-
	 * Placements via Hard-Validation gefiltert), platziert eine Mini-
	 * Construction sie zuerst. Default false.
	 */
	hotStart?: boolean;
	/**
	 * Phase 15 — Diversify (LNS-Mode): bei aktivem Plan wird ein Anteil
	 * `fraction` der nicht-pinned Units zurückgesetzt und neu platziert,
	 * gefolgt von Local Search mit Budget `durationMs`. Wenn der End-Score
	 * NICHT besser ist als vor dem Lauf, wird der Pre-Snapshot
	 * wiederhergestellt — Plan bleibt bit-identisch. Best-Tracking
	 * absolut, kein Verlust möglich.
	 *
	 * Setzt `hotStart=true` implizit (aktueller Plan ist Basis). Pool-Phase
	 * wird übersprungen. Nutzbar nur wenn `doc.placed.length > 0`.
	 */
	diversify?: {
		/** Anteil zurückzusetzender nicht-pinned Units (0.05 - 0.5). */
		fraction: number;
		/** Local-Search-Budget nach Reset in ms (5000 - 120000). */
		durationMs: number;
	};
}

// ----- Tiny event emitter ---------------------------------------------------

class Emitter {
	private listeners = new Map<string, Set<(e: unknown) => void>>();
	on(event: string, cb: (e: unknown) => void): () => void {
		let set = this.listeners.get(event);
		if (!set) { set = new Set(); this.listeners.set(event, set); }
		set.add(cb);
		return () => { set!.delete(cb); };
	}
	emit(event: string, e: unknown): void {
		const set = this.listeners.get(event);
		if (!set) return;
		for (const cb of set) {
			try { cb(e); } catch (err) { console.warn('SolveSession listener threw', err); }
		}
	}
}

// ----- Helpers --------------------------------------------------------------

/**
 * Convert a SolverState's placement[] into PlacedLesson[] for the UI.
 * Each Unit may produce multiple PlacedLesson entries (one per (occurrence,
 * grade) instance).
 */
function placementToPlacedLessons(state: SolverState, placement: Int32Array): PlacedLesson[] {
	// Last-mile defensive sweep: never hand a hard-violating placement to
	// the UI. We swap the state's placement buffer for the duration of the
	// scan, find offending unit indices, and skip them during decode. This
	// catches any inconsistency the solver may have produced (legacy
	// pinned data, partial ejection-chain) so the grid never shows a
	// teacher- or grade-double booking.
	const original = state.placement;
	state.placement = placement;
	let offenders: Set<number>;
	try {
		offenders = new Set(findHardViolations(state));
	} finally {
		state.placement = original;
	}

	const out: PlacedLesson[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const slot = placement[i];
		if (slot === SLOT_UNPLACED) continue;
		if (offenders.has(i)) continue;
		const unit = state.units[i];
		const { dayIndex, period: basePeriod } = dpFromSlot(slot);
		const day = DAYS_BY_INDEX[dayIndex];
		for (const inst of unit.instances) {
			const period = basePeriod + inst.blockPos;
			// Phase 17: bei Team-Teaching-Pseudo-Specs hat die Unit nur das
			// Segment-Team (Teilmenge von spec.teachers). Wir schreiben diese
			// effektive Lehrer-Liste explizit ins PlacedLesson, damit UI und
			// Konflikt-Validierung korrekt arbeiten.
			const spec = state.specsById.get(inst.specId);
			const teachers = (spec?.teachingSegments && spec.teachingSegments.length > 0)
				? [...unit.teacherIds]
				: undefined;
			out.push({
				specId: inst.specId,
				day,
				period: period as PlacedLesson['period'],
				grade: inst.grade,
				pinned: unit.pinned,
				...(teachers ? { teachers } : {})
			});
		}
	}
	return out;
}

/** Map a v2 ScoreBreakdown to the v1-compatible PenaltyBreakdown. */
function toPenaltyBreakdown(b: ScoreBreakdown): PenaltyBreakdown {
	// The v1 interface had no `min_daily` or `no_p1_start`. Fold those into
	// `no_free` (they're related — gaps and missing start).
	return {
		main_aft: b.main_aft,
		any_aft: b.any_aft,
		main_early: b.main_early,
		main_run: b.main_run,
		no_free: b.no_free + b.no_p1_start + b.min_daily,
		uneven_days: b.uneven_days,
		compact: b.compact_teacher,
		time_pref: b.time_pref,
		subject_twice: b.subject_twice,
		spec_spread: b.spec_spread,
		teacher_late_start: b.teacher_late_start,
		teacher_under_min: b.teacher_under_min,
		target_daily: b.target_daily,
		afternoon_preferred: b.afternoon_preferred,
		main_twice: b.main_twice,
		main_block_split: b.main_block_split,
		teacher_gap_fairness: b.teacher_gap_fairness,
		teacher_days_present: b.teacher_days_present,
		teacher_lunch: b.teacher_lunch,
		total: b.total,
	};
}

/** Find spec IDs whose strict block-pattern was relaxed during construction.
 *  v2 always uses auto-mode internally, so this is empty for now. */
function emptyRelaxation(): RelaxationInfo {
	return {
		blocksRelaxed: [],
		minDailyReducedTo: null,
		startInP1Disabled: false,
		noFreeRelaxed: false,
	};
}

// ----- DZN-Export (Phase 18) ------------------------------------------------

/**
 * Phase 18: Vollständiger Solver-Snapshot für Debug/Reproduktion.
 *
 * Enthält:
 *  - meta: Schuljahr, Timestamp, Format-Version
 *  - units: Solver-interne Atomar-Einheiten (rückwärtskompatibel zum alten Format)
 *  - specs: Original-LessonSpecs vor Expansion (inkl. teachingSegments, afternoonAllowed)
 *  - teachers: Stammdaten mit unavailable-Slots (für Lehrer-Last-Audit)
 *  - subjects: Stammdaten mit isMain-Flag
 *  - constraints: ConstraintConfig zum Reproduzieren der Soft-Constraint-Gewichte
 *  - placements: aktueller doc.placed (Pinned + freie Platzierungen)
 *  - droppedPins: vom Solver verworfene Pins (Validierungs-Fehler)
 *  - relaxation: Auto-Lockerung-Info wenn der Solver Constraints gelockert hat
 *  - scoreBreakdown: letzte bekannte Score-Werte
 *  - options: StartSolveOptions wie pool/hotStart/diversify
 *
 * Format ist JSON (trotz .dzn-Endung — Legacy aus MiniZinc-Zeit, Phase 5-10).
 */
const DZN_EXPORT_VERSION = 2;

function buildDznDump(args: {
	doc: ScheduleDoc;
	state: SolverState | null;
	breakdown: ScoreBreakdown | null;
	relaxation: RelaxationInfo | null;
	tStart: number;
	options: StartSolveOptions;
}): string {
	const { doc, state, breakdown, relaxation, tStart, options } = args;

	const dump: Record<string, unknown> = {
		meta: {
			exportVersion: DZN_EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			schoolYear: doc.schoolYear,
			solverElapsedMs: Date.now() - tStart,
			source: 'solver-v2',
			docSchemaVersion: doc.meta?.schemaVersion ?? null,
		},
		// Solver-Optionen die diesen Lauf konfiguriert haben.
		options: {
			totalBudgetMs: options.totalBudgetMs ?? null,
			innerBudgetMs: options.innerBudgetMs ?? null,
			poolBudgetMs: options.poolBudgetMs ?? null,
			hotStart: options.hotStart ?? false,
			diversify: options.diversify ?? null,
		},
		// Original-Stammdaten (für Reproduktion ohne Solver-State).
		teachers: doc.teachers.map(t => ({
			id: t.id,
			name: t.name,
			shortNumber: t.shortNumber,
			personalNumber: t.personalNumber,
			isLeader: t.isLeader,
			placeholder: t.placeholder,
			subjects: [...t.subjects],
			unavailable: t.unavailable.map(u => ({ day: u.day, period: u.period })),
		})),
		subjects: doc.subjects.map(s => ({
			code: s.code,
			name: s.name,
			category: s.category,
			isMain: s.isMain,
			maxConsecutive: s.maxConsecutive,
			hoursPerWeek: s.hoursPerWeek,
		})),
		specs: doc.specs.map(s => ({
			id: s.id,
			subject: s.subject,
			teachers: [...s.teachers],
			classes: [...s.classes],
			grades: [...s.grades],
			weekPattern: s.weekPattern,
			groupLabel: s.groupLabel,
			couplingId: s.couplingId,
			count: s.count,
			blocks: s.blocks,
			timePref: s.timePref,
			afternoonAllowed: s.afternoonAllowed,
			includeInSolver: s.includeInSolver,
			source: s.source,
			teachingSegments: s.teachingSegments,
		})),
		constraints: doc.constraints,
		// Aktueller Plan-Stand für Reproduktion (Pinned + freie).
		placements: doc.placed.map(p => ({
			specId: p.specId,
			day: p.day,
			period: p.period,
			grade: p.grade,
			pinned: p.pinned,
		})),
	};

	if (state) {
		// Solver-State-spezifische Felder. Wenn state===null (getDzn vor Solver-
		// Start aufgerufen), bleiben die fields weg — das ist erlaubt und
		// signalisiert „kein Lauf gestartet".
		dump.nUnits = state.nUnits;
		dump.units = state.units.map(u => ({
			idx: u.idx,
			kind: u.kind,
			subjectCode: u.subjectCode,
			teacherId: u.teacherId,
			teacherIds: [...u.teacherIds],
			grades: [...u.grades],
			blockSize: u.blockSize,
			pinned: u.pinned,
			specIds: [...u.specIds],
			weekPattern: u.weekPattern,
			afternoonAllowed: u.afternoonAllowed,
		}));
		dump.droppedPins = (state.droppedPins ?? []).map(dp => ({
			specId: dp.specId,
			subjectCode: dp.subjectCode,
			day: dp.day,
			period: dp.period,
			reason: dp.reason,
		}));
	} else {
		dump.nUnits = 0;
		dump.units = [];
		dump.droppedPins = [];
	}

	if (breakdown) {
		dump.scoreBreakdown = breakdown;
	}
	if (relaxation) {
		dump.relaxation = relaxation;
	}

	return JSON.stringify(dump, null, 2);
}

// ----- Public API -----------------------------------------------------------

/**
 * Start a solve session. Returns immediately; events are emitted via
 * `session.on(event, cb)`. Use `session.abort()` to stop early — the best
 * known solution is then returned in the `done` event.
 */
export function startSolve(doc: ScheduleDoc, opts: StartSolveOptions = {}): SolveSession {
	const emitter = new Emitter();
	const tStart = Date.now();
	// Phase 15: Diversify überschreibt totalBudgetMs mit eigenem
	// durationMs — der ganze Lauf (Construction-Mini + LS) soll innerhalb
	// dieses Budgets bleiben.
	const totalBudget = opts.diversify
		? opts.diversify.durationMs
		: (opts.totalBudgetMs ?? 60_000);
	const innerBudget = opts.innerBudgetMs ?? 15_000;

	let aborted = false;
	let stateForDump: SolverState | null = null;
	// Phase 18: zuletzt-bekannter Score + Relaxation-Info für DZN-Export.
	// Werden vom done-Pfad gesetzt; bleiben null wenn vor Solver-Lauf getDzn()
	// gerufen wird.
	let lastBreakdownForDump: ScoreBreakdown | null = null;
	let lastRelaxationForDump: RelaxationInfo | null = null;

	function emit<K extends keyof EventMap>(event: K, e: EventMap[K]): void {
		emitter.emit(event, e);
	}
	function emitLog(level: SolveLogEvent['level'], message: string, data?: Record<string, unknown>): void {
		emit('log', { tElapsedMs: Date.now() - tStart, level, message, data });
	}

	const session: SolveSession = {
		abort(): void {
			aborted = true;
			emitLog('phase', 'Benutzer hat abgebrochen');
		},
		on(event, cb): () => void {
			return emitter.on(event as string, cb as (e: unknown) => void);
		},
		getDzn(): string {
			return buildDznDump({
				doc,
				state: stateForDump,
				breakdown: lastBreakdownForDump,
				relaxation: lastRelaxationForDump,
				tStart,
				options: opts,
			});
		},
	};

	// Defer to give caller a chance to register listeners.
	queueMicrotask(() => { void runSession(); });

	async function runSession(): Promise<void> {
		try {
			emitLog('phase', 'Session startet — encode + pre-flight');

			// --- Pre-flight diagnose ---
			const allHints = diagnose(doc);
			for (const h of allHints) {
				emitLog(h.severity === 'error' ? 'error' : 'warn', `Diagnose: ${h.message}`);
			}
			const fatal = allHints.find((h: Hint) => h.severity === 'error');
			if (fatal) {
				emit('done', {
					final: {
						status: 'ERROR',
						placed: [],
						unplaced: [],
						message: `Konfiguration nicht lösbar:\n\n${fatal.message}`,
					},
					totalElapsedMs: Date.now() - tStart,
				});
				return;
			}

			// --- Build state ---
			// Phase 14: hotStart aus Options durchreichen — wenn true, übernimmt
			// buildState die nicht-pinned Placements als Startposition.
			// Phase 15: Diversify impliziert hotStart (wir starten vom aktuellen
			// Plan und schütteln einen Anteil durch).
			const diversifyOpts = opts.diversify;
			const isDiversify = !!diversifyOpts;
			const hotStart = opts.hotStart === true || isDiversify;
			const state = buildState(doc, { hotStart });
			stateForDump = state;
			const strictNoFree = doc.constraints.noFreePeriodsForClass.strict !== false &&
				doc.constraints.noFreePeriodsForClass.enabled !== false;
			let weights = defaultWeights(doc, strictNoFree);
			let noFreeRelaxed = false;
			emitLog('info', `Modell: ${state.nUnits} Units, ${state.doc.teachers.length} Lehrer, ${state.doc.subjects.length} Fächer`);
			if (strictNoFree) {
				emitLog('info', 'Modus: keine Freistunden in Stufen (strict)');
			}

			// K-1: Pin-Verluste melden. buildState verwirft Pins die hard
			// constraints verletzen — das ist sicher, aber der User muss es
			// wissen, sonst wundert er sich warum „seine" Pins fehlen.
			if (state.droppedPins && state.droppedPins.length > 0) {
				for (const dp of state.droppedPins) {
					emitLog('warn', `Pin verworfen: ${dp.subjectCode} ${dp.day} P${dp.period} — ${dp.reason}`, {
						specId: dp.specId,
						day: dp.day,
						period: dp.period,
						reason: dp.reason,
					});
				}
			}

			if (state.nUnits === 0) {
				emit('done', {
					final: {
						status: 'ERROR',
						placed: [],
						unplaced: [],
						message: 'Keine Lehreinheiten vorhanden — nichts zu generieren.',
					},
					totalElapsedMs: Date.now() - tStart,
				});
				return;
			}

			// --- Phase 15: Diversify Pre-Snapshot + Random Reset ---
			// Vor allem anderen: snapshotten was wir haben, dann einen Anteil
			// der nicht-pinned Units zurücksetzen. Construction (im hotStart-
			// Pfad) wird sie neu platzieren, LS optimiert auf neuem Basis.
			let diversifyPreSnapshot: Int32Array | null = null;
			let diversifyPreScore: number | null = null;
			let diversifyResetCount = 0;
			if (isDiversify) {
				diversifyPreSnapshot = new Int32Array(state.placement);
				diversifyPreScore = computeScore(state, weights).total;
				const fraction = Math.max(0.05, Math.min(0.5, diversifyOpts!.fraction));
				// Sammle alle nicht-pinned, aktuell platzierten Units
				const candidates: number[] = [];
				for (let i = 0; i < state.nUnits; i++) {
					if (!state.units[i].pinned && state.placement[i] !== SLOT_UNPLACED) {
						candidates.push(i);
					}
				}
				const resetCount = Math.max(1, Math.floor(candidates.length * fraction));
				// Fisher-Yates Partial Shuffle für resetCount zufällige Indices
				const seedR = ((Date.now()) & 0x7fffffff) || 1;
				let rngState = seedR;
				const rand = () => {
					rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
					return rngState / 0x7fffffff;
				};
				for (let i = 0; i < resetCount && i < candidates.length; i++) {
					const j = i + Math.floor(rand() * (candidates.length - i));
					[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
				}
				const toReset = candidates.slice(0, resetCount);
				for (const idx of toReset) state.placement[idx] = SLOT_UNPLACED;
				diversifyResetCount = toReset.length;
				emitLog('phase', `Diversify: ${diversifyResetCount} von ${candidates.length} nicht-pinned Units zurückgesetzt (${Math.round(fraction * 100)}%)`);
			}

			// --- Phase 1: Construction (Pool, Single, oder Hot-Start) ---
			emit('phase', 'satisfy');
			const poolBudget = opts.poolBudgetMs ?? 0;
			// Phase 14: Hot-Start überschreibt Pool. Wenn beides angegeben,
			// gewinnt Hot-Start (User wollte explizit weiter optimieren).
			const usePool = poolBudget > 0 && !hotStart;
			emit('progress', {
				phase: 'satisfy',
				phaseLabel: hotStart
					? 'Phase 1/2: Hot-Start (aktueller Plan als Basis)'
					: usePool
						? `Phase 1/2: Pool-Suche (${Math.round(poolBudget / 1000)}s)`
						: 'Phase 1/2: Erste valide Lösung suchen',
				tElapsedMs: Date.now() - tStart,
				tLimitMs: hotStart ? 1_000 : (usePool ? poolBudget : 5_000),
				phaseIndex: 1,
				phaseCount: 2,
			});

			let constructResult: { unplacedUnitIdxs: number[]; complete: boolean };

			if (hotStart) {
				// Hot-Start: buildState hat schon Placements geladen. Prüfe ob
				// noch Units unplaced sind (z. B. neue Specs). Dafür Mini-
				// Construction. Sonst direkt zu Phase 2.
				let unplacedIdxs: number[] = [];
				for (let i = 0; i < state.nUnits; i++) {
					if (state.placement[i] === SLOT_UNPLACED) unplacedIdxs.push(i);
				}
				const placedCount = state.nUnits - unplacedIdxs.length;
				emitLog('phase', `Hot-Start: ${placedCount}/${state.nUnits} Units aus aktuellem Plan übernommen`);
				if (unplacedIdxs.length > 0) {
					emitLog('info', `${unplacedIdxs.length} Units brauchen Construction (neu oder konfliktbehaftet)`);
					// Nutze normale construct() — die respektiert bereits
					// platzierte Units (sie überspringt Units mit
					// placement[idx] !== SLOT_UNPLACED).
					constructResult = construct(state, { weights, seed: Date.now() & 0x7fffffff });
				} else {
					constructResult = { unplacedUnitIdxs: [], complete: true };
				}
			} else if (usePool) {
				// Pool-Phase: N Constructions mit verschiedenen Seeds, beste
				// behalten. Live-Updates an UI für jede neue Best-Lösung.
				emitLog('phase', `Phase 1: Pool-Construction (${Math.round(poolBudget / 1000)}s Budget)`);
				const poolStart = Date.now();
				let poolAttempts = 0;
				let bestPoolPlacement: Int32Array | null = null;
				let bestPoolBreakdown: ScoreBreakdown | null = null;
				let bestPoolUnplaced: number[] = [];
				let bestPoolComplete = false;

				// Pinned-Placements einmal sichern — werden bei jedem Reset
				// wieder eingespielt, damit User-Pins überleben.
				const pinnedSnapshot = new Int32Array(state.nUnits);
				for (let i = 0; i < state.nUnits; i++) {
					pinnedSnapshot[i] = state.units[i].pinned ? state.placement[i] : SLOT_UNPLACED;
				}

				// eslint-disable-next-line no-constant-condition
				while (true) {
					if (aborted) break;
					if (Date.now() - poolStart >= poolBudget) break;

					// Reset placement: nur pinned units behalten ihre Plätze.
					for (let i = 0; i < state.nUnits; i++) {
						state.placement[i] = pinnedSnapshot[i];
					}

					// Construction mit neuem Seed pro Versuch.
					const seed = ((Date.now() ^ (poolAttempts * 0x9E3779B1)) & 0x7fffffff) || 1;
					const r = construct(state, { weights, seed });
					poolAttempts++;
					const breakdown = computeScore(state, weights);

					// Akzeptiere wenn besser als bisheriger Pool-Best.
					// "Besser" heißt: weniger unplaced ODER (gleich viele
					// unplaced UND niedriger Score). Vollständige Lösungen
					// dominieren immer über partielle.
					const better = bestPoolBreakdown === null
						|| (r.unplacedUnitIdxs.length < bestPoolUnplaced.length)
						|| (r.unplacedUnitIdxs.length === bestPoolUnplaced.length
							&& breakdown.total < bestPoolBreakdown.total);
					if (better) {
						bestPoolPlacement = new Int32Array(state.placement);
						bestPoolBreakdown = breakdown;
						bestPoolUnplaced = r.unplacedUnitIdxs;
						bestPoolComplete = r.complete;
						// Live-Update für UI.
						emit('solution', {
							placed: placementToPlacedLessons(state, state.placement),
							score: breakdown.total,
							tElapsedMs: Date.now() - tStart,
							phase: 'satisfy',
						});
						emitLog('stat', `Pool: neuer Best #${poolAttempts}, Score ${breakdown.total}, ${r.unplacedUnitIdxs.length} unplaced`);
					}

					// Async-Yield damit UI-Updates durchkommen und abort
					// wirksam wird.
					await new Promise(resolve => setTimeout(resolve, 0));
				}

				// Pool-Phase fertig — beste Lösung als Startpunkt für LS
				// wieder einspielen.
				if (bestPoolPlacement && bestPoolBreakdown) {
					state.placement.set(bestPoolPlacement);
					constructResult = {
						unplacedUnitIdxs: bestPoolUnplaced,
						complete: bestPoolComplete,
					};
					emitLog('phase', `Pool abgeschlossen: ${poolAttempts} Versuche, bester Score ${bestPoolBreakdown.total}`);
				} else {
					// Fallback wenn Pool gar keinen Versuch geschafft hat
					// (z.B. abort kurz nach Start).
					emitLog('warn', `Pool ohne valide Lösung — Fallback auf Einzel-Construction`);
					for (let i = 0; i < state.nUnits; i++) state.placement[i] = pinnedSnapshot[i];
					constructResult = construct(state, { weights, seed: Date.now() & 0x7fffffff });
				}
			} else {
				// Heutiges Verhalten: 1 Construction
				emitLog('phase', 'Phase 1: Construction (greedy + ejection chain)');
				const tConstructStart = Date.now();
				constructResult = construct(state, { weights, seed: Date.now() & 0x7fffffff });
				const tConstruct = Date.now() - tConstructStart;
				emitLog('stat', `Construction abgeschlossen in ${tConstruct} ms`, {
					unplaced: constructResult.unplacedUnitIdxs.length,
					complete: constructResult.complete,
				});
			}

			if (aborted) {
				emitDone(state, weights, computeScore(state, weights), null, false);
				return;
			}

			// Even if some units are unplaced, we proceed to LS — partial
			// solution is better than nothing.
			let initialBreakdown = computeScore(state, weights);
			emit('solution', {
				placed: placementToPlacedLessons(state, state.placement),
				score: initialBreakdown.total,
				tElapsedMs: Date.now() - tStart,
				phase: 'satisfy',
			});

			// --- Phase 2: Iterated Local Search ---
			emit('phase', 'optimize');
			emit('progress', {
				phase: 'optimize',
				phaseLabel: 'Phase 2/2: Optimieren',
				tElapsedMs: Date.now() - tStart,
				tLimitMs: totalBudget,
				phaseIndex: 2,
				phaseCount: 2,
			});
			emitLog('phase', 'Phase 2: Iterated Local Search');

			// K-2: Phase-3 Mindest-Budget reservieren. Wenn strict-no-free aktiv
			// ist, könnte später eine Auto-Lockerung nötig werden — dafür
			// reservieren wir 10 % des Gesamtbudgets (mind. 2 s), sonst frisst
			// Phase 2 die Zeit auf und Phase 3 kommt gar nicht erst zum Zug.
			const phase2BudgetCap = strictNoFree
				? Math.max(2_000, totalBudget - Math.max(2_000, Math.floor(totalBudget * 0.1)))
				: totalBudget;
			const phase2Remaining = Math.min(
				phase2BudgetCap - (Date.now() - tStart),
				totalBudget - (Date.now() - tStart),
			);
			const ils = await iteratedLocalSearchAsync(state, initialBreakdown, {
				weights,
				totalBudgetMs: Math.max(1_000, phase2Remaining),
				innerBudgetMs: innerBudget,
				seed: Date.now() & 0x7fffffff,
				shouldAbort: () => aborted,
				onImprovement: (info) => {
					emit('solution', {
						placed: placementToPlacedLessons(state, info.bestPlacement),
						score: info.breakdown.total,
						tElapsedMs: Date.now() - tStart,
						phase: 'optimize',
					});
				},
				onRestart: (info) => {
					emitLog('phase', `Restart (Plateau) nach ${info.iteration} Iterationen`);
				},
			});

			emitLog('stat', `ILS abgeschlossen: ${ils.totalIterations} Iter, ${ils.restartCount} Restarts in ${ils.tElapsedMs} ms`);
			emitLog('info', `Final score: ${ils.bestBreakdown.total}`);

			let bestBreakdown = ils.bestBreakdown;

			// --- Phase 3 (Auto-Relax): if strict-no-free still leaves gaps,
			// re-run ILS with normal soft weight so we don't get stuck on a
			// quasi-infeasible objective. The relaxed pass starts from the
			// current state (best-effort), keeps any improvement, but never
			// lets the score get worse than the strict result.
			// Phase 15: Diversify überspringt Auto-Relax. Diversify ist ein
			// kurzer LNS-Stoß auf einem bestehenden Plan; Relax-Lockerung
			// würde den Vergleich Pre-/Post-Score mit unterschiedlichen
			// Gewichten machen und Best-Tracking inkonsistent werden lassen.
			if (
				strictNoFree &&
				!isDiversify &&
				ils.bestBreakdown.no_free > 0 &&
				!aborted &&
				Date.now() - tStart < totalBudget
			) {
				emit('phase', 'relax');
				emitLog('phase', `Auto-Lockerung: ${ils.bestBreakdown.no_free} Freistunden unvermeidbar — Constraint wird auf Soft umgestellt`);
				const relaxedWeights = defaultWeights(doc, false);
				weights = relaxedWeights;
				noFreeRelaxed = true;
				const relaxBaseline = computeScore(state, relaxedWeights);
				const ils2 = await iteratedLocalSearchAsync(state, relaxBaseline, {
					weights: relaxedWeights,
					totalBudgetMs: Math.max(2_000, totalBudget - (Date.now() - tStart)),
					innerBudgetMs: innerBudget,
					seed: (Date.now() & 0x7fffffff) ^ 0x55aa55aa,
					shouldAbort: () => aborted,
					onImprovement: (info) => {
						emit('solution', {
							placed: placementToPlacedLessons(state, info.bestPlacement),
							score: info.breakdown.total,
							tElapsedMs: Date.now() - tStart,
							phase: 'relax',
						});
					},
					onRestart: (info) => {
						emitLog('phase', `Relax-Restart nach ${info.iteration} Iterationen`);
					},
				});
				emitLog('stat', `Relax-Phase abgeschlossen: ${ils2.totalIterations} Iter, ${ils2.restartCount} Restarts in ${ils2.tElapsedMs} ms`);
				bestBreakdown = ils2.bestBreakdown;
			}

			const relaxation = noFreeRelaxed
				? { ...emptyRelaxation(), noFreeRelaxed: true }
				: emptyRelaxation();
			if (noFreeRelaxed) emit('relaxation', relaxation);

			// Phase 15: Diversify-Revert. Wenn Diversify-Lauf KEINE Verbesserung
			// gefunden hat, stelle Pre-Snapshot wieder her. Best-Tracking ist
			// absolut: Plan kann nie schlechter werden.
			if (isDiversify && diversifyPreSnapshot && diversifyPreScore !== null) {
				const newScore = bestBreakdown.total;
				if (newScore < diversifyPreScore) {
					emitLog('phase', `Diversify erfolgreich: Score ${Math.round(diversifyPreScore)} → ${Math.round(newScore)} (verbessert um ${Math.round(diversifyPreScore - newScore)})`);
					// Plan bleibt wie er ist (= verbesserter Stand)
				} else {
					emitLog('phase', `Diversify ohne Verbesserung: ${Math.round(diversifyPreScore)} → ${Math.round(newScore)} — Plan wird zurückgesetzt`);
					state.placement.set(diversifyPreSnapshot);
					bestBreakdown = computeScore(state, weights);
				}
			}

			emitDone(state, weights, bestBreakdown, constructResult.unplacedUnitIdxs, true, relaxation);
		} catch (e) {
			emit('error', e instanceof Error ? e : new Error(String(e)));
			emit('done', {
				final: {
					status: 'ERROR',
					placed: [],
					unplaced: [],
					message: e instanceof Error ? e.message : String(e),
				},
				totalElapsedMs: Date.now() - tStart,
			});
		}
	}

	function emitDone(
		state: SolverState,
		_weights: ReturnType<typeof defaultWeights>,
		breakdown: ScoreBreakdown,
		unplacedIdxs: number[] | null,
		_complete: boolean,
		relaxation: RelaxationInfo = emptyRelaxation()
	): void {
		// Phase 18: für DZN-Export merken
		lastBreakdownForDump = breakdown;
		lastRelaxationForDump = relaxation;
		const placed = placementToPlacedLessons(state, state.placement);
		const unplacedSpecIds = new Set<string>();
		if (unplacedIdxs) {
			for (const idx of unplacedIdxs) {
				const u = state.units[idx];
				for (const sid of u.specIds) unplacedSpecIds.add(sid);
			}
		}
		const status: SolverOutput['status'] = aborted
			? 'TIMEOUT'
			: 'SAT';
		let message = aborted
			? `Vom Benutzer abgebrochen — beste bisher gefundene Lösung übernommen (Score ${breakdown.total}).`
			: undefined;
		if (relaxation.noFreeRelaxed && !aborted) {
			message = `Plan akzeptiert mit ${breakdown.no_free} unvermeidbaren Freistunden (Constraint automatisch gelockert).`;
		}

		emit('done', {
			final: {
				status,
				placed,
				unplaced: Array.from(unplacedSpecIds),
				message,
				penalties: toPenaltyBreakdown(breakdown),
				relaxation,
				relaxedSpecIds: [],
			},
			totalElapsedMs: Date.now() - tStart,
		});
	}

	return session;
}

// ----- Backward-compatible solve() wrapper for tests -----------------------

export interface SolveOptions {
	timeoutMs?: number;
	onProgress?: (phase: string) => void;
}

/** Synchronous-ish convenience wrapper. Resolves with the final SolverOutput. */
export async function solve(doc: ScheduleDoc, opts: SolveOptions = {}): Promise<SolverOutput> {
	void bestHint; // ensure import is used
	const totalBudgetMs = opts.timeoutMs ?? 60_000;
	return new Promise((resolve) => {
		const session = startSolve(doc, { totalBudgetMs });
		session.on('phase', (p) => opts.onProgress?.(p));
		session.on('done', (d) => resolve(d.final));
	});
}
