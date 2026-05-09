import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { buildState } from './units';
import { computeScore } from './score';
import { applyMove, genMove, Rng, revertMove } from './moves';
import { evaluateDelta } from './scoreDelta';
import { defaultWeights, slotFromDP } from './types';

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
		source: 'manual'
	};
}

describe('evaluateDelta', () => {
	it('does not mutate state (placement before == after)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't1', [5], 3));
		doc.specs.push(spec('s2', 'D', 't2', [6], 3));
		const state = buildState(doc);
		// Place units
		state.placement[0] = slotFromDP(0, 1);
		state.placement[1] = slotFromDP(0, 2);
		state.placement[2] = slotFromDP(0, 3);
		state.placement[3] = slotFromDP(1, 1);
		state.placement[4] = slotFromDP(1, 2);
		state.placement[5] = slotFromDP(1, 3);

		const w = defaultWeights(doc);
		const before = computeScore(state, w);
		const beforeArr = Array.from(state.placement);

		const rng = new Rng(7);
		for (let i = 0; i < 30; i++) {
			const m = genMove(state, rng);
			if (!m) continue;
			evaluateDelta(state, m, w, before);
			// State must be identical
			expect(Array.from(state.placement)).toEqual(beforeArr);
		}
	});

	it('property: delta = computeScore(after) - computeScore(before) for 100 random moves', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 4));
		doc.specs.push(spec('s2', 'D', 't2', [6], 4));
		const state = buildState(doc);
		// Spread placements
		for (let i = 0; i < state.nUnits; i++) {
			state.placement[i] = slotFromDP(i % 5, ((i * 2) % 8) + 1);
		}

		const w = defaultWeights(doc);
		const rng = new Rng(123);
		let checked = 0;
		for (let i = 0; i < 100; i++) {
			const before = computeScore(state, w);
			const m = genMove(state, rng);
			if (!m) continue;
			const { delta, nextBreakdown } = evaluateDelta(state, m, w, before);
			// Now apply for real and verify
			applyMove(state, m);
			const after = computeScore(state, w);
			expect(after.total).toBe(before.total + delta);
			expect(after.total).toBe(nextBreakdown.total);
			revertMove(state, m);
			checked++;
		}
		expect(checked).toBeGreaterThan(50);
	});
});
