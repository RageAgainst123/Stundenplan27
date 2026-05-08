// Encode a ScheduleDoc into MiniZinc data + a flat list of lesson instances.
// The instance list is needed to map the solver's `assign` array back into PlacedLessons.

import { DAYS, GRADES, PERIODS, type Day, type Period, type GradeLevel, type ScheduleDoc } from '../types';

export interface LessonInstance {
	specId: string;
	specIndex1: number;            // 1-based spec id (instances of same spec share this)
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

/**
 * Slot index for (day, period, grade) in the 3D model.
 * 1-based, in 1..D*P*G.
 */
export function slotFromDPG(day: Day, period: Period, grade: GradeLevel, P = PERIODS.length, G = GRADES.length): number {
	const d = DAY_TO_IDX0[day];
	const p = period - 1;
	const g = grade - 5; // 5→0
	return d * (P * G) + p * G + g + 1;
}

export function dpgFromSlot(slot1: number, P = PERIODS.length, G = GRADES.length): { day: Day; period: Period; grade: GradeLevel } {
	const idx0 = slot1 - 1;
	const dIdx = Math.floor(idx0 / (P * G));
	const pIdx = Math.floor(idx0 / G) % P;
	const gIdx = idx0 % G;
	return {
		day: DAYS[dIdx] as Day,
		period: (pIdx + 1) as Period,
		grade: (gIdx + 5) as GradeLevel
	};
}

// Backwards-compatible aliases (still used by some helpers)
export function slotFromDayPeriod(day: Day, period: Period, P = PERIODS.length): number {
	return DAY_TO_IDX0[day] * P + period;
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

	// Pre-index pinnings: spec.id → ordered list of pinned slot1 values (one per occurrence).
	// Pin grade defaults to the first grade of the spec (PlacedLesson has only day/period).
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const pinsBySpec = new Map<string, number[]>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = specById.get(p.specId);
		if (!spec || spec.grades.length === 0) continue;
		const arr = pinsBySpec.get(p.specId) ?? [];
		arr.push(slotFromDPG(p.day, p.period, spec.grades[0] as GradeLevel));
		pinsBySpec.set(p.specId, arr);
	}

	// Each LessonSpec expands into one instance per (occurrence × grade). Specs with
	// |grades|>1 represent classes taught together at the same (day,period) — so for
	// every "occurrence" (count) we emit one instance per grade, all sharing the same
	// occurrence index so they can be coupled to a common (day,period) at solve time.
	const instances: LessonInstance[] = [];
	let specCounter = 0;
	let autoGroupCounter = 1_000_000; // synthetic group ids for grade-coupling
	for (const spec of doc.specs) {
		const tIdx1 = teacherIdx.get(spec.teacher);
		if (!tIdx1) continue;
		specCounter++;
		const groupIdBase = getGroupId(spec);
		const weekId = weekToId[spec.weekPattern] ?? 0;
		const pins = pinsBySpec.get(spec.id) ?? [];
		const count = Math.round(spec.count);

		// Each occurrence: emit one instance per grade. All grades in one occurrence
		// share a synthetic group_id so they MUST land on the same (day,period).
		for (let occ = 0; occ < count; occ++) {
			// Build a stable group id for this occurrence: reuse spec's groupKey base if
			// any, OR mint a fresh synthetic id for each occurrence.
			const occGroupId = groupIdBase > 0 ? groupIdBase : autoGroupCounter++;
			const pin = pins[occ];
			for (const grade of spec.grades) {
				const gradesSet = [grade - 4]; // single-element set: this instance occupies this grade
				instances.push({
					specId: spec.id,
					specIndex1: specCounter,
					indexWithinSpec: occ,
					teacherIndex1: tIdx1,
					gradesSet,
					groupId: occGroupId,
					weekId,
					pinned: pin !== undefined,
					pinSlot1: pin
				});
			}
		}
	}

	const L = instances.length;

	// teacher_blocked[T, D, P] — true means blocked for whole (day,period)
	const teacherBlocked3D: boolean[][][] = [];
	for (let t = 0; t < T; t++) {
		const teacher = doc.teachers[t];
		const days: boolean[][] = [];
		for (let d = 0; d < D; d++) {
			const periods: boolean[] = new Array(P).fill(false);
			days.push(periods);
		}
		for (const u of teacher.unavailable) {
			const dIdx = DAY_TO_IDX0[u.day];
			const pIdx = u.period - 1;
			if (days[dIdx]) days[dIdx][pIdx] = true;
		}
		teacherBlocked3D.push(days);
	}

	function mznBool3D(matrix: boolean[][][]): string {
		// MiniZinc 3D array literal flattening: array3d(1..T, 1..D, 1..P, [...])
		if (matrix.length === 0 || matrix[0].length === 0 || matrix[0][0].length === 0) {
			return 'array3d(1..1, 1..1, 1..1, [false])';
		}
		const tn = matrix.length;
		const dn = matrix[0].length;
		const pn = matrix[0][0].length;
		const flat: string[] = [];
		for (let t = 0; t < tn; t++) {
			for (let d = 0; d < dn; d++) {
				for (let p = 0; p < pn; p++) {
					flat.push(matrix[t][d][p] ? 'true' : 'false');
				}
			}
		}
		return `array3d(1..${tn}, 1..${dn}, 1..${pn}, [${flat.join(',')}])`;
	}

	function mznSet(values: number[]): string {
		return '{' + values.join(',') + '}';
	}

	const dataJson: Record<string, unknown> = {
		D,
		P,
		T: Math.max(T, 1),
		G,
		L: Math.max(L, 1)
	};

	const lessonTeacher = instances.map(i => i.teacherIndex1).join(',') || '1';
	const lessonGrades = instances.map(i => mznSet(i.gradesSet)).join(',') || '{1}';
	const lessonGroup = instances.map(i => i.groupId).join(',') || '0';
	const lessonWeek = instances.map(i => i.weekId).join(',') || '0';
	const lessonSpecId = instances.map(i => i.specIndex1).join(',') || '1';
	const lessonPinned = instances.map(i => (i.pinned ? 'true' : 'false')).join(',') || 'false';
	const lessonPinSlot = instances.map(i => i.pinSlot1 ?? 1).join(',') || '1';

	const dzn = [
		`D = ${D};`,
		`P = ${P};`,
		`T = ${Math.max(T, 1)};`,
		`G = ${G};`,
		`L = ${Math.max(L, 1)};`,
		L > 0 ? `lesson_teacher = [${lessonTeacher}];` : `lesson_teacher = [1];`,
		L > 0 ? `lesson_grades = [${lessonGrades}];` : `lesson_grades = [{1}];`,
		L > 0 ? `lesson_group = [${lessonGroup}];` : `lesson_group = [0];`,
		L > 0 ? `lesson_week = [${lessonWeek}];` : `lesson_week = [0];`,
		L > 0 ? `lesson_spec_id = [${lessonSpecId}];` : `lesson_spec_id = [1];`,
		L > 0 ? `lesson_pinned = [${lessonPinned}];` : `lesson_pinned = [false];`,
		L > 0 ? `lesson_pin_slot = [${lessonPinSlot}];` : `lesson_pin_slot = [1];`,
		`teacher_blocked = ${mznBool3D(teacherBlocked3D.length > 0 ? teacherBlocked3D : [[[false]]])};`
	].join('\n');

	(dataJson as any).__dzn = dzn;

	return { D, P, T, G, L, teacherIds, instances, dataJson };
}
