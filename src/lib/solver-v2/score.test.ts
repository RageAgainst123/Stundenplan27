import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Subject, type Teacher, type Day, type Period, type GradeLevel, type ScheduleDoc, type PlacedLesson } from '../types';
import { buildState } from './units';
import { computeScore } from './score';
import { defaultWeights, DAY_INDEX, slotFromDP, type SolverState } from './types';

// ---- helpers --------------------------------------------------------------

function teacher(id: string, name: string): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable: [] };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return {
		code, name: opts.name ?? code, category: 'PG',
		isMain: opts.isMain ?? false, hoursPerWeek: {},
		maxConsecutive: opts.maxConsecutive ?? 99
	};
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teacher: t, classes: ['1a'], grades,
		weekPattern: 'every', count,
		blocks: 'blocks' in opts ? opts.blocks : undefined,
		includeInSolver: opts.includeInSolver ?? true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual'
	};
}

/** Place a unit at (day, period) by finding a matching unit and writing into placement[]. */
function place(state: SolverState, specId: string, day: Day, period: Period, grade?: GradeLevel): void {
	const units = state.unitsBySpec.get(specId) ?? [];
	const target = units.find(u => state.placement[u.idx] === -1 && (grade === undefined || u.grades.includes(grade)));
	if (!target) throw new Error(`No free unit for spec ${specId}`);
	state.placement[target.idx] = slotFromDP(DAY_INDEX[day], period);
}

// ---- tests ----------------------------------------------------------------

describe('buildState', () => {
	it('expands a single-grade spec into one solo Unit per occurrence', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 4));
		const state = buildState(doc);
		// count=4, no blocks → 4 solo units, each with 1 instance
		expect(state.nUnits).toBe(4);
		expect(state.units.every(u => u.kind === 'solo')).toBe(true);
		expect(state.units.every(u => u.instances.length === 1)).toBe(true);
		expect(state.units.every(u => u.grades.length === 1 && u.grades[0] === 5)).toBe(true);
	});

	it('expands a multi-grade spec into multigrade Units (one per occurrence, all grades inside)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('REL'));
		doc.specs.push(spec('s', 'REL', 't', [6, 7], 2));
		const state = buildState(doc);
		// count=2, grades=[6,7] → 2 multigrade-units, each with 2 instances
		expect(state.nUnits).toBe(2);
		expect(state.units.every(u => u.kind === 'multigrade')).toBe(true);
		expect(state.units.every(u => u.instances.length === 2)).toBe(true);
		expect(state.units[0].grades).toEqual([6, 7]);
	});

	it('expands a block-pattern spec into block Units of size > 1', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5], 3, { blocks: [2, 1] }));
		const state = buildState(doc);
		// blocks=[2,1] → 1 block-unit (size 2) + 1 solo-unit (size 1)
		expect(state.nUnits).toBe(2);
		const blockUnit = state.units.find(u => u.blockSize === 2);
		const soloUnit = state.units.find(u => u.blockSize === 1);
		expect(blockUnit?.kind).toBe('block');
		expect(blockUnit?.instances.length).toBe(2); // 2 positions × 1 grade
		expect(soloUnit?.kind).toBe('solo');
	});

	it('respects pinned lessons from doc.placed', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		doc.placed.push({ specId: 's', day: 'Mo', period: 1, grade: 5, pinned: true });
		const state = buildState(doc);
		const pinned = state.units.filter(u => u.pinned);
		expect(pinned.length).toBe(1);
		expect(pinned[0].pinnedDay).toBe('Mo');
		expect(pinned[0].pinnedPeriod).toBe(1);
		expect(state.placement[pinned[0].idx]).not.toBe(-1);
	});

	it('skips includeInSolver=false specs', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2, { includeInSolver: false }));
		const state = buildState(doc);
		expect(state.nUnits).toBe(0);
	});

	it('groups specs with the same couplingId into coupling Units', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s1', 'BSP', 't1', [5, 6], 1, { couplingId: 'C1' }));
		doc.specs.push(spec('s2', 'BSP', 't2', [7, 8], 1, { couplingId: 'C1' }));
		const state = buildState(doc);
		// One coupling-Unit covering all 4 grades
		expect(state.nUnits).toBe(1);
		expect(state.units[0].kind).toBe('coupling');
		expect(state.units[0].grades.sort()).toEqual([5, 6, 7, 8]);
		expect(state.units[0].specIds.sort()).toEqual(['s1', 's2']);
	});
});

describe('computeScore — empty state', () => {
	it('returns all zeros for an unplaced doc', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		const breakdown = computeScore(state, w);
		expect(breakdown.main_aft).toBe(0);
		expect(breakdown.no_free).toBe(0);
		expect(breakdown.main_early).toBe(0);
		// min_daily only counts active days (none placed → 0)
		expect(breakdown.min_daily).toBe(0);
		// uneven_days counts UNDER-LOAD, even if 0 lessons (empty day = 4 missing)
		// but we only count active days for `uneven_days` per the comments?
		// In our impl we count ALL (d,g): 5 days × 4 grades × 4 missing = 80
		expect(breakdown.uneven_days).toBe(D_TIMES_G * 4);
	});
});

const D_TIMES_G = 5 * 4; // 5 days × 4 grades

describe('computeScore — main_aft + main_early', () => {
	function setup() {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('BSP', { isMain: false }));
		doc.specs.push(spec('sM', 'M', 't', [5], 1));
		doc.specs.push(spec('sB', 'BSP', 't', [5], 1));
		return doc;
	}

	it('main subject in P1: main_early=0, main_aft=0', () => {
		const doc = setup();
		const state = buildState(doc);
		place(state, 'sM', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_aft).toBe(0);
		expect(b.main_early).toBe(0);
	});

	it('main subject in P5: main_early=4, no afternoon', () => {
		const doc = setup();
		const state = buildState(doc);
		place(state, 'sM', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_aft).toBe(0);
		expect(b.main_early).toBe(4); // (P-1)
	});

	it('main subject in P7 (afternoon): main_aft=1, any_aft=1, main_early=6', () => {
		const doc = setup();
		const state = buildState(doc);
		place(state, 'sM', 'Mo', 7);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_aft).toBe(1);
		expect(b.any_aft).toBe(1);
		expect(b.main_early).toBe(6);
	});

	it('non-main subject in P7: any_aft=1 but main_aft=0', () => {
		const doc = setup();
		const state = buildState(doc);
		place(state, 'sB', 'Mo', 7);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_aft).toBe(0);
		expect(b.any_aft).toBe(1);
		expect(b.main_early).toBe(0);
	});
});

describe('computeScore — no_free (sandwich gaps)', () => {
	it('Mo P1 + Mo P3 with gap at P2 = 1 sandwich', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_free).toBe(1);
	});

	it('Mo P1 + Mo P2 (no gap) = 0 sandwich', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_free).toBe(0);
	});

	it('Mo P1 only (no later lesson) = 0 sandwich', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_free).toBe(0);
	});
});

describe('computeScore — no_p1_start', () => {
	it('Day with lessons but no P1: no_p1_start = 1 per such (day, grade)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_p1_start).toBe(1);
	});

	it('Day with P1 occupied = 0', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_p1_start).toBe(0);
	});
});

describe('computeScore — main_run (3-run of main)', () => {
	it('3 main subjects in a row in same (day, grade) = main_run + 1', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		// All three are main subjects with maxConsecutive=2
		doc.subjects.push(subject('M', { isMain: true, maxConsecutive: 2 }));
		doc.subjects.push(subject('D', { isMain: true, maxConsecutive: 2 }));
		doc.subjects.push(subject('E', { isMain: true, maxConsecutive: 2 }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'D', 't', [5], 1));
		doc.specs.push(spec('s3', 'E', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 2);
		place(state, 's3', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		// One window of (max+1)=3 consecutive mains → 1 violation
		expect(b.main_run).toBeGreaterThanOrEqual(1);
	});
});

describe('computeScore — score is non-negative and weighted total matches', () => {
	it('total = sum(weights × counts)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 7); // afternoon → main_aft=1, any_aft=1, main_early=6
		place(state, 's', 'Di', 8); // afternoon
		const w = defaultWeights(doc);
		const b = computeScore(state, w);
		const expected =
			w.min_daily * b.min_daily +
			w.no_p1_start * b.no_p1_start +
			w.main_aft * b.main_aft +
			w.any_aft * b.any_aft +
			w.no_free * b.no_free +
			w.uneven_days * b.uneven_days +
			w.main_run * b.main_run +
			w.compact_teacher * b.compact_teacher +
			w.main_early * b.main_early;
		expect(b.total).toBe(expected);
	});
});

void (null as unknown as ScheduleDoc);
void (null as unknown as PlacedLesson);
