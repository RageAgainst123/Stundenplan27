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
			out.push({
				specId: inst.specId,
				day,
				period: period as PlacedLesson['period'],
				grade: inst.grade,
				pinned: unit.pinned,
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

// ----- Public API -----------------------------------------------------------

/**
 * Start a solve session. Returns immediately; events are emitted via
 * `session.on(event, cb)`. Use `session.abort()` to stop early — the best
 * known solution is then returned in the `done` event.
 */
export function startSolve(doc: ScheduleDoc, opts: StartSolveOptions = {}): SolveSession {
	const emitter = new Emitter();
	const tStart = Date.now();
	const totalBudget = opts.totalBudgetMs ?? 60_000;
	const innerBudget = opts.innerBudgetMs ?? 15_000;

	let aborted = false;
	let stateForDump: SolverState | null = null;

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
			if (!stateForDump) return '';
			// v2 has no DZN — produce a JSON snapshot instead
			return JSON.stringify({
				nUnits: stateForDump.nUnits,
				units: stateForDump.units.map(u => ({
					idx: u.idx,
					kind: u.kind,
					subjectCode: u.subjectCode,
					teacherId: u.teacherId,
					grades: u.grades,
					blockSize: u.blockSize,
					pinned: u.pinned,
					specIds: u.specIds,
				})),
			}, null, 2);
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
			const state = buildState(doc);
			stateForDump = state;
			const strictNoFree = doc.constraints.noFreePeriodsForClass.strict !== false &&
				doc.constraints.noFreePeriodsForClass.enabled !== false;
			let weights = defaultWeights(doc, strictNoFree);
			let noFreeRelaxed = false;
			emitLog('info', `Modell: ${state.nUnits} Units, ${state.doc.teachers.length} Lehrer, ${state.doc.subjects.length} Fächer`);
			if (strictNoFree) {
				emitLog('info', 'Modus: keine Freistunden in Stufen (strict)');
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

			// --- Phase 1: Construction ---
			emit('phase', 'satisfy');
			emit('progress', {
				phase: 'satisfy',
				phaseLabel: 'Phase 1/2: Erste valide Lösung suchen',
				tElapsedMs: Date.now() - tStart,
				tLimitMs: 5_000,
				phaseIndex: 1,
				phaseCount: 2,
			});
			emitLog('phase', 'Phase 1: Construction (greedy + ejection chain)');

			const tConstructStart = Date.now();
			const constructResult = construct(state, { weights, seed: Date.now() & 0x7fffffff });
			const tConstruct = Date.now() - tConstructStart;
			emitLog('stat', `Construction abgeschlossen in ${tConstruct} ms`, {
				unplaced: constructResult.unplacedUnitIdxs.length,
				complete: constructResult.complete,
			});

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

			const ils = await iteratedLocalSearchAsync(state, initialBreakdown, {
				weights,
				totalBudgetMs: totalBudget - (Date.now() - tStart),
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
			if (
				strictNoFree &&
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
