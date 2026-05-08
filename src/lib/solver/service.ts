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
		// Phase 7B-4: try auto-relaxation if there were any strict patterns.
		const { doc: relaxedDoc, relaxedSpecIds } = relaxStrictBlocks(doc);
		if (relaxedSpecIds.length > 0) {
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
		}

		// Still UNSAT (or nothing to relax) → give the user a concrete hint.
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
