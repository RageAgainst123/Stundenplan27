// Tests für die Worker-Bridge (R2 Schritt 5).
//
// jsdom hat keinen echten Web Worker — getestet werden:
//  1. der Fallback-Pfad (typeof Worker === 'undefined' → Inline-startSolve),
//  2. das Nachrichten-Protokoll der Bridge gegen einen Fake-Worker
//     (Event-Spiegelung, done+dzn, abort-Nachricht, Terminate-Fallback).
// Der echte Worker läuft im Build + Preview-E2E (Browser).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from '../types';
import { startSolveSession, type WorkerInMsg, type WorkerOutMsg } from './worker-bridge';

function tinyDoc() {
	const doc = emptyDoc();
	const t: Teacher = { id: 't1', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] };
	const s: Subject = { code: 'M', name: 'M', category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
	const spec: LessonSpec = {
		id: 's1', subject: 'M', teachers: ['t1'], classes: ['1a'], grades: [5],
		weekPattern: 'every', count: 2, includeInSolver: true, source: 'manual',
	};
	doc.teachers.push(t);
	doc.subjects.push(s);
	doc.specs.push(spec);
	return doc;
}

describe('startSolveSession — Fallback ohne Worker', () => {
	it('läuft inline durch (jsdom hat keinen Worker) und liefert done', async () => {
		expect(typeof Worker).toBe('undefined'); // Voraussetzung des Tests
		const session = startSolveSession(tinyDoc(), { totalBudgetMs: 1_500, innerBudgetMs: 500 });
		const done = await new Promise<{ final: { status: string } }>(resolve => {
			session.on('done', e => resolve(e));
		});
		expect(['SAT', 'TIMEOUT']).toContain(done.final.status);
		// Inline-Pfad: getDzn liefert den echten Snapshot der Session.
		expect(session.getDzn()).toContain('solver-v2');
	}, 15_000);
});

describe('startSolveSession — Worker-Protokoll (Fake-Worker)', () => {
	// Fake-Worker: fängt postMessage der Bridge ab und lässt den Test
	// Worker-Nachrichten einspeisen. Injiziert via globalThis.Worker.
	class FakeWorker {
		static instances: FakeWorker[] = [];
		sent: WorkerInMsg[] = [];
		terminated = false;
		onmessage: ((e: { data: WorkerOutMsg }) => void) | null = null;
		onerror: ((e: { message: string }) => void) | null = null;
		constructor(_url: unknown, _opts?: unknown) {
			FakeWorker.instances.push(this);
		}
		postMessage(m: WorkerInMsg): void {
			this.sent.push(m);
		}
		terminate(): void {
			this.terminated = true;
		}
		/** Test-Helfer: Nachricht „vom Worker" einspeisen. */
		receive(m: WorkerOutMsg): void {
			this.onmessage?.({ data: m });
		}
	}

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).Worker;
		FakeWorker.instances = [];
		vi.useRealTimers();
	});

	function withFakeWorker() {
		(globalThis as Record<string, unknown>).Worker = FakeWorker;
	}

	it('start-Nachricht enthält doc + opts; Events werden gespiegelt', () => {
		withFakeWorker();
		const doc = tinyDoc();
		const session = startSolveSession(doc, { totalBudgetMs: 5_000, seed: 42 });
		const w = FakeWorker.instances[0];
		expect(w.sent).toHaveLength(1);
		expect(w.sent[0]).toMatchObject({ type: 'start', opts: { totalBudgetMs: 5_000, seed: 42 } });

		const phases: unknown[] = [];
		const solutions: unknown[] = [];
		session.on('phase', p => phases.push(p));
		session.on('solution', s => solutions.push(s));
		w.receive({ kind: 'phase', payload: 'optimize' });
		w.receive({ kind: 'solution', payload: { placed: [], score: 123, tElapsedMs: 10, phase: 'optimize' } });
		expect(phases).toEqual(['optimize']);
		expect(solutions).toHaveLength(1);
	});

	it('done liefert dzn mit, terminiert den Worker und feuert genau einmal', () => {
		withFakeWorker();
		const session = startSolveSession(tinyDoc(), {});
		const w = FakeWorker.instances[0];
		const dones: unknown[] = [];
		session.on('done', d => dones.push(d));
		const doneMsg: WorkerOutMsg = {
			kind: 'done',
			payload: { final: { status: 'SAT', placed: [], unplaced: [] }, totalElapsedMs: 99 },
			dzn: '{"source":"solver-v2"}',
		};
		w.receive(doneMsg);
		w.receive(doneMsg); // Doppel-done darf nicht doppelt feuern
		expect(dones).toHaveLength(1);
		expect(session.getDzn()).toBe('{"source":"solver-v2"}');
		expect(w.terminated).toBe(true);
	});

	it('abort schickt die abort-Nachricht; ohne done folgt der Terminate-Fallback mit letzter Lösung', () => {
		vi.useFakeTimers();
		withFakeWorker();
		const session = startSolveSession(tinyDoc(), {});
		const w = FakeWorker.instances[0];
		const dones: Array<{ final: { status: string; placed: unknown[] } }> = [];
		session.on('done', d => dones.push(d as never));
		// Eine Lösung ist bereits eingetroffen — die darf nicht verloren gehen.
		w.receive({
			kind: 'solution',
			payload: { placed: [{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false }], score: 42, tElapsedMs: 5, phase: 'optimize' },
		});
		session.abort();
		expect(w.sent.some(m => m.type === 'abort')).toBe(true);
		expect(dones).toHaveLength(0);
		vi.advanceTimersByTime(3_100);
		expect(dones).toHaveLength(1);
		expect(dones[0].final.status).toBe('TIMEOUT');
		expect(dones[0].final.placed).toHaveLength(1);
		expect(w.terminated).toBe(true);
	});

	it('reguläres done nach abort räumt den Terminate-Timer auf (kein Doppel-done)', () => {
		vi.useFakeTimers();
		withFakeWorker();
		const session = startSolveSession(tinyDoc(), {});
		const w = FakeWorker.instances[0];
		const dones: unknown[] = [];
		session.on('done', d => dones.push(d));
		session.abort();
		w.receive({
			kind: 'done',
			payload: { final: { status: 'TIMEOUT', placed: [], unplaced: [] }, totalElapsedMs: 50 },
			dzn: '',
		});
		vi.advanceTimersByTime(10_000);
		expect(dones).toHaveLength(1);
	});
});
