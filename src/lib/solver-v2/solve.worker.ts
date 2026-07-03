// Solver v2 — Web-Worker-Entry (R2 Schritt 5+6).
//
// Zwei Betriebsarten:
//  - 'start': führt startSolve UNVERÄNDERT im Worker-Thread aus und
//    spiegelt alle Session-Events via postMessage an die Bridge.
//  - 'pool' (Schritt 6): reine Pool-Construction — N Constructions mit
//    verschiedenen Seeds, jede neue Best-Lösung wird gemeldet. Die Bridge
//    fährt k solcher Pool-Worker PARALLEL und startet danach die
//    Haupt-Session mit der besten Lösung als Hot-Start.
//
// Weil startSolve intern bereits async-gechunkt ist (250-ms-Chunks mit
// setTimeout-Yields), atmet der Worker-Event-Loop zwischen den Chunks —
// message-basiertes Abort funktioniert OHNE SharedArrayBuffer (kein
// COOP/COEP-Problem auf GitHub Pages). Der Pool-Loop yieldet pro
// Construction (~50-150 ms) und ist damit ebenso abbrechbar.
//
// Protokoll-Typen: siehe worker-bridge.ts (WorkerInMsg / WorkerOutMsg).

import { startSolve, placementToPlacedLessons } from './index';
import { buildState } from './units';
import { construct } from './construct';
import { computeScore } from './score';
import { Rng } from './moves';
import { defaultWeights, SLOT_UNPLACED } from './types';
import type { ScheduleDoc } from '../types';
import type { PoolBestPayload, WorkerInMsg, WorkerOutMsg } from './worker-bridge';

const ctx = self as unknown as {
	postMessage(m: WorkerOutMsg): void;
	onmessage: ((e: MessageEvent<WorkerInMsg>) => void) | null;
};

let session: ReturnType<typeof startSolve> | null = null;
let poolAborted = false;

ctx.onmessage = (e: MessageEvent<WorkerInMsg>) => {
	const msg = e.data;
	if (msg.type === 'start') {
		if (session) return; // Ein Worker fährt genau EINE Session.
		session = startSolve(msg.doc, msg.opts);
		session.on('phase', p => ctx.postMessage({ kind: 'phase', payload: p }));
		session.on('progress', p => ctx.postMessage({ kind: 'progress', payload: p }));
		session.on('solution', s => ctx.postMessage({ kind: 'solution', payload: s }));
		session.on('relaxation', r => ctx.postMessage({ kind: 'relaxation', payload: r }));
		session.on('log', l => ctx.postMessage({ kind: 'log', payload: l }));
		// Error-Objekte sind zwar structured-cloneable, aber nur die Message
		// wird gebraucht — schlanker und ohne Browser-Altlasten-Risiko.
		session.on('error', err => ctx.postMessage({ kind: 'error', message: err.message }));
		session.on('done', d => {
			// DZN-Snapshot huckepack: getDzn() ist eine synchrone API — die
			// Bridge kann nicht nachfragen, also liefert done ihn gleich mit.
			ctx.postMessage({ kind: 'done', payload: d, dzn: session!.getDzn() });
		});
	} else if (msg.type === 'pool') {
		void runPool(msg.doc, msg.budgetMs, msg.seed);
	} else if (msg.type === 'abort') {
		// Flag setzen — greift beim nächsten Chunk-Yield der Session bzw.
		// nach der laufenden Pool-Construction.
		poolAborted = true;
		session?.abort();
	}
};

/**
 * Pool-Construction-Loop (Spiegel der Pool-Phase aus index.ts): frische
 * Constructions mit wechselnden Seeds, pinned Placements bleiben erhalten,
 * „besser" heißt weniger unplaced, dann niedrigerer Score.
 */
async function runPool(doc: ScheduleDoc, budgetMs: number, seed: number): Promise<void> {
	const state = buildState(doc); // lädt Pins, Rest unplaced
	const strictNoFree = doc.constraints.noFreePeriodsForClass.strict !== false &&
		doc.constraints.noFreePeriodsForClass.enabled !== false;
	const weights = defaultWeights(doc, strictNoFree);
	const rng = new Rng(seed);

	const pinnedSnapshot = new Int32Array(state.nUnits);
	for (let i = 0; i < state.nUnits; i++) {
		pinnedSnapshot[i] = state.units[i].pinned ? state.placement[i] : SLOT_UNPLACED;
	}

	let best: PoolBestPayload | null = null;
	let attempts = 0;
	const t0 = Date.now();
	while (Date.now() - t0 < budgetMs && !poolAborted) {
		state.placement.set(pinnedSnapshot);
		const r = construct(state, { weights, seed: rng.int(1, 2147483647) });
		attempts++;
		const breakdown = computeScore(state, weights);
		const better = best === null
			|| r.unplacedUnitIdxs.length < best.unplacedCount
			|| (r.unplacedUnitIdxs.length === best.unplacedCount && breakdown.total < best.score);
		if (better) {
			best = {
				placed: placementToPlacedLessons(state, state.placement),
				score: breakdown.total,
				unplacedCount: r.unplacedUnitIdxs.length,
				attempts,
			};
			ctx.postMessage({ kind: 'poolBest', payload: best });
		}
		// Yield: Abort-Messages verarbeiten, Worker-Loop atmen lassen.
		await new Promise<void>(resolve => setTimeout(resolve, 0));
	}
	ctx.postMessage({ kind: 'poolDone', payload: { attempts, best } });
}
