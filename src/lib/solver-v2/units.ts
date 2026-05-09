// Solver v2 — expansion of LessonSpecs into atomic Units.
//
// Why expand into Units (and not naively into one instance per (count×grade))?
// Because some instances MUST move together:
//   - Multi-grade siblings (same occurrence, different grade columns)
//   - Block siblings (consecutive periods within one grade)
//   - Coupling siblings (different specs, same couplingId, same slot)
//
// Construction and Local Search treat each Unit as an atomic placement.

import { GRADES, type GradeLevel, type LessonSpec, type ScheduleDoc, type WeekPattern } from '../types';
import {
	DAY_INDEX,
	type LessonInstance,
	type SolverState,
	type Unit,
	type UnitKind,
	SLOT_UNPLACED,
	slotFromDP,
} from './types';

/** Resolve `spec.blocks` to a concrete sequence of block sizes. */
function resolveBlocks(spec: LessonSpec): number[] {
	const count = Math.max(1, Math.round(spec.count));
	if (spec.blocks && spec.blocks.length > 0) {
		// Validate sum, fall back to all-ones on mismatch
		const sum = spec.blocks.reduce((a, b) => a + b, 0);
		if (Math.abs(sum - count) < 0.001) return spec.blocks;
	}
	// Auto mode: count singles. Local Search may pair them up via Kempe etc.
	return new Array(count).fill(1);
}

/**
 * Build the working state from the document. Pure function — does not
 * mutate `doc`.
 *
 * Algorithm:
 *  1) Iterate specs in document order; skip excluded ones (includeInSolver=false).
 *  2) For each spec, expand `blocks` into block-groups. A block of size > 1
 *     becomes ONE block-Unit per grade column it covers.
 *  3) For multi-grade specs, the per-grade Units of the SAME occurrence are
 *     bundled into ONE multigrade-Unit (their instances must share the slot).
 *  4) Coupling: specs sharing `couplingId` are merged at the END — their
 *     occurrence-Units of matching positions become a coupling-Unit.
 *  5) Pinned placements from `doc.placed` get pre-filled into the placement
 *     array; those Units are marked `pinned=true` and never moved.
 */
export function buildState(doc: ScheduleDoc): SolverState {
	const units: Unit[] = [];
	const unitsBySpec = new Map<string, Unit[]>();
	const unitsByTeacher = new Map<string, Unit[]>();
	const specsById = new Map(doc.specs.map(s => [s.id, s]));
	const subjectsByCode = new Map(doc.subjects.map(s => [s.code, s]));
	const teachersById = new Map(doc.teachers.map(t => [t.id, t]));

	// Map couplingId → list of (specId, occurrenceIndex, blockId, blockPos)
	// to be merged into coupling-Units after the per-spec expansion.
	const couplingBuckets = new Map<string, Array<{ specId: string; occurrenceIndex: number; blockId: number; blockPos: number; blockSize: number }>>();

	let nextBlockId = 1;

	function pushUnit(u: Omit<Unit, 'idx'>): Unit {
		const idx = units.length;
		const unit: Unit = { ...u, idx };
		units.push(unit);
		for (const sid of unit.specIds) {
			const arr = unitsBySpec.get(sid) ?? [];
			arr.push(unit);
			unitsBySpec.set(sid, arr);
		}
		// Index by ALL teachers of the unit. For coupling-units this means
		// each member teacher's bucket gets the same Unit reference, so
		// any teacher-bucket scan covers couplings correctly.
		for (const tid of unit.teacherIds) {
			const arrT = unitsByTeacher.get(tid) ?? [];
			arrT.push(unit);
			unitsByTeacher.set(tid, arrT);
		}
		return unit;
	}

	for (const spec of doc.specs) {
		if (spec.includeInSolver === false) continue;
		const grades = spec.grades.length > 0 ? spec.grades : ([] as GradeLevel[]);
		if (grades.length === 0) continue;

		const blocks = resolveBlocks(spec);
		// A spec may have a teacher team (parallel team-teaching). The first
		// id is the primary (display) teacher; all are honored by hard checks.
		const teacherTeam = (spec.teachers ?? []).filter(tid => teachersById.has(tid));
		if (teacherTeam.length === 0) continue;
		const primaryTeacher = teacherTeam[0];

		// Expand: walk through blocks. Each block element is one occurrence-block.
		// occurrenceCounter: position in the spec.
		let occurrenceIndex = 0;
		for (const blockSize of blocks) {
			const blockId = blockSize > 1 ? nextBlockId++ : -1;

			// If the spec is in a coupling, push the occurrence info to the bucket
			// instead of creating a Unit immediately. We finalize couplings later.
			if (spec.couplingId && spec.couplingId.trim()) {
				const bucket = couplingBuckets.get(spec.couplingId) ?? [];
				// One bucket entry per block-position, so every period the
				// block occupies is materialized in `allInstances` later.
				// (Without this loop a Doppelstunde-coupling would only
				// produce instances for the first period and the grid
				// would render an inconsistent placement.)
				for (let pos = 0; pos < blockSize; pos++) {
					bucket.push({
						specId: spec.id,
						occurrenceIndex,
						blockId,
						blockPos: pos,
						blockSize,
					});
				}
				couplingBuckets.set(spec.couplingId, bucket);
				occurrenceIndex++;
				continue;
			}

			// Build instances for this block: one per (block-position × grade).
			const instances: LessonInstance[] = [];
			for (let pos = 0; pos < blockSize; pos++) {
				for (const grade of grades) {
					instances.push({
						specId: spec.id,
						occurrenceIndex,
						grade,
						blockId,
						blockSize,
						blockPos: pos,
					});
				}
			}

			// Decide unit kind:
			//  - block (blockSize > 1, single grade)
			//  - multigrade (blockSize == 1, grades.length > 1)
			//  - block + multigrade (blockSize > 1, grades.length > 1) — treat as block,
			//    but instance set is larger
			//  - solo (blockSize == 1, grades.length == 1)
			let kind: UnitKind;
			if (blockSize > 1) kind = 'block';
			else if (grades.length > 1) kind = 'multigrade';
			else kind = 'solo';

			pushUnit({
				kind,
				instances,
				blockSize,
				teacherId: primaryTeacher,
				teacherIds: [...teacherTeam],
				subjectCode: spec.subject,
				grades: [...grades],
				pinned: false,
				specIds: [spec.id],
				weekPattern: spec.weekPattern as WeekPattern,
			});

			occurrenceIndex++;
		}
	}

	// Now finalize coupling buckets: every bucket entry becomes one coupling-Unit.
	// We pair up entries from DIFFERENT specs that share the same occurrence-index
	// position. If sizes mismatch, we fall back to "first available" pairing.
	for (const [couplingId, entries] of couplingBuckets) {
		// Group entries by occurrenceIndex (best-effort alignment).
		const byOcc = new Map<number, typeof entries>();
		for (const e of entries) {
			const arr = byOcc.get(e.occurrenceIndex) ?? [];
			arr.push(e);
			byOcc.set(e.occurrenceIndex, arr);
		}
		for (const [, group] of byOcc) {
			// Merge all specs at this occurrence-position into one Unit.
			const allInstances: LessonInstance[] = [];
			const specIds: string[] = [];
			const allGrades = new Set<GradeLevel>();
			const allTeachers = new Set<string>();
			let teacherId = '';
			let subjectCode = '';
			let blockSize = 1;
			let weekPattern: WeekPattern = 'every';
			for (const e of group) {
				const spec = specsById.get(e.specId);
				if (!spec) continue;
				const grades = spec.grades;
				for (const g of grades) {
					allInstances.push({
						specId: e.specId,
						occurrenceIndex: e.occurrenceIndex,
						grade: g,
						blockId: e.blockId,
						blockSize: e.blockSize,
						blockPos: e.blockPos,
					});
					allGrades.add(g);
				}
				for (const tid of spec.teachers ?? []) allTeachers.add(tid);
				if (!teacherId && spec.teachers && spec.teachers.length > 0) teacherId = spec.teachers[0];
				if (!subjectCode) subjectCode = spec.subject;
				blockSize = Math.max(blockSize, e.blockSize);
				weekPattern = spec.weekPattern;
				specIds.push(e.specId);
			}
			if (allInstances.length === 0) continue;
			pushUnit({
				kind: 'coupling',
				instances: allInstances,
				blockSize,
				teacherId,
				teacherIds: Array.from(allTeachers),
				subjectCode,
				grades: Array.from(allGrades).sort((a, b) => a - b) as GradeLevel[],
				pinned: false,
				specIds,
				weekPattern,
			});
		}
		void couplingId;
	}

	// Initialize placement array.
	const placement = new Int32Array(units.length);
	placement.fill(SLOT_UNPLACED);

	// Apply pinned placements from doc.placed.
	// We try to match each pinned PlacedLesson to one Unit. Multi-grade pins:
	// the user pins ONE PlacedLesson per grade. We accept the first-seen
	// pin for the matching Unit and ignore duplicates (the others are
	// implicit).
	if (doc.placed && doc.placed.length > 0) {
		for (const pl of doc.placed) {
			if (!pl.pinned) continue;
			const unitsForSpec = unitsBySpec.get(pl.specId) ?? [];
			const dayIdx = DAY_INDEX[pl.day];
			const slot = slotFromDP(dayIdx, pl.period);
			// Find the first non-pinned, unplaced unit for this spec that
			// covers the pin's grade.
			const target = unitsForSpec.find(
				u => !u.pinned && placement[u.idx] === SLOT_UNPLACED && u.grades.includes(pl.grade)
			);
			if (!target) continue;
			target.pinned = true;
			target.pinnedDay = pl.day;
			target.pinnedPeriod = pl.period;
			placement[target.idx] = slot;
		}
	}

	return {
		doc,
		nUnits: units.length,
		units,
		placement,
		unitsBySpec,
		unitsByTeacher,
		specsById,
		subjectsByCode,
		teachersById,
	};
}
