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
		doc.placed.push({ specId: 'sM', day: 'Mo', period: 1, pinned: true });
		const enc = encode(doc);
		const sMInstances = enc.instances.filter(i => i.specId === 'sM');
		expect(sMInstances.filter(i => i.pinned)).toHaveLength(1);
		expect(sMInstances.find(i => i.pinned)!.pinSlot1).toBe(1);
	});

	it('assigns same group id to specs sharing groupKey', () => {
		const doc = makeDoc();
		doc.specs[0].groupKey = 'KopplungA';
		doc.specs[1].groupKey = 'KopplungA';
		const enc = encode(doc);
		const gM = enc.instances.find(i => i.specId === 'sM')!.groupId;
		const gD = enc.instances.find(i => i.specId === 'sD')!.groupId;
		expect(gM).toBeGreaterThan(0);
		expect(gM).toBe(gD);
	});

	it('handles empty doc gracefully', () => {
		const doc = emptyDoc();
		const enc = encode(doc);
		expect(enc.L).toBe(0);
		expect(enc.instances).toHaveLength(0);
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
