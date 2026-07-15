// Audit C-6: Die Schwierigkeits-Heuristik speist den 🧩-Report im
// Generator — falsche Punkte führen den User bei klemmenden Plänen in
// die Irre. Vorher ohne jede Abdeckung.

import { describe, it, expect } from 'vitest';
import { computeSpecDifficulties } from './spec-difficulty';
import { emptyDoc, type LessonSpec, type Teacher } from './types';

function mkSpec(id: string, overrides: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: 'M', teachers: ['t1'], classes: ['1a'], grades: [5],
		weekPattern: 'every', count: 2, includeInSolver: true, source: 'manual',
		...overrides,
	};
}

function mkDoc(specs: LessonSpec[], teachers?: Teacher[]) {
	const doc = emptyDoc('2026/27');
	doc.teachers.push(...(teachers ?? [
		{ id: 't1', name: 'A', shortNumber: 1, color: '#000', subjects: [], unavailable: [] },
	]));
	doc.specs.push(...specs);
	return doc;
}

describe('computeSpecDifficulties — Punkte-Heuristik', () => {
	it('Basis-Spec: nur der Wochenstunden-Sockel (20 × Slots), keine Gründe', () => {
		const [d] = computeSpecDifficulties(mkDoc([mkSpec('s1')]));
		expect(d.score).toBe(40); // count 2 → 2 Slots × 20
		expect(d.reasons).toEqual([]);
	});

	it('Zuschläge: Kopplung 500, Mehrstufe 200/Extra-Stufe, Team 150/Extra-Lehrer, Block 100', () => {
		const doc = mkDoc([
			mkSpec('coupled', { couplingId: 'g1' }),
			mkSpec('multi', { grades: [5, 6, 7] }),
			mkSpec('team', { teachers: ['t1', 't2'] }),
			mkSpec('block', { blocks: [2] }),
		], [
			{ id: 't1', name: 'A', shortNumber: 1, color: '#000', subjects: [], unavailable: [] },
			{ id: 't2', name: 'B', shortNumber: 2, color: '#000', subjects: [], unavailable: [] },
		]);
		const byId = new Map(computeSpecDifficulties(doc).map(d => [d.spec.id, d]));
		expect(byId.get('coupled')!.score).toBe(540);
		expect(byId.get('coupled')!.reasons).toContain('gekoppelt');
		expect(byId.get('multi')!.score).toBe(440); // 2 Extra-Stufen × 200 + 40
		expect(byId.get('multi')!.reasons).toContain('mehrstufig (5+6+7)');
		expect(byId.get('team')!.score).toBe(190);
		expect(byId.get('team')!.reasons).toContain('Team (2 Lehrer)');
		expect(byId.get('block')!.score).toBe(140);
		expect(byId.get('block')!.reasons).toContain('Doppelstunden-Block');
	});

	it('Lehrer-Sperren zählen als VEREINIGUNG über alle Team-Lehrer (30/Slot)', () => {
		const doc = mkDoc([mkSpec('s1', { teachers: ['t1', 't2'] })], [
			{ id: 't1', name: 'A', shortNumber: 1, color: '#000', subjects: [], unavailable: [
				{ day: 'Mo', period: 1 }, { day: 'Di', period: 1 },
			] },
			{ id: 't2', name: 'B', shortNumber: 2, color: '#000', subjects: [], unavailable: [
				{ day: 'Mo', period: 1 }, { day: 'Mi', period: 1 },
			] },
		]);
		const [d] = computeSpecDifficulties(doc);
		// Union = Mo1, Di1, Mi1 = 3 Slots × 30 = 90; + Team 150 + Sockel 40.
		expect(d.score).toBe(280);
	});

	it('Vormittags-Pflicht (+80) und Wochen-Muster (+50) mit Klartext-Gründen', () => {
		const doc = mkDoc([
			mkSpec('vormittag', { afternoonAllowed: 'never' }),
			mkSpec('gwoche', { weekPattern: 'even' }),
		]);
		const byId = new Map(computeSpecDifficulties(doc).map(d => [d.spec.id, d]));
		expect(byId.get('vormittag')!.score).toBe(120);
		expect(byId.get('vormittag')!.reasons).toContain('nur Vormittag');
		expect(byId.get('gwoche')!.score).toBe(90);
		expect(byId.get('gwoche')!.reasons).toContain('G-Woche');
	});

	it('includeInSolver=false wird übersprungen; Sortierung absteigend nach Punkten', () => {
		const doc = mkDoc([
			mkSpec('aus', { includeInSolver: false, couplingId: 'x' }),
			mkSpec('leicht'),
			mkSpec('schwer', { couplingId: 'g1', grades: [5, 6] }),
		]);
		const out = computeSpecDifficulties(doc);
		expect(out.map(d => d.spec.id)).toEqual(['schwer', 'leicht']);
	});

	it('viele Wochenstunden: Sockel wächst und wird ab 4 Slots als Grund genannt', () => {
		const [d] = computeSpecDifficulties(mkDoc([mkSpec('s1', { count: 5 })]));
		expect(d.score).toBe(100);
		expect(d.reasons).toContain('5 Wochenstunden');
	});
});
