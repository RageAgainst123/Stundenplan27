import { describe, it, expect } from 'vitest';
import { encode, slotFromDayPeriod, dayPeriodFromSlot } from './encode';
import { decode } from './decode';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from '../types';

function makeDoc() {
	const doc = emptyDoc('2026/27');
	const tA: Teacher = {
		id: 'tA',
		name: 'Lehrer A',
		shortNumber: 1,
		color: '#000',
		subjects: ['M'],
		unavailable: []
	};
	const tB: Teacher = {
		id: 'tB',
		name: 'Lehrer B',
		shortNumber: 2,
		color: '#000',
		subjects: ['D'],
		unavailable: [{ day: 'Mo', period: 1 }]
	};
	doc.teachers.push(tA, tB);

	const m: Subject = { code: 'M', name: 'Mathe', category: 'PG', isMain: true, hoursPerWeek: {} };
	const d: Subject = { code: 'D', name: 'Deutsch', category: 'PG', isMain: true, hoursPerWeek: {} };
	doc.subjects.push(m, d);

	const sM: LessonSpec = {
		id: 'sM',
		subject: 'M',
		teacher: 'tA',
		classes: ['1a'],
		grades: [5],
		weekPattern: 'every',
		count: 4,
		blocks: [1, 1, 1, 1],
		includeInSolver: true,
		source: 'manual'
	};
	const sD: LessonSpec = {
		id: 'sD',
		subject: 'D',
		teacher: 'tB',
		classes: ['1a'],
		grades: [5],
		weekPattern: 'every',
		count: 3,
		blocks: [1, 1, 1],
		includeInSolver: true,
		source: 'manual'
	};
	doc.specs.push(sM, sD);
	return doc;
}

describe('slot indexing', () => {
	it('round-trips day/period through slot index', () => {
		const cases: Array<['Mo' | 'Di' | 'Mi' | 'Do' | 'Fr', number]> = [
			['Mo', 1],
			['Mo', 8],
			['Fr', 1],
			['Fr', 8],
			['Mi', 4]
		];
		for (const [day, period] of cases) {
			const s = slotFromDayPeriod(day, period as 1);
			expect(s).toBeGreaterThanOrEqual(1);
			expect(s).toBeLessThanOrEqual(40);
			const back = dayPeriodFromSlot(s);
			expect(back.day).toBe(day);
			expect(back.period).toBe(period);
		}
	});

	it('Mo period 1 = slot 1', () => {
		expect(slotFromDayPeriod('Mo', 1)).toBe(1);
	});
	it('Fr period 8 = slot 40', () => {
		expect(slotFromDayPeriod('Fr', 8)).toBe(40);
	});
});

describe('encode', () => {
	it('expands count into individual lesson instances', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		expect(enc.L).toBe(7); // 4 Mathe + 3 Deutsch
		expect(enc.instances.filter(i => i.specId === 'sM')).toHaveLength(4);
		expect(enc.instances.filter(i => i.specId === 'sD')).toHaveLength(3);
	});

	it('maps teacher IDs to 1-based indices', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		expect(enc.T).toBe(2);
		expect(enc.instances.find(i => i.specId === 'sM')!.teacherIndex1).toBe(1);
		expect(enc.instances.find(i => i.specId === 'sD')!.teacherIndex1).toBe(2);
	});

	it('shifts grade levels (5..8) to 1-based set indices (1..4)', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		expect(enc.instances[0].gradesSet).toEqual([1]);
	});

	it('produces DZN data with teacher_blocked reflecting unavailability', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		// teacher 2 (Lehrer B) is blocked at (Mo, period 1)
		expect(dzn).toContain('teacher_blocked');
		expect(dzn).toContain('array3d');
		// At least one "true" appears in the teacher_blocked literal
		expect(dzn.match(/teacher_blocked[^;]*true/s)).toBeTruthy();
	});

	it('encodes pinning via pin_slot', () => {
		const doc = makeDoc();
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, grade: 5, pinned: true });
		const enc = encode(doc);
		const sMInstances = enc.instances.filter(i => i.specId === 'sM');
		expect(sMInstances.filter(i => i.pinned)).toHaveLength(1);
		expect(sMInstances.find(i => i.pinned)!.pinSlot1).toBe(1);
	});

	it('assigns same group id to specs sharing couplingId', () => {
		const doc = makeDoc();
		doc.specs[0].couplingId = 'KopplungA';
		doc.specs[1].couplingId = 'KopplungA';
		const enc = encode(doc);
		const gM = enc.instances.find(i => i.specId === 'sM')!.groupId;
		const gD = enc.instances.find(i => i.specId === 'sD')!.groupId;
		expect(gM).toBeGreaterThan(0);
		expect(gM).toBe(gD);
	});

	it('Phase 8: multi-grade siblings of one occurrence share a synthetic occurrence groupId', () => {
		// Regression test for the user-reported "BSP 7+8 split across day/period"
		// bug. A spec with grades=[7,8] count=1 must NOT let the solver place
		// the grade-7 instance and grade-8 instance on different slots.
		// We bind them via a non-zero synthetic occurrence groupId; constraint
		// 4b in model.mzn then forces same (day, period).
		const doc = emptyDoc('2026/27');
		doc.teachers.push({
			id: 't', name: 'Schlegel', shortNumber: 1, color: '#000',
			subjects: ['BSP'], unavailable: []
		});
		doc.subjects.push({
			code: 'BSP', name: 'BSP', category: 'PG', isMain: false,
			hoursPerWeek: {}, maxConsecutive: 99
		});
		doc.specs.push({
			id: 's', subject: 'BSP', teacher: 't', classes: ['2a'],
			grades: [7, 8], weekPattern: 'every', count: 1, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		// Two instances (grade 7 + grade 8), both auto-mode.
		expect(enc.instances).toHaveLength(2);
		const [g7, g8] = enc.instances;
		expect(g7.groupId).toBeGreaterThan(0);
		expect(g7.groupId).toBe(g8.groupId);
	});

	it('Phase 8: single-grade spec without coupling has groupId=0', () => {
		// Single-grade specs need no synthetic occurrence group — they have
		// only one instance per occurrence. groupId stays 0 = no constraint.
		const doc = emptyDoc('2026/27');
		doc.teachers.push({
			id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: []
		});
		doc.subjects.push({
			code: 'M', name: 'M', category: 'PG', isMain: true, hoursPerWeek: {}
		});
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'],
			grades: [5], weekPattern: 'every', count: 2, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.instances).toHaveLength(2);
		expect(enc.instances.every(i => i.groupId === 0)).toBe(true);
	});

	it('Phase 8 v3: groupLabel does NOT couple specs in the solver', () => {
		const doc = makeDoc();
		// Same descriptive label, but no couplingId — solver must keep them
		// independent. Both are single-grade specs without a coupling, so
		// they should have groupId=0 (no group constraint), NOT some shared
		// non-zero id that would force them onto the same slot.
		doc.specs[0].groupLabel = 'DGB 1/2';
		doc.specs[1].groupLabel = 'DGB 1/2';
		const enc = encode(doc);
		const gM = enc.instances.find(i => i.specId === 'sM')!.groupId;
		const gD = enc.instances.find(i => i.specId === 'sD')!.groupId;
		// 0 = no group; the constraint that forces same-slot is keyed on
		// group_id != 0, so both being 0 means "no coupling" → correct.
		expect(gM).toBe(0);
		expect(gD).toBe(0);
	});

	it('handles empty doc gracefully', () => {
		const doc = emptyDoc();
		const enc = encode(doc);
		expect(enc.L).toBe(0);
		expect(enc.instances).toHaveLength(0);
	});
});

// ----- Phase 7A regression suite (multi-grade specs + pinning) -----

import { slotFromDPG } from './encode';

function makeMultiGradeDoc() {
	const doc = emptyDoc('2026/27');
	const t: Teacher = {
		id: 'tREL',
		name: 'Simon Maximilian',
		shortNumber: 9,
		color: '#a855f7',
		subjects: ['REL'],
		// Only Wednesday available (block all other days)
		unavailable: [
			{ day: 'Mo', period: 1 }, { day: 'Mo', period: 2 }, { day: 'Mo', period: 3 }, { day: 'Mo', period: 4 },
			{ day: 'Mo', period: 5 }, { day: 'Mo', period: 6 }, { day: 'Mo', period: 7 }, { day: 'Mo', period: 8 },
			{ day: 'Di', period: 1 }, { day: 'Di', period: 2 }, { day: 'Di', period: 3 }, { day: 'Di', period: 4 },
			{ day: 'Di', period: 5 }, { day: 'Di', period: 6 }, { day: 'Di', period: 7 }, { day: 'Di', period: 8 },
			{ day: 'Do', period: 1 }, { day: 'Do', period: 2 }, { day: 'Do', period: 3 }, { day: 'Do', period: 4 },
			{ day: 'Do', period: 5 }, { day: 'Do', period: 6 }, { day: 'Do', period: 7 }, { day: 'Do', period: 8 },
			{ day: 'Fr', period: 1 }, { day: 'Fr', period: 2 }, { day: 'Fr', period: 3 }, { day: 'Fr', period: 4 },
			{ day: 'Fr', period: 5 }, { day: 'Fr', period: 6 }, { day: 'Fr', period: 7 }, { day: 'Fr', period: 8 }
		]
	};
	doc.teachers.push(t);
	const rel: Subject = {
		code: 'REL',
		name: 'Religion',
		category: 'PG',
		isMain: false,
		hoursPerWeek: {},
		maxConsecutive: 99
	};
	doc.subjects.push(rel);
	// REL für 6+7 Schulstufe (cross-class wie in Sokrates)
	const sREL67: LessonSpec = {
		id: 'sREL67',
		subject: 'REL',
		teacher: 'tREL',
		classes: ['1a', '2a'],
		grades: [6, 7],
		weekPattern: 'every',
		count: 2,
		blocks: [1, 1],
		includeInSolver: true,
		source: 'manual'
	};
	const sREL78: LessonSpec = {
		id: 'sREL78',
		subject: 'REL',
		teacher: 'tREL',
		classes: ['2a'],
		grades: [7, 8],
		weekPattern: 'every',
		count: 2,
		blocks: [1, 1],
		includeInSolver: true,
		source: 'manual'
	};
	doc.specs.push(sREL67, sREL78);
	return doc;
}

describe('phase 7A: multi-grade pinning bug', () => {
	it('a multi-grade spec with grades=[6,7] expands to 2 instances per occurrence', () => {
		const doc = makeMultiGradeDoc();
		const enc = encode(doc);
		const sREL67Inst = enc.instances.filter(i => i.specId === 'sREL67');
		// count=2, grades=[6,7] → 2 occurrences × 2 grades = 4 instances
		expect(sREL67Inst).toHaveLength(4);
	});

	it('pinning a multi-grade spec produces a per-grade pin slot, not just grade[0]', () => {
		const doc = makeMultiGradeDoc();
		// Pin REL_67 on (Mi, 1)
		// Phase 8 v2: pin both grade columns of the multi-grade spec.
		doc.placed.push({ specId: 'sREL67', day: 'Mi', period: 1, grade: 6, pinned: true });
		doc.placed.push({ specId: 'sREL67', day: 'Mi', period: 1, grade: 7, pinned: true });
		const enc = encode(doc);
		const pinnedInst = enc.instances.filter(i => i.specId === 'sREL67' && i.pinned);
		// At least one instance per grade should be pinned
		expect(pinnedInst.length).toBeGreaterThanOrEqual(2);
		// Each pinned instance should have a slot whose grade matches its own gradesSet
		for (const inst of pinnedInst) {
			expect(inst.pinSlot1).toBeGreaterThan(0);
			const gradeFromSlot = ((inst.pinSlot1! - 1) % 4) + 1; // G=4
			// gradesSet[0] is 1-based grade index (5→1 etc), should equal gradeFromSlot
			expect(inst.gradesSet[0]).toBe(gradeFromSlot);
		}
	});

	it('all pinned instances of a single (day,period) are gradeOf-consistent with their gradesSet', () => {
		const doc = makeMultiGradeDoc();
		doc.placed.push({ specId: 'sREL67', day: 'Mi', period: 1, grade: 6, pinned: true });
		doc.placed.push({ specId: 'sREL67', day: 'Mi', period: 1, grade: 7, pinned: true });
		doc.placed.push({ specId: 'sREL78', day: 'Mi', period: 3, grade: 7, pinned: true });
		doc.placed.push({ specId: 'sREL78', day: 'Mi', period: 3, grade: 8, pinned: true });
		const enc = encode(doc);
		// For every pinned instance: pinSlot's grade must match the instance's lesson_grades
		for (const inst of enc.instances.filter(i => i.pinned)) {
			const gradeFromSlot = ((inst.pinSlot1! - 1) % 4) + 1;
			expect(inst.gradesSet).toContain(gradeFromSlot);
		}
	});
});

describe('phase 7A: subject_max_consec edge case', () => {
	it('subject without explicit maxConsecutive defaults to 99 (no run limit)', () => {
		const doc = makeMultiGradeDoc();
		const enc = encode(doc);
		expect(enc.subjectMaxConsec.length).toBe(1);
		expect(enc.subjectMaxConsec[0]).toBe(99);
	});

	it('main subject with maxConsecutive=2 emits 2 in DZN', () => {
		const doc = emptyDoc();
		doc.subjects.push({
			code: 'M', name: 'Mathe', category: 'PG', isMain: true,
			hoursPerWeek: {}, maxConsecutive: 2
		});
		doc.teachers.push({
			id: 't', name: 'L', shortNumber: 1, color: '#000',
			subjects: ['M'], unavailable: []
		});
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't',
			classes: ['1a'], grades: [5], weekPattern: 'every',
			count: 4, blocks: [1,1,1,1], includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.subjectMaxConsec[0]).toBe(2);
	});
});

void slotFromDPG;

// ----- Phase 7B-1: Auto-Block-Modus -----

describe('phase 7B: auto-block mode', () => {
	function autoModeDoc() {
		const doc = emptyDoc('2026/27');
		doc.teachers.push({
			id: 't', name: 'L', shortNumber: 1, color: '#000',
			subjects: ['M'], unavailable: []
		});
		doc.subjects.push({
			code: 'M', name: 'Mathe', category: 'PG', isMain: true,
			hoursPerWeek: {}, maxConsecutive: 2
		});
		return doc;
	}

	it('blocks=undefined → emits count flexible auto-mode instances with blockId=-1', () => {
		const doc = autoModeDoc();
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 3, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.instances).toHaveLength(3);
		for (const inst of enc.instances) {
			expect(inst.autoMode).toBe(true);
			expect(inst.blockId).toBe(-1);
			expect(inst.blockSize).toBe(1);
		}
	});

	it('blocks=[2,1] → strict mode, autoMode=false on every instance, blockId set on the doublet', () => {
		const doc = autoModeDoc();
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 3, blocks: [2, 1],
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.instances).toHaveLength(3);
		for (const inst of enc.instances) {
			expect(inst.autoMode).toBe(false);
		}
		// Two instances form the doublet (blockId ≥ 0, blockSize=2),
		// one is standalone (blockId=-1, blockSize=1)
		const doublet = enc.instances.filter(i => i.blockId >= 0);
		const standalone = enc.instances.filter(i => i.blockId < 0);
		expect(doublet).toHaveLength(2);
		expect(standalone).toHaveLength(1);
		expect(doublet[0].blockId).toBe(doublet[1].blockId);
		expect(doublet[0].blockSize).toBe(2);
		expect(standalone[0].blockSize).toBe(1);
	});

	it('blocks=[1,1,1] → strict mode singles, autoMode=false', () => {
		const doc = autoModeDoc();
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 3, blocks: [1, 1, 1],
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.instances).toHaveLength(3);
		for (const inst of enc.instances) {
			expect(inst.autoMode).toBe(false);
			expect(inst.blockId).toBe(-1);
			expect(inst.blockSize).toBe(1);
		}
	});

	it('mixed doc (auto + strict specs) → each spec keeps its mode', () => {
		const doc = autoModeDoc();
		doc.subjects.push({
			code: 'D', name: 'Deutsch', category: 'PG', isMain: true,
			hoursPerWeek: {}, maxConsecutive: 2
		});
		doc.specs.push({
			id: 'sAuto', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 3, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		doc.specs.push({
			id: 'sStrict', subject: 'D', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 2, blocks: [2],
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		const auto = enc.instances.filter(i => i.specId === 'sAuto');
		const strict = enc.instances.filter(i => i.specId === 'sStrict');
		expect(auto.every(i => i.autoMode)).toBe(true);
		expect(strict.every(i => !i.autoMode)).toBe(true);
		expect(strict[0].blockSize).toBe(2);
		expect(strict[0].blockId).toBe(strict[1].blockId);
	});

	it('emits lesson_auto[] in DZN with one bool per instance', () => {
		const doc = autoModeDoc();
		doc.specs.push({
			id: 's1', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 2, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('lesson_auto');
		// Two instances, both auto → expect "true,true" pattern
		expect(dzn).toMatch(/lesson_auto = \[true,true\]/);
	});

	it('blocks=[] (empty array) is treated as auto mode', () => {
		const doc = autoModeDoc();
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 2, blocks: [],
			includeInSolver: true, source: 'manual'
		});
		const enc = encode(doc);
		expect(enc.instances).toHaveLength(2);
		expect(enc.instances.every(i => i.autoMode)).toBe(true);
	});
});

// ----- Phase 9: Tagespensum + Doppel-Cohesion + Nachmittag-für-alle -----

describe('phase 9: encoder DZN parameters', () => {
	function configuredDoc() {
		const doc = emptyDoc('2026/27');
		doc.teachers.push({
			id: 't', name: 'L', shortNumber: 1, color: '#000', subjects: [], unavailable: []
		});
		doc.subjects.push({
			code: 'M', name: 'Mathe', category: 'PG', isMain: true, hoursPerWeek: {}
		});
		doc.specs.push({
			id: 's', subject: 'M', teacher: 't', classes: ['1a'], grades: [5],
			weekPattern: 'every', count: 2, blocks: undefined,
			includeInSolver: true, source: 'manual'
		});
		return doc;
	}

	it('emits min_daily_slots from constraints (default 4)', () => {
		const doc = configuredDoc();
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('min_daily_slots = 4;');
	});

	it('emits min_daily_slots = 0 when constraint disabled', () => {
		const doc = configuredDoc();
		doc.constraints.minDailySlotsPerGrade = 0;
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('min_daily_slots = 0;');
	});

	it('emits w_any_aft when applyToAllSubjects is true', () => {
		const doc = configuredDoc();
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		// Phase 10: default weight raised from 15 to 50 to actually push
		// non-main subjects off afternoon slots.
		expect(dzn).toContain('w_any_aft = 50;');
	});

	it('emits w_any_aft = 0 when applyToAllSubjects is false', () => {
		const doc = configuredDoc();
		doc.constraints.noMainSubjectAfternoon.applyToAllSubjects = false;
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('w_any_aft = 0;');
	});

	it('emits w_any_aft = 0 when entire afternoon constraint is disabled', () => {
		const doc = configuredDoc();
		doc.constraints.noMainSubjectAfternoon.enabled = false;
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('w_any_aft = 0;');
		expect(dzn).toContain('w_main_aft = 0;');
	});

	it('Phase 10: emits must_start_p1 = true by default', () => {
		const doc = configuredDoc();
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('must_start_p1 = true;');
	});

	it('Phase 10: emits must_start_p1 = false when disabled', () => {
		const doc = configuredDoc();
		doc.constraints.mustStartFirstPeriod.enabled = false;
		const enc = encode(doc);
		const dzn = (enc.dataJson as any).__dzn as string;
		expect(dzn).toContain('must_start_p1 = false;');
	});
});

describe('decode', () => {
	it('maps assign array back to PlacedLessons', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		// Synthetic: 7 instances → 7 distinct slots (1..7 = Mo period 1..7)
		const fakeOutput = JSON.stringify({ assign: [1, 2, 3, 4, 5, 6, 7] });
		const result = decode(fakeOutput, enc.instances);
		expect(result.status).toBe('SAT');
		expect(result.placed).toHaveLength(7);
		expect(result.placed[0].day).toBe('Mo');
		expect(result.placed[0].period).toBe(1);
	});

	it('parses penalty breakdown from solver output (Phase 7B + 9)', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const fakeOutput = JSON.stringify({
			assign: [1, 2, 3, 4, 5, 6, 7],
			penalties: { main_aft: 0, any_aft: 4, main_early: 12, main_run: 1, no_free: 3, uneven_days: 5, compact: 2, total: 595 }
		});
		const result = decode(fakeOutput, enc.instances);
		expect(result.status).toBe('SAT');
		expect(result.penalties).toBeDefined();
		expect(result.penalties!.total).toBe(595);
		expect(result.penalties!.any_aft).toBe(4);
		expect(result.penalties!.uneven_days).toBe(5);
	});

	it('omits penalties when solver output lacks them', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const fakeOutput = JSON.stringify({ assign: [1, 2, 3, 4, 5, 6, 7] });
		const result = decode(fakeOutput, enc.instances);
		expect(result.penalties).toBeUndefined();
	});

	it('reports ERROR when output cannot be parsed', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const result = decode('not json', enc.instances);
		expect(result.status).toBe('ERROR');
	});

	it('reports UNSAT when output is null', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const result = decode(null, enc.instances);
		expect(result.status).toBe('UNSAT');
	});

	it('reports ERROR when assign length mismatch', () => {
		const doc = makeDoc();
		const enc = encode(doc);
		const result = decode(JSON.stringify({ assign: [1, 2] }), enc.instances);
		expect(result.status).toBe('ERROR');
	});
});
