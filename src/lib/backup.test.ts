import { describe, it, expect, beforeEach } from 'vitest';
import { createBackupSnapshot } from './backup';
import { loadSnapshots, SNAPSHOTS_CHANGED_EVENT } from './snapshots';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from './types';

function docWithPlan() {
	const doc = emptyDoc('2026/27');
	const t: Teacher = { id: 't1', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: [] };
	const s: Subject = { code: 'M', name: 'M', category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
	const spec: LessonSpec = {
		id: 's1', subject: 'M', teachers: ['t1'], classes: ['1a'], grades: [5],
		weekPattern: 'every', count: 1, includeInSolver: true, source: 'manual',
	};
	doc.teachers.push(t);
	doc.subjects.push(s);
	doc.specs.push(spec);
	doc.placed.push({ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false });
	return doc;
}

describe('createBackupSnapshot — der eine Backup-Weg (Audit C-4)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('legt ein Backup mit ehrlichem Score, Breakdown und Zeit-Label an + Event', () => {
		let events = 0;
		const onChange = () => { events++; };
		window.addEventListener(SNAPSHOTS_CHANGED_EVENT, onChange);
		try {
			const snap = createBackupSnapshot(docWithPlan(), 'Backup vor Test');
			expect(snap).not.toBeNull();
			expect(snap!.source).toBe('backup');
			expect(snap!.name).toMatch(/^Backup vor Test \d{1,2}:\d{2}:\d{2}/);
			// Ehrlicher lokaler Score (1 platzierte Stunde erzeugt Rest-Penalties > 0)
			// + Breakdown für die Galerie (der frühere Inline-Drift ließ ihn weg).
			expect(snap!.score).toBeGreaterThan(0);
			expect(snap!.scoreBreakdown?.total).toBe(snap!.score);
			expect(events).toBe(1);
			const stored = loadSnapshots().find(s => s.id === snap!.id);
			expect(stored?.placed).toHaveLength(1);
		} finally {
			window.removeEventListener(SNAPSHOTS_CHANGED_EVENT, onChange);
		}
	});

	it('leerer Plan → null, kein Snapshot, kein Event', () => {
		let events = 0;
		const onChange = () => { events++; };
		window.addEventListener(SNAPSHOTS_CHANGED_EVENT, onChange);
		try {
			expect(createBackupSnapshot(emptyDoc('2026/27'), 'Backup vor Test')).toBeNull();
			expect(loadSnapshots()).toHaveLength(0);
			expect(events).toBe(0);
		} finally {
			window.removeEventListener(SNAPSHOTS_CHANGED_EVENT, onChange);
		}
	});

	it('Mutation am Doc nach dem Backup verändert das Backup nicht (Deep-Clone)', () => {
		const doc = docWithPlan();
		const snap = createBackupSnapshot(doc, 'Backup vor Test');
		doc.placed[0].day = 'Fr';
		expect(loadSnapshots().find(s => s.id === snap!.id)?.placed[0].day).toBe('Mo');
	});
});
