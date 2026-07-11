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
	DAYS_BY_INDEX,
	type LessonInstance,
	type SolverState,
	type Unit,
	type UnitKind,
	SLOT_UNPLACED,
	dpFromSlot,
	slotFromDP,
} from './types';
import { findHardViolations, wouldViolate } from './hardCheck';

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
 * Phase 17: Expand specs with `teachingSegments` into one virtual spec per
 * segment. Each segment becomes an independent solver-Unit with its own
 * teacher team and `count = segment.hours`. The visible spec.id is preserved
 * (so PlacedLesson.specId still maps back to the original) — only the
 * per-segment Units carry the segment's teacher set.
 *
 * Specs WITHOUT teachingSegments pass through unchanged → bestehende Pläne
 * verhalten sich bit-identisch zu vor Phase 17.
 *
 * Validation: ungültige Segment-Splits (Summe ≠ count, leere Teams) werden
 * defensiv verworfen — die Spec wird wie pre-Phase-17 als 1 Unit behandelt.
 */
function expandSegmentedSpecs(specs: readonly LessonSpec[]): LessonSpec[] {
	const out: LessonSpec[] = [];
	for (const spec of specs) {
		const segs = spec.teachingSegments;
		if (!segs || segs.length === 0) {
			out.push(spec);
			continue;
		}
		// Defensive validation: kaputter Split → ignorieren, Spec normal
		// einreihen (Solver verhält sich wie vor Phase 17).
		const sumHours = segs.reduce((s, seg) => s + (Number(seg.hours) || 0), 0);
		const allTeachersValid = segs.every(seg =>
			Array.isArray(seg.teachers) && seg.teachers.length > 0
			&& seg.teachers.every(tid => spec.teachers.includes(tid))
		);
		if (Math.abs(sumHours - spec.count) > 0.05 || !allTeachersValid) {
			out.push(spec);
			continue;
		}
		// Split-Pfad: pro Segment eine Pseudo-Spec mit reduziertem count
		// und eigenem Team. blocks=undefined → Solver entscheidet auto.
		for (const seg of segs) {
			out.push({
				...spec,
				teachers: [...seg.teachers],
				count: seg.hours,
				blocks: undefined,
				// teachingSegments im Pseudo-Spec NICHT durchreichen — sonst
				// Endlos-Rekursion. Die Original-Spec.id bleibt drin, damit
				// PlacedLesson und UI weiterhin auf das gleiche Subject/Klasse
				// usw. zugreifen.
				teachingSegments: undefined
			});
		}
	}
	return out;
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
 *  6) Phase 14 — Hot-Start: wenn `opts.hotStart=true`, werden auch
 *     nicht-pinned Placements als Startposition übernommen (Units bleiben
 *     `pinned=false`, dürfen also vom Solver bewegt werden). Hard-Violations
 *     werden trotzdem rausgefiltert.
 */
export interface BuildStateOpts {
	/**
	 * Wenn true: nicht-pinned Placements aus `doc.placed` werden als
	 * Startposition (Hot-Start) ins `state.placement` geschrieben. Solver
	 * darf sie bewegen — sie sind keine Pins. Default false (= heutiges
	 * Verhalten: nur pinned Placements landen im State, der Rest startet
	 * unplaced und Construction muss sie platzieren).
	 */
	hotStart?: boolean;
}

export function buildState(doc: ScheduleDoc, opts: BuildStateOpts = {}): SolverState {
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

	// Phase 17: vor der Unit-Expansion werden Specs mit teachingSegments
	// in N Pseudo-Specs aufgesplittet (eine pro Segment). Specs ohne
	// Segmente bleiben byte-identisch wie vorher.
	const expandedSpecs = expandSegmentedSpecs(doc.specs);

	for (const spec of expandedSpecs) {
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
				afternoonAllowed: spec.afternoonAllowed ?? 'allowed',
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
			// Strictest afternoonAllowed across coupled specs wins.
			// Reihenfolge (von strikt zu lax): 'never' > 'must' > 'allowed' > 'preferred'.
			// Wenn ein Coupling 'never' UND 'must' enthält → das ist eine
			// User-Misskonfiguration (unmöglich befriedigbar). Wir wählen
			// 'never' (sicher) und der Solver wird die 'must'-Spec als
			// unplaced melden; die Diagnose hat das auch schon gewarnt.
			let afternoonAllowed: 'never' | 'allowed' | 'preferred' | 'must' = 'preferred';
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
				const sa = spec.afternoonAllowed ?? 'allowed';
				if (sa === 'never') {
					afternoonAllowed = 'never';
				} else if (sa === 'must' && afternoonAllowed !== 'never') {
					afternoonAllowed = 'must';
				} else if (sa === 'allowed' && afternoonAllowed !== 'never' && afternoonAllowed !== 'must') {
					afternoonAllowed = 'allowed';
				}
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
				afternoonAllowed,
			});
		}
		void couplingId;
	}

	// Initialize placement array.
	const placement = new Int32Array(units.length);
	placement.fill(SLOT_UNPLACED);

	// Apply pinned placements from doc.placed.
	//
	// CRITICAL: dedup BEFORE pinning by an equivalence-class that respects
	// both multi-grade and coupling. A multi-grade spec (e.g. REL grades=[7,8]
	// count=2) has ONE Unit per occurrence but the doc stores ONE PlacedLesson
	// PER grade — so 4 PlacedLessons match 2 Units. A coupling group adds
	// another dimension: spec_A and spec_B with the same couplingId share
	// ONE coupling-Unit per occurrence — so 8 PlacedLessons match 2 Units.
	//
	// Dedup-Key: per (coupling-or-spec, day, period). Within one such key
	// only the FIRST PlacedLesson triggers a pin; the rest are redundant.
	const seenSlot = new Set<string>();
	const dedupGroup = (specId: string): string => {
		const sp = specsById.get(specId);
		if (sp?.couplingId && sp.couplingId.trim()) return `cpl:${sp.couplingId}`;
		return `spec:${specId}`;
	};
	// Audit A2c: Verluste beim Placement-Loading MELDEN statt still schlucken.
	// Ein Placement ohne passende Unit (Spec gelöscht, count gesunken, Stufe
	// geändert) verschwand vorher kommentarlos — „meine gepinnte Stunde ist
	// weg" blieb unerklärt. droppedPins wird deshalb schon hier befüllt
	// (die Hard-Violation-Validierung unten pusht in dasselbe Array).
	const droppedPins: NonNullable<SolverState['droppedPins']> = [];
	if (doc.placed && doc.placed.length > 0) {
		for (const pl of doc.placed) {
			if (!pl.pinned) continue;
			const slotKey = `${dedupGroup(pl.specId)}|${pl.day}|${pl.period}`;
			if (seenSlot.has(slotKey)) continue;
			seenSlot.add(slotKey);
			const unitsForSpec = unitsBySpec.get(pl.specId) ?? [];
			const dayIdx = DAY_INDEX[pl.day];
			const slot = slotFromDP(dayIdx, pl.period);
			// Find the first non-pinned, unplaced unit for this spec that
			// covers the pin's grade.
			const target = unitsForSpec.find(
				u => !u.pinned && placement[u.idx] === SLOT_UNPLACED && u.grades.includes(pl.grade)
			);
			if (!target) {
				droppedPins.push({
					specId: pl.specId,
					subjectCode: specsById.get(pl.specId)?.subject ?? '?',
					day: pl.day,
					period: pl.period,
					reason: unitsForSpec.length === 0
						? 'Lehreinheit existiert nicht mehr (oder ist vom Solver ausgenommen)'
						: 'keine passende Stunde mehr frei (Stundenzahl gesunken oder Stufe geändert?)',
				});
				continue;
			}
			target.pinned = true;
			target.pinnedDay = pl.day;
			target.pinnedPeriod = pl.period;
			placement[target.idx] = slot;
		}
	}

	// Defensive validation: alte localStorage-Pläne können inkonsistente
	// Pinned-Placements enthalten (z. B. zwei verschiedene Specs pinned auf
	// dem gleichen Slot+Stufe). Wir scannen die Pinned-Units gegen
	// einander mit findHardViolations und un-pinnen Verletzer. Lieber eine
	// Pin verloren als ein hard-violating Plan im Solver-Input.
	const stateForCheck: SolverState = {
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
	const offenders = findHardViolations(stateForCheck);
	for (const idx of offenders) {
		const u = units[idx];
		const slot = placement[idx];
		// Capture the violation reason BEFORE we mutate, so the user message
		// is informative ("Lehrer X unverfügbar an Mo P1" statt nur "verworfen").
		let reason = 'Slot-Konflikt mit anderem Pin';
		if (slot !== SLOT_UNPLACED) {
			placement[idx] = SLOT_UNPLACED;
			const wasPinned = u.pinned;
			u.pinned = false;
			const violReason = wouldViolate(stateForCheck, u, slot);
			u.pinned = wasPinned;
			placement[idx] = slot;
			if (violReason) reason = violReason;
		}
		// Map back to a (specId, day, period) the UI can show.
		if (slot !== SLOT_UNPLACED) {
			const { dayIndex, period } = dpFromSlot(slot);
			droppedPins.push({
				specId: u.specIds[0],
				subjectCode: u.subjectCode,
				day: DAYS_BY_INDEX[dayIndex],
				period: period as import('../types').Period,
				reason,
			});
		}
		if (!u.pinned) {
			// Non-pinned offenders shouldn't happen here (placement only has
			// pinned units at this stage), but be defensive.
			placement[idx] = SLOT_UNPLACED;
			continue;
		}
		// Unpin and clear so the solver gets to choose a fresh slot.
		u.pinned = false;
		u.pinnedDay = undefined;
		u.pinnedPeriod = undefined;
		placement[idx] = SLOT_UNPLACED;
	}

	// Phase 14 — Hot-Start: nach Pin-Validation auch nicht-pinned Placements
	// als Startposition übernehmen. Units bleiben `pinned=false` — Solver
	// darf sie verschieben. Hard-Violations werden via `wouldViolate`
	// gegen die schon belegten Slots gefiltert: wenn ein Hot-Start-Slot
	// kollidiert (z. B. mit einem Pin), wird die Unit ohne Placement
	// gelassen und Local Search/Construction macht sie später.
	if (opts.hotStart && doc.placed && doc.placed.length > 0) {
		// Dedup wie beim Pin-Loop, aber für nicht-pinned Placements.
		const seenHotSlot = new Set<string>();
		for (const pl of doc.placed) {
			if (pl.pinned) continue; // Pins sind oben schon eingetragen
			const slotKey = `${dedupGroup(pl.specId)}|${pl.day}|${pl.period}`;
			if (seenHotSlot.has(slotKey)) continue;
			seenHotSlot.add(slotKey);
			const unitsForSpec = unitsBySpec.get(pl.specId) ?? [];
			const dayIdx = DAY_INDEX[pl.day];
			const slot = slotFromDP(dayIdx, pl.period);
			// Finde eine noch unplaced Unit dieser Spec mit passender Stufe.
			const target = unitsForSpec.find(
				u => placement[u.idx] === SLOT_UNPLACED && u.grades.includes(pl.grade)
			);
			if (!target) {
				// Audit A2c: auch Hot-Start-Verluste melden (Stammdaten haben
				// sich seit dem letzten Plan geändert) — Solver plant die
				// Stunde neu, aber der User soll wissen WARUM sie wanderte.
				droppedPins.push({
					specId: pl.specId,
					subjectCode: specsById.get(pl.specId)?.subject ?? '?',
					day: pl.day,
					period: pl.period,
					reason: unitsForSpec.length === 0
						? 'Hot-Start: Lehreinheit existiert nicht mehr — Stunde wird neu geplant'
						: 'Hot-Start: keine passende Stunde mehr frei — wird neu geplant',
				});
				continue;
			}
			// Prüfe ob diese Position gegen aktuell belegte Slots
			// (Pins + bereits hot-gestartete Units) verstößt.
			const stateForViol: SolverState = {
				doc, nUnits: units.length, units, placement,
				unitsBySpec, unitsByTeacher, specsById, subjectsByCode, teachersById
			};
			if (wouldViolate(stateForViol, target, slot) === null) {
				placement[target.idx] = slot;
				// pinned bleibt FALSE — Solver darf bewegen.
			}
			// Bei Konflikt einfach skip — Construction/LS platziert die Unit später.
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
		droppedPins,
	};
}

