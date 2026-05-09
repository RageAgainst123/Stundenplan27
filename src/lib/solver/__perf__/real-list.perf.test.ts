// Performance regression tests against the real Sokrates list (129 lessons).
//
// These tests are SLOW (5-60s each). Run via `npm run test:perf`, NOT in
// the regular test suite. They are guarded by `minizincAvailable()` so CI
// without a MiniZinc install just skips them.
//
// What we measure here:
//   - Does the model find a satisfying assignment for the real workload?
//   - How long does FlatZinc compilation take? (regression indicator)
//   - How long does the search take? (heuristic effectiveness)
//   - Does each hard constraint individually allow a solution? (isolation)
//
// When you change the model, run `npm run test:perf` and check the deltas.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMzn, minizincAvailable } from './harness';

const modelMzn = readFileSync(
	join(__dirname, '..', 'model.mzn'),
	'utf8'
);
// Read fixture and append flags that newer model versions require.
// The DZN was captured before constraint-toggles existed; we set them to
// the production-default values here.
const listeDzn = (() => {
	let d = readFileSync(join(__dirname, 'liste-129-lessons.dzn'), 'utf8');
	if (!d.endsWith('\n')) d += '\n';
	if (!/enable_same_day_cohesion\s*=/.test(d)) {
		d += 'enable_same_day_cohesion = false;\n';
	}
	return d;
})();

const skipIfNoMinizinc = minizincAvailable() ? describe : describe.skip;

skipIfNoMinizinc('real Liste.csv (129 lessons) — performance regressions', () => {
	it('finds a SAT solution within 120s with full hard-constraint stack', async () => {
		const result = await runMzn(modelMzn, listeDzn, { timeoutMs: 120_000 });

		// eslint-disable-next-line no-console
		console.log('  → status=' + result.status +
			' wall=' + result.wallTimeMs + 'ms' +
			' flat=' + result.flatTime.toFixed(1) + 's' +
			' solve=' + result.solveTime.toFixed(1) + 's' +
			' fails=' + result.failures +
			' nodes=' + result.nodes +
			' obj=' + result.objective);

		// Test reality: the model SHOULD be satisfiable.
		// As of constraint-12 + constraint-10 with reified exists this can
		// still timeout. Pass criterion: SAT (any solution found).
		expect(result.status).toBe('SAT');
	}, 150_000);

	it('FlatZinc compile time stays under 30s (regression guard)', async () => {
		const result = await runMzn(modelMzn, listeDzn, { timeoutMs: 60_000 });
		// If a future constraint pushes flatTime past 30s, the search budget
		// shrinks dramatically. This guard makes that visible.
		expect(result.flatTime).toBeLessThan(30);
	}, 90_000);
});

skipIfNoMinizinc('real Liste.csv — constraint isolation', () => {
	/** Patch the DZN to disable a specific hard parameter. */
	function patchDzn(original: string, replacements: Record<string, string>): string {
		let out = original;
		for (const [key, value] of Object.entries(replacements)) {
			const re = new RegExp(`^${key}\\s*=\\s*[^;]+;`, 'm');
			out = out.replace(re, `${key} = ${value};`);
		}
		return out;
	}

	it('SAT-able with min_daily_slots = 0 (constraint 10 disabled)', async () => {
		const dzn = patchDzn(listeDzn, { min_daily_slots: '0' });
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 30_000 });
		// eslint-disable-next-line no-console
		console.log('  [no min_daily] status=' + result.status + ' flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's');
		expect(result.status).toBe('SAT');
	}, 60_000);

	it('SAT-able with must_start_p1 = false (constraint 12 disabled)', async () => {
		const dzn = patchDzn(listeDzn, { must_start_p1: 'false' });
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 30_000 });
		// eslint-disable-next-line no-console
		console.log('  [no start_p1] status=' + result.status + ' flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's');
		expect(result.status).toBe('SAT');
	}, 60_000);

	it('SAT-able with both min_daily=0 + must_start_p1=false (baseline)', async () => {
		const dzn = patchDzn(listeDzn, { min_daily_slots: '0', must_start_p1: 'false' });
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 15_000 });
		// eslint-disable-next-line no-console
		console.log('  [baseline]    status=' + result.status + ' flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's');
		expect(result.status).toBe('SAT');
	}, 30_000);
});

function zeroAllSoftWeights(dzn: string): string {
	return dzn
		.replace(/^w_no_free\s*=\s*\d+;/m, 'w_no_free = 0;')
		.replace(/^w_main_aft\s*=\s*\d+;/m, 'w_main_aft = 0;')
		.replace(/^w_any_aft\s*=\s*\d+;/m, 'w_any_aft = 0;')
		.replace(/^w_main_run\s*=\s*\d+;/m, 'w_main_run = 0;')
		.replace(/^w_main_early\s*=\s*\d+;/m, 'w_main_early = 0;')
		.replace(/^w_compact\s*=\s*\d+;/m, 'w_compact = 0;');
}

skipIfNoMinizinc('real Liste.csv — soft-constraint impact', () => {
	it('SAT-able with all soft weights = 0 (pure satisfiability)', async () => {
		const dzn = zeroAllSoftWeights(listeDzn);
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 90_000 });
		// eslint-disable-next-line no-console
		console.log('  [no soft]     status=' + result.status + ' wall=' + result.wallTimeMs + 'ms flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's fails=' + result.failures);
		expect(result.status).toBe('SAT');
	}, 120_000);

	function patch(d: string, r: Record<string, string>): string {
		// Ensure trailing newline so subsequent appends don't merge with the
		// last line (the fixture often ends mid-statement).
		let o = d.endsWith('\n') ? d : d + '\n';
		for (const [k, v] of Object.entries(r)) {
			if (new RegExp(`^${k}\\s*=`, 'm').test(o)) {
				o = o.replace(new RegExp(`^${k}\\s*=\\s*[^;]+;`, 'm'), `${k} = ${v};`);
			} else {
				o = o + `${k} = ${v};\n`;
			}
		}
		return o;
	}

	it('isolation: no soft + no min_daily + no must_start_p1 (BASELINE)', async () => {
		const dzn = patch(zeroAllSoftWeights(listeDzn), {
			min_daily_slots: '0',
			must_start_p1: 'false'
		});
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 90_000 });
		// eslint-disable-next-line no-console
		console.log('  [BASELINE]            status=' + result.status + ' flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's fails=' + result.failures);
		expect(result.status).toBe('SAT');
	}, 120_000);

	it('isolation: BASELINE + no C11 (same-day cohesion off)', async () => {
		const dzn = patch(zeroAllSoftWeights(listeDzn), {
			min_daily_slots: '0',
			must_start_p1: 'false',
			enable_same_day_cohesion: 'false'
		});
		const result = await runMzn(modelMzn, dzn, { timeoutMs: 90_000 });
		// eslint-disable-next-line no-console
		console.log('  [no C11]              status=' + result.status + ' flat=' + result.flatTime.toFixed(1) + 's solve=' + result.solveTime.toFixed(1) + 's fails=' + result.failures);
		if (result.stderr && result.status !== 'SAT') {
			// eslint-disable-next-line no-console
			console.log('  [no C11 stderr]', result.stderr.slice(0, 500));
		}
		expect(result.status).toBe('SAT');
	}, 120_000);
});
