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
			// Try to give the user a concrete hint via pre-flight diagnostics.
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
