// Solver v2 — Worker-Bridge (R2 Schritt 5+6).
//
// `startSolveSession(doc, opts)` ist der Einstiegspunkt für die UI:
// gleiche SolveSession-API wie startSolve, aber der Solver läuft in
// Web Workern — der UI-Thread bleibt komplett frei (kein Jank durch die
// 250-ms-Compute-Chunks, kein Konkurrieren mit Svelte-Updates/Ticker).
//
// Schritt 6 — Parallel-Pool: die Pool-Phase ist embarrassingly parallel.
// Bei poolBudgetMs > 0 (und ohne Hot-Start/Diversify) fahren
// k = min(4, hardwareConcurrency - 2) Pool-Worker GLEICHZEITIG
// Constructions mit verschiedenen Seeds; die Bridge sammelt das global
// beste Ergebnis (weniger unplaced, dann Score — identisches Kriterium
// wie die Session-interne Pool-Phase) und startet damit die Haupt-Session
// als Hot-Start. Auf einem 8-Kern-Rechner probiert der Pool damit ~4×
// so viele Startlösungen im selben Budget.
//
// Fallback-Kaskade: ohne Worker-Support (jsdom/Tests) läuft startSolve
// inline; mit nur 1 nutzbarem Kern läuft der Pool wie bisher IN der
// Session (Single-Worker).
//
// Abort-Kette: postMessage('abort') → Worker setzt Session-Flag → greift
// beim nächsten Chunk. Antwortet der Worker nicht binnen 3 s, wird er hart
// terminiert und ein künstliches done mit der letzten bekannten Lösung
// emittiert — die UI wartet nie ewig.

import type { PlacedLesson, ScheduleDoc } from '../types';
import { diagnose } from './diagnose';
import {
	startSolve,
	type RelaxationInfo,
	type SolveDoneEvent,
	type SolveLogEvent,
	type SolvePhase,
	type SolveProgressEvent,
	type SolveSession,
	type SolveSolutionEvent,
	type StartSolveOptions,
} from './index';

/** Beste Lösung eines Pool-Workers. */
export interface PoolBestPayload {
	placed: PlacedLesson[];
	score: number;
	unplacedCount: number;
	attempts: number;
}

/** Nachricht Bridge → Worker. */
export type WorkerInMsg =
	| { type: 'start'; doc: ScheduleDoc; opts: StartSolveOptions }
	| { type: 'pool'; doc: ScheduleDoc; budgetMs: number; seed: number }
	| { type: 'abort' };

/** Nachricht Worker → Bridge. */
export type WorkerOutMsg =
	| { kind: 'phase'; payload: SolvePhase }
	| { kind: 'progress'; payload: SolveProgressEvent }
	| { kind: 'solution'; payload: SolveSolutionEvent }
	| { kind: 'relaxation'; payload: RelaxationInfo }
	| { kind: 'log'; payload: SolveLogEvent }
	| { kind: 'error'; message: string }
	| { kind: 'done'; payload: SolveDoneEvent; dzn: string }
	| { kind: 'poolBest'; payload: PoolBestPayload }
	| { kind: 'poolDone'; payload: { attempts: number; best: PoolBestPayload | null } };

/** Wartezeit nach abort, bevor der Worker hart terminiert wird. */
const ABORT_TERMINATE_MS = 3_000;

/**
 * Startet eine Solve-Session — in Web Workern wenn verfügbar, sonst inline.
 * Drop-in-Ersatz für startSolve; die UI merkt keinen API-Unterschied.
 *
 * WICHTIG (Serialisierung): `doc` muss ein PLAIN Object sein — im
 * Svelte-Kontext also `$state.snapshot(store.doc)`, nie der reaktive Proxy.
 */
export function startSolveSession(doc: ScheduleDoc, opts: StartSolveOptions = {}): SolveSession {
	if (typeof Worker === 'undefined') {
		return startSolve(doc, opts);
	}
	const wantsPool = (opts.poolBudgetMs ?? 0) > 0 && opts.hotStart !== true && !opts.diversify;
	const k = parallelPoolSize();
	if (wantsPool && k >= 2) {
		return startParallelPoolSession(doc, opts, k);
	}
	return startSolveInWorker(doc, opts);
}

/** Parallel-Pool-Breite: min(4, Kerne - 2), mindestens 1. */
function parallelPoolSize(): number {
	const hc = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
		? navigator.hardwareConcurrency
		: 4;
	return Math.max(1, Math.min(4, hc - 2));
}

// ----- Gemeinsame Session-Infrastruktur --------------------------------------

interface BridgeEmitter {
	emit(event: string, e: unknown): void;
	on(event: string, cb: (e: unknown) => void): () => void;
}

function makeEmitter(): BridgeEmitter {
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	return {
		emit(event, e): void {
			const set = listeners.get(event);
			if (!set) return;
			for (const cb of set) {
				try { cb(e); } catch (err) { console.warn('SolveSession listener threw', err); }
			}
		},
		on(event, cb): () => void {
			let set = listeners.get(event);
			if (!set) { set = new Set(); listeners.set(event, set); }
			set.add(cb);
			return () => { set!.delete(cb); };
		},
	};
}

function newWorker(): Worker {
	return new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
}

// ----- Single-Worker-Session (Schritt 5) -------------------------------------

function startSolveInWorker(doc: ScheduleDoc, opts: StartSolveOptions): SolveSession {
	const worker = newWorker();
	const emitter = makeEmitter();
	const tStart = Date.now();
	let done = false;
	let lastDzn = '';
	let lastPlaced: PlacedLesson[] = [];
	let lastScore: number | null = null;
	let abortTimer: ReturnType<typeof setTimeout> | null = null;

	function finish(doneEvent: SolveDoneEvent): void {
		if (done) return;
		done = true;
		if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
		emitter.emit('done', doneEvent);
		// Session ist einmalig — Worker-Ressourcen sofort freigeben.
		worker.terminate();
	}

	worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
		const m = e.data;
		switch (m.kind) {
			case 'solution':
				// Letzte Lösung merken — für das künstliche done beim
				// Terminate-Fallback (best-so-far geht nie verloren).
				lastPlaced = m.payload.placed;
				lastScore = m.payload.score;
				emitter.emit('solution', m.payload);
				break;
			case 'done':
				lastDzn = m.dzn;
				finish(m.payload);
				break;
			case 'error':
				emitter.emit('error', new Error(m.message));
				break;
			default:
				emitter.emit(m.kind, (m as { payload: unknown }).payload);
		}
	};
	worker.onerror = (ev: ErrorEvent) => {
		// Lade-/Laufzeitfehler des Workers selbst (nicht der Session — deren
		// Fehler kommen als done mit status ERROR). UI-Promise muss auflösen.
		emitter.emit('error', new Error(ev.message || 'Solver-Worker-Fehler'));
		finish({
			final: {
				status: 'ERROR',
				placed: [],
				unplaced: [],
				message: `Solver-Worker-Fehler: ${ev.message || 'unbekannt'}`,
			},
			totalElapsedMs: Date.now() - tStart,
		});
	};

	worker.postMessage({ type: 'start', doc, opts } satisfies WorkerInMsg);

	return {
		abort(): void {
			if (done) return;
			worker.postMessage({ type: 'abort' } satisfies WorkerInMsg);
			if (abortTimer === null) {
				abortTimer = setTimeout(() => {
					finish({
						final: {
							status: 'TIMEOUT',
							placed: lastPlaced,
							unplaced: [],
							message: lastScore !== null
								? `Abbruch erzwungen — letzte bekannte Lösung übernommen (Score ${lastScore}).`
								: 'Abbruch erzwungen — Solver-Worker reagierte nicht.',
						},
						totalElapsedMs: Date.now() - tStart,
					});
				}, ABORT_TERMINATE_MS);
			}
		},
		on(event, cb): () => void {
			return emitter.on(event as string, cb as (e: unknown) => void);
		},
		// Der DZN-Snapshot kommt huckepack mit dem done-Event — während der
		// Worker läuft, liefert getDzn() einen leeren String (getDzn ist
		// synchron, ein Message-Roundtrip ist nicht möglich). Der UI-Button
		// nutzt das nur nach Session-Ende bzw. fällt auf lastDzn zurück.
		getDzn(): string {
			return lastDzn;
		},
	};
}

// ----- Parallel-Pool-Session (Schritt 6) -------------------------------------

function startParallelPoolSession(doc: ScheduleDoc, opts: StartSolveOptions, k: number): SolveSession {
	// Fatale Konfigurationen VOR dem Pool abfangen — sonst verbrennen k
	// Worker das Pool-Budget an einem Problem, das die Haupt-Session sofort
	// mit ERROR beantworten würde. Die Single-Worker-Session macht die
	// Diagnose + saubere Fehlermeldung selbst.
	const fatal = diagnose(doc).find(h => h.severity === 'error');
	if (fatal) {
		return startSolveInWorker(doc, opts);
	}

	const emitter = makeEmitter();
	const tStart = Date.now();
	const poolBudget = opts.poolBudgetMs ?? 0;
	const totalBudget = opts.totalBudgetMs ?? 60_000;
	const baseSeed = opts.seed ?? (Date.now() & 0x7fffffff);

	let aborted = false;
	let done = false;
	let inner: SolveSession | null = null;
	const poolWorkers: Worker[] = [];
	let poolDoneCount = 0;
	let totalAttempts = 0;
	let globalBest: PoolBestPayload | null = null;

	function emitLog(level: SolveLogEvent['level'], message: string): void {
		emitter.emit('log', { tElapsedMs: Date.now() - tStart, level, message } satisfies SolveLogEvent);
	}
	function terminatePool(): void {
		for (const w of poolWorkers) w.terminate();
		poolWorkers.length = 0;
	}
	function finish(doneEvent: SolveDoneEvent): void {
		if (done) return;
		done = true;
		terminatePool();
		emitter.emit('done', doneEvent);
	}

	// UI-Verdrahtung wie die Session-interne Pool-Phase: phase 'satisfy',
	// progress mit Pool-Label, stat-Logs im Format das GenerateButton parst
	// („Pool: neuer Best #N, Score X" / „Pool abgeschlossen: N Versuche").
	queueMicrotask(() => {
		if (done) return;
		emitter.emit('phase', 'satisfy' satisfies SolvePhase);
		emitter.emit('progress', {
			phase: 'satisfy',
			phaseLabel: `Phase 1/2: Pool-Suche (${Math.round(poolBudget / 1000)}s, ${k} Worker parallel)`,
			tElapsedMs: 0,
			tLimitMs: poolBudget,
			phaseIndex: 1,
			phaseCount: 2,
		} satisfies SolveProgressEvent);
		emitLog('phase', `Phase 1: Parallel-Pool über ${k} Worker (${Math.round(poolBudget / 1000)}s Budget)`);
	});

	function startMainSession(): void {
		if (done || aborted) return;
		const poolElapsed = Date.now() - tStart;
		emitLog('phase', `Pool abgeschlossen: ${totalAttempts} Versuche, bester Score ${globalBest ? Math.round(globalBest.score) : '–'}`);
		// Beste Pool-Lösung als Hot-Start-Basis. Ohne Pool-Ergebnis (z. B.
		// alle Worker gescheitert) läuft die Session mit normaler
		// Einzel-Construction weiter — Resilienz vor Eleganz.
		const docForMain: ScheduleDoc = globalBest
			? { ...doc, placed: globalBest.placed }
			: doc;
		inner = startSolveInWorker(docForMain, {
			...opts,
			poolBudgetMs: 0,
			hotStart: globalBest !== null,
			// Pool-Zeit zählt gegen das Gesamtbudget — wie in der
			// Session-internen Pool-Phase (Autopilot verlässt sich darauf).
			totalBudgetMs: Math.max(1_000, totalBudget - poolElapsed),
		});
		for (const ev of ['phase', 'progress', 'solution', 'relaxation', 'log', 'error'] as const) {
			inner.on(ev as never, ((e: unknown) => emitter.emit(ev, e)) as never);
		}
		inner.on('done', d => finish(d));
		if (aborted) inner.abort();
	}

	for (let i = 0; i < k; i++) {
		const w = newWorker();
		poolWorkers.push(w);
		w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
			// Nach finish() (Abort während des Pools) keine Events mehr
			// spiegeln — ein spätes poolBest würde sonst ein 'solution'
			// NACH dem done-Event emittieren (Guard wie in startMainSession).
			if (done) return;
			const m = e.data;
			if (m.kind === 'poolBest') {
				const cand = m.payload;
				const better = globalBest === null
					|| cand.unplacedCount < globalBest.unplacedCount
					|| (cand.unplacedCount === globalBest.unplacedCount && cand.score < globalBest.score);
				if (better) {
					globalBest = cand;
					emitter.emit('solution', {
						placed: cand.placed,
						score: cand.score,
						tElapsedMs: Date.now() - tStart,
						phase: 'satisfy',
					} satisfies SolveSolutionEvent);
					emitLog('stat', `Pool: neuer Best #${totalAttempts + cand.attempts}, Score ${Math.round(cand.score)}, ${cand.unplacedCount} unplaced (Worker ${i + 1})`);
				}
			} else if (m.kind === 'poolDone') {
				totalAttempts += m.payload.attempts;
				poolDoneCount++;
				if (poolDoneCount === k) {
					terminatePool();
					startMainSession();
				}
			}
		};
		w.onerror = () => {
			// Ein gescheiterter Pool-Worker bricht den Pool nicht ab — die
			// übrigen liefern weiter; zur Not startet die Haupt-Session ohne
			// Pool-Ergebnis.
			poolDoneCount++;
			if (poolDoneCount === k && !done) {
				terminatePool();
				startMainSession();
			}
		};
		w.postMessage({
			type: 'pool',
			doc,
			budgetMs: poolBudget,
			seed: ((baseSeed ^ (i * 0x9e3779b1)) & 0x7fffffff) || 1,
		} satisfies WorkerInMsg);
	}

	return {
		abort(): void {
			if (done) return;
			aborted = true;
			if (inner) {
				inner.abort();
				return;
			}
			// Abort während der Pool-Phase: Worker stoppen, beste bisherige
			// Pool-Lösung übernehmen (Spiegel des Session-internen Verhaltens).
			emitLog('phase', 'Benutzer hat abgebrochen');
			finish({
				final: {
					status: 'TIMEOUT',
					placed: globalBest?.placed ?? [],
					unplaced: [],
					message: globalBest
						? `Vom Benutzer abgebrochen — beste Pool-Lösung übernommen (Score ${Math.round(globalBest.score)}).`
						: 'Vom Benutzer abgebrochen — noch keine Lösung gefunden.',
				},
				totalElapsedMs: Date.now() - tStart,
			});
		},
		on(event, cb): () => void {
			return emitter.on(event as string, cb as (e: unknown) => void);
		},
		getDzn(): string {
			return inner?.getDzn() ?? '';
		},
	};
}
