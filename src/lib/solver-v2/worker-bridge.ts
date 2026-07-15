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
// wie die Session-interne Pool-Phase).
//
// R3 Schritt 2 — Island-ILS („mehrere Pläne, bester gewinnt", Untis-
// Prinzip): Nach dem Pool startet NICHT mehr eine einzelne Haupt-Session,
// sondern k unabhängige Optimierungs-Inseln — jede fährt die komplette
// ILS mit eigenem Seed vom selben Pool-Best als Hot-Start. Die Bridge
// spiegelt live nur echte Verbesserungen über alle Inseln (solution),
// UI-Rauschen (phase/progress/log) kommt von Insel 1. Am Ende gewinnt
// die beste Insel: weniger unplatzierte Stunden, dann weniger
// Klassen-Lücken (Roh-Zähler, frame-unabhängig — Auto-Relax misst den
// Total im relaxed-Frame!), dann niedrigerer Total.
//
// Audit D-3 (2026-07) — Parallel-Diversify: Diversify lief bisher auf
// EINEM Worker, während 3-4 Kerne brachlagen. Der D-2-Bench hat gemessen,
// dass EIN 10s-Zyklus im Median NICHTS findet (Revert), best-of-3 von
// derselben Basis aber Median -530 bringt (docs/bench-baseline.json,
// d2-diversify-baseline). Deshalb fahren jetzt k Diversify-Versuche mit
// abgeleiteten Seeds GLEICHZEITIG auf demselben Plan; der beste gewinnt
// (gleiche Rangfolge wie die Inseln). Jeder Versuch hat seinen eigenen
// Revert-Guard — das Gesamtergebnis kann nie schlechter als der
// Ausgangsplan sein.
//
// Fallback-Kaskade: ohne Worker-Support (jsdom/Tests) läuft startSolve
// inline; mit nur 1 nutzbarem Kern läuft der Pool wie bisher IN der
// Session (Single-Worker) und Diversify als Einzel-Lauf.
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
	// Audit D-3: Diversify parallel — k Versuche, der beste gewinnt.
	if (opts.diversify && k >= 2) {
		return startParallelDiversifySession(doc, opts, k);
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

/**
 * R3-S2: Rangfolge eines Endergebnisses — weniger unplatzierte Stunden,
 * dann weniger Klassen-Lücken (Roh-ZÄHLER, frame-unabhängig: die Auto-
 * Lockerung misst den Total im relaxed-Gewichts-Frame), dann Total.
 * Kleiner = besser. Geteilt von Island- (R3-S2) und Parallel-Diversify-
 * Kürung (D-3).
 */
function islandBeats(a: SolveDoneEvent, b: SolveDoneEvent): boolean {
	const ua = a.final.unplaced?.length ?? 0;
	const ub = b.final.unplaced?.length ?? 0;
	if (ua !== ub) return ua < ub;
	const na = a.final.penalties?.no_free ?? 0;
	const nb = b.final.penalties?.no_free ?? 0;
	if (na !== nb) return na < nb;
	const ta = a.final.penalties?.total ?? Number.POSITIVE_INFINITY;
	const tb = b.final.penalties?.total ?? Number.POSITIVE_INFINITY;
	return ta < tb;
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
	const poolWorkers: Worker[] = [];
	let poolDoneCount = 0;
	let totalAttempts = 0;
	let globalBest: PoolBestPayload | null = null;

	// R3-S2: Island-Phase-Zustand.
	const islandWorkers: Worker[] = [];
	let islandsStarted = false;
	let islandDoneCount = 0;
	let islandFinals: (SolveDoneEvent | null)[] = [];
	let islandDzns: string[] = [];
	let lastDzn = '';
	let abortTimer: ReturnType<typeof setTimeout> | null = null;

	function emitLog(level: SolveLogEvent['level'], message: string): void {
		emitter.emit('log', { tElapsedMs: Date.now() - tStart, level, message } satisfies SolveLogEvent);
	}
	function terminatePool(): void {
		for (const w of poolWorkers) w.terminate();
		poolWorkers.length = 0;
	}
	function terminateIslands(): void {
		for (const w of islandWorkers) w.terminate();
		islandWorkers.length = 0;
	}
	function finish(doneEvent: SolveDoneEvent): void {
		if (done) return;
		done = true;
		if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
		terminatePool();
		terminateIslands();
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

	function finishIslands(): void {
		if (done) return;
		let bestIdx = -1;
		for (let i = 0; i < islandFinals.length; i++) {
			const f = islandFinals[i];
			if (!f) continue;
			if (bestIdx === -1 || islandBeats(f, islandFinals[bestIdx]!)) bestIdx = i;
		}
		if (bestIdx === -1) {
			// Alle Inseln gescheitert — beste Pool-Lösung als Notergebnis
			// (Resilienz vor Eleganz, wie der Pool-Abort-Pfad).
			finish({
				final: {
					status: 'TIMEOUT',
					placed: globalBest?.placed ?? [],
					unplaced: [],
					message: globalBest
						? `Alle ${k} Optimierungs-Inseln gescheitert — beste Pool-Lösung übernommen (Score ${Math.round(globalBest.score)}).`
						: `Alle ${k} Optimierungs-Inseln gescheitert — keine Lösung gefunden.`,
				},
				totalElapsedMs: Date.now() - tStart,
			});
			return;
		}
		const scores = islandFinals
			.map((f, i) => f ? `Insel ${i + 1}: ${Math.round(f.final.penalties?.total ?? 0)}` : `Insel ${i + 1}: ✗`)
			.join(' · ');
		emitLog('stat', `Island-Ergebnis — ${scores} → Insel ${bestIdx + 1} gewinnt`);
		lastDzn = islandDzns[bestIdx];
		const winner = islandFinals[bestIdx]!;
		finish({ final: winner.final, totalElapsedMs: Date.now() - tStart });
	}

	/**
	 * R3-S2: Nach dem Pool starten k unabhängige Optimierungs-Inseln —
	 * jede eine komplette startSolve-Session mit eigenem Seed vom selben
	 * Pool-Best als Hot-Start („mehrere Pläne, bester gewinnt").
	 */
	function startIslandPhase(): void {
		if (done || aborted) return;
		islandsStarted = true;
		const poolElapsed = Date.now() - tStart;
		emitLog('phase', `Pool abgeschlossen: ${totalAttempts} Versuche, bester Score ${globalBest ? Math.round(globalBest.score) : '–'}`);
		// Pool-Zeit zählt gegen das Gesamtbudget — wie in der Session-
		// internen Pool-Phase (Autopilot verlässt sich darauf).
		const islandBudget = Math.max(1_000, totalBudget - poolElapsed);
		// Beste Pool-Lösung als Hot-Start-Basis. Ohne Pool-Ergebnis (z. B.
		// alle Worker gescheitert) constructen die Inseln selbst —
		// Resilienz vor Eleganz.
		const docForMain: ScheduleDoc = globalBest
			? { ...doc, placed: globalBest.placed }
			: doc;
		emitLog('phase', `Phase 2: Island-Optimierung — ${k} unabhängige Läufe parallel (${Math.round(islandBudget / 1000)}s Budget)`);

		islandFinals = new Array(k).fill(null);
		islandDzns = new Array(k).fill('');
		// Live-Best über alle Inseln: nur echte Verbesserungen erreichen das
		// UI (der Score gewichtet unplaced dominant — Vergleich per Total
		// reicht). phase/progress/log/relaxation kommen nur von Insel 1,
		// sonst überschreiben sich die Anzeigen gegenseitig.
		let liveBest = globalBest ? globalBest.score : Number.POSITIVE_INFINITY;
		let leadIsland = -1;

		for (let i = 0; i < k; i++) {
			const w = newWorker();
			islandWorkers.push(w);
			w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
				if (done) return;
				const m = e.data;
				switch (m.kind) {
					case 'solution': {
						const s = m.payload.score;
						if (s !== null && s < liveBest) {
							liveBest = s;
							if (leadIsland !== i) {
								leadIsland = i;
								emitLog('stat', `Insel ${i + 1}/${k} übernimmt die Führung (Score ${Math.round(s)})`);
							}
							emitter.emit('solution', { ...m.payload, tElapsedMs: Date.now() - tStart } satisfies SolveSolutionEvent);
						}
						break;
					}
					case 'phase':
						if (i === 0) emitter.emit('phase', m.payload);
						break;
					case 'progress':
						if (i === 0) emitter.emit('progress', m.payload);
						break;
					case 'log':
						if (i === 0) emitter.emit('log', m.payload);
						break;
					case 'relaxation':
						if (i === 0) emitter.emit('relaxation', m.payload);
						break;
					case 'error':
						if (i === 0) emitter.emit('error', new Error(m.message));
						break;
					case 'done':
						islandDzns[i] = m.dzn;
						islandFinals[i] = m.payload;
						islandDoneCount++;
						if (islandDoneCount === k) finishIslands();
						break;
				}
			};
			w.onerror = () => {
				if (done) return;
				emitLog('warn', `Insel ${i + 1} abgestürzt — die übrigen laufen weiter`);
				islandDoneCount++;
				if (islandDoneCount === k) finishIslands();
			};
			w.postMessage({
				type: 'start',
				doc: docForMain,
				opts: {
					...opts,
					poolBudgetMs: 0,
					hotStart: globalBest !== null,
					totalBudgetMs: islandBudget,
					// Eigener Seed pro Insel (anderer Mixer als die Pool-Seeds,
					// damit Insel i nicht mit Pool-Worker i korreliert).
					seed: ((baseSeed ^ ((i + 1) * 0x85ebca6b)) & 0x7fffffff) || 1,
				},
			} satisfies WorkerInMsg);
		}
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
					startIslandPhase();
				}
			}
		};
		w.onerror = () => {
			// Ein gescheiterter Pool-Worker bricht den Pool nicht ab — die
			// übrigen liefern weiter; zur Not starten die Inseln ohne
			// Pool-Ergebnis.
			poolDoneCount++;
			if (poolDoneCount === k && !done) {
				terminatePool();
				startIslandPhase();
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
			if (islandsStarted) {
				// Abort während der Island-Phase: alle Inseln stoppen; jede
				// antwortet mit ihrem eigenen done (TIMEOUT + bester Stand) →
				// finishIslands wählt das beste. Antwortet nicht jede binnen
				// ABORT_TERMINATE_MS, schließt der Timer mit dem bis dahin
				// Gesammelten ab (finish terminiert die Nachzügler hart).
				emitLog('phase', 'Benutzer hat abgebrochen — Inseln werden gestoppt');
				for (const w of islandWorkers) {
					w.postMessage({ type: 'abort' } satisfies WorkerInMsg);
				}
				abortTimer = setTimeout(() => {
					abortTimer = null;
					finishIslands();
				}, ABORT_TERMINATE_MS);
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
			// DZN der Gewinner-Insel — verfügbar nach Session-Ende (wie beim
			// Single-Worker-Pfad kommt der Snapshot mit dem done-Event).
			return lastDzn;
		},
	};
}

// ----- Parallel-Diversify-Session (Audit D-3) ---------------------------------

/**
 * k Diversify-Versuche GLEICHZEITIG auf demselben Plan, der beste gewinnt.
 *
 * Jeder Arm ist eine komplette startSolve-Session (hotStart + diversify)
 * mit eigenem abgeleiteten Seed — inklusive eigenem Pre-Snapshot und
 * Revert-Guard. Die Kürung nutzt dieselbe Rangfolge wie die Inseln
 * (unplaced → no_free roh → total); scheitern alle Arme, bleibt der
 * Plan unverändert (Revert-Semantik). Begründung + Messwerte:
 * docs/bench-baseline.json (d2-diversify-baseline).
 */
function startParallelDiversifySession(doc: ScheduleDoc, opts: StartSolveOptions, k: number): SolveSession {
	// Fatale Konfigurationen → Single-Worker meldet den Fehler sauber
	// (gleiches Muster wie die Pool-Session).
	const fatal = diagnose(doc).find(h => h.severity === 'error');
	if (fatal) {
		return startSolveInWorker(doc, opts);
	}

	const emitter = makeEmitter();
	const tStart = Date.now();
	const baseSeed = opts.seed ?? (Date.now() & 0x7fffffff);
	const durationSec = Math.round((opts.diversify?.durationMs ?? 0) / 1000);

	let done = false;
	const armWorkers: Worker[] = [];
	let armDoneCount = 0;
	const armFinals: (SolveDoneEvent | null)[] = new Array(k).fill(null);
	const armDzns: string[] = new Array(k).fill('');
	let lastDzn = '';
	let abortTimer: ReturnType<typeof setTimeout> | null = null;

	function emitLog(level: SolveLogEvent['level'], message: string): void {
		emitter.emit('log', { tElapsedMs: Date.now() - tStart, level, message } satisfies SolveLogEvent);
	}
	function terminateArms(): void {
		for (const w of armWorkers) w.terminate();
		armWorkers.length = 0;
	}
	function finish(doneEvent: SolveDoneEvent): void {
		if (done) return;
		done = true;
		if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
		terminateArms();
		emitter.emit('done', doneEvent);
	}

	function finishArms(): void {
		if (done) return;
		let bestIdx = -1;
		for (let i = 0; i < armFinals.length; i++) {
			const f = armFinals[i];
			if (!f) continue;
			if (bestIdx === -1 || islandBeats(f, armFinals[bestIdx]!)) bestIdx = i;
		}
		if (bestIdx === -1) {
			// Alle Arme gescheitert — Plan bleibt unverändert (Revert-Semantik:
			// Diversify darf nie verschlechtern, also auch nie verlieren).
			finish({
				final: {
					status: 'TIMEOUT',
					placed: doc.placed.map(p => ({ ...p })),
					unplaced: [],
					message: `Alle ${k} Diversify-Versuche gescheitert — Plan bleibt unverändert.`,
				},
				totalElapsedMs: Date.now() - tStart,
			});
			return;
		}
		const scores = armFinals
			.map((f, i) => f ? `Versuch ${i + 1}: ${Math.round(f.final.penalties?.total ?? 0)}` : `Versuch ${i + 1}: ✗`)
			.join(' · ');
		emitLog('stat', `Parallel-Diversify — ${scores} → Versuch ${bestIdx + 1} gewinnt`);
		lastDzn = armDzns[bestIdx];
		const winner = armFinals[bestIdx]!;
		finish({ final: winner.final, totalElapsedMs: Date.now() - tStart });
	}

	queueMicrotask(() => {
		if (done) return;
		emitLog('phase', `Diversify parallel: ${k} Versuche à ${durationSec}s auf ${k} Kernen — der beste gewinnt`);
	});

	// Live-Best über alle Arme: nur echte Verbesserungen erreichen das UI;
	// phase/progress/relaxation kommen nur von Arm 1 (wie bei den Inseln).
	let liveBest = Number.POSITIVE_INFINITY;
	let leadArm = -1;

	for (let i = 0; i < k; i++) {
		const w = newWorker();
		armWorkers.push(w);
		w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
			if (done) return;
			const m = e.data;
			switch (m.kind) {
				case 'solution': {
					const s = m.payload.score;
					if (s !== null && s < liveBest) {
						liveBest = s;
						if (leadArm !== i && k > 1) {
							leadArm = i;
							emitLog('stat', `Diversify-Versuch ${i + 1}/${k} übernimmt die Führung (Score ${Math.round(s)})`);
						}
						emitter.emit('solution', { ...m.payload, tElapsedMs: Date.now() - tStart } satisfies SolveSolutionEvent);
					}
					break;
				}
				case 'phase':
					if (i === 0) emitter.emit('phase', m.payload);
					break;
				case 'progress':
					if (i === 0) emitter.emit('progress', m.payload);
					break;
				case 'log':
					if (i === 0) emitter.emit('log', m.payload);
					break;
				case 'relaxation':
					if (i === 0) emitter.emit('relaxation', m.payload);
					break;
				case 'error':
					if (i === 0) emitter.emit('error', new Error(m.message));
					break;
				case 'done':
					armDzns[i] = m.dzn;
					armFinals[i] = m.payload;
					armDoneCount++;
					if (armDoneCount === k) finishArms();
					break;
			}
		};
		w.onerror = () => {
			if (done) return;
			emitLog('warn', `Diversify-Versuch ${i + 1} abgestürzt — die übrigen laufen weiter`);
			armDoneCount++;
			if (armDoneCount === k) finishArms();
		};
		w.postMessage({
			type: 'start',
			doc,
			opts: {
				...opts,
				poolBudgetMs: 0,
				// Eigener Seed pro Arm — gleicher Mixer wie die Insel-Seeds.
				seed: ((baseSeed ^ ((i + 1) * 0x85ebca6b)) & 0x7fffffff) || 1,
			},
		} satisfies WorkerInMsg);
	}

	return {
		abort(): void {
			if (done) return;
			emitLog('phase', 'Benutzer hat abgebrochen — Diversify-Versuche werden gestoppt');
			for (const w of armWorkers) {
				w.postMessage({ type: 'abort' } satisfies WorkerInMsg);
			}
			if (abortTimer === null) {
				abortTimer = setTimeout(() => {
					abortTimer = null;
					finishArms();
				}, ABORT_TERMINATE_MS);
			}
		},
		on(event, cb): () => void {
			return emitter.on(event as string, cb as (e: unknown) => void);
		},
		getDzn(): string {
			return lastDzn;
		},
	};
}
