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

	// ----- Schritt 6: Parallel-Pool ------------------------------------------

	function withCores(n: number): void {
		Object.defineProperty(navigator, 'hardwareConcurrency', { value: n, configurable: true });
	}

	const poolPlaced = [{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false }];
	const poolBest = (score: number, attempts: number) => ({
		kind: 'poolBest' as const,
		payload: { placed: poolPlaced, score, unplacedCount: 0, attempts },
	});

	it('Parallel-Pool: k Worker mit distinkten Seeds, Best-Aggregation, Übergang zu k Inseln (R3-S2)', async () => {
		withFakeWorker();
		withCores(8); // → k = min(4, 8-2) = 4
		const session = startSolveSession(tinyDoc(), { poolBudgetMs: 5_000, totalBudgetMs: 60_000, seed: 7 });
		const solutions: Array<{ score: number | null }> = [];
		const logs: string[] = [];
		session.on('solution', s => solutions.push(s as never));
		session.on('log', l => logs.push((l as { message: string }).message));
		await Promise.resolve(); // queueMicrotask der Pool-Startevents

		expect(FakeWorker.instances).toHaveLength(4);
		const seeds = FakeWorker.instances.map(w => (w.sent[0] as { type: 'pool'; seed: number }).seed);
		expect(FakeWorker.instances.every(w => w.sent[0].type === 'pool')).toBe(true);
		expect(new Set(seeds).size).toBe(4); // distinkte Seeds

		// Worker 0 meldet Best 5000, Worker 1 toppt mit 4000, Worker 2 schlechter (ignoriert).
		FakeWorker.instances[0].receive(poolBest(5000, 3));
		FakeWorker.instances[1].receive(poolBest(4000, 2));
		FakeWorker.instances[2].receive(poolBest(4500, 1));
		expect(solutions.map(s => s.score)).toEqual([5000, 4000]);
		expect(logs.some(m => /Pool: neuer Best #\d+.*Score 4000/.test(m))).toBe(true);

		// Alle 4 melden poolDone → R3-S2: k ISLAND-Worker starten, jeder mit
		// Best als Hot-Start und eigenem Seed.
		for (const w of FakeWorker.instances.slice(0, 4)) {
			w.receive({ kind: 'poolDone', payload: { attempts: 5, best: null } });
		}
		expect(FakeWorker.instances).toHaveLength(8);
		const islands = FakeWorker.instances.slice(4);
		const islandSeeds: number[] = [];
		for (const isl of islands) {
			const startMsg = isl.sent[0] as { type: 'start'; doc: { placed: unknown[] }; opts: Record<string, unknown> };
			expect(startMsg.type).toBe('start');
			expect(startMsg.opts.hotStart).toBe(true);
			expect(startMsg.opts.poolBudgetMs).toBe(0);
			expect(startMsg.doc.placed).toEqual(poolPlaced);
			expect(startMsg.opts.totalBudgetMs as number).toBeLessThanOrEqual(60_000);
			islandSeeds.push(startMsg.opts.seed as number);
		}
		expect(new Set(islandSeeds).size).toBe(4); // Inseln suchen unabhängig
		expect(logs.some(m => /Pool abgeschlossen: 20 Versuche/.test(m))).toBe(true);
		expect(logs.some(m => /Island-Optimierung — 4 unabhängige Läufe/.test(m))).toBe(true);
		// Pool-Worker sind terminiert.
		expect(FakeWorker.instances.slice(0, 4).every(w => w.terminated)).toBe(true);

		// Live-Verbesserungen: nur echte Bests erreichen das UI, Führungs-
		// wechsel wird geloggt.
		islands[1].receive({ kind: 'solution', payload: { placed: poolPlaced, score: 3000, tElapsedMs: 5, phase: 'optimize' } });
		islands[2].receive({ kind: 'solution', payload: { placed: poolPlaced, score: 3500, tElapsedMs: 6, phase: 'optimize' } }); // schlechter → ignoriert
		expect(solutions.map(s => s.score)).toEqual([5000, 4000, 3000]);
		expect(logs.some(m => /Insel 2\/4 übernimmt die Führung/.test(m))).toBe(true);

		// Alle Inseln melden done — die beste (weniger unplaced, dann
		// weniger no_free, dann Total) gewinnt; genau EIN done an die UI.
		const dones: Array<{ final: { status: string; message?: string } }> = [];
		session.on('done', d => dones.push(d as never));
		const islandDone = (unplaced: number, noFree: number, total: number, dzn: string) => ({
			kind: 'done' as const,
			payload: {
				final: {
					status: 'SAT', placed: poolPlaced,
					unplaced: new Array(unplaced).fill({}),
					penalties: { no_free: noFree, total },
				},
				totalElapsedMs: 1,
			},
			dzn,
		});
		islands[0].receive(islandDone(1, 0, 2000, 'dzn0')); // 1 unplaced → raus
		islands[1].receive(islandDone(0, 1, 2500, 'dzn1')); // no_free 1 → raus
		islands[2].receive(islandDone(0, 0, 3100, 'dzn2')); // Kandidat
		expect(dones).toHaveLength(0); // erst wenn ALLE fertig sind
		islands[3].receive(islandDone(0, 0, 2900, 'dzn3')); // gewinnt (Total)
		expect(dones).toHaveLength(1);
		expect(session.getDzn()).toBe('dzn3');
		expect(logs.some(m => /Insel 4 gewinnt/.test(m))).toBe(true);
		expect(islands.every(w => w.terminated)).toBe(true);
	});

	it('Abort während der Island-Phase: alle Inseln bekommen abort, beste Antwort gewinnt', async () => {
		vi.useFakeTimers();
		withFakeWorker();
		withCores(8);
		const session = startSolveSession(tinyDoc(), { poolBudgetMs: 5_000, totalBudgetMs: 60_000, seed: 7 });
		const dones: Array<{ final: { status: string } }> = [];
		session.on('done', d => dones.push(d as never));
		await Promise.resolve();
		FakeWorker.instances[0].receive(poolBest(5000, 1));
		for (const w of FakeWorker.instances.slice(0, 4)) {
			w.receive({ kind: 'poolDone', payload: { attempts: 2, best: null } });
		}
		const islands = FakeWorker.instances.slice(4);
		expect(islands).toHaveLength(4);

		session.abort();
		expect(islands.every(w => w.sent.some(m => m.type === 'abort'))).toBe(true);
		// Nur 2 Inseln antworten auf den Abort — der Terminate-Fallback
		// schließt nach 3 s mit der besten Antwort ab.
		islands[0].receive({
			kind: 'done',
			payload: { final: { status: 'TIMEOUT', placed: poolPlaced, unplaced: [], penalties: { no_free: 0, total: 4200 } }, totalElapsedMs: 1 },
			dzn: 'a',
		});
		islands[1].receive({
			kind: 'done',
			payload: { final: { status: 'TIMEOUT', placed: poolPlaced, unplaced: [], penalties: { no_free: 0, total: 3900 } }, totalElapsedMs: 1 },
			dzn: 'b',
		});
		expect(dones).toHaveLength(0);
		vi.advanceTimersByTime(3_100);
		expect(dones).toHaveLength(1);
		expect(session.getDzn()).toBe('b'); // Insel 2 hatte den besseren Total
		expect(islands.every(w => w.terminated)).toBe(true);
	});

	it('Abort während der Pool-Phase: Worker terminiert, beste Pool-Lösung übernommen', async () => {
		withFakeWorker();
		withCores(8);
		const session = startSolveSession(tinyDoc(), { poolBudgetMs: 5_000 });
		const dones: Array<{ final: { status: string; placed: unknown[] } }> = [];
		session.on('done', d => dones.push(d as never));
		await Promise.resolve();
		FakeWorker.instances[0].receive(poolBest(3000, 1));
		session.abort();
		expect(dones).toHaveLength(1);
		expect(dones[0].final.status).toBe('TIMEOUT');
		expect(dones[0].final.placed).toEqual(poolPlaced);
		expect(FakeWorker.instances.every(w => w.terminated)).toBe(true);
	});

	it('fatale Diagnose überspringt den Pool (Single-Worker meldet den Fehler sauber)', () => {
		withFakeWorker();
		withCores(8);
		const doc = tinyDoc();
		// Stufe 5 mit 41 Wochenstunden > 40 Slots → diagnose-Fatal.
		doc.specs[0].count = 41;
		const session = startSolveSession(doc, { poolBudgetMs: 5_000 });
		expect(FakeWorker.instances).toHaveLength(1);
		expect(FakeWorker.instances[0].sent[0].type).toBe('start');
		void session;
	});

	it('nur 1 nutzbarer Kern: Pool bleibt in der Session (Single-Worker)', () => {
		withFakeWorker();
		withCores(2); // → k = 1 → kein Parallel-Pool
		startSolveSession(tinyDoc(), { poolBudgetMs: 5_000 });
		expect(FakeWorker.instances).toHaveLength(1);
		const msg = FakeWorker.instances[0].sent[0] as { type: string; opts?: { poolBudgetMs?: number } };
		expect(msg.type).toBe('start');
		expect(msg.opts?.poolBudgetMs).toBe(5_000); // Session-interner Pool
	});
});
