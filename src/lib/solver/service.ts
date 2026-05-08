// Frontend-side service that drives MiniZinc-JS directly.
// MiniZinc-JS already runs the solver in its own internal Web Worker (it spins
// up `minizinc-worker.js` via importScripts), so we don't need an outer module
// worker — that would prevent the inner Classic-worker from loading.

import * as MiniZinc from 'minizinc';
import minizincWorkerURL from 'minizinc/minizinc-worker.js?url';
import minizincWasmURL from 'minizinc/minizinc.wasm?url';
import minizincDataURL from 'minizinc/minizinc.data?url';
import { encode, type SolverInput } from './encode';
import { decode, type SolverOutput } from './decode';
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
		// Phase 7B-4 + 9-4: tiered auto-relaxation.
		//   Round 2: relax strict block patterns (auto-mode for everyone).
		//   Round 3: also reduce min_daily_slots from 4 → 3.
		//   Round 4: also disable min_daily_slots entirely (0).
		const originalMinDaily = doc.constraints?.minDailySlotsPerGrade ?? 0;
		const { doc: relaxedDoc, relaxedSpecIds } = relaxStrictBlocks(doc);
		const hasBlocksToRelax = relaxedSpecIds.length > 0;

		const relaxNotes: string[] = [];

		// Round 2 — only if there's actually something to relax.
		if (hasBlocksToRelax) {
			opts.onProgress?.('Lockere Block-Pattern und versuche es nochmal…');
			const enc2 = encode(relaxedDoc);
			const r2 = await runSolver(enc2, timeoutMs, opts.onProgress);
			if (r2.status === 'SAT') {
				const names = relaxedSpecIds
					.map(id => {
						const s = doc.specs.find(x => x.id === id);
						return s ? `${s.subject} (${s.classes.join('+') || s.grades.join('+')})` : id;
					})
					.slice(0, 5)
					.join(', ');
				const more = relaxedSpecIds.length > 5 ? ` und ${relaxedSpecIds.length - 5} weitere` : '';
				return {
					...r2,
					relaxedSpecIds,
					message: `Block-Pattern automatisch gelockert: ${names}${more}. Strikte Vorgaben waren unlösbar.`
				};
			}
			relaxNotes.push('Block-Pattern auf Auto');
		}

		// Round 3 — reduce min_daily_slots if it was active.
		if (originalMinDaily >= 4) {
			opts.onProgress?.('Lockere Mindest-Tagespensum auf 3…');
			const docR3 = relaxMinDailySlots(hasBlocksToRelax ? relaxedDoc : doc, 3);
			const enc3 = encode(docR3);
			const r3 = await runSolver(enc3, timeoutMs, opts.onProgress);
			if (r3.status === 'SAT') {
				relaxNotes.push('Mindest-Tagespensum auf 3 gesenkt');
				return {
					...r3,
					relaxedSpecIds: hasBlocksToRelax ? relaxedSpecIds : undefined,
					message: `Lockerungen aktiv: ${relaxNotes.join(', ')}. Strenge Konfig war unlösbar.`
				};
			}
			relaxNotes.push('Mindest-Tagespensum auf 3 (UNSAT)');
		}

		// Round 4 — disable min_daily entirely.
		if (originalMinDaily > 0) {
			opts.onProgress?.('Deaktiviere Mindest-Tagespensum komplett…');
			const docR4 = relaxMinDailySlots(hasBlocksToRelax ? relaxedDoc : doc, 0);
			const enc4 = encode(docR4);
			const r4 = await runSolver(enc4, timeoutMs, opts.onProgress);
			if (r4.status === 'SAT') {
				relaxNotes.push('Mindest-Tagespensum deaktiviert');
				return {
					...r4,
					relaxedSpecIds: hasBlocksToRelax ? relaxedSpecIds : undefined,
					message: `Lockerungen aktiv: ${relaxNotes.join(', ')}. Strenge Konfig war unlösbar.`
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
