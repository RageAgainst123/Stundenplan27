// Native-MiniZinc test harness for performance + constraint regression tests.
//
// Calls the locally installed `minizinc.exe` via child_process with the
// `--json-stream` flag, parses the resulting NDJSON event stream, and exposes
// the metrics (status, flatTime, solveTime, failures, etc.) plus the final
// solution as a structured result object.
//
// Why a separate harness instead of vitest+minizinc-WASM:
//   - WASM under Node throws "Failed to construct URL" because it expects
//     a browser Worker context. Workarounds are flaky.
//   - Native binary is ~2-3x faster on real workloads (no WASM overhead).
//   - Streaming events (statistics, status, solution) are emitted line-by-line
//     in the same NDJSON shape as the WASM library uses, so behavior parity
//     is high.
//
// Performance tests are NOT included in the default `npm test` run because
// they take 5-60s each. Run them via `npm run test:perf`.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/** Default install path on Windows. Override with MINIZINC_BIN env var. */
const DEFAULT_BIN_WIN = 'C:\\Program Files\\MiniZinc\\minizinc.exe';
const DEFAULT_BIN_UNIX = 'minizinc';

function findMinizinc(): string {
	if (process.env.MINIZINC_BIN) return process.env.MINIZINC_BIN;
	if (process.platform === 'win32' && existsSync(DEFAULT_BIN_WIN)) return DEFAULT_BIN_WIN;
	return DEFAULT_BIN_UNIX;
}

export interface RunMznOptions {
	/** Solver name. Default 'gecode'. */
	solver?: string;
	/** Time limit in milliseconds. Default 30_000. */
	timeoutMs?: number;
	/** Random seed. Default 42. */
	randomSeed?: number;
	/** Emit every intermediate solution (`--all-solutions` for optimize). */
	allSolutions?: boolean;
	/** Print the MiniZinc command line for debugging. */
	verbose?: boolean;
}

export interface RunMznResult {
	/** Mapped to our domain values: SAT, UNSAT, TIMEOUT, ERROR. */
	status: 'SAT' | 'UNSAT' | 'TIMEOUT' | 'ERROR';
	/** Raw status string from MiniZinc (UNSATISFIABLE, OPTIMAL_SOLUTION, etc). */
	rawStatus: string;
	/** Wall-clock duration of the solver invocation (ms). */
	wallTimeMs: number;
	/** FlatZinc compilation time in seconds (from statistics). */
	flatTime: number;
	/** Solver time in seconds (from statistics). */
	solveTime: number;
	/** Number of failures encountered by the solver. */
	failures: number;
	/** Number of search nodes. */
	nodes: number;
	/** Number of propagations. */
	propagations: number;
	/** Best objective found, if any. */
	objective: number | null;
	/** Number of solutions emitted (>1 means anytime improvement). */
	solutionCount: number;
	/** Final/best raw solution output (the JSON string from `output [...]`). */
	finalOutput: string | null;
	/** Captured stderr (for debugging crashes). */
	stderr: string;
}

/**
 * Run MiniZinc with the given model + DZN strings.
 *
 * Implementation notes:
 * - Writes model + dzn into a temp dir; deletes on success or failure.
 * - Uses `--json-stream` so we get one JSON event per line.
 * - Last solution wins (we save raw output of every `solution` event,
 *   the last one is the optimal/best).
 * - statistics events are merged into a single dict (later keys win).
 */
export async function runMzn(
	modelMzn: string,
	dzn: string,
	opts: RunMznOptions = {}
): Promise<RunMznResult> {
	const solver = opts.solver ?? 'gecode';
	const timeoutMs = opts.timeoutMs ?? 30_000;
	const randomSeed = opts.randomSeed ?? 42;
	const bin = findMinizinc();

	const dir = mkdtempSync(join(tmpdir(), 'mzn-perf-'));
	const modelPath = join(dir, 'model.mzn');
	const dznPath = join(dir, 'data.dzn');
	writeFileSync(modelPath, modelMzn);
	writeFileSync(dznPath, dzn);

	const args: string[] = [
		'--solver', solver,
		'--json-stream',
		'--statistics',
		'--output-time',
		'--time-limit', String(timeoutMs),
		'--random-seed', String(randomSeed)
	];
	if (opts.allSolutions) args.push('--all-solutions');
	args.push(modelPath, dznPath);

	if (opts.verbose) {
		// eslint-disable-next-line no-console
		console.log('[runMzn]', bin, args.join(' '));
	}

	const tStart = Date.now();
	let stderr = '';
	const stats: Record<string, unknown> = {};
	let solutionCount = 0;
	let lastOutput: string | null = null;
	let rawStatus = 'UNKNOWN';

	return new Promise<RunMznResult>((resolve) => {
		const child = spawn(bin, args, { windowsHide: true });
		let stdoutBuf = '';

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBuf += chunk.toString('utf8');
			let nl: number;
			while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
				const line = stdoutBuf.slice(0, nl).trim();
				stdoutBuf = stdoutBuf.slice(nl + 1);
				if (!line) continue;
				try {
					const ev = JSON.parse(line);
					switch (ev.type) {
						case 'solution': {
							solutionCount++;
							// MiniZinc CLI emits the output in `output.json` or `output.default`
							const out = ev.output?.json ?? ev.output?.default ?? ev.output;
							lastOutput = typeof out === 'string' ? out : JSON.stringify(out);
							break;
						}
						case 'statistics': {
							Object.assign(stats, ev.statistics ?? {});
							break;
						}
						case 'status': {
							rawStatus = String(ev.status ?? 'UNKNOWN');
							break;
						}
						// Other event types (warning, error, trace) ignored here;
						// they show up in stderr or via parse errors.
					}
				} catch {
					// Not JSON — ignore (MiniZinc occasionally emits plain text)
				}
			}
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});

		child.on('error', (err) => {
			rmSync(dir, { recursive: true, force: true });
			resolve({
				status: 'ERROR',
				rawStatus: 'ERROR',
				wallTimeMs: Date.now() - tStart,
				flatTime: 0,
				solveTime: 0,
				failures: 0,
				nodes: 0,
				propagations: 0,
				objective: null,
				solutionCount: 0,
				finalOutput: null,
				stderr: stderr + '\nspawn error: ' + err.message
			});
		});

		child.on('close', () => {
			rmSync(dir, { recursive: true, force: true });
			const wallTimeMs = Date.now() - tStart;

			let status: RunMznResult['status'];
			if (rawStatus === 'UNSATISFIABLE') status = 'UNSAT';
			else if (lastOutput !== null) status = 'SAT';
			else if (rawStatus === 'UNKNOWN') status = 'TIMEOUT';
			else status = 'ERROR';

			resolve({
				status,
				rawStatus,
				wallTimeMs,
				flatTime: typeof stats.flatTime === 'number' ? stats.flatTime : 0,
				solveTime: typeof stats.solveTime === 'number' ? stats.solveTime : 0,
				failures: typeof stats.failures === 'number' ? stats.failures : 0,
				nodes: typeof stats.nodes === 'number' ? stats.nodes : 0,
				propagations: typeof stats.propagations === 'number' ? stats.propagations : 0,
				objective: typeof stats.objective === 'number' ? stats.objective : null,
				solutionCount,
				finalOutput: lastOutput,
				stderr
			});
		});
	});
}

/** Quick existence check — useful in tests to skip if MiniZinc isn't installed. */
export function minizincAvailable(): boolean {
	const bin = findMinizinc();
	return bin === DEFAULT_BIN_UNIX || existsSync(bin);
}

void mkdirSync; // ESM unused-import quirk
