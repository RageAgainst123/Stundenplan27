// Frontend-side service that drives MiniZinc-JS directly.
// MiniZinc-JS already runs the solver in its own internal Web Worker (it spins
// up `minizinc-worker.js` via importScripts), so we don't need an outer module
// worker — that would prevent the inner Classic-worker from loading.

import * as MiniZinc from 'minizinc';
import minizincWorkerURL from 'minizinc/minizinc-worker.js?url';
import minizincWasmURL from 'minizinc/minizinc.wasm?url';
import minizincDataURL from 'minizinc/minizinc.data?url';
import { encode, type SolverInput } from './encode';
import { decode, type RelaxationInfo, type SolverOutput } from './decode';
import { diagnose, bestHint } from './diagnose';
import type { ScheduleDoc } from '../types';
import modelMzn from './model.mzn?raw';

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
	if (!initPromise) {
		initPromise = MiniZinc.init({
			workerURL: new URL(minizincWorkerURL, location.href),
			wasmURL: new URL(minizincWasmURL, location.href),
			dataURL: new URL(minizincDataURL, location.href),
			numWorkers: 1
		});
	}
	return initPromise;
}

export interface SolveOptions {
	timeoutMs?: number;
	onProgress?: (phase: string) => void;
}

// ===================== Phase 10: Streaming SolveSession =====================

export type SolvePhase = 'init' | 'satisfy' | 'optimize' | 'relax' | 'variant';

/** A single intermediate solution emitted during optimization. */
export interface SolveSolutionEvent {
	placed: import('../types').PlacedLesson[];
	score: number | null;          // null until objective is known
	tElapsedMs: number;
	phase: SolvePhase;
}

export interface SolveProgressEvent {
	phase: SolvePhase;
	phaseLabel: string;            // human readable
	tElapsedMs: number;
	tLimitMs: number;              // 0 = no time limit
	phaseIndex: number;            // 1, 2, 3...
	phaseCount: number;
}

export interface SolveDoneEvent {
	final: SolverOutput;
	totalElapsedMs: number;
}

/** A single line in the solver log shown to the user. */
export interface SolveLogEvent {
	/** Wall-clock ms since the session started. */
	tElapsedMs: number;
	/** Severity. `info` is the default; `warn` highlights potential issues;
	 *  `error` is a failed run; `stat` is solver statistics; `phase` is a
	 *  phase or relaxation transition. */
	level: 'info' | 'warn' | 'error' | 'stat' | 'phase';
	message: string;
	/** Optional structured payload — currently used for solver statistics. */
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
	/** The DZN string from the most recent encode, useful for debugging. */
	getDzn(): string;
}

export interface StartSolveOptions {
	/** Time limit for the satisfy phase (Phase A). Default 15_000. */
	satisfyTimeoutMs?: number;
	/** Time limit for the optimize phase (Phase B). Default 60_000. */
	optimizeTimeoutMs?: number;
	/** Per-relaxation-step time limit. Default 30_000. */
	relaxTimeoutMs?: number;
	/** Currently always `false` — variants run on-demand via runVariant(). */
	enableVariants?: boolean;
}

/** Internal: tiny event emitter (avoid Node EventEmitter dependency). */
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

// Single solver round: takes a SolverInput, runs MiniZinc, decodes.
async function runSolver(enc: SolverInput, timeoutMs: number, onProgress?: (s: string) => void): Promise<SolverOutput> {
	const dzn = (enc.dataJson as any).__dzn as string;
	try {
		onProgress?.('init');
		await ensureInit();

		onProgress?.('build');
		const model = new MiniZinc.Model();
		model.addString(modelMzn);
		model.addDznString(dzn);

		onProgress?.('solve');
		const job = model.solve({
			options: {
				solver: 'gecode',
				'time-limit': timeoutMs
			}
		});

		let lastSolutionOutput: string | null = null;
		(job as any).on?.('solution', (sol: any) => {
			const out = sol.output?.json ?? sol.output?.default ?? sol;
			lastSolutionOutput = typeof out === 'string' ? out : JSON.stringify(out);
		});

		const result = await job;
		const status = String(result.status ?? 'UNKNOWN');

		if (status === 'UNSATISFIABLE') {
			return {
				status: 'UNSAT',
				placed: [],
				unplaced: enc.instances.map(i => i.specId)
			};
		}

		const rawOutput =
			lastSolutionOutput ??
			(result.solution
				? JSON.stringify((result.solution as any).output ?? result.solution)
				: null);

		return decode(rawOutput, enc.instances);
	} catch (e) {
		const msg = e instanceof Error ? e.message
			: (typeof e === 'object' && e !== null) ? JSON.stringify(e)
			: String(e);
		return {
			status: 'ERROR',
			placed: [],
			unplaced: enc.instances.map(i => i.specId),
			message: msg
		};
	}
}

// Phase 7B: Build a relaxed copy of the doc where all explicit block patterns
// are dropped (= auto mode). User-pinned placements stay. Returns the new doc
// and the list of spec IDs that were actually relaxed (had a strict pattern
// to begin with), so the UI can show what changed.
function relaxStrictBlocks(doc: ScheduleDoc): { doc: ScheduleDoc; relaxedSpecIds: string[] } {
	const relaxed: string[] = [];
	const cloned: ScheduleDoc = {
		...doc,
		specs: doc.specs.map(s => {
			if (s.blocks && s.blocks.length > 0) {
				relaxed.push(s.id);
				return { ...s, blocks: undefined };
			}
			return s;
		})
	};
	return { doc: cloned, relaxedSpecIds: relaxed };
}

// Phase 9: relax the hard "≥ N slots per day per grade" constraint to a
// lower threshold (or disable entirely with 0). Returns a doc clone with
// the new value.
function relaxMinDailySlots(doc: ScheduleDoc, newValue: number): ScheduleDoc {
	return {
		...doc,
		constraints: { ...doc.constraints, minDailySlotsPerGrade: newValue }
	};
}

// Phase 10: disable the hard "Beginn in P1"-constraint as a last-resort
// relaxation step.
function disableStartInP1(doc: ScheduleDoc): ScheduleDoc {
	return {
		...doc,
		constraints: {
			...doc.constraints,
			mustStartFirstPeriod: { enabled: false }
		}
	};
}

export async function solve(doc: ScheduleDoc, opts: SolveOptions = {}): Promise<SolverOutput> {
	const enc = encode(doc);
	const timeoutMs = opts.timeoutMs ?? 30_000;

	if (enc.L === 0) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: [],
			message: 'Keine Lehreinheiten vorhanden — nichts zu generieren.'
		};
	}

	// Pre-flight: detect obvious UNSAT-causing config errors before spending
	// 25s on a doomed solver run.
	const preflight = diagnose(doc);
	const fatalHint = preflight.find(h => h.severity === 'error');
	if (fatalHint) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: enc.instances.map(i => i.specId),
			message: `Konfiguration nicht lösbar:\n\n${fatalHint.message}`
		};
	}

	// Round 1: as configured.
	const r1 = await runSolver(enc, timeoutMs, opts.onProgress);

	if (r1.status === 'SAT') return r1;

	if (r1.status === 'UNSAT') {
		// Phase 10: tiered auto-relaxation with structured RelaxationInfo.
		//   Round 2: relax strict block patterns (auto-mode for everyone)
		//   Round 3: also reduce min_daily_slots from 4 → 3
		//   Round 4: also reduce min_daily_slots → 0
		//   Round 5: also disable mustStartFirstPeriod (last-resort)
		const originalMinDaily = doc.constraints?.minDailySlotsPerGrade ?? 0;
		const originalMustStartP1 = doc.constraints?.mustStartFirstPeriod?.enabled ?? false;

		const { doc: blocksRelaxedDoc, relaxedSpecIds } = relaxStrictBlocks(doc);
		const hasBlocksToRelax = relaxedSpecIds.length > 0;

		// Helper: build RelaxationInfo from current state.
		function makeInfo(opts: {
			minDaily?: number | null;
			startP1Disabled?: boolean;
		}): RelaxationInfo {
			return {
				blocksRelaxed: hasBlocksToRelax ? relaxedSpecIds : [],
				minDailyReducedTo: opts.minDaily ?? null,
				startInP1Disabled: !!opts.startP1Disabled
			};
		}

		// Helper: human-readable summary for the message field.
		function summarize(info: RelaxationInfo): string {
			const parts: string[] = [];
			if (info.blocksRelaxed.length > 0) {
				const names = info.blocksRelaxed
					.map(id => {
						const s = doc.specs.find(x => x.id === id);
						return s ? `${s.subject}` : id;
					})
					.slice(0, 5)
					.join(', ');
				const more = info.blocksRelaxed.length > 5 ? ` und ${info.blocksRelaxed.length - 5} weitere` : '';
				parts.push(`Block-Pattern für ${names}${more} auf Auto gelockert`);
			}
			if (info.minDailyReducedTo !== null) {
				parts.push(
					info.minDailyReducedTo === 0
						? 'Mindest-Tagespensum deaktiviert'
						: `Mindest-Tagespensum auf ${info.minDailyReducedTo} reduziert`
				);
			}
			if (info.startInP1Disabled) {
				parts.push('„Beginn in P1"-Regel deaktiviert');
			}
			return parts.length > 0
				? `Lockerungen aktiv: ${parts.join('; ')}.`
				: '';
		}

		// Round 2 — relax strict blocks (only if there's actually something to relax).
		if (hasBlocksToRelax) {
			opts.onProgress?.('Lockere Block-Pattern und versuche es nochmal…');
			const enc2 = encode(blocksRelaxedDoc);
			const r2 = await runSolver(enc2, timeoutMs, opts.onProgress);
			if (r2.status === 'SAT') {
				const info = makeInfo({});
				return {
					...r2,
					relaxation: info,
					relaxedSpecIds: info.blocksRelaxed,
					message: summarize(info)
				};
			}
		}

		const baseDoc = hasBlocksToRelax ? blocksRelaxedDoc : doc;

		// Round 3 — reduce min_daily_slots to 3 (if it was higher).
		if (originalMinDaily > 3) {
			opts.onProgress?.('Lockere Mindest-Tagespensum auf 3…');
			const docR3 = relaxMinDailySlots(baseDoc, 3);
			const enc3 = encode(docR3);
			const r3 = await runSolver(enc3, timeoutMs, opts.onProgress);
			if (r3.status === 'SAT') {
				const info = makeInfo({ minDaily: 3 });
				return {
					...r3,
					relaxation: info,
					relaxedSpecIds: info.blocksRelaxed,
					message: summarize(info)
				};
			}
		}

		// Round 4 — disable min_daily entirely (if it was active at all).
		if (originalMinDaily > 0) {
			opts.onProgress?.('Deaktiviere Mindest-Tagespensum komplett…');
			const docR4 = relaxMinDailySlots(baseDoc, 0);
			const enc4 = encode(docR4);
			const r4 = await runSolver(enc4, timeoutMs, opts.onProgress);
			if (r4.status === 'SAT') {
				const info = makeInfo({ minDaily: 0 });
				return {
					...r4,
					relaxation: info,
					relaxedSpecIds: info.blocksRelaxed,
					message: summarize(info)
				};
			}
		}

		// Round 5 — also disable mustStartFirstPeriod (Phase 10 last-resort).
		if (originalMustStartP1) {
			opts.onProgress?.('Deaktiviere „Beginn in P1"-Regel…');
			const docR5 = disableStartInP1(relaxMinDailySlots(baseDoc, 0));
			const enc5 = encode(docR5);
			const r5 = await runSolver(enc5, timeoutMs, opts.onProgress);
			if (r5.status === 'SAT') {
				const info = makeInfo({
					minDaily: originalMinDaily > 0 ? 0 : null,
					startP1Disabled: true
				});
				return {
					...r5,
					relaxation: info,
					relaxedSpecIds: info.blocksRelaxed,
					message: summarize(info)
				};
			}
		}

		// Still UNSAT after all rounds → give the user a concrete hint.
		const hints = diagnose(doc);
		const top = bestHint(hints);
		const detail = top
			? `\n\nWahrscheinlichste Ursache: ${top.message}`
			: '\n\nTipp: Constraints im Tab „Regeln" lockern, Pinnings entfernen, oder Lehrer-Verfügbarkeit erweitern.';
		return {
			status: 'UNSAT',
			placed: [],
			unplaced: enc.instances.map(i => i.specId),
			message: `Es gibt keinen Plan, der alle harten Regeln erfüllt.${detail}`
		};
	}

	// ERROR / TIMEOUT → return as-is
	return r1;
}

// ===================== Phase 10: streaming runner =====================

interface StreamHandle {
	cancel(): void;
	finished: Promise<SolverOutput>;
}

/**
 * Runs MiniZinc in streaming mode: every intermediate solution that the
 * solver finds is decoded and forwarded via `onSolution`. Returns a handle
 * with a `cancel()` method that aborts the underlying solver job.
 *
 * @param enc           Pre-encoded solver input
 * @param timeoutMs     Solver time limit (also passed to MiniZinc)
 * @param mode          'satisfy' = first feasible solution, 'optimize' = anytime minimize
 * @param onSolution    Called for each better solution (anytime)
 * @param tStartMs      Wall-clock start time for tElapsedMs reporting
 * @param phaseTag      Tag used in the SolveSolutionEvent
 */
function runSolverStreaming(
	enc: SolverInput,
	timeoutMs: number,
	mode: 'satisfy' | 'optimize',
	onSolution: (s: SolveSolutionEvent) => void,
	tStartMs: number,
	phaseTag: SolvePhase,
	onLog?: (log: SolveLogEvent) => void
): StreamHandle {
	const dzn = (enc.dataJson as any).__dzn as string;

	// Mutable state shared between the cancel() method and the async job.
	const state: { job: { cancel?(): void } | null; cancelled: boolean } = {
		job: null,
		cancelled: false
	};

	function log(level: SolveLogEvent['level'], message: string, data?: Record<string, unknown>): void {
		onLog?.({ tElapsedMs: Date.now() - tStartMs, level, message, data });
	}

	const finished = (async (): Promise<SolverOutput> => {
		try {
			await ensureInit();
			const model = new MiniZinc.Model();
			model.addString(modelMzn);
			model.addDznString(dzn);

			const solverOpts: Record<string, unknown> = {
				solver: 'gecode',
				'time-limit': timeoutMs,
				statistics: true,
				'output-time': true
			};
			// In optimize mode, ask the solver to emit each better solution.
			if (mode === 'optimize') {
				solverOpts['all-solutions'] = true;
			}
			log('phase', `Solver-Lauf startet (${mode}, Time-Limit ${Math.round(timeoutMs / 1000)} s)`);

			const job = model.solve({ options: solverOpts });
			state.job = job as unknown as { cancel?(): void };

			let lastSolutionOutput: string | null = null;
			let solutionCount = 0;
			let lastStats: Record<string, unknown> = {};

			(job as any).on?.('solution', (sol: any) => {
				const out = sol.output?.json ?? sol.output?.default ?? sol;
				const raw = typeof out === 'string' ? out : JSON.stringify(out);
				lastSolutionOutput = raw;
				try {
					const decoded = decode(raw, enc.instances);
					if (decoded.status === 'SAT') {
						solutionCount++;
						onSolution({
							placed: decoded.placed,
							score: decoded.penalties?.total ?? null,
							tElapsedMs: Date.now() - tStartMs,
							phase: phaseTag
						});
						log('info', `Lösung ${solutionCount} gefunden${decoded.penalties ? ` (Score ${decoded.penalties.total})` : ''}`);
					}
				} catch {
					// ignore parse errors on intermediate solutions
				}
			});

			(job as any).on?.('statistics', (s: any) => {
				if (s?.statistics) {
					lastStats = { ...lastStats, ...s.statistics };
				}
			});

			(job as any).on?.('status', (s: any) => {
				log('phase', `Solver-Status: ${s?.status ?? 'unknown'}`);
			});

			(job as any).on?.('warning', (w: any) => {
				const msg = w?.message ?? w?.what ?? JSON.stringify(w);
				log('warn', `MiniZinc-Warnung: ${msg}`);
			});

			(job as any).on?.('error', (e: any) => {
				const msg = e?.message ?? e?.what ?? JSON.stringify(e);
				log('error', `MiniZinc-Fehler: ${msg}`);
			});

			(job as any).on?.('trace', (t: any) => {
				if (t?.message) log('info', `Trace: ${t.message}`);
			});

			const result = await job;
			const status = String(result.status ?? 'UNKNOWN');

			// Compact key statistics for the user-facing log.
			const interestingKeys = ['failures', 'propagations', 'nodes', 'peakDepth', 'solveTime', 'flatTime', 'objective', 'restarts'];
			const compact: Record<string, unknown> = {};
			for (const k of interestingKeys) {
				if (lastStats[k] !== undefined) compact[k] = lastStats[k];
			}
			log('stat', `Lauf beendet (${status}, ${solutionCount} Lösungen)`, compact);

			if (status === 'UNSATISFIABLE') {
				return { status: 'UNSAT', placed: [], unplaced: enc.instances.map(i => i.specId) };
			}

			const rawOutput =
				lastSolutionOutput ??
				(result.solution
					? JSON.stringify((result.solution as any).output ?? result.solution)
					: null);

			return decode(rawOutput, enc.instances);
		} catch (e) {
			const msg = e instanceof Error ? e.message
				: (typeof e === 'object' && e !== null) ? JSON.stringify(e)
				: String(e);
			if (state.cancelled) {
				log('phase', 'Lauf abgebrochen');
			} else {
				log('error', `Solver-Exception: ${msg}`);
			}
			return {
				status: state.cancelled ? 'TIMEOUT' : 'ERROR',
				placed: [],
				unplaced: enc.instances.map(i => i.specId),
				message: state.cancelled ? 'Vom Benutzer abgebrochen.' : msg
			};
		}
	})();

	return {
		finished,
		cancel(): void {
			state.cancelled = true;
			try { state.job?.cancel?.(); } catch { /* ignore */ }
		}
	};
}

/**
 * Phase 10 streaming entry point. Runs Phase A (satisfy) then Phase B
 * (optimize anytime), emits events for every better solution. The caller
 * can `abort()` mid-flight; the best known solution stays available.
 *
 * Usage:
 * ```ts
 * const session = startSolve(doc, { optimizeTimeoutMs: 60_000 });
 * session.on('solution', s => updateGrid(s.placed));
 * session.on('done', d => showFinal(d.final));
 * ```
 */
export function startSolve(doc: ScheduleDoc, opts: StartSolveOptions = {}): SolveSession {
	const emitter = new Emitter();
	const tStart = Date.now();
	const satisfyMs = opts.satisfyTimeoutMs ?? 15_000;
	const optimizeMs = opts.optimizeTimeoutMs ?? 60_000;
	const relaxMs = opts.relaxTimeoutMs ?? 30_000;

	let aborted = false;
	let activeStream: StreamHandle | null = null;
	let bestSolution: SolveSolutionEvent | null = null;
	let lastDzn: string = '';

	function emit<K extends keyof EventMap>(event: K, e: EventMap[K]): void {
		emitter.emit(event, e);
	}

	function emitLog(level: SolveLogEvent['level'], message: string, data?: Record<string, unknown>): void {
		emit('log', { tElapsedMs: Date.now() - tStart, level, message, data });
	}

	function trackSolution(s: SolveSolutionEvent): void {
		if (bestSolution === null
			|| s.score === null
			|| (bestSolution.score !== null && s.score < bestSolution.score)) {
			bestSolution = s;
		}
		emit('solution', s);
	}

	const session: SolveSession = {
		abort(): void {
			aborted = true;
			emitLog('phase', 'Benutzer hat abgebrochen');
			activeStream?.cancel();
		},
		on<K extends keyof EventMap>(event: K, cb: (e: EventMap[K]) => void): () => void {
			return emitter.on(event as string, cb as (e: unknown) => void);
		},
		getDzn(): string {
			return lastDzn;
		}
	};

	// Defer the actual work via queueMicrotask so the caller has a chance
	// to register listeners (`session.on(...)`) before any event fires.
	queueMicrotask(() => { void runSession(); });

	async function runSession(): Promise<void> {
		try {
			// Pre-flight: same as the legacy solve(). If a fatal hint is found,
			// emit error+done and stop.
			emitLog('phase', 'Session startet — encode + pre-flight');
			const enc = encode(doc);
			lastDzn = (enc.dataJson as any).__dzn as string;
			emitLog('info', `Modell: L=${enc.L} Lessons, T=${enc.T} Lehrer, S=${enc.S} Fächer, NSLOTS=${enc.D * enc.P * enc.G}`);

			if (enc.L === 0) {
				emitLog('error', 'Keine Lehreinheiten vorhanden — Abbruch.');
				emit('done', {
					final: {
						status: 'ERROR',
						placed: [],
						unplaced: [],
						message: 'Keine Lehreinheiten vorhanden — nichts zu generieren.'
					},
					totalElapsedMs: Date.now() - tStart
				});
				return;
			}

			const allHints = diagnose(doc);
			for (const h of allHints) {
				emitLog(h.severity === 'error' ? 'error' : 'warn', `Diagnose: ${h.message}`);
			}
			const fatal = allHints.find(h => h.severity === 'error');
			if (fatal) {
				emit('done', {
					final: {
						status: 'ERROR',
						placed: [],
						unplaced: enc.instances.map(i => i.specId),
						message: `Konfiguration nicht lösbar:\n\n${fatal.message}`
					},
					totalElapsedMs: Date.now() - tStart
				});
				return;
			}

			// ----- Phase A: SATISFY -----
			emit('phase', 'satisfy');
			emitLog('phase', 'Phase A: Erste valide Lösung suchen');
			emit('progress', {
				phase: 'satisfy',
				phaseLabel: 'Phase 1/2: Erste valide Lösung suchen',
				tElapsedMs: 0,
				tLimitMs: satisfyMs,
				phaseIndex: 1,
				phaseCount: 2
			});

			const streamA = runSolverStreaming(
				enc,
				satisfyMs,
				'satisfy',
				trackSolution,
				tStart,
				'satisfy',
				ev => emit('log', ev)
			);
			activeStream = streamA;
			let resA = await streamA.finished;
			activeStream = null;
			emitLog('info', `Phase A abgeschlossen: ${resA.status}`);
			if (aborted) {
				emit('done', { final: finalFromBest(bestSolution, resA, enc), totalElapsedMs: Date.now() - tStart });
				return;
			}

			// If Phase A is UNSAT, walk the relaxation chain.
			if (resA.status === 'UNSAT') {
				emitLog('phase', 'Phase A UNSAT — starte Lockerungs-Kette');
				const relaxResult = await relaxationChain(
					doc, relaxMs, emit, () => aborted,
					() => activeStream, h => { activeStream = h; },
					trackSolution, tStart, emitLog
				);
				if (aborted) {
					emit('done', { final: finalFromBest(bestSolution, relaxResult, enc), totalElapsedMs: Date.now() - tStart });
					return;
				}
				if (relaxResult.status !== 'SAT') {
					emit('done', { final: relaxResult, totalElapsedMs: Date.now() - tStart });
					return;
				}
				if (relaxResult.relaxation) emit('relaxation', relaxResult.relaxation);
				resA = relaxResult;
			}

			if (resA.status !== 'SAT') {
				emit('done', { final: resA, totalElapsedMs: Date.now() - tStart });
				return;
			}

			// ----- Phase B: OPTIMIZE (anytime) -----
			emit('phase', 'optimize');
			emitLog('phase', 'Phase B: Optimieren (anytime)');
			const tBStart = Date.now() - tStart;
			emit('progress', {
				phase: 'optimize',
				phaseLabel: 'Phase 2/2: Optimieren',
				tElapsedMs: tBStart,
				tLimitMs: optimizeMs,
				phaseIndex: 2,
				phaseCount: 2
			});

			const streamB = runSolverStreaming(
				enc,
				optimizeMs,
				'optimize',
				trackSolution,
				tStart,
				'optimize',
				ev => emit('log', ev)
			);
			activeStream = streamB;
			const resB = await streamB.finished;
			activeStream = null;
			emitLog('info', `Phase B abgeschlossen: ${resB.status}`);

			// Final = either the optimize result, or — if the user aborted — the
			// best solution we tracked so far via streaming events.
			const final = aborted
				? finalFromBest(bestSolution, resA, enc)
				: (resB.status === 'SAT' ? resB : (resA as SolverOutput));

			emit('done', { final, totalElapsedMs: Date.now() - tStart });
		} catch (e) {
			emit('error', e instanceof Error ? e : new Error(String(e)));
			emit('done', {
				final: {
					status: 'ERROR',
					placed: [],
					unplaced: [],
					message: e instanceof Error ? e.message : String(e)
				},
				totalElapsedMs: Date.now() - tStart
			});
		}
	}

	return session;
}

/** Build a final SolverOutput from the best streamed solution if available;
 *  fall back to the given baseline. Used on abort. */
function finalFromBest(
	best: SolveSolutionEvent | null,
	fallback: SolverOutput,
	enc: SolverInput
): SolverOutput {
	if (!best) return fallback;
	return {
		status: 'SAT',
		placed: best.placed,
		unplaced: enc.instances
			.map(i => i.specId)
			.filter(id => !best.placed.some(p => p.specId === id)),
		penalties: best.score !== null ? {
			main_aft: 0, any_aft: 0, main_early: 0, main_run: 0,
			no_free: 0, compact: 0, total: best.score
		} : undefined,
		message: `Vom Benutzer abgebrochen — beste bisher gefundene Lösung übernommen (Score ${best.score ?? '?'}).`
	};
}

/** The relaxation chain from `solve()` extracted into a streaming-friendly
 *  variant so the SolveSession can use it too. Returns the SolverOutput of
 *  the first round that became SAT (or the final UNSAT). */
async function relaxationChain(
	doc: ScheduleDoc,
	timeoutMs: number,
	emit: <K extends keyof EventMap>(e: K, v: EventMap[K]) => void,
	isAborted: () => boolean,
	getStream: () => StreamHandle | null,
	setStream: (h: StreamHandle | null) => void,
	onSolution: (s: SolveSolutionEvent) => void,
	tStart: number,
	emitLog: (level: SolveLogEvent['level'], message: string, data?: Record<string, unknown>) => void
): Promise<SolverOutput> {
	void getStream; // unused; setStream is enough for cancel propagation
	const originalMinDaily = doc.constraints?.minDailySlotsPerGrade ?? 0;
	const originalMustStartP1 = doc.constraints?.mustStartFirstPeriod?.enabled ?? false;
	const { doc: blocksRelaxedDoc, relaxedSpecIds } = relaxStrictBlocks(doc);
	const hasBlocks = relaxedSpecIds.length > 0;

	function info(o: { minDaily?: number | null; startP1?: boolean }): RelaxationInfo {
		return {
			blocksRelaxed: hasBlocks ? relaxedSpecIds : [],
			minDailyReducedTo: o.minDaily ?? null,
			startInP1Disabled: !!o.startP1
		};
	}

	async function tryRound(d: ScheduleDoc, label: string, mkInfo: () => RelaxationInfo): Promise<SolverOutput | null> {
		emit('phase', 'relax');
		emit('progress', {
			phase: 'relax',
			phaseLabel: label,
			tElapsedMs: Date.now() - tStart,
			tLimitMs: timeoutMs,
			phaseIndex: 1,
			phaseCount: 2
		});
		emitLog('phase', `Lockerungs-Stufe: ${label}`);
		const enc = encode(d);
		const stream = runSolverStreaming(
			enc, timeoutMs, 'satisfy', onSolution, tStart, 'relax',
			ev => emit('log', ev)
		);
		setStream(stream);
		const r = await stream.finished;
		setStream(null);
		emitLog('info', `Lockerungs-Lauf Ergebnis: ${r.status}`);
		if (isAborted()) return r;
		if (r.status === 'SAT') {
			const inf = mkInfo();
			return { ...r, relaxation: inf, relaxedSpecIds: inf.blocksRelaxed };
		}
		return null;
	}

	if (hasBlocks) {
		const r = await tryRound(blocksRelaxedDoc, `Lockere Block-Pattern (${relaxedSpecIds.length} Specs auf Auto)`, () => info({}));
		if (r) return r;
		if (isAborted()) return { status: 'TIMEOUT', placed: [], unplaced: [], message: 'Abgebrochen' };
	} else {
		emitLog('info', 'Keine strikten Block-Pattern vorhanden — Stufe übersprungen');
	}
	const base = hasBlocks ? blocksRelaxedDoc : doc;
	if (originalMinDaily > 3) {
		const r = await tryRound(relaxMinDailySlots(base, 3), 'Mindest-Tagespensum 4 → 3', () => info({ minDaily: 3 }));
		if (r) return r;
		if (isAborted()) return { status: 'TIMEOUT', placed: [], unplaced: [], message: 'Abgebrochen' };
	}
	if (originalMinDaily > 0) {
		const r = await tryRound(relaxMinDailySlots(base, 0), 'Mindest-Tagespensum deaktivieren', () => info({ minDaily: 0 }));
		if (r) return r;
		if (isAborted()) return { status: 'TIMEOUT', placed: [], unplaced: [], message: 'Abgebrochen' };
	}
	if (originalMustStartP1) {
		const r = await tryRound(disableStartInP1(relaxMinDailySlots(base, 0)), '„Beginn in P1"-Regel deaktivieren', () => info({ minDaily: originalMinDaily > 0 ? 0 : null, startP1: true }));
		if (r) return r;
	}

	const hints = diagnose(doc);
	const top = bestHint(hints);
	const detail = top ? `\n\nWahrscheinlichste Ursache: ${top.message}` : '';
	emitLog('error', 'Alle Lockerungs-Stufen erschöpft — UNSAT bleibt');
	return {
		status: 'UNSAT',
		placed: [],
		unplaced: doc.specs.map(s => s.id),
		message: `Es gibt keinen Plan, der alle harten Regeln erfüllt.${detail}`
	};
}
