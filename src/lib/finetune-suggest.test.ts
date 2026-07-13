import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher, type GradeLevel, type Day, type Period } from './types';
import { suggestSwaps } from './finetune-suggest';
import { scorePlacedPlan } from './quality';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string, isMain = false): Subject {
	return { code, name: code, category: 'PG', isMain, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(id: string, sub: string, teachers: string[], grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers, classes: ['1a'], grades,
		weekPattern: 'every', count, includeInSolver: true, source: 'manual', ...opts,
	};
}

/** Alpha hat auf Di eine reparierbare Springstunde (P1 + P3, P2 frei). */
function gapDoc() {
	const doc = emptyDoc();
	doc.teachers.push(teacher('tA', 'Alpha Anna'), teacher('tB', 'Beta Bernd'));
	doc.subjects.push(subject('M', true), subject('D', true));
	doc.specs.push(spec('s1', 'M', ['tA'], [5], 4));
	doc.specs.push(spec('s2', 'D', ['tB'], [5], 2));
	doc.placed.push(
		{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false },
		{ specId: 's1', day: 'Mo', period: 3, grade: 5, pinned: false },
		{ specId: 's2', day: 'Mo', period: 2, grade: 5, pinned: false },
		{ specId: 's2', day: 'Mo', period: 4, grade: 5, pinned: false },
		{ specId: 's1', day: 'Di', period: 1, grade: 5, pinned: false },
		{ specId: 's1', day: 'Di', period: 3, grade: 5, pinned: false },
	);
	return doc;
}

describe('suggestSwaps — Tauschvorschläge-Engine (F2-S3)', () => {
	it('findet für den Lücken-Lehrer eine Verbesserung und sortiert nach Gewinn', () => {
		const doc = gapDoc();
		const suggestions = suggestSwaps(doc, { teacherId: 'tA' });
		expect(suggestions.length).toBeGreaterThan(0);
		// Bester Vorschlag zuerst, aufsteigend sortiert.
		for (let i = 1; i < suggestions.length; i++) {
			expect(suggestions[i].delta).toBeGreaterThanOrEqual(suggestions[i - 1].delta);
		}
		expect(suggestions[0].delta).toBeLessThan(0);
		// Der Top-Zug schließt die Di-Lücke: M Di P3 → Di P2 (frei).
		expect(suggestions[0].label).toContain('M');
	});

	it('GEGENPROBE: delta jedes Vorschlags == exakter Score-Diff des Kandidaten-Plans', () => {
		const doc = gapDoc();
		const before = scorePlacedPlan(doc);
		const suggestions = suggestSwaps(doc, { teacherId: 'tA' }, { maxResults: 15, maxDelta: 10_000 });
		expect(suggestions.length).toBeGreaterThan(3);
		for (const s of suggestions) {
			const after = scorePlacedPlan(doc, s.candidatePlaced);
			expect(after.total - before.total, `Vorschlag "${s.label}"`).toBe(s.delta);
		}
	});

	it('einzelne Stunde als Ziel (lessonKey) liefert nur Züge dieser Stunde', () => {
		const doc = gapDoc();
		const suggestions = suggestSwaps(doc, { lessonKeys: ['s1|Di|3'] }, { maxDelta: 10_000 });
		expect(suggestions.length).toBeGreaterThan(0);
		// Alle Vorschläge betreffen die Di-P3-Stunde als Quelle bzw. Tausch-Teilnehmer.
		for (const s of suggestions) {
			expect(s.label.includes('Di P3')).toBe(true);
		}
	});

	it('gepinnte Stunden werden weder bewegt noch als Tauschpartner benutzt', () => {
		const doc = gapDoc();
		// Alles pinnen außer der Di-P3-Stunde von Alpha.
		doc.placed = doc.placed.map(p =>
			p.specId === 's1' && p.day === 'Di' && p.period === 3 ? p : { ...p, pinned: true }
		);
		const suggestions = suggestSwaps(doc, { teacherId: 'tA' }, { maxDelta: 10_000 });
		// Nur Verschiebe-Züge (kein Partner beweglich) und nur für Di P3.
		for (const s of suggestions) {
			expect(s.kind).toBe('move');
			expect(s.label).toContain('Di P3');
		}
		// Kandidaten lassen gepinnte Placements unangetastet (inkl. Flag).
		const pinnedBefore = doc.placed.filter(p => p.pinned).map(p => `${p.specId}|${p.day}|${p.period}|${p.grade}`).sort();
		for (const s of suggestions) {
			const pinnedAfter = s.candidatePlaced.filter(p => p.pinned).map(p => `${p.specId}|${p.day}|${p.period}|${p.grade}`).sort();
			expect(pinnedAfter).toEqual(pinnedBefore);
		}
	});

	it('Kopplung wandert als GANZE Gruppe (eine Unit)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('tA', 'A'), teacher('tB', 'B'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('k1', 'BSP', ['tA'], [5], 1, { couplingId: 'c1' }));
		doc.specs.push(spec('k2', 'BSP', ['tB'], [6], 1, { couplingId: 'c1' }));
		doc.placed.push(
			{ specId: 'k1', day: 'Mo', period: 5, grade: 5, pinned: false },
			{ specId: 'k2', day: 'Mo', period: 5, grade: 6, pinned: false },
		);
		const suggestions = suggestSwaps(doc, { lessonKeys: ['k1|Mo|5'] }, { maxDelta: 100_000, maxResults: 5 });
		expect(suggestions.length).toBeGreaterThan(0);
		for (const s of suggestions) {
			// Beide Kopplungs-Specs liegen im Kandidaten IMMER am selben Slot.
			const k1 = s.candidatePlaced.find(p => p.specId === 'k1');
			const k2 = s.candidatePlaced.find(p => p.specId === 'k2');
			expect(k1 && k2).toBeTruthy();
			expect(`${k1!.day}|${k1!.period}`).toBe(`${k2!.day}|${k2!.period}`);
		}
	});

	it('respektiert Lehrer-Sperren (kein Vorschlag auf gesperrten Slot)', () => {
		const doc = gapDoc();
		// Alpha ist Di P2 gesperrt — der naheliegendste Reparatur-Slot fällt weg.
		doc.teachers[0].unavailable.push({ day: 'Di', period: 2 });
		const suggestions = suggestSwaps(doc, { lessonKeys: ['s1|Di|3'] }, { maxDelta: 100_000, maxResults: 50 });
		for (const s of suggestions) {
			expect(s.label).not.toContain('→ Di P2');
		}
	});

	it('ist deterministisch (zweifacher Aufruf identisch)', () => {
		const doc = gapDoc();
		const a = suggestSwaps(doc, { teacherId: 'tA' });
		const b = suggestSwaps(doc, { teacherId: 'tA' });
		expect(a.map(s => s.id + s.delta)).toEqual(b.map(s => s.id + s.delta));
	});
});
