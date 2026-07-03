// Solver v2 — Worker-Bridge (R2 Schritt 5).
//
// `startSolveSession(doc, opts)` ist der neue Einstiegspunkt für die UI:
// gleiche SolveSession-API wie startSolve, aber der Solver läuft in einem
// Web Worker — der UI-Thread bleibt komplett frei (kein Jank durch die
// 250-ms-Compute-Chunks, kein Konkurrieren mit Svelte-Updates/Ticker).
//
// Fallback: ohne Worker-Support (jsdom/Tests, exotische Umgebungen) läuft
// startSolve wie bisher inline — Verhalten identisch, nur blockierender.
//
// Abort-Kette: postMessage('abort') → Worker setzt Session-Flag → greift
// beim nächsten Chunk. Antwortet der Worker nicht binnen 3 s (Session
// hängt in einem Endlos-Chunk), wird er hart terminiert und ein
// künstliches done mit der letzten bekannten Lösung emittiert — die UI
// wartet nie ewig.

import type { PlacedLesson, ScheduleDoc } from '../types';
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

/** Nachricht Bridge → Worker. */
export type WorkerInMsg =
	| { type: 'start'; doc: ScheduleDoc; opts: StartSolveOptions }
	| { type: 'abort' };

/** Nachricht Worker → Bridge. */
export type WorkerOutMsg =
	| { kind: 'phase'; payload: SolvePhase }
	| { kind: 'progress'; payload: SolveProgressEvent }
	| { kind: 'solution'; payload: SolveSolutionEvent }
	| { kind: 'relaxation'; payload: RelaxationInfo }
	| { kind: 'log'; payload: SolveLogEvent }
	| { kind: 'error'; message: string }
	| { kind: 'done'; payload: SolveDoneEvent; dzn: string };

/**
 * Startet eine Solve-Session — im Web Worker wenn verfügbar, sonst inline.
 * Drop-in-Ersatz für startSolve; die UI merkt keinen API-Unterschied.
 *
 * WICHTIG (Serialisierung): `doc` muss ein PLAIN Object sein — im
 * Svelte-Kontext also `$state.snapshot(store.doc)`, nie der reaktive Proxy.
 */
export function startSolveSession(doc: ScheduleDoc, opts: StartSolveOptions = {}): SolveSession {
	if (typeof Worker === 'undefined') {
		return startSolve(doc, opts);
	}
	return startSolveInWorker(doc, opts);
}

/** Wartezeit nach abort, bevor der Worker hart terminiert wird. */
const ABORT_TERMINATE_MS = 3_000;

function startSolveInWorker(doc: ScheduleDoc, opts: StartSolveOptions): SolveSession {
	const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	const tStart = Date.now();
	let done = false;
	let lastDzn = '';
	let lastPlaced: PlacedLesson[] = [];
	let lastScore: number | null = null;
	let abortTimer: ReturnType<typeof setTimeout> | null = null;

	function emit(event: string, e: unknown): void {
		const set = listeners.get(event);
		if (!set) return;
		for (const cb of set) {
			try { cb(e); } catch (err) { console.warn('SolveSession listener threw', err); }
		}
	}
	function finish(doneEvent: SolveDoneEvent): void {
		if (done) return;
		done = true;
		if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
		emit('done', doneEvent);
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
				emit('solution', m.payload);
				break;
			case 'done':
				lastDzn = m.dzn;
				finish(m.payload);
				break;
			case 'error':
				emit('error', new Error(m.message));
				break;
			default:
				emit(m.kind, m.payload);
		}
	};
	worker.onerror = (ev: ErrorEvent) => {
		// Lade-/Laufzeitfehler des Workers selbst (nicht der Session — deren
		// Fehler kommen als done mit status ERROR). UI-Promise muss auflösen.
		emit('error', new Error(ev.message || 'Solver-Worker-Fehler'));
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
			let set = listeners.get(event as string);
			if (!set) { set = new Set(); listeners.set(event as string, set); }
			set.add(cb as (e: unknown) => void);
			return () => { set!.delete(cb as (e: unknown) => void); };
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
