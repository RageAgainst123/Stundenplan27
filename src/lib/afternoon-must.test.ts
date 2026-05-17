// Phase 18: Tests für afternoonAllowed='must' (Hard-Constraint H11).

import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { buildState } from './solver-v2/units';
import { wouldViolate } from './solver-v2/hardCheck';
import { slotFromDP } from './solver-v2/types';
import { diagnose } from './solver-v2/diagnose';

function teacher(id: string, name: string, sn: number): Teacher {
	return { id, name, shortNumber: sn, color: '#f00', subjects: [], unavailable: [] };
}
function subject(code: string, isMain = false): Subject {
	return { code, name: code, category: 'PG', isMain, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(o: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return { classes:['1'], weekPattern:'every', includeInSolver:true, source:'manual', afternoonAllowed:'allowed', ...o };
}

describe('H11: afternoonAllowed=must Hard-Constraint', () => {
	it('Spec mit must darf nicht auf P1 platziert werden', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1)];
		doc.subjects = [subject('BBO')];
		doc.specs = [spec({
			id: 'bbo', subject: 'BBO', teachers: ['L1'], count: 1, grades: [7],
			afternoonAllowed: 'must'
		})];

		const state = buildState(doc);
		const unit = state.units[0];
		const moP1 = slotFromDP(0, 1);
		expect(wouldViolate(state, unit, moP1)).toMatch(/H11|nachmittag/i);
	});

	it('Spec mit must darf auf P7 platziert werden', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1)];
		doc.subjects = [subject('BBO')];
		doc.specs = [spec({
			id: 'bbo', subject: 'BBO', teachers: ['L1'], count: 1, grades: [7],
			afternoonAllowed: 'must'
		})];

		const state = buildState(doc);
		const unit = state.units[0];
		const moP7 = slotFromDP(0, 7);
		expect(wouldViolate(state, unit, moP7)).toBeNull();
	});

	it('Spec mit must darf auf P8 platziert werden', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1)];
		doc.subjects = [subject('BBO')];
		doc.specs = [spec({
			id: 'bbo', subject: 'BBO', teachers: ['L1'], count: 1, grades: [7],
			afternoonAllowed: 'must'
		})];

		const state = buildState(doc);
		const unit = state.units[0];
		const moP8 = slotFromDP(0, 8);
		expect(wouldViolate(state, unit, moP8)).toBeNull();
	});

	it('Block-Spec mit must: Doppelstunde P6-P7 nicht erlaubt (P6 vor Nachmittag)', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1)];
		doc.subjects = [subject('BBO')];
		doc.specs = [spec({
			id: 'bbo', subject: 'BBO', teachers: ['L1'], count: 2, grades: [7],
			blocks: [2], afternoonAllowed: 'must'
		})];

		const state = buildState(doc);
		const unit = state.units[0];
		expect(unit.blockSize).toBe(2);
		const moP6 = slotFromDP(0, 6); // Block würde P6+P7 belegen
		expect(wouldViolate(state, unit, moP6)).toMatch(/H11|nachmittag/i);
		// P7 + P8 (Doppelstunde komplett im Nachmittag) ist OK
		const moP7 = slotFromDP(0, 7);
		expect(wouldViolate(state, unit, moP7)).toBeNull();
	});

	it('Diagnose: too many must-hours for teacher → error', () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1)];
		doc.subjects = [subject('BBO')];
		// 1 Lehrer, 12 Pflicht-Nachmittag-Stunden, aber nur 10 Slots (5 Tage × 2 P)
		doc.specs = [spec({
			id: 'bbo', subject: 'BBO', teachers: ['L1'], count: 12, grades: [7],
			afternoonAllowed: 'must'
		})];

		const hints = diagnose(doc);
		const err = hints.find(h => h.severity === 'error' && /pflicht|nachmittag|must/i.test(h.message));
		expect(err).toBeDefined();
	});

	it('Diagnose: must-hours per grade > 10 → error', () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L1', 'L1', 1), teacher('L2', 'L2', 2),
			teacher('L3', 'L3', 3), teacher('L4', 'L4', 4)
		];
		doc.subjects = [subject('A'), subject('B'), subject('C'), subject('D')];
		// Pro Stufe nur 10 Nachmittag-Slots (5 Tage × 2 P) — 12 Stunden = UNSAT
		doc.specs = [
			spec({ id:'a', subject:'A', teachers:['L1'], count:3, grades:[7], afternoonAllowed:'must' }),
			spec({ id:'b', subject:'B', teachers:['L2'], count:3, grades:[7], afternoonAllowed:'must' }),
			spec({ id:'c', subject:'C', teachers:['L3'], count:3, grades:[7], afternoonAllowed:'must' }),
			spec({ id:'d', subject:'D', teachers:['L4'], count:3, grades:[7], afternoonAllowed:'must' })
		];
		const hints = diagnose(doc);
		const err = hints.find(h => h.severity === 'error' && /Schulstufe 7.*pflicht/i.test(h.message));
		expect(err).toBeDefined();
	});

	it('Solver-Run: alle must-Specs landen im Nachmittag', async () => {
		const doc = emptyDoc();
		doc.teachers = [teacher('L1', 'L1', 1), teacher('L2', 'L2', 2)];
		doc.subjects = [subject('BBO'), subject('M', true), subject('D', true)];
		doc.specs = [
			// Pflicht-Nachmittag
			spec({ id:'bbo', subject:'BBO', teachers:['L1'], count:2, grades:[7], afternoonAllowed:'must' }),
			// Fillter um den Plan aussagekräftig zu machen
			spec({ id:'m', subject:'M', teachers:['L2'], count:4, grades:[7], afternoonAllowed:'never' }),
			spec({ id:'d', subject:'D', teachers:['L2'], count:4, grades:[7], afternoonAllowed:'never' })
		];

		const { startSolve } = await import('./solver-v2/index');
		const session = startSolve(doc, { totalBudgetMs: 1500 });
		const final = await new Promise<{ placed: typeof doc.placed }>(resolve => {
			session.on('done', d => resolve(d.final));
		});
		// Alle BBO-Placements müssen ≥ P7 sein
		const bboPlacements = final.placed.filter(p => p.specId === 'bbo');
		expect(bboPlacements.length).toBeGreaterThan(0);
		for (const pl of bboPlacements) {
			expect(pl.period).toBeGreaterThanOrEqual(7);
		}
		// Alle M und D müssen < P7 sein (never)
		const mainPlacements = final.placed.filter(p => p.specId === 'm' || p.specId === 'd');
		for (const pl of mainPlacements) {
			expect(pl.period).toBeLessThan(7);
		}
	}, 10_000);
});
