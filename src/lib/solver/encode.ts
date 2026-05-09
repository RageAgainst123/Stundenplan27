// Encode a ScheduleDoc into MiniZinc data + a flat list of lesson instances.
// The instance list is needed to map the solver's `assign` array back into PlacedLessons.

import { DAYS, GRADES, PERIODS, type Day, type Period, type GradeLevel, type ScheduleDoc } from '../types';

export interface LessonInstance {
	specId: string;
	specIndex1: number;            // 1-based spec id (instances of same spec share this)
	indexWithinSpec: number;       // 0..count-1
	teacherIndex1: number;         // 1-based, matches MiniZinc array indices
	subjectIndex1: number;         // 1-based subject id (used for maxConsecutive)
	gradesSet: number[];           // 1-based grade indices (5→1, 6→2, 7→3, 8→4)
	groupId: number;               // 0 = no group; >0 = shared
	weekId: number;                // 0=every, 1=even, 2=odd
	blockId: number;               // -1 = standalone, ≥0 = part of a contiguous block
	blockSize: number;             // size of the block this instance belongs to (1 = standalone)
	autoMode: boolean;             // Phase 7B: true = solver decides block layout (max 1 double per spec)
	pinned: boolean;
	pinSlot1?: number;             // 1-based slot index when pinned
}

export interface SolverInput {
	D: number;
	P: number;
	T: number;
	G: number;
	L: number;
	S: number;                     // number of subjects
	teacherIds: string[];          // by 0-based index; teacherIndex1 = i+1
	subjectCodes: string[];        // by 0-based index; subjectIndex1 = i+1
	subjectMaxConsec: number[];    // [S], default 99 = no limit
	subjectIsMain: boolean[];      // [S], Phase 7B for soft constraints
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

	// Build coupling registry. Phase 8 v3: solver couplings now use the new
	// `couplingId` field, NOT the descriptive `groupLabel` from CSV.
	const groupMap = new Map<string, number>();
	let nextGroupId = 1;
	function getGroupId(spec: { couplingId?: string; pairedWith?: string[] }): number {
		if (spec.couplingId && spec.couplingId.trim()) {
			let id = groupMap.get(spec.couplingId);
			if (!id) {
				id = nextGroupId++;
				groupMap.set(spec.couplingId, id);
			}
			return id;
		}
		return 0;
	}

	const weekToId: Record<string, number> = { every: 0, even: 1, odd: 2 };

	// Pre-index pinnings: spec.id → grade → ordered list of pinned slot1 values
	// (one per occurrence). Multi-grade specs (e.g. grades=[6,7]) need a separate
	// pin slot per grade column, since the slot is 3D (day, period, grade) and
	// constraint 0 enforces gradeOf(assign[l]) ∈ lesson_grades[l]. If we re-used
	// the same slot for all grades, the multi-grade siblings would each need to
	// be in grade[0]'s column, contradicting their own grade assignment → UNSAT.
	// Phase 8 v2: PlacedLesson now carries its own grade. We index pins per
	// (specId, grade) so each grade column gets exactly the slots the user
	// pinned for THAT column. Multi-grade specs are pinned via multiple
	// PlacedLessons (one per grade) — see ScheduleGrid.handleDropToCell.
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const pinsBySpecGrade = new Map<string, Map<GradeLevel, number[]>>();
	for (const p of doc.placed) {
		if (!p.pinned) continue;
		const spec = specById.get(p.specId);
		if (!spec || spec.grades.length === 0) continue;
		// Defensive: ignore pins on grades the spec doesn't actually cover
		// (legacy/corrupt data).
		if (!spec.grades.includes(p.grade)) continue;
		if (!pinsBySpecGrade.has(p.specId)) pinsBySpecGrade.set(p.specId, new Map());
		const byGrade = pinsBySpecGrade.get(p.specId)!;
		if (!byGrade.has(p.grade)) byGrade.set(p.grade, []);
		byGrade.get(p.grade)!.push(slotFromDPG(p.day, p.period, p.grade));
	}

	// Subject indexing for maxConsecutive + isMain (for soft constraints)
	const subjectCodes = doc.subjects.map(s => s.code);
	const subjectIdx = new Map<string, number>(subjectCodes.map((c, i) => [c, i + 1]));
	const subjectMaxConsec = doc.subjects.map(s => s.maxConsecutive ?? 99);
	const subjectIsMain = doc.subjects.map(s => !!s.isMain);
	const S = subjectCodes.length;

	// Spec expansion:
	// 1. Skip specs with includeInSolver === false
	// 2. For each spec, expand `blocks[]`. Each block element of size N becomes N
	//    consecutive lesson instances (sharing a blockId), one per grade per slot.
	// 3. Block of size 1 → standalone (blockId = -1, blockSize = 1).
	// 4. All grade-instances of the SAME block-position share an occurrence groupId
	//    (so they land on the same day/period for parallel teaching).
	const instances: LessonInstance[] = [];
	let specCounter = 0;
	let autoGroupCounter = 1_000_000;
	let nextBlockId = 0;

	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const tIdx1 = teacherIdx.get(spec.teachers[0]);
		if (!tIdx1) continue;
		const sIdx1 = subjectIdx.get(spec.subject) ?? 1;
		specCounter++;
		const groupIdBase = getGroupId(spec);
		const weekId = weekToId[spec.weekPattern] ?? 0;
		const pinsByGrade = pinsBySpecGrade.get(spec.id);

		// Phase 7B: blocks=undefined or empty → AUTO MODE. Emit `count` flexible
		// instances; the solver decides whether any pair becomes a double-period
		// block (max 1 double per spec, no triples — enforced in model.mzn).
		// Explicit blocks (e.g. [2,1] or [1,1,1]) → STRICT MODE, current behavior.
		const isAutoMode = !spec.blocks || spec.blocks.length === 0;
		const blocks = isAutoMode
			? Array(Math.max(1, Math.round(spec.count))).fill(1)
			: spec.blocks!;

		// Walk through each block; each block becomes blockSize consecutive lesson positions.
		// We keep a global "occurrence index" within the spec for pin-mapping and tracing.
		let occ = 0;
		for (const blockSize of blocks) {
			// In strict mode: one block id per block; size=1 → -1 (standalone).
			// In auto mode: every instance has blockId=-1 (solver decides freely).
			const thisBlockId = !isAutoMode && blockSize > 1 ? nextBlockId++ : -1;
			for (let pos = 0; pos < blockSize; pos++) {
				// Phase 8 fix: when the spec covers MULTIPLE grades, the
				// resulting per-grade instances are siblings of ONE pedagogical
				// lesson — they must land on the same (day, period). We bind
				// them with a synthetic occurrence group regardless of whether
				// the user set a couplingId. Single-grade specs without a
				// coupling get groupId=0 (no constraint).
				const isMultiGrade = spec.grades.length > 1;
				const occGroupId =
					groupIdBase > 0
						? groupIdBase
						: isMultiGrade
							? autoGroupCounter++
							: 0;
				for (const grade of spec.grades) {
					const gradesSet = [grade - 4];
					// Per-grade pin lookup: each grade column gets its own pin slot.
					const pinForGrade = pinsByGrade?.get(grade)?.[occ];
					instances.push({
						specId: spec.id,
						specIndex1: specCounter,
						indexWithinSpec: occ,
						teacherIndex1: tIdx1,
						subjectIndex1: sIdx1,
						gradesSet,
						groupId: occGroupId,
						weekId,
						blockId: thisBlockId,
						blockSize: blockSize,
						autoMode: isAutoMode,
						pinned: pinForGrade !== undefined,
						pinSlot1: pinForGrade
					});
				}
				occ++;
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
		L: Math.max(L, 1),
		S: Math.max(S, 1)
	};

	const lessonTeacher = instances.map(i => i.teacherIndex1).join(',') || '1';
	const lessonSubject = instances.map(i => i.subjectIndex1).join(',') || '1';
	const lessonGrades = instances.map(i => mznSet(i.gradesSet)).join(',') || '{1}';
	const lessonGroup = instances.map(i => i.groupId).join(',') || '0';
	const lessonWeek = instances.map(i => i.weekId).join(',') || '0';
	const lessonSpecId = instances.map(i => i.specIndex1).join(',') || '1';
	const lessonOccIdx = instances.map(i => i.indexWithinSpec).join(',') || '0';
	const lessonBlockId = instances.map(i => i.blockId).join(',') || '-1';
	const lessonBlockSize = instances.map(i => i.blockSize).join(',') || '1';
	const lessonAuto = instances.map(i => (i.autoMode ? 'true' : 'false')).join(',') || 'false';
	const lessonPinned = instances.map(i => (i.pinned ? 'true' : 'false')).join(',') || 'false';
	const lessonPinSlot = instances.map(i => i.pinSlot1 ?? 1).join(',') || '1';
	const subjectMaxConsecArr = subjectMaxConsec.length > 0 ? subjectMaxConsec.join(',') : '99';
	const subjectIsMainArr = subjectIsMain.length > 0
		? subjectIsMain.map(b => (b ? 'true' : 'false')).join(',')
		: 'false';

	// Phase 7B: Soft-Constraint weights (0 = disabled). The model multiplies
	// each penalty term by its weight; a 0 weight zeros out the contribution.
	const c = doc.constraints;
	const w_noFree = c.noFreePeriodsForClass.enabled ? Math.max(0, Math.round(c.noFreePeriodsForClass.weight)) : 0;
	const w_mainAft = c.noMainSubjectAfternoon.enabled ? Math.max(0, Math.round(c.noMainSubjectAfternoon.weight)) : 0;
	const afternoonStart = Math.max(1, Math.min(P, Math.round(c.noMainSubjectAfternoon.afternoonStartsAtPeriod)));
	// Phase 9: any-subject afternoon penalty.
	const w_anyAft =
		c.noMainSubjectAfternoon.enabled && c.noMainSubjectAfternoon.applyToAllSubjects
			? Math.max(0, Math.round(c.noMainSubjectAfternoon.weightAllSubjects))
			: 0;
	const w_mainRun = c.maxConsecutiveMain.enabled ? Math.max(0, Math.round(c.maxConsecutiveMain.weight)) : 0;
	const maxConsecMain = Math.max(1, Math.min(P, Math.round(c.maxConsecutiveMain.max)));
	const w_mainEarly = c.preferMainEarly.enabled ? Math.max(0, Math.round(c.preferMainEarly.weight)) : 0;
	const w_compact = c.compactTeacherDays.enabled ? Math.max(0, Math.round(c.compactTeacherDays.weight)) : 0;
	// Phase 9: hard min-daily-slots per (day, grade). Capped at P.
	const minDailySlots = Math.max(0, Math.min(P, Math.round(c.minDailySlotsPerGrade ?? 0)));
	// Phase 10: must P1 be active when day is active?
	const mustStartP1 = c.mustStartFirstPeriod?.enabled ?? true;

	const dzn = [
		`D = ${D};`,
		`P = ${P};`,
		`T = ${Math.max(T, 1)};`,
		`G = ${G};`,
		`L = ${Math.max(L, 1)};`,
		`S = ${Math.max(S, 1)};`,
		L > 0 ? `lesson_teacher = [${lessonTeacher}];` : `lesson_teacher = [1];`,
		L > 0 ? `lesson_subject = [${lessonSubject}];` : `lesson_subject = [1];`,
		L > 0 ? `lesson_grades = [${lessonGrades}];` : `lesson_grades = [{1}];`,
		L > 0 ? `lesson_group = [${lessonGroup}];` : `lesson_group = [0];`,
		L > 0 ? `lesson_week = [${lessonWeek}];` : `lesson_week = [0];`,
		L > 0 ? `lesson_spec_id = [${lessonSpecId}];` : `lesson_spec_id = [1];`,
		L > 0 ? `lesson_occ_idx = [${lessonOccIdx}];` : `lesson_occ_idx = [0];`,
		L > 0 ? `lesson_block_id = [${lessonBlockId}];` : `lesson_block_id = [-1];`,
		L > 0 ? `lesson_block_size = [${lessonBlockSize}];` : `lesson_block_size = [1];`,
		L > 0 ? `lesson_auto = [${lessonAuto}];` : `lesson_auto = [false];`,
		L > 0 ? `lesson_pinned = [${lessonPinned}];` : `lesson_pinned = [false];`,
		L > 0 ? `lesson_pin_slot = [${lessonPinSlot}];` : `lesson_pin_slot = [1];`,
		`subject_max_consec = [${subjectMaxConsecArr}];`,
		`subject_is_main = [${subjectIsMainArr}];`,
		`w_no_free = ${w_noFree};`,
		`w_main_aft = ${w_mainAft};`,
		`w_any_aft = ${w_anyAft};`,
		`afternoon_start = ${afternoonStart};`,
		`w_main_run = ${w_mainRun};`,
		`max_consec_main = ${maxConsecMain};`,
		`w_main_early = ${w_mainEarly};`,
		`w_compact = ${w_compact};`,
		`min_daily_slots = ${minDailySlots};`,
		`must_start_p1 = ${mustStartP1 ? 'true' : 'false'};`,
		// Phase 10 perf: constraint 11 (same-day cohesion) disabled by default.
		// Empirically blocks the solver completely on real-size models — even
		// the static-grade-filter and only-strict-mode variants couldn't get
		// past ~35k failures with 0 solutions in 60s. Without C11 the solver
		// finds 9 solutions and proves optimum in 50s. Constraint 9b (max 1
		// double pair per spec in auto mode) and constraint 7 (block_id
		// contiguity in strict mode) cover most of the original intent.
		`enable_same_day_cohesion = false;`,
		`teacher_blocked = ${mznBool3D(teacherBlocked3D.length > 0 ? teacherBlocked3D : [[[false]]])};`
	].join('\n');

	(dataJson as any).__dzn = dzn;

	return { D, P, T, G, L, S, teacherIds, subjectCodes, subjectMaxConsec, subjectIsMain, instances, dataJson };
}
