// Audit M-6 (Mai-Audit, 2026-07 umgesetzt): Der try/catch um runSession
// (index.ts) fängt Exceptions aus dem ILS-Hot-Loop und beantwortet sie
// mit einem sauberen done(status ERROR) + error-Event — das war bisher
// nur für den Diagnose-Pfad getestet, nie für einen echten Mid-ILS-Crash.
//
// Eigene Test-Datei, weil vi.mock modulweit gilt: genMoveWithSource
// wirft hier IMMER — die reguläre index.test.ts bleibt ungemockt.

import { describe, it, expect, vi } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from '../types';
import { startSolve, type SolveDoneEvent } from './index';

vi.mock('./moves', async (importOriginal) => {
	const original = await importOriginal<typeof import('./moves')>();
	return {
		...original,
		genMoveWithSource: () => {
			throw new Error('kaboom im ILS-Hot-Loop');
		},
	};
});

function tinyDoc() {
	const doc = emptyDoc('2026/27');
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

describe('runSession — Exception im ILS-Hot-Loop (M-6)', () => {
	it('Mid-ILS-Throw → error-Event + done mit status ERROR und der Fehlermeldung', async () => {
		const errors: Error[] = [];
		const done = await new Promise<SolveDoneEvent>(resolve => {
			const session = startSolve(tinyDoc(), { totalBudgetMs: 2_000, innerBudgetMs: 500 });
			session.on('error', e => errors.push(e));
			session.on('done', d => resolve(d));
		});
		expect(done.final.status).toBe('ERROR');
		expect(done.final.message).toContain('kaboom');
		expect(done.final.placed).toEqual([]);
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0].message).toContain('kaboom');
	}, 15_000);
});
