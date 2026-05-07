// Frontend-side service that drives MiniZinc-JS directly.
// MiniZinc-JS already runs the solver in its own internal Web Worker (it spins
// up `minizinc-worker.js` via importScripts), so we don't need an outer module
// worker — that would prevent the inner Classic-worker from loading.

import * as MiniZinc from 'minizinc';
import minizincWorkerURL from 'minizinc/minizinc-worker.js?url';
import minizincWasmURL from 'minizinc/minizinc.wasm?url';
import minizincDataURL from 'minizinc/minizinc.data?url';
import { encode } from './encode';
import { decode, type SolverOutput } from './decode';
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

export async function solve(doc: ScheduleDoc, opts: SolveOptions = {}): Promise<SolverOutput> {
	const enc = encode(doc);
	const dzn = (enc.dataJson as any).__dzn as string;
	const timeoutMs = opts.timeoutMs ?? 30_000;

	if (enc.L === 0) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: [],
			message: 'Keine Lehreinheiten vorhanden — nichts zu generieren.'
		};
	}

	try {
		opts.onProgress?.('init');
		await ensureInit();

		opts.onProgress?.('build');
		const model = new MiniZinc.Model();
		model.addString(modelMzn);
		model.addDznString(dzn);

		opts.onProgress?.('solve');
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
				unplaced: enc.instances.map(i => i.specId),
				message: 'Es gibt keinen Plan, der alle harten Regeln erfüllt.'
			};
		}

		const rawOutput =
			lastSolutionOutput ??
			(result.solution
				? JSON.stringify((result.solution as any).output ?? result.solution)
				: null);

		return decode(rawOutput, enc.instances);
	} catch (e) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: enc.instances.map(i => i.specId),
			message: e instanceof Error ? e.message : String(e)
		};
	}
}
