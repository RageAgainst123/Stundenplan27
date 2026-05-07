// Encode a ScheduleDoc into MiniZinc data + a flat list of lesson instances.
// The instance list is needed to map the solver's `assign` array back into PlacedLessons.

import { DAYS, GRADES, PERIODS, type Day, type Period, type ScheduleDoc } from '../types';

export interface LessonInstance {
	specId: string;
	indexWithinSpec: number;       // 0..count-1
	teacherIndex1: number;         // 1-based, matches MiniZinc array indices
	gradesSet: number[];           // 1-based grade indices (5→1, 6→2, 7→3, 8→4)
	groupId: number;               // 0 = no group; >0 = shared
	weekId: number;                // 0=every, 1=even, 2=odd
	pinned: boolean;
	pinSlot1?: number;             // 1-based slot index when pinned
}

export interface SolverInput {
	D: number;
	P: number;
	T: number;
	G: number;
	L: number;
	teacherIds: string[];          // by 0-based index; teacherIndex1 = i+1
	instances: LessonInstance[];
	dataJson: Record<string, unknown>;
}

const DAY_TO_IDX0: Record<Day, number> = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4 };

export function slotFromDayPeriod(day: Day, period: Period, P = PERIODS.length): number {
	return DAY_TO_IDX0[day] * P + period; // 1..NSLOTS
}

export function dayPeriodFromSlot(slot1: number, P = PERIODS.length): { day: Day; period: Period } {
	const idx0 = slot1 - 1;
	const dIdx = Math.floor(idx0 / P);
	const pIdx = idx0 % P;
	return { day: DAYS[dIdx] as Day, period: (pIdx + 1) as Period };
}

export function encode(doc: ScheduleDoc): SolverInput {
	const D = DAYS.length;
	const P = PERIODS.length;
	const G = GRADES.length;
	const teacherIds = doc.teachers.map(t => t.id);
	const teacherIdx = new Map<string, number>(teacherIds.map((id, i) => [id, i + 1]));
	const T = teacherIds.length;

	// Build group registry
	const groupMap = new Map<string, number>();
	let nextGroupId = 1;
	function getGroupId(spec: { groupKey?: string; pairedWith?: string[] }): number {
		// Either explicit groupKey or pairedWith creates a coupling; use groupKey if present.
		if (spec.groupKey && spec.groupKey.trim()) {
			let id = groupMap.get(spec.groupKey);
			if (!id) {
				id = nextGroupId++;
				groupMap.set(spec.groupKey, id);
			}
			return id;
		}
		return 0;
	}

	const weekToId: Record<string, number> = { every: 0, even: 1, odd: 2 };

	// Pre-index pinnings: spec.id → ordered list of pinned slot1 values (one per occurrence)
	const pinsBySpec = new Map<string, number[]>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const arr = pinsBySpec.get(p.specId) ?? [];
		arr.push(slotFromDayPeriod(p.day, p.period));
		pinsBySpec.set(p.specId, arr);
	}

	const instances: LessonInstance[] = [];
	for (const spec of doc.specs) {
		const tIdx1 = teacherIdx.get(spec.teacher);
		if (!tIdx1) continue; // orphaned teacher reference, skip
		const gradesSet = spec.grades.map(g => g - 4); // 5→1, 6→2, 7→3, 8→4
		const groupId = getGroupId(spec);
		const weekId = weekToId[spec.weekPattern] ?? 0;
		const pins = pinsBySpec.get(spec.id) ?? [];
		// Round count to integer (half-periods are a Sokrates artifact; the MVP solver
		// works in whole periods. Half-period support: future extension via 0.5-grain).
		const count = Math.round(spec.count);
		for (let i = 0; i < count; i++) {
			const pin = pins[i];
			instances.push({
				specId: spec.id,
				indexWithinSpec: i,
				teacherIndex1: tIdx1,
				gradesSet,
				groupId,
				weekId,
				pinned: pin !== undefined,
				pinSlot1: pin
			});
		}
	}

	const L = instances.length;
	const NSLOTS = D * P;

	// teacher_blocked[T, NSLOTS] flat row-major
	const teacherBlocked: boolean[][] = [];
	for (let t = 0; t < T; t++) {
		const teacher = doc.teachers[t];
		const row: boolean[] = new Array(NSLOTS).fill(false);
		for (const u of teacher.unavailable) {
			const s = slotFromDayPeriod(u.day, u.period) - 1;
			if (s >= 0 && s < NSLOTS) row[s] = true;
		}
		teacherBlocked.push(row);
	}

	// MiniZinc 2D array literal: [|t1s1, t1s2, ...| t2s1, t2s2, ...|]
	function mznBool2D(rows: boolean[][]): string {
		if (rows.length === 0 || rows[0].length === 0) return 'array2d(1..0, 1..0, [])';
		return (
			'[| ' +
			rows.map(r => r.map(b => (b ? 'true' : 'false')).join(', ')).join(' | ') +
			' |]'
		);
	}

	function mznSet(values: number[]): string {
		return '{' + values.join(',') + '}';
	}

	const dataJson: Record<string, unknown> = {
		D,
		P,
		T: Math.max(T, 1),
		G,
		L: Math.max(L, 1),
		// JSON encoding of arrays-of-set is awkward in MiniZinc JSON; we use DZN string instead.
	};

	// Encode as DZN string for the parts that JSON would mangle (sets/2D arrays)
	const lessonTeacher = instances.map(i => i.teacherIndex1).join(',') || '1';
	const lessonGrades =
		instances.map(i => mznSet(i.gradesSet)).join(',') || '{}';
	const lessonGroup = instances.map(i => i.groupId).join(',') || '0';
	const lessonWeek = instances.map(i => i.weekId).join(',') || '0';
	const lessonPinned =
		instances.map(i => (i.pinned ? 'true' : 'false')).join(',') || 'false';
	const lessonPinSlot =
		instances.map(i => i.pinSlot1 ?? 1).join(',') || '1';

	const dzn = [
		`D = ${D};`,
		`P = ${P};`,
		`T = ${Math.max(T, 1)};`,
		`G = ${G};`,
		`L = ${Math.max(L, 1)};`,
		L > 0 ? `lesson_teacher = [${lessonTeacher}];` : `lesson_teacher = [1];`,
		L > 0 ? `lesson_grades = [${lessonGrades}];` : `lesson_grades = [{}];`,
		L > 0 ? `lesson_group = [${lessonGroup}];` : `lesson_group = [0];`,
		L > 0 ? `lesson_week = [${lessonWeek}];` : `lesson_week = [0];`,
		L > 0 ? `lesson_pinned = [${lessonPinned}];` : `lesson_pinned = [false];`,
		L > 0 ? `lesson_pin_slot = [${lessonPinSlot}];` : `lesson_pin_slot = [1];`,
		`teacher_blocked = ${mznBool2D(teacherBlocked.length > 0 ? teacherBlocked : [[false]])};`
	].join('\n');

	(dataJson as any).__dzn = dzn;

	return { D, P, T, G, L, teacherIds, instances, dataJson };
}
