import { describe, it, expect } from 'vitest';
import { emptyDoc, type Day, type LessonSpec, type Period, type Subject, type Teacher, type GradeLevel } from '../types';
import { buildState } from './units';
import { computeScore } from './score';
import { applyMove, genMove, Rng, revertMove, type Move } from './moves';
import { wouldViolate } from './hardCheck';
import { commitMove, evaluateDelta, rebuildScoreCache } from './scoreDelta';
import {
	D, DAYS_BY_INDEX, P, defaultWeights, slotFromDP, SLOT_UNPLACED,
	type ScoreBreakdown, type SolverState,
} from './types';

function teacher(id: string, name: string, unavailable: { day: Day; period: Period }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}
function subject(code: string, opts: Partial<Subject> = {}): Subject {
	return { code, name: code, category: 'PG', isMain: opts.isMain ?? false, hoursPerWeek: {}, maxConsecutive: opts.maxConsecutive ?? 99 };
}
function spec(id: string, sub: string, t: string, grades: GradeLevel[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades,
		weekPattern: 'every', count,
		blocks: 'blocks' in opts ? opts.blocks : undefined,
		includeInSolver: true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual'
	};
}

describe('evaluateDelta', () => {
	it('does not mutate state (placement before == after)', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D', { isMain: true }));
		doc.specs.push(spec('s1', 'M', 't1', [5], 3));
		doc.specs.push(spec('s2', 'D', 't2', [6], 3));
		const state = buildState(doc);
		// Place units
		state.placement[0] = slotFromDP(0, 1);
		state.placement[1] = slotFromDP(0, 2);
		state.placement[2] = slotFromDP(0, 3);
		state.placement[3] = slotFromDP(1, 1);
		state.placement[4] = slotFromDP(1, 2);
		state.placement[5] = slotFromDP(1, 3);

		const w = defaultWeights(doc);
		const before = computeScore(state, w);
		const beforeArr = Array.from(state.placement);

		const rng = new Rng(7);
		for (let i = 0; i < 30; i++) {
			const m = genMove(state, rng);
			if (!m) continue;
			evaluateDelta(state, m, w, before);
			// State must be identical
			expect(Array.from(state.placement)).toEqual(beforeArr);
		}
	});

	it('property: delta = computeScore(after) - computeScore(before) for 100 random moves', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.subjects.push(subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 4));
		doc.specs.push(spec('s2', 'D', 't2', [6], 4));
		const state = buildState(doc);
		// Spread placements
		for (let i = 0; i < state.nUnits; i++) {
			state.placement[i] = slotFromDP(i % 5, ((i * 2) % 8) + 1);
		}

		const w = defaultWeights(doc);
		const rng = new Rng(123);
		let checked = 0;
		for (let i = 0; i < 100; i++) {
			const before = computeScore(state, w);
			const m = genMove(state, rng);
			if (!m) continue;
			const { delta, nextBreakdown } = evaluateDelta(state, m, w, before);
			// Now apply for real and verify
			applyMove(state, m);
			const after = computeScore(state, w);
			expect(after.total).toBe(before.total + delta);
			expect(after.total).toBe(nextBreakdown.total);
			revertMove(state, m);
			checked++;
		}
		expect(checked).toBeGreaterThan(50);
	});
});

// ---------------------------------------------------------------------------
// R3-S1: Scoped-Delta (mit Score-Cache) gegen Full-Scan-Referenz.
//
// Die States sind hard-ZULÄSSIG platziert (wouldViolate-geprüft) — das ist
// der echte Kontrakt der Local Search: genMove validiert jeden Kandidaten,
// bevor evaluateDelta ihn sieht. (rowStartSubj im Scratch setzt H4 voraus:
// pro (Tag, Stufe, Periode) startet maximal eine Unit.)
// ---------------------------------------------------------------------------

/**
 * Zufälliger, vielfältiger Doc (Kopplungen, Blöcke, Multi-Grade, G/U,
 * Hauptfächer, timePref, afternoonAllowed, Sperren) mit hard-zulässiger
 * Zufalls-Platzierung; ein Teil der Units bleibt absichtlich unplaced
 * (deckt unplaced-Zählung + unplaced-insert-Moves ab).
 */
function randomFeasibleState(rng: Rng): SolverState {
	const doc = emptyDoc();
	const nTeachers = 3 + rng.int(0, 3);
	for (let t = 0; t < nTeachers; t++) {
		const unavailable: { day: Day; period: Period }[] = [];
		for (let k = 0; k < rng.int(0, 4); k++) {
			unavailable.push({
				day: DAYS_BY_INDEX[rng.int(0, D)],
				period: (rng.int(0, P) + 1) as Period,
			});
		}
		doc.teachers.push(teacher(`t${t}`, `L${t}`, unavailable));
	}
	const codes = ['M', 'D', 'E', 'BSP', 'REL', 'PH'];
	// Hauptfächer mit echtem Max-in-Folge-Limit (R3-S5) — damit der
	// Property-Test auch subject_run über den Delta-Pfad abdeckt.
	codes.forEach((c, i) => doc.subjects.push(subject(c, { isMain: i < 3, maxConsecutive: i < 3 ? 2 : 99 })));
	const nSpecs = 6 + rng.int(0, 6);
	for (let s = 0; s < nSpecs; s++) {
		const gradePick = rng.int(0, 4);
		const grades: GradeLevel[] =
			gradePick === 3 ? [5, 6] : gradePick === 2 ? [7, 8] : [((rng.int(0, 4) + 5) as GradeLevel)];
		const blocks = rng.int(0, 4) === 0 ? [2] : undefined;
		const sp = spec(`s${s}`, codes[rng.int(0, codes.length)], `t${rng.int(0, nTeachers)}`,
			grades, blocks ? 2 : 1 + rng.int(0, 2), {
				blocks,
				couplingId: rng.int(0, 5) === 0 ? `c${rng.int(0, 2)}` : undefined,
			});
		sp.weekPattern = (['every', 'every', 'even', 'odd'] as const)[rng.int(0, 4)];
		sp.timePref = (['early', 'late', undefined, undefined] as const)[rng.int(0, 4)];
		sp.afternoonAllowed = (['allowed', 'preferred', undefined, undefined] as const)[rng.int(0, 4)];
		doc.specs.push(sp);
	}
	const state = buildState(doc);
	// Hard-zulässige Zufalls-Platzierung: pro Unit bis zu 20 Slot-Versuche,
	// sonst bleibt sie unplaced. Einige werden gar nicht erst versucht.
	for (let i = 0; i < state.nUnits; i++) {
		if (rng.int(0, 7) === 0) continue;
		const unit = state.units[i];
		for (let attempt = 0; attempt < 20; attempt++) {
			const slot = rng.int(0, D * P);
			if (wouldViolate(state, unit, slot) === null) {
				state.placement[i] = slot;
				break;
			}
		}
	}
	return state;
}

const BREAKDOWN_KEYS: (keyof ScoreBreakdown)[] = [
	'min_daily', 'no_p1_start', 'time_pref', 'main_aft', 'any_aft', 'no_free',
	'uneven_days', 'main_run', 'compact_teacher', 'main_early', 'subject_twice',
	'spec_spread', 'teacher_late_start', 'teacher_under_min', 'target_daily',
	'afternoon_preferred', 'main_twice', 'main_block_split',
	'teacher_gap_fairness', 'teacher_days_present', 'teacher_lunch',
	'unplaced', 'subject_run', 'total',
];

describe('Scoped Score-Delta == Full-Scan-Referenz (R3-S1)', () => {
	it('500 Random-States × 8 Moves: Breakdown feldgenau identisch, Cache driftet nicht über Accept-Ketten', () => {
		const rng = new Rng(0xcafe);
		let evaluated = 0;
		let accepted = 0;
		let nonZeroDeltas = 0;
		for (let round = 0; round < 500; round++) {
			const state = randomFeasibleState(rng);
			if (state.nUnits === 0) continue;
			const w = defaultWeights(state.doc);
			let cur = rebuildScoreCache(state, w);

			for (let probe = 0; probe < 8; probe++) {
				const move = genMove(state, rng, probe % 3 === 0 ? 0.3 : 0);
				if (!move) continue;

				// Voll-Scan-Referenz: apply → computeScore → revert.
				// (computeScore füllt die Footprints komplett neu — nach dem
				// revert entspricht der Füllstand wieder exakt dem Placement,
				// das der Cache erwartet; die Zeilen-Vektoren bleiben unberührt.)
				applyMove(state, move);
				const ref = computeScore(state, w);
				revertMove(state, move);
				computeScore(state, w); // Footprints zurück auf Vor-Move-Stand

				const { delta, nextBreakdown } = evaluateDelta(state, move, w, cur);
				evaluated++;
				if (delta !== 0) nonZeroDeltas++;

				for (const key of BREAKDOWN_KEYS) {
					expect(
						nextBreakdown[key],
						`Runde ${round} Probe ${probe} [${move.kind}] Komponente ${key}: scoped=${nextBreakdown[key]} ref=${ref[key]}`
					).toBe(ref[key]);
				}
				expect(delta).toBe(ref.total - cur.total);

				// ~1/3 der Moves übernehmen — commitMove muss den Cache exakt
				// mitführen, sonst driften die Folge-Evaluationen.
				if (rng.int(0, 3) === 0) {
					commitMove(state, move, nextBreakdown);
					cur = nextBreakdown;
					accepted++;
				}
			}

			// Drift-Check am Runden-Ende: Cache-Stand == frischer Voll-Scan.
			const full = computeScore(state, w);
			for (const key of BREAKDOWN_KEYS) {
				expect(
					cur[key],
					`Runde ${round} Drift in ${key}: cache=${cur[key]} full=${full[key]}`
				).toBe(full[key]);
			}
		}
		// Sanity: der Test muss echte Arbeit geleistet haben.
		expect(evaluated).toBeGreaterThan(2500);
		expect(accepted).toBeGreaterThan(400);
		expect(nonZeroDeltas).toBeGreaterThan(1000);
	});

	it('unplaced-insert (fromSlot=UNPLACED) wird scoped korrekt bewertet', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t0', 'L0'));
		doc.subjects.push(subject('M', { isMain: true }));
		doc.specs.push(spec('s0', 'M', 't0', [5], 2));
		const state = buildState(doc);
		const w = defaultWeights(doc);
		// Eine Unit platziert, eine unplaced.
		state.placement[0] = slotFromDP(0, 1);
		state.placement[1] = SLOT_UNPLACED;
		const cur = rebuildScoreCache(state, w);
		expect(cur.unplaced).toBe(1);

		const move: Move = { kind: 'slot-move', unitIdx: 1, fromSlot: SLOT_UNPLACED, toSlot: slotFromDP(1, 2) };
		applyMove(state, move);
		const ref = computeScore(state, w);
		revertMove(state, move);
		computeScore(state, w); // Footprints zurücksetzen

		const { nextBreakdown } = evaluateDelta(state, move, w, cur);
		for (const key of BREAKDOWN_KEYS) {
			expect(nextBreakdown[key], `Komponente ${key}`).toBe(ref[key]);
		}
		expect(nextBreakdown.unplaced).toBe(0);
	});
});
