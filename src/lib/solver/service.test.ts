import { describe, it, expect } from 'vitest';
import { startSolve } from './service';
import { emptyDoc } from '../types';

// We can't run MiniZinc-WASM under jsdom (no Web Worker support to spin up
// the solver). These tests focus on the JS-side wiring of startSolve():
// listener registration, abort propagation, lifecycle events. The actual
// solver pipeline is exercised end-to-end via the existing solve() Tests
// (which use mocked decode pathways).

// Note: under jsdom/Node we can't run the real MiniZinc-WASM solver. The
// only paths in startSolve that don't call MiniZinc are:
//   1) `enc.L === 0` (no specs) — pre-flight short-circuits
//   2) a fatal diagnose hint — pre-flight short-circuits
// All other paths spawn the solver (which tries to call native `minizinc`
// in Node, fails, and crashes the test runner). So we only test those two.

describe('startSolve — pre-flight short-circuits', () => {
	it('emits a done event with status=ERROR when no specs are present', async () => {
		const doc = emptyDoc('2026/27');
		const session = startSolve(doc, { satisfyTimeoutMs: 100, optimizeTimeoutMs: 100 });
		const done = await new Promise<{ final: { status: string; message?: string } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		expect(done.final.status).toBe('ERROR');
		expect(done.final.message).toContain('Keine Lehreinheiten');
	});

	it('emits a done event with status=ERROR when diagnose finds a fatal hint', async () => {
		const doc = emptyDoc('2026/27');
		// Need at least one teacher (else the encoder skips all specs and
		// triggers the empty-doc short-circuit instead of reaching diagnose).
		doc.teachers.push({ id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] });
		doc.subjects.push({ code: 'M', name: 'M', category: 'PG', isMain: true, hoursPerWeek: {} });
		// Fatal: this spec references a non-existent teacher 'tNONE'.
		doc.specs.push({
			id: 'sBad', subject: 'M', teacher: 'tNONE', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		// Add a second valid spec so encode produces L > 0 and we hit diagnose,
		// not the empty-L short-circuit.
		doc.specs.push({
			id: 'sOk', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		const session = startSolve(doc, { satisfyTimeoutMs: 100, optimizeTimeoutMs: 100 });
		const done = await new Promise<{ final: { status: string; message?: string } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		expect(done.final.status).toBe('ERROR');
		expect(done.final.message).toMatch(/nicht lösbar|Lehrer/i);
		session.abort();
	});

	it('on() returns an unsubscribe function', () => {
		const doc = emptyDoc('2026/27'); // empty → pre-flight short-circuit, no solver
		const session = startSolve(doc, { satisfyTimeoutMs: 100, optimizeTimeoutMs: 100 });
		const off = session.on('phase', () => { /* noop */ });
		expect(typeof off).toBe('function');
		off();
	});
});

