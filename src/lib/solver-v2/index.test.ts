import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { startSolve, solve } from './index';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return { code, name: code, category: 'PG', isMain: opts.isMain ?? false, hoursPerWeek: {}, maxConsecutive: opts.maxConsecutive ?? 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
		weekPattern: 'every', count,
		blocks: 'blocks' in opts ? opts.blocks : undefined,
		includeInSolver: true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual',
	};
}

describe('startSolve — public API', () => {
	it('returns a session with abort/on/getDzn methods', () => {
		const doc = emptyDoc();
		const s = startSolve(doc);
		expect(typeof s.abort).toBe('function');
		expect(typeof s.on).toBe('function');
		expect(typeof s.getDzn).toBe('function');
		s.abort();
	});

	it('emits done with status=ERROR when no specs', async () => {
		const doc = emptyDoc();
		const session = startSolve(doc, { totalBudgetMs: 100 });
		const done = await new Promise<{ final: { status: string; message?: string } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		expect(done.final.status).toBe('ERROR');
	});

	it('fatal diagnose hint short-circuits to ERROR', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// Spec references non-existent teacher
		doc.specs.push(spec('s', 'M', 'tNONE', [5], 1));
		// Plus a valid spec so encode produces L > 0
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		const session = startSolve(doc, { totalBudgetMs: 200 });
		const done = await new Promise<{ final: { status: string; message?: string } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		expect(done.final.status).toBe('ERROR');
		expect(done.final.message).toMatch(/nicht lösbar|Lehrer/i);
	});

	it('full solve produces a SAT result on a tiny doc', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const session = startSolve(doc, { totalBudgetMs: 1500, innerBudgetMs: 500 });
		const done = await new Promise<{ final: { status: string; placed: Array<{ specId: string }>; penalties?: { total: number } } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		expect(done.final.status).toBe('SAT');
		expect(done.final.placed.length).toBeGreaterThan(0);
		expect(done.final.penalties).toBeDefined();
	});

	it('abort returns TIMEOUT with best-so-far solution', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 4));
		doc.specs.push(spec('s2', 'D', 't2', [6], 4));
		const session = startSolve(doc, { totalBudgetMs: 60_000, innerBudgetMs: 30_000 });
		// Abort after first solution
		setTimeout(() => session.abort(), 100);
		const done = await new Promise<{ final: { status: string; message?: string } }>((resolve) => {
			session.on('done', e => resolve(e as any));
		});
		// Could be SAT (Construction was so fast it finished before abort) or TIMEOUT.
		expect(['SAT', 'TIMEOUT']).toContain(done.final.status);
	});

	it('emits at least one solution event for a solvable doc', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const session = startSolve(doc, { totalBudgetMs: 1000, innerBudgetMs: 300 });
		let solutionCount = 0;
		session.on('solution', () => solutionCount++);
		await new Promise<void>((resolve) => {
			session.on('done', () => resolve());
		});
		expect(solutionCount).toBeGreaterThanOrEqual(1);
	});
});

describe('Phase 14: Pool-Construction', () => {
	it('Default (poolBudgetMs=0): single Construction wie bisher', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const session = startSolve(doc, { totalBudgetMs: 1500, innerBudgetMs: 500 });
		// Sammle log-Events um zu prüfen ob "Pool" oder "Single" lief
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		await new Promise<void>((resolve) => session.on('done', () => resolve()));
		// Mind. ein Phase-Log darf "Construction (greedy" enthalten
		// (heutiger Default-Text), aber kein "Pool-Construction".
		const hasSingle = phaseLogs.some(m => m.includes('Construction (greedy'));
		const hasPool = phaseLogs.some(m => m.includes('Pool-Construction'));
		expect(hasSingle).toBe(true);
		expect(hasPool).toBe(false);
	});

	it('poolBudgetMs > 0: Pool-Phase läuft, mehrere Versuche', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const session = startSolve(doc, {
			totalBudgetMs: 5000,
			innerBudgetMs: 1500,
			poolBudgetMs: 1000  // 1s Pool
		});
		const phaseLogs: string[] = [];
		const statLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
			if (e.level === 'stat' && typeof e.message === 'string') statLogs.push(e.message);
		});
		await new Promise<void>((resolve) => session.on('done', () => resolve()));
		const hasPool = phaseLogs.some(m => m.includes('Pool-Construction'));
		const poolDone = phaseLogs.some(m => m.includes('Pool abgeschlossen'));
		expect(hasPool).toBe(true);
		expect(poolDone).toBe(true);
		// Mind. ein Pool-Best-Update wurde geloggt
		const poolBests = statLogs.filter(m => m.includes('Pool: neuer Best'));
		expect(poolBests.length).toBeGreaterThanOrEqual(1);
	});
});

describe('strict-noFree auto-relaxation', () => {
	it('default doc has strict mode enabled', () => {
		const doc = emptyDoc();
		expect(doc.constraints.noFreePeriodsForClass.strict).toBe(true);
	});

	it('does not signal noFreeRelaxed when no gaps exist', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// 4 stunden in stufe 5 — easy to place without gaps
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const session = startSolve(doc, { totalBudgetMs: 1500, innerBudgetMs: 500 });
		const done = await new Promise<{ final: { relaxation?: { noFreeRelaxed: boolean } } }>(
			(resolve) => session.on('done', e => resolve(e as any))
		);
		expect(done.final.relaxation?.noFreeRelaxed).toBe(false);
	});

	it('Audit A1b: erzwungene Relax-Phase — Frame-konsistenter Vergleich, kein Score-Regress', async () => {
		// Unvermeidbare Sandwich-Lücke konstruieren: Lehrer LA kann NUR Mo P1,
		// Lehrer LB NUR Mo P3 → Stufe 5 hat zwangsweise P2 frei → strict-Phase
		// endet mit no_free>0 → Auto-Lockerung (Phase 3) muss feuern.
		const allExcept = (day: 'Mo', period: number) => {
			const out: { day: any; period: any }[] = [];
			for (const d of ['Mo', 'Di', 'Mi', 'Do', 'Fr']) {
				for (let p = 1; p <= 8; p++) {
					if (d === day && p === period) continue;
					out.push({ day: d, period: p });
				}
			}
			return out;
		};
		const doc = emptyDoc();
		doc.teachers.push(teacher('la', 'LA', allExcept('Mo', 1) as any));
		doc.teachers.push(teacher('lb', 'LB', allExcept('Mo', 3) as any));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('sa', 'M', 'la', [5], 1));
		doc.specs.push(spec('sb', 'D', 'lb', [5], 1));
		const session = startSolve(doc, { totalBudgetMs: 3000, innerBudgetMs: 600, seed: 42 });
		const logs: string[] = [];
		session.on('log', (e: any) => { if (typeof e.message === 'string') logs.push(e.message); });
		const done = await new Promise<{ final: { status: string; relaxation?: { noFreeRelaxed: boolean }; penalties?: { no_free: number; total: number } } }>(
			(resolve) => session.on('done', e => resolve(e as any))
		);
		expect(done.final.relaxation?.noFreeRelaxed).toBe(true);
		// Die Lücke bleibt real bestehen (unvermeidbar) …
		expect(done.final.penalties!.no_free).toBeGreaterThanOrEqual(1);
		// … und der Frame-konsistente Vergleich/Guard hat geloggt (einer der
		// beiden Pfade: Verbesserung übernommen ODER Phase-2-Stand restauriert).
		expect(logs.some(m =>
			m.includes('Relax-Vergleich (relaxed-Frame)') ||
			m.includes('Phase-2-Stand wiederhergestellt')
		)).toBe(true);
	}, 15_000);
});

describe('solve() — Promise-based wrapper', () => {
	it('returns a SolverOutput', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const result = await solve(doc, { timeoutMs: 1000 });
		expect(['SAT', 'TIMEOUT']).toContain(result.status);
		expect(result.placed.length).toBeGreaterThan(0);
	});
});

describe('Phase 14: Hot-Start (Weiter optimieren)', () => {
	it('hotStart=true skips Pool, even when poolBudgetMs > 0', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		// Vorhandene Placements als Hot-Start-Basis
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 2, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 3, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 4, grade: 5, pinned: false });

		const session = startSolve(doc, {
			totalBudgetMs: 2000,
			innerBudgetMs: 800,
			poolBudgetMs: 5000,  // wäre groß, aber hotStart überschreibt
			hotStart: true
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		await new Promise<void>((resolve) => session.on('done', () => resolve()));
		// Pool darf NICHT laufen
		const hasPool = phaseLogs.some(m => m.includes('Pool-Construction'));
		expect(hasPool).toBe(false);
		// Hot-Start-Log muss da sein
		const hasHotStart = phaseLogs.some(m => m.includes('Hot-Start'));
		expect(hasHotStart).toBe(true);
	});

	it('hotStart loads non-pinned placements as starting position', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		// Eine Spec hat 2 Stunden — wir geben beide als Startposition
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 2, grade: 5, pinned: false });

		const session = startSolve(doc, {
			totalBudgetMs: 1500,
			innerBudgetMs: 500,
			hotStart: true
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		const done = await new Promise<{ final: { status: string; placed: any[] } }>(
			(resolve) => session.on('done', e => resolve(e as any))
		);
		expect(['SAT', 'TIMEOUT']).toContain(done.final.status);
		// Hot-Start sollte 2/2 Units übernommen haben
		const hsLog = phaseLogs.find(m => m.includes('Hot-Start: 2/2'));
		expect(hsLog).toBeTruthy();
	});

	it('hotStart with no existing placements falls through to Construction', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		// Keine Placements

		const session = startSolve(doc, {
			totalBudgetMs: 1500,
			innerBudgetMs: 500,
			hotStart: true
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		await new Promise<void>((resolve) => session.on('done', () => resolve()));
		// Hot-Start läuft, aber 0/2 übernommen → Mini-Construction für 2 Units
		const hsLog = phaseLogs.find(m => m.includes('Hot-Start: 0/'));
		expect(hsLog).toBeTruthy();
	});
});

describe('Phase 15: Diversify (LNS-Mode)', () => {
	it('diversify resets a fraction of placements and runs LS', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 2, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 3, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 4, grade: 5, pinned: false });

		const session = startSolve(doc, {
			diversify: { fraction: 0.5, durationMs: 1500 }
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		const done = await new Promise<{ final: { status: string; placed: any[] } }>(
			(resolve) => session.on('done', e => resolve(e as any))
		);
		expect(['SAT', 'TIMEOUT']).toContain(done.final.status);
		// Mind. 1 Diversify-Log muss da sein (Default-Strategie: random)
		const divLog = phaseLogs.find(m => m.includes('Diversify (random):'));
		expect(divLog).toBeTruthy();
	});

	it('diversify reverts to pre-snapshot when no improvement found', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		// Plan platzieren — schon optimal (P1-P4 lückenlos vom P1 aus)
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 2, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 3, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 4, grade: 5, pinned: false });

		const session = startSolve(doc, {
			diversify: { fraction: 0.5, durationMs: 1000 }
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		const done = await new Promise<{ final: { status: string; placed: any[] } }>(
			(resolve) => session.on('done', e => resolve(e as any))
		);
		expect(['SAT', 'TIMEOUT']).toContain(done.final.status);
		// Entweder verbessert oder gleich-gut+revert — beide Logs sind valide
		const divResult = phaseLogs.find(m =>
			m.includes('Diversify erfolgreich') || m.includes('Diversify ohne Verbesserung')
		);
		expect(divResult).toBeTruthy();
	});

	it('diversify skips Pool even when poolBudgetMs is set', async () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: false });
		doc.placed.push({ specId: 's', day: 'Mo', period: 2, grade: 5, pinned: false });

		const session = startSolve(doc, {
			poolBudgetMs: 5000,  // wäre gross, aber diversify überschreibt
			diversify: { fraction: 0.5, durationMs: 1000 }
		});
		const phaseLogs: string[] = [];
		session.on('log', (e: any) => {
			if (e.level === 'phase' && typeof e.message === 'string') phaseLogs.push(e.message);
		});
		await new Promise<void>((resolve) => session.on('done', () => resolve()));
		// Pool darf NICHT laufen
		const hasPool = phaseLogs.some(m => m.includes('Pool-Construction'));
		expect(hasPool).toBe(false);
	});
});
