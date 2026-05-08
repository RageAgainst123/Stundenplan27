// Map MiniZinc solver output back into PlacedLesson[].
import type { PlacedLesson } from '../types';
import { dpgFromSlot, type LessonInstance } from './encode';

export interface SolverOutput {
	status: 'SAT' | 'UNSAT' | 'TIMEOUT' | 'ERROR';
	placed: PlacedLesson[];
	unplaced: string[];           // spec IDs that could not be placed
	message?: string;
}

export function decode(
	rawOutput: string | null,
	instances: LessonInstance[],
	options: { keepPinnedFlag?: boolean } = {}
): SolverOutput {
	if (!rawOutput) {
		return { status: 'UNSAT', placed: [], unplaced: instances.map(i => i.specId) };
	}
	let parsed: { assign?: number[] };
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
		placed.push({
			specId: instances[i].specId,
			day: dpg.day,
			period: dpg.period,
			pinned: options.keepPinnedFlag ? instances[i].pinned : instances[i].pinned
		});
	}
	return { status: 'SAT', placed, unplaced };
}
