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
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
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

describe('unplaced (Solver-Opt R2)', () => {
	it('zählt ungeplante Units und gewichtet sie dominant', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 3));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		// Nur 1 von 3 platzieren.
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, w);
		expect(b.unplaced).toBe(2);
		expect(w.unplaced).toBe(100000);
		expect(b.total).toBeGreaterThanOrEqual(2 * 100000);
	});

	it('vollständiger Plan → unplaced 0; eine weggelassene Stunde verschlechtert den Total IMMER', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		// Nachmittags-Stunde: das Weglassen SPART any_aft — genau der Fall,
		// in dem der Solver vorher „lieber nicht platzieren" gelernt hat.
		doc.subjects.push(subject('PH'));
		doc.specs.push(spec('s', 'PH', 't', [5], 2));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		place(state, 's', 'Mo', 7);
		place(state, 's', 'Di', 7);
		const full = computeScore(state, w);
		expect(full.unplaced).toBe(0);
		// Eine Stunde entfernen → trotz gesparter Nachmittags-Penalty muss
		// der Total steigen (Dominanz der unplaced-Strafe).
		state.placement[state.units[1].idx] = -1;
		const partial = computeScore(state, w);
		expect(partial.unplaced).toBe(1);
		expect(partial.total).toBeGreaterThan(full.total);
	});

	it('unplacedPenalty.enabled=false schaltet die Strafe ab (RulesPanel-Toggle)', () => {
		const doc = emptyDoc();
		doc.constraints.unplacedPenalty = { enabled: false, weight: 100000 };
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		expect(w.unplaced).toBe(0);
		const b = computeScore(state, w); // nichts platziert
		expect(b.unplaced).toBe(2); // Zähler läuft weiter (Anzeige)
		expect(b.total).toBe(0);    // aber gewichtet 0
	});
});

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
		// uneven_days counts only ACTIVE days (under-loaded but >0 lessons).
		// Empty days are handled by min_daily/target_daily, not uneven_days.
		expect(breakdown.uneven_days).toBe(0);
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

	// Phase 13.1: Tagesrand-Lücken AM ANFANG zählen mit. Pädagogisch heißt
	// „Schule beginnt P3 statt P1" 2 Lücken für die Schüler — egal dass
	// nichts dazwischen frei ist.
	it('Mo P3 only counts 2 leading gaps (Phase 13.1)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		// firstP=2 (0-indexed), keine inner gaps. Leading = 2.
		expect(b.no_free).toBe(2);
	});

	it('Mo P3 + P5 counts 2 leading + 1 inner = 3', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 3);
		place(state, 's', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.no_free).toBe(3);
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
			w.main_early * b.main_early +
			w.time_pref * b.time_pref +
			w.subject_twice * b.subject_twice +
			w.spec_spread * b.spec_spread +
			w.teacher_late_start * b.teacher_late_start +
			w.teacher_under_min * b.teacher_under_min +
			w.target_daily * b.target_daily +
			w.afternoon_preferred * b.afternoon_preferred +
			w.main_twice * b.main_twice +
			w.main_block_split * b.main_block_split +
			w.teacher_gap_fairness * b.teacher_gap_fairness +
			w.teacher_days_present * b.teacher_days_present +
			w.teacher_lunch * b.teacher_lunch;
		expect(b.total).toBe(expected);
	});
});

describe('computeScore — time_pref (per-spec time-of-day preference)', () => {
	it('contributes 0 when no spec sets timePref', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 4);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.time_pref).toBe(0);
	});

	it('penalizes early-pref spec placed late (P=8 → distance 7)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		doc.specs[0].timePref = 'early';
		const state = buildState(doc);
		place(state, 's', 'Mo', 8);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.time_pref).toBe(7);
	});

	it('penalizes late-pref spec placed early (P=1 → distance 7)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5], 1));
		doc.specs[0].timePref = 'late';
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.time_pref).toBe(7);
	});

	it('zero penalty when late-pref is placed at P8', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push(spec('s', 'BSP', 't', [5], 1));
		doc.specs[0].timePref = 'late';
		const state = buildState(doc);
		place(state, 's', 'Mo', 8);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.time_pref).toBe(0);
	});

	it("'late'-pref suppresses any_aft / main_aft / main_early so the two penalties don't fight", () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		// EH = main subject for the test (any subject works — we want to see main_aft would normally fire)
		doc.subjects.push(subject('EH', { isMain: true }));
		doc.specs.push(spec('s', 'EH', 't', [7], 1));
		doc.specs[0].timePref = 'late';
		const state = buildState(doc);
		place(state, 's', 'Mo', 8); // afternoon, would normally trigger main_aft + any_aft + main_early
		const b = computeScore(state, defaultWeights(doc));
		expect(b.any_aft).toBe(0);
		expect(b.main_aft).toBe(0);
		expect(b.main_early).toBe(0);
		expect(b.time_pref).toBe(0); // P8 = ideal for late-pref
	});

	it('multi-grade spec contributes once per (occurrence, blockPos), not per grade', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		// grades=[7,8]: two grade-instances per slot. Penalty must NOT double.
		doc.specs.push(spec('s', 'BSP', 't', [7, 8], 1));
		doc.specs[0].timePref = 'late';
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		// distance from P8 (idx 7) to P1 (idx 0) = 7. Counted ONCE.
		expect(b.time_pref).toBe(7);
	});
});

describe('computeScore — subject_twice', () => {
	it('penalizes the same subject placed twice on the same (day, grade)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't1', [5], 1));
		doc.specs.push(spec('b', 'M', 't2', [5], 1));
		const state = buildState(doc);
		place(state, 'a', 'Mo', 1);
		place(state, 'b', 'Mo', 5); // same Mo, same grade 5, same subject M
		const b = computeScore(state, defaultWeights(doc));
		expect(b.subject_twice).toBe(1);
	});

	it('does not penalize the same subject across different days', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't1', [5], 1));
		doc.specs.push(spec('b', 'M', 't2', [5], 1));
		const state = buildState(doc);
		place(state, 'a', 'Mo', 1);
		place(state, 'b', 'Di', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.subject_twice).toBe(0);
	});
});

describe('computeScore — spec_spread', () => {
	it('penalizes when two occurrences of the same spec land on the same day', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 5); // both occurrences on Monday → 1 spread violation
		const b = computeScore(state, defaultWeights(doc));
		expect(b.spec_spread).toBe(1);
	});

	it('zero penalty when occurrences are on different days', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Di', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.spec_spread).toBe(0);
	});
});

describe('computeScore — min_daily', () => {
	it('penalizes (day, grade) with fewer lessons than minDailySlotsPerGrade', () => {
		const doc = emptyDoc();
		doc.constraints.minDailySlotsPerGrade = 4;
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		// Only 2 lessons on Mo/Stufe 5, target is 4 → 2 missing slots
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.min_daily).toBe(2);
	});

	it('zero penalty when day is empty (only counts ACTIVE days)', () => {
		const doc = emptyDoc();
		doc.constraints.minDailySlotsPerGrade = 4;
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		// Don't place anything → empty day, no min_daily penalty
		const b = computeScore(state, defaultWeights(doc));
		expect(b.min_daily).toBe(0);
	});
});

describe('computeScore — uneven_days', () => {
	it('penalizes only ACTIVE (day, grade) tuples under the target load', () => {
		const doc = emptyDoc();
		doc.constraints.minDailySlotsPerGrade = 4;
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 3));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		// uneven_days target = max(minDaily, 4) = 4. Mo/Stufe 5 has 3 occupied
		// periods → 1 missing. Other (day,grade) tuples have 0 occupied →
		// EXEMPT (uneven_days zählt nur aktive Tage; leere Tage werden durch
		// min_daily/target_daily abgedeckt).
		expect(b.uneven_days).toBe(1);
	});

	it('zero penalty when no (day, grade) is active', () => {
		const doc = emptyDoc();
		doc.constraints.minDailySlotsPerGrade = 4;
		const state = buildState(doc);
		// Empty doc, no specs → no occupied periods → no active days →
		// uneven_days = 0 (komplett leere Tage zählen NICHT).
		const b = computeScore(state, defaultWeights(doc));
		expect(b.uneven_days).toBe(0);
	});
});

describe('computeScore — compact_teacher (quadratic)', () => {
	it('1 sandwich gap → 1 penalty (1²)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		// Mo P1 + Mo P3 → P2 is a single sandwich gap for the teacher
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.compact_teacher).toBe(1);
	});

	it('zero gap when slots are contiguous', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.compact_teacher).toBe(0);
	});

	it('2 gaps on the SAME day → 4 penalty (2², not 2)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		// Mo P1 + Mo P4 → P2 + P3 are TWO sandwich gaps in one day
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 4);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.compact_teacher).toBe(4);
	});

	it('3 gaps on the same day → 9 penalty', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		// Mo P1 + Mo P5 → P2, P3, P4 are three sandwich gaps
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.compact_teacher).toBe(9);
	});

	it('1 gap on Mo + 1 gap on Di → 2 penalty (1² + 1², per-day)', () => {
		// Important: the penalty is squared PER DAY, not over the whole week.
		// Two separate days with 1 gap each = 1 + 1 = 2, NOT (1+1)² = 4.
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't', [5], 1));
		doc.specs.push(spec('b', 'M', 't', [6], 1));
		doc.specs.push(spec('c', 'M', 't', [7], 1));
		doc.specs.push(spec('d', 'M', 't', [8], 1));
		const state = buildState(doc);
		// Mo: P1 + P3 (gap at P2). Di: P1 + P3 (gap at P2). Each day 1 gap.
		place(state, 'a', 'Mo', 1);
		place(state, 'b', 'Mo', 3);
		place(state, 'c', 'Di', 1);
		place(state, 'd', 'Di', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.compact_teacher).toBe(2);
	});
});

describe('computeScore — teacher_under_min', () => {
	it('penalizes a teacher day with 1 lesson when min=2', () => {
		const doc = emptyDoc();
		doc.constraints.teacherMinLessonsPerDay = { enabled: true, weight: 150, min: 2 };
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_under_min).toBe(1);
	});

	it('zero penalty when teacher has min lessons or more', () => {
		const doc = emptyDoc();
		doc.constraints.teacherMinLessonsPerDay = { enabled: true, weight: 150, min: 2 };
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't', [5], 1));
		doc.specs.push(spec('b', 'M', 't', [6], 1));
		const state = buildState(doc);
		place(state, 'a', 'Mo', 1);
		place(state, 'b', 'Mo', 2);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_under_min).toBe(0);
	});

	it('zero penalty for free days (0 lessons)', () => {
		const doc = emptyDoc();
		doc.constraints.teacherMinLessonsPerDay = { enabled: true, weight: 150, min: 2 };
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// No specs placed — teacher has 0 lessons everywhere → no penalty.
		const state = buildState(doc);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_under_min).toBe(0);
	});

	it('cumulates: two single-lesson days = 2 penalty', () => {
		const doc = emptyDoc();
		doc.constraints.teacherMinLessonsPerDay = { enabled: true, weight: 150, min: 2 };
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't', [5], 1));
		doc.specs.push(spec('b', 'M', 't', [6], 1));
		const state = buildState(doc);
		place(state, 'a', 'Mo', 1);
		place(state, 'b', 'Di', 1);
		const b = computeScore(state, defaultWeights(doc));
		// Mo: 1 lesson, missing 1. Di: 1 lesson, missing 1. Total: 2.
		expect(b.teacher_under_min).toBe(2);
	});
});

describe('computeScore — teacher_late_start', () => {
	it('penalizes a teacher whose first lesson is at P3 (free in P1)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'Spätstarter'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		// Mo P3 = idx 2 → late_start += 2
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_late_start).toBe(2);
	});

	it('zero penalty when teacher starts at P1', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_late_start).toBe(0);
	});

	it('exempts teachers blocked at P1 (Sperrstunde)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'Teilzeit'));
		doc.teachers[0].unavailable = [
			{ day: 'Mo', period: 1 },
			{ day: 'Mo', period: 2 }
		];
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_late_start).toBe(0);
	});

	it('cumulates over multiple teacher-days', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('a', 'M', 't', [5], 1));
		doc.specs.push(spec('b', 'M', 't', [6], 1));
		const state = buildState(doc);
		place(state, 'a', 'Mo', 2); // late_start += 1
		place(state, 'b', 'Di', 3); // late_start += 2
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_late_start).toBe(3);
	});
});

// --- Phase 13: target_daily + afternoon_preferred ---

describe('computeScore — target_daily (Phase 13)', () => {
	it('is 0 when daily lessons match target', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// 6 Specs für 1 Stufe an einem Tag = target_daily = 0 für diesen Tag
		for (let i = 0; i < 6; i++) {
			doc.specs.push(spec(`s${i}`, 'M', 't', [5], 1));
		}
		const state = buildState(doc);
		// Alle 6 auf Mo P1..P6
		for (let p = 1; p <= 6; p++) {
			place(state, `s${p - 1}`, 'Mo', p as Period);
		}
		const b = computeScore(state, defaultWeights(doc));
		// Mo: 6 Stunden = target → diff 0. Andere Tage: 0 Stunden, ausgenommen.
		expect(b.target_daily).toBe(0);
	});

	it('charges (actual-target)² when above target', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		for (let i = 0; i < 8; i++) {
			doc.specs.push(spec(`s${i}`, 'M', 't', [5], 1));
		}
		const state = buildState(doc);
		// 8 Stunden Mo: Abweichung 2 → Penalty 4
		for (let p = 1; p <= 8; p++) {
			place(state, `s${p - 1}`, 'Mo', p as Period);
		}
		const b = computeScore(state, defaultWeights(doc));
		expect(b.target_daily).toBe(4);
	});

	it('charges (actual-target)² when below target (active days only)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		for (let i = 0; i < 4; i++) {
			doc.specs.push(spec(`s${i}`, 'M', 't', [5], 1));
		}
		const state = buildState(doc);
		// 4 Stunden Mo: Abweichung -2 → Penalty 4. Andere Tage 0 → exempt.
		for (let p = 1; p <= 4; p++) {
			place(state, `s${p - 1}`, 'Mo', p as Period);
		}
		const b = computeScore(state, defaultWeights(doc));
		expect(b.target_daily).toBe(4);
	});

	it('exempts inactive (0 lessons) days', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s0', 'M', 't', [5], 1));
		const state = buildState(doc);
		// Nur 1 Stunde an Mo, andere Tage ganz leer.
		place(state, 's0', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		// Mo: (1-6)² = 25. Andere Tage 0 (exempt). Andere Stufen 0 (exempt).
		expect(b.target_daily).toBe(25);
	});
});

// --- Phase 13.3: main_twice + main_block_split ---

describe('computeScore — main_twice (Phase 13.3)', () => {
	it('is 0 when main subject appears once', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_twice).toBe(0);
	});

	it('is 0 when main subject appears twice (allowed)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_twice).toBe(0);
	});

	it('charges 1 for 3 occurrences of same main subject on same day', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		doc.specs.push(spec('s3', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 3);
		place(state, 's3', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_twice).toBe(1); // 3 - 2 = 1
	});

	it('does not trigger for non-main subjects (subject_twice covers them)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP', { isMain: false }));
		doc.specs.push(spec('s1', 'BSP', 't', [5], 1));
		doc.specs.push(spec('s2', 'BSP', 't', [5], 1));
		doc.specs.push(spec('s3', 'BSP', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 3);
		place(state, 's3', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_twice).toBe(0);
		expect(b.subject_twice).toBe(2); // 3 - 1 = 2
	});
});

describe('computeScore — main_block_split (Phase 13.3)', () => {
	it('is 0 when main subject appears once', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_block_split).toBe(0);
	});

	it('is 0 for two consecutive single-period occurrences (P1 + P2)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 2);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_block_split).toBe(0);
	});

	it('charges N gap-slots when two main occurrences split the day', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		// Block 1 endet P1, Block 2 startet P5 → Lücke = 5 - 1 - 1 = 3.
		expect(b.main_block_split).toBe(3);
	});

	it('does not trigger when 3+ occurrences (handled by main_twice)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't', [5], 1));
		doc.specs.push(spec('s2', 'M', 't', [5], 1));
		doc.specs.push(spec('s3', 'M', 't', [5], 1));
		const state = buildState(doc);
		place(state, 's1', 'Mo', 1);
		place(state, 's2', 'Mo', 3);
		place(state, 's3', 'Mo', 5);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.main_block_split).toBe(0); // skipped, only on v===2
		expect(b.main_twice).toBe(1);
	});
});

describe('computeScore — afternoon_preferred (Phase 13)', () => {
	it('is 0 for an allowed-Spec, regardless of position', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BSP'));
		doc.specs.push({ ...spec('s', 'BSP', 't', [5], 1), afternoonAllowed: 'allowed' });
		const state = buildState(doc);
		place(state, 's', 'Mo', 3); // morning
		const b = computeScore(state, defaultWeights(doc));
		expect(b.afternoon_preferred).toBe(0);
	});

	it('charges 1 for a preferred-Spec placed in the morning', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BBO'));
		doc.specs.push({ ...spec('s', 'BBO', 't', [5], 1), afternoonAllowed: 'preferred' });
		const state = buildState(doc);
		place(state, 's', 'Mo', 4); // P4 = morning
		const b = computeScore(state, defaultWeights(doc));
		expect(b.afternoon_preferred).toBe(1);
	});

	it('is 0 for a preferred-Spec placed in the afternoon', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('BBO'));
		doc.specs.push({ ...spec('s', 'BBO', 't', [5], 1), afternoonAllowed: 'preferred' });
		const state = buildState(doc);
		place(state, 's', 'Mo', 7);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.afternoon_preferred).toBe(0);
	});
});

// --- Solver-Opt Schritt 3: Lehrer-Qualitäts-Komponenten ---

describe('computeScore — teacher_gap_fairness (Wochen-Lücken pro Lehrer, quadratisch)', () => {
	it('0 bei lückenlosen Tagen', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 2));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2); // konsekutiv, keine Lücke
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_gap_fairness).toBe(0);
	});

	it('Klumpung kostet quadratisch: 2 Lücken bei EINEM Lehrer = 4', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		// Mo: P1 + P3 (1 Lücke bei P2), Di: P1 + P3 (1 Lücke) → weekGaps=2 → 2²=4
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 3);
		place(state, 's', 'Di', 1);
		place(state, 's', 'Di', 3);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_gap_fairness).toBe(4);
		// compact_teacher sieht nur 1²+1²=2 (pro Tag) — genau die Lücke die
		// gap_fairness schließt.
		expect(b.compact_teacher).toBe(2);
	});

	it('Verteilung auf 2 Lehrer ist billiger als Klumpung bei einem', () => {
		// Lehrer A mit 2 Lücken (2²=4) vs Lehrer A+B mit je 1 Lücke (1+1=2)
		const mk = (twoTeachers: boolean) => {
			const doc = emptyDoc();
			doc.teachers.push(teacher('t1', 'L1'));
			doc.teachers.push(teacher('t2', 'L2'));
			doc.subjects.push(subject('M'));
			if (twoTeachers) {
				doc.specs.push(spec('a', 'M', 't1', [5], 2));
				doc.specs.push(spec('b', 'M', 't2', [6], 2));
			} else {
				doc.specs.push(spec('a', 'M', 't1', [5], 2));
				doc.specs.push(spec('b', 'M', 't1', [6], 2));
			}
			const state = buildState(doc);
			// Spec a: Mo P1+P3 (Lücke), Spec b: Di P1+P3 (Lücke)
			place(state, 'a', 'Mo', 1);
			place(state, 'a', 'Mo', 3);
			place(state, 'b', 'Di', 1);
			place(state, 'b', 'Di', 3);
			return computeScore(state, defaultWeights(doc));
		};
		const clumped = mk(false);   // beide Lücken bei t1
		const spread = mk(true);     // je 1 Lücke bei t1 und t2
		expect(clumped.teacher_gap_fairness).toBe(4);
		expect(spread.teacher_gap_fairness).toBe(2);
	});
});

describe('computeScore — teacher_days_present (Anwesenheitstage über Ideal)', () => {
	it('0 wenn Stunden auf Ideal-Tage konzentriert (4h an 1 Tag)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		place(state, 's', 'Mo', 3);
		place(state, 's', 'Mo', 4);
		const b = computeScore(state, defaultWeights(doc));
		// 4 Stunden → Ideal ceil(4/6)=1 Tag, präsent 1 Tag → 0
		expect(b.teacher_days_present).toBe(0);
	});

	it('bestraft Verstreuung: 4h an 4 Tagen = 3 Tage über Ideal', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 4));
		const state = buildState(doc);
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Di', 1);
		place(state, 's', 'Mi', 1);
		place(state, 's', 'Do', 1);
		const b = computeScore(state, defaultWeights(doc));
		// Ideal 1 Tag, präsent 4 → Penalty 3
		expect(b.teacher_days_present).toBe(3);
	});

	it('Vollzeit-artige Last ist exempt: 12h an 2 Tagen = Ideal', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't', [5], 6));
		doc.specs.push(spec('s2', 'D', 't', [6], 6));
		const state = buildState(doc);
		for (let p = 1; p <= 6; p++) place(state, 's1', 'Mo', p as Period);
		for (let p = 1; p <= 6; p++) place(state, 's2', 'Di', p as Period);
		const b = computeScore(state, defaultWeights(doc));
		// 12 Stunden → Ideal ceil(12/6)=2 Tage, präsent 2 → 0
		expect(b.teacher_days_present).toBe(0);
	});
});

describe('computeScore — teacher_lunch (Mittagspause bei langen Tagen)', () => {
	function longDayDoc() {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 6));
		return doc;
	}

	it('zählt 1 bei >=6h mit Vormittag+Nachmittag und belegtem P5+P6', () => {
		const doc = longDayDoc();
		const state = buildState(doc);
		// P1, P2, P5, P6, P7, P8 → 6h, Vormittag (P1), Nachmittag (P7), P5+P6 belegt
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		place(state, 's', 'Mo', 5);
		place(state, 's', 'Mo', 6);
		place(state, 's', 'Mo', 7);
		place(state, 's', 'Mo', 8);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_lunch).toBe(1);
	});

	it('0 wenn P5 frei bleibt (Pause vorhanden)', () => {
		const doc = longDayDoc();
		const state = buildState(doc);
		// P1-P4 + P6 + P7 → 6h, P5 frei → Pause möglich
		place(state, 's', 'Mo', 1);
		place(state, 's', 'Mo', 2);
		place(state, 's', 'Mo', 3);
		place(state, 's', 'Mo', 4);
		place(state, 's', 'Mo', 6);
		place(state, 's', 'Mo', 7);
		const b = computeScore(state, defaultWeights(doc));
		expect(b.teacher_lunch).toBe(0);
	});

	it('Gewicht ist per Default 0 (teacherMiddayBreak.enabled=false) — Zähler zählt trotzdem', () => {
		const doc = longDayDoc();
		const w = defaultWeights(doc);
		expect(w.teacher_lunch).toBe(0);
		// Aktiviert → Gewicht greift
		doc.constraints.teacherMiddayBreak.enabled = true;
		const w2 = defaultWeights(doc);
		expect(w2.teacher_lunch).toBe(100);
	});
});

void (null as unknown as ScheduleDoc);
void (null as unknown as PlacedLesson);
