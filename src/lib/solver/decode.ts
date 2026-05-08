// Map MiniZinc solver output back into PlacedLesson[].
import type { GradeLevel, PlacedLesson } from '../types';
import { dpgFromSlot, type LessonInstance } from './encode';

export interface PenaltyBreakdown {
	main_aft: number;
	main_early: number;
	main_run: number;
	no_free: number;
	compact: number;
	total: number;
}

export interface SolverOutput {
	status: 'SAT' | 'UNSAT' | 'TIMEOUT' | 'ERROR';
	placed: PlacedLesson[];
	unplaced: string[];           // spec IDs that could not be placed
	message?: string;
	penalties?: PenaltyBreakdown; // Phase 7B: soft-constraint score breakdown
	relaxedSpecIds?: string[];    // Phase 7B: specs whose strict block-pattern was relaxed to auto
}

export function decode(
	rawOutput: string | null,
	instances: LessonInstance[],
	options: { keepPinnedFlag?: boolean } = {}
): SolverOutput {
	if (!rawOutput) {
		return { status: 'UNSAT', placed: [], unplaced: instances.map(i => i.specId) };
	}
	let parsed: { assign?: number[]; penalties?: Partial<PenaltyBreakdown> };
	try {
		parsed = JSON.parse(rawOutput);
	} catch (e) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: instances.map(i => i.specId),
			message: 'Could not parse solver output: ' + String(e)
		};
	}
	const arr = parsed.assign;
	if (!Array.isArray(arr) || arr.length !== instances.length) {
		return {
			status: 'ERROR',
			placed: [],
			unplaced: instances.map(i => i.specId),
			message: `assign array length ${arr?.length} != instances ${instances.length}`
		};
	}
	const placed: PlacedLesson[] = [];
	const unplaced: string[] = [];
	for (let i = 0; i < instances.length; i++) {
		const slot1 = arr[i];
		if (!slot1 || slot1 < 1) {
			unplaced.push(instances[i].specId);
			continue;
		}
		const dpg = dpgFromSlot(slot1);
		// Phase 8 v2: derive grade from the slot directly. The encoder ensures
		// each instance is constrained to its own grade column (gradesSet is a
		// singleton), so dpgFromSlot's grade matches the instance's intent.
		const grade = dpg.grade as GradeLevel;
		placed.push({
			specId: instances[i].specId,
			day: dpg.day,
			period: dpg.period,
			grade,
			pinned: options.keepPinnedFlag ? instances[i].pinned : instances[i].pinned
		});
	}
	const out: SolverOutput = { status: 'SAT', placed, unplaced };
	if (parsed.penalties) {
		out.penalties = {
			main_aft: parsed.penalties.main_aft ?? 0,
			main_early: parsed.penalties.main_early ?? 0,
			main_run: parsed.penalties.main_run ?? 0,
			no_free: parsed.penalties.no_free ?? 0,
			compact: parsed.penalties.compact ?? 0,
			total: parsed.penalties.total ?? 0
		};
	}
	return out;
}
