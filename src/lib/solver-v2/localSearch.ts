// Solver v2 — Phase 2: Local Search.
//
// Hill-climbing + Simulated Annealing + Tabu list. See SOLVER-V2-CONCEPT.md §7.
//
// Operates on a constructed (hard-feasible) state. Each iteration generates
// a random move, evaluates the score delta, and accepts/rejects according to
// the SA criterion. The tabu list prevents direct undo of recent moves.
//
// RESUME-Mechanik (Schritt 2 der Solver-Optimierung): Der Async-Pfad
// (iteratedLocalSearchAsync) zerlegt die innere LS in ~250ms-Chunks, damit
// UI + Abort reagieren können. Vor dem Fix startete jeder Chunk localSearch
// KOMPLETT frisch — SA-Temperatur zurück auf 100, Tabu leer → jeder Chunk
// akzeptierte erst massenhaft Verschlechterungen und musste neu klettern
// (empirisch: 2 von 5 Bench-Läufen blieben mit Klassen-Lücke stecken, siehe
// docs/bench-baseline.json). Mit `opts.resume` setzt ein Chunk nahtlos fort:
// Temperatur, Tabu-Liste, aktueller Walk-Score, Best-Tracking und RNG-Zustand
// werden übernommen. `restoreBestOnExit: false` lässt state.placement am
// Walk-Punkt (statt Best zu restaurieren), damit der nächste Chunk den Walk
// fortsetzt; die Best-Restauration übernimmt der Caller am ECHTEN Ende.

import { applyMove, genMove, movableUnits, Rng, type Move } from './moves';
import { evaluateDelta } from './scoreDelta';
import type { ScoreBreakdown, ScoreWeights, SolverState } from './types';

/**
 * Vollständiger Fortsetzungs-Zustand einer Local-Search-Session.
 * Wird von localSearch() zurückgegeben und beim nächsten Chunk via
 * `opts.resume` wieder hineingereicht. Die Map und die Int32Array-Referenzen
 * werden geteilt (kein Deep-Copy) — zwischen Chunks darf niemand anderes
 * damit arbeiten.
 */
export interface LsResumeState {
	/** Aktuelle SA-Temperatur (setzt Kühlung nahtlos fort). */
	T: number;
	/** Globaler Iterationszähler über alle Chunks — treibt Tabu-Expiry. */
	iterations: number;
	/** Tabu-Liste (Map<`${unitIdx}:${slot}`, expiryIteration>). */
	tabu: Map<string, number>;
	/** Score-Breakdown des aktuellen WALK-Punkts (== state.placement). */
	curBreakdown: ScoreBreakdown;
	/** Bestes bisher gesehenes Placement (kumulativ über Chunks). */
	bestPlacement: Int32Array;
	/** Breakdown zu bestPlacement. */
	bestBreakdown: ScoreBreakdown;
	/** Kumulative akzeptierte Moves über alle Chunks. */
	acceptedMoves: number;
	/** Kumulative Verbesserungen über alle Chunks. */
	improvementCount: number;
	/** RNG-Zustand (Rng.getState()) für deterministische Fortsetzung. */
	rngState: number;
}

export interface LocalSearchOptions {
	weights: ScoreWeights;
	/** Maximum iterations FÜR DIESEN AUFRUF. Default 50_000. */
	maxIterations?: number;
	/** Maximum wall-clock time in ms. Default 60_000 (1 min). */
	timeBudgetMs?: number;
	/** Initial SA temperature. Default 100. Ignoriert wenn `resume` gesetzt. */
	tStart?: number;
	/** Minimum SA temperature. Default 0.1. */
	tMin?: number;
	/** Cooling rate. Default 0.9995 (per iteration). */
	cooling?: number;
	/** Tabu tenure (iterations). Default 50. */
	tabuTenure?: number;
	/**
	 * Diversification boost — added to the kempe-chain probability when
	 * generating moves. ILS raises this after unproductive restarts. 0 = default mix.
	 */
	kempeBoost?: number;
	/** Random seed. Default deterministic. Ignoriert wenn `resume` gesetzt. */
	seed?: number;
	/**
	 * Fortsetzungs-Zustand eines vorherigen localSearch-Aufrufs. Wenn gesetzt,
	 * werden Temperatur, Tabu, Walk-Score, Best-Tracking, Zähler und RNG
	 * übernommen; `initialBreakdown`, `tStart` und `seed` werden ignoriert.
	 * VORAUSSETZUNG: state.placement ist unverändert seit dem Chunk-Ende
	 * (restoreBestOnExit: false beim vorherigen Aufruf).
	 */
	resume?: LsResumeState;
	/**
	 * true (Default): state.placement wird am Ende auf das beste gefundene
	 * Placement restauriert (bisheriges Verhalten).
	 * false: state.placement bleibt am aktuellen Walk-Punkt — für Chunk-Resume;
	 * der Caller restauriert `resumeState.bestPlacement` am echten Session-Ende.
	 */
	restoreBestOnExit?: boolean;
	/**
	 * Optional callback invoked after each accepted improvement (i.e. score
	 * dropped). Used by the streaming session to push live updates to the UI.
	 */
	onImprovement?: (info: {
		iteration: number;
		tElapsedMs: number;
		breakdown: ScoreBreakdown;
		bestPlacement: Int32Array;
	}) => void;
	/**
	 * Optional cancel signal. If returns true, LS aborts after the next move.
	 * Used by `startSolve.abort()`.
	 */
	shouldAbort?: () => boolean;
}

export interface LocalSearchResult {
	/** The best placement seen (deep copy of state.placement). */
	bestPlacement: Int32Array;
	/** The best breakdown corresponding to bestPlacement. */
	bestBreakdown: ScoreBreakdown;
	/** Number of iterations performed IN DIESEM AUFRUF. */
	iterations: number;
	/** Number of accepted moves in diesem Aufruf (including SA-uphill). */
	acceptedMoves: number;
	/** Number of accepted improvements (delta < 0) in diesem Aufruf. */
	improvementCount: number;
	/** Final wall-clock time spent in ms. */
	tElapsedMs: number;
	/** Fortsetzungs-Zustand — für den nächsten Chunk via opts.resume. */
	resumeState: LsResumeState;
}

/**
 * Run local search on the given state.
 *
 * Ohne `resume`/`restoreBestOnExit` verhält sich die Funktion byte-identisch
 * zum bisherigen Verhalten: frischer Start, Best-Restauration am Ende.
 */
export function localSearch(
	state: SolverState,
	initialBreakdown: ScoreBreakdown,
	opts: LocalSearchOptions
): LocalSearchResult {
	const maxIter = opts.maxIterations ?? 50_000;
	const timeBudgetMs = opts.timeBudgetMs ?? 60_000;
	const tMin = opts.tMin ?? 0.1;
	const cooling = opts.cooling ?? 0.9995;
	const tabuTenure = opts.tabuTenure ?? 50;
	const kempeBoost = opts.kempeBoost ?? 0;
	const restoreBest = opts.restoreBestOnExit ?? true;
	const resume = opts.resume;
	const tStart = Date.now();

	const rng = new Rng(opts.seed ?? Date.now() & 0x7fffffff);
	if (resume) rng.setState(resume.rngState);

	let T = resume ? resume.T : (opts.tStart ?? 100);
	let curBreakdown = resume ? resume.curBreakdown : initialBreakdown;
	let bestPlacement = resume ? resume.bestPlacement : new Int32Array(state.placement);
	let bestBreakdown = resume ? resume.bestBreakdown : { ...curBreakdown };

	// Tabu: map<key, iteration-when-expires>. Key = `${unitIdx}:${oldSlot}`.
	// Expiry läuft über den GLOBALEN Zähler, damit Einträge Chunk-Grenzen
	// korrekt überleben.
	const tabu = resume ? resume.tabu : new Map<string, number>();
	let globalIter = resume ? resume.iterations : 0;

	let localIter = 0;
	let acceptedMoves = 0;
	let improvementCount = 0;

	// Runde 2, Schritt 3: bewegliche Units EINMAL pro Aufruf berechnen —
	// während des Laufs statisch (Moves relozieren nur). Identische Liste
	// (Inhalt + idx-Reihenfolge) wie der frühere Per-Move-Aufbau → der
	// Move-Strom bleibt bei gleichem Seed byte-identisch.
	const movable = movableUnits(state);

	while (localIter < maxIter) {
		if (opts.shouldAbort?.()) break;
		const elapsed = Date.now() - tStart;
		if (elapsed > timeBudgetMs) break;

		const move = genMove(state, rng, kempeBoost, movable);
		if (!move) {
			localIter++;
			globalIter++;
			continue;
		}

		// Tabu check: is the move forbidden?
		if (isTabu(move, tabu, globalIter)) {
			localIter++;
			globalIter++;
			continue;
		}

		const { delta, nextBreakdown } = evaluateDelta(state, move, opts.weights, curBreakdown);

		const accept =
			delta < 0 ||
			(T > tMin && rng.next() < Math.exp(-delta / T));

		if (accept) {
			applyMove(state, move);
			acceptedMoves++;
			curBreakdown = nextBreakdown;
			pushTabu(move, tabu, globalIter + tabuTenure);
			if (delta < 0) {
				improvementCount++;
				if (curBreakdown.total < bestBreakdown.total) {
					bestBreakdown = { ...curBreakdown };
					bestPlacement = new Int32Array(state.placement);
					opts.onImprovement?.({
						iteration: localIter,
						tElapsedMs: elapsed,
						breakdown: bestBreakdown,
						bestPlacement,
					});
				}
			}
		}

		T = Math.max(tMin, T * cooling);
		localIter++;
		globalIter++;
	}

	// Restore best placement — nur wenn gewünscht (Chunk-Resume lässt den
	// Walk-Punkt stehen, damit der nächste Chunk nahtlos fortsetzen kann).
	if (restoreBest) {
		for (let i = 0; i < state.nUnits; i++) state.placement[i] = bestPlacement[i];
	}

	return {
		bestPlacement,
		bestBreakdown,
		iterations: localIter,
		acceptedMoves,
		improvementCount,
		tElapsedMs: Date.now() - tStart,
		resumeState: {
			T,
			iterations: globalIter,
			tabu,
			curBreakdown,
			bestPlacement,
			bestBreakdown,
			acceptedMoves: (resume?.acceptedMoves ?? 0) + acceptedMoves,
			improvementCount: (resume?.improvementCount ?? 0) + improvementCount,
			rngState: rng.getState(),
		},
	};
}

// Tabu semantics: after a move U: s_from → s_to we forbid U from going
// BACK to s_from for `tabuTenure` iterations. So pushTabu writes the slot
// that was just vacated as forbidden, and isTabu checks whether the move's
// proposed destination slot is currently tabu for that unit.
function isTabu(move: Move, tabu: Map<string, number>, iter: number): boolean {
	switch (move.kind) {
		case 'slot-move':
			return checkTabu(`${move.unitIdx}:${move.toSlot}`, tabu, iter);
		case 'slot-swap':
			// A swap moves a → b's slot, b → a's slot. We block re-occupying
			// the slot each unit just left.
			return (
				checkTabu(`${move.aIdx}:${move.bSlot}`, tabu, iter) ||
				checkTabu(`${move.bIdx}:${move.aSlot}`, tabu, iter)
			);
		case 'kempe-chain':
			// Don't bother with tabu for kempe — they're rare and hard to oscillate
			return false;
	}
}

function checkTabu(key: string, tabu: Map<string, number>, iter: number): boolean {
	const expiry = tabu.get(key);
	if (expiry === undefined) return false;
	if (expiry <= iter) {
		tabu.delete(key);
		return false;
	}
	return true;
}

function pushTabu(move: Move, tabu: Map<string, number>, expiry: number): void {
	switch (move.kind) {
		case 'slot-move':
			// Block returning to the slot we just left.
			tabu.set(`${move.unitIdx}:${move.fromSlot}`, expiry);
			return;
		case 'slot-swap':
			tabu.set(`${move.aIdx}:${move.aSlot}`, expiry);
			tabu.set(`${move.bIdx}:${move.bSlot}`, expiry);
			return;
		case 'kempe-chain':
			return;
	}
}

