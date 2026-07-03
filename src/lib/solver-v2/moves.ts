// Solver v2 — move operators for Local Search.
//
// Basis-Operatoren per SOLVER-V2-CONCEPT.md §7.1:
//   - slot-move: one unit jumps to a different slot
//   - slot-swap: two units exchange slots
//   - kempe-chain: block-swap of all lessons of one (day, grade)
//                  between two days
//
// Solver-Opt Schritt 4 — zielgerichtete Repair-Generatoren (emittieren
// die BESTEHENDEN Move-Kinds slot-move, dadurch bleiben apply/revert,
// Tabu und Delta-Bewertung unverändert):
//   - teacher-gap-repair: findet einen Lehrer mit Springstunde und zieht
//     eine seiner Stunden in die Lücke. Zufällige Moves treffen die eine
//     spezifische (Unit → Slot)-Kombination praktisch nie.
//   - day-eliminator: löst Mini-Tage auf (Lehrer-Tag mit 1-2 Stunden) —
//     verschiebt die Stunde auf einen Tag an dem der Lehrer schon da ist.
//   - class-gap-repair: analog für KLASSEN-Lücken (no_free, Gewicht 10000
//     im strict-Modus!) — Bench-Befund: Läufe blieben mit no_free=1
//     stecken weil Random-Moves die Lücke nicht füllen.
//
// All moves come with apply/revert symmetry — applyMove(state, m) followed
// by revertMove(state, m) restores the state byte-for-byte.

import { wouldViolate } from './hardCheck';
import {
	D,
	P,
	dpFromSlot,
	type SolverState,
	type Unit,
	SLOT_UNPLACED,
	slotFromDP,
} from './types';

export type MoveKind = 'slot-move' | 'slot-swap' | 'kempe-chain';

/** Description of a planned move. Apply and revert use this for undo. */
export type Move =
	| { kind: 'slot-move'; unitIdx: number; fromSlot: number; toSlot: number }
	| { kind: 'slot-swap'; aIdx: number; bIdx: number; aSlot: number; bSlot: number }
	| { kind: 'kempe-chain'; unitIdxs: number[]; fromSlots: number[]; toSlots: number[] };

/**
 * Simple seedable PRNG (xoroshiro64* — fast, decent quality, deterministic).
 * Used for reproducible moves with a known seed.
 */
export class Rng {
	private state: number;
	constructor(seed: number) {
		this.state = (seed | 0) || 1;
	}
	/** Aktuellen internen Zustand lesen — für Resume über LS-Chunk-Grenzen. */
	getState(): number {
		return this.state;
	}
	/** Internen Zustand setzen — Gegenstück zu getState() beim Resume. */
	setState(s: number): void {
		this.state = (s | 0) || 1;
	}
	next(): number {
		// xorshift32
		let x = this.state;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.state = x | 0;
		// Map to [0, 1)
		return ((x >>> 0) % 1_000_000) / 1_000_000;
	}
	int(min: number, maxExclusive: number): number {
		return Math.floor(this.next() * (maxExclusive - min)) + min;
	}
	pick<T>(arr: T[]): T {
		return arr[this.int(0, arr.length)];
	}
}

/**
 * Generate a candidate move. May return null if no valid move can be
 * constructed (e.g. all units pinned).
 *
 * Mix (Solver-Opt Schritt 4): slot-move 45% / slot-swap 30% / kempe 5%
 * / teacher-gap-repair 10% / day-eliminator 5% / class-gap-repair 5%.
 * `kempeBoost` verschiebt Richtung Diversifikation — der Caller
 * (typischerweise ILS nach unproduktivem Plateau) hebt ihn an, um aus
 * lokalen Optima zu entkommen.
 */
export function genMove(state: SolverState, rng: Rng, kempeBoost = 0, movable?: Unit[]): Move | null {
	const kempeProb = Math.min(0.4, 0.05 + kempeBoost);
	const swapProb = 0.30;
	const teacherGapProb = 0.10;
	const dayElimProb = 0.05;
	const classGapProb = 0.05;
	const moveProb = Math.max(0.05, 1 - swapProb - kempeProb - teacherGapProb - dayElimProb - classGapProb);
	const r = rng.next() * (moveProb + swapProb + kempeProb + teacherGapProb + dayElimProb + classGapProb);
	let acc = moveProb;
	if (r < acc) return genSlotMove(state, rng, movable);
	acc += swapProb;
	if (r < acc) return genSlotSwap(state, rng, movable);
	acc += kempeProb;
	if (r < acc) return genKempeChain(state, rng);
	acc += teacherGapProb;
	if (r < acc) return genTeacherGapRepair(state, rng);
	acc += dayElimProb;
	if (r < acc) return genDayEliminator(state, rng);
	return genClassGapRepair(state, rng);
}

/**
 * slot-move: pick a non-pinned, placed unit; pick a feasible target slot;
 * if target is occupied by another non-pinned unit, fall back to a swap.
 */
function genSlotMove(state: SolverState, rng: Rng, movable?: Unit[]): Move | null {
	const candidates = movable ?? movableUnits(state);
	if (candidates.length === 0) return null;
	const unit = rng.pick(candidates);
	const fromSlot = state.placement[unit.idx];

	// Hot-path optimization: instead of building the full feasibleSlots list
	// (which costs O(D*P*nUnits) wouldViolate calls), we sample random slots
	// directly and let wouldViolate filter them. This trades a slight chance
	// of missing a feasible slot for a ~50× speedup at our problem size.
	const D = 5; // days
	const P = 8; // periods
	const maxStartP = P - unit.blockSize + 1;
	if (maxStartP < 1) return null;
	for (let tries = 0; tries < 12; tries++) {
		const d = rng.int(0, D);
		const p = rng.int(1, maxStartP + 1);
		const toSlot = d * P + (p - 1);
		if (toSlot === fromSlot) continue;
		const occupant = findOccupantAt(state, toSlot);
		if (occupant && occupant !== unit) {
			// Convert to swap
			if (occupant.pinned) continue;
			if (wouldViolate(state, unit, toSlot, occupant) !== null) continue;
			if (wouldViolate(state, occupant, fromSlot, unit) !== null) continue;
			return {
				kind: 'slot-swap',
				aIdx: unit.idx,
				bIdx: occupant.idx,
				aSlot: fromSlot,
				bSlot: toSlot,
			};
		}
		// Empty target — verify no hard violation
		if (wouldViolate(state, unit, toSlot) !== null) continue;
		return { kind: 'slot-move', unitIdx: unit.idx, fromSlot, toSlot };
	}
	return null;
}

/**
 * slot-swap: pick two distinct non-pinned units, check both ways for hard
 * constraints, return swap.
 */
function genSlotSwap(state: SolverState, rng: Rng, movable?: Unit[]): Move | null {
	const candidates = movable ?? movableUnits(state);
	if (candidates.length < 2) return null;
	for (let tries = 0; tries < 8; tries++) {
		const a = rng.pick(candidates);
		const b = rng.pick(candidates);
		if (a === b) continue;
		const aSlot = state.placement[a.idx];
		const bSlot = state.placement[b.idx];
		if (aSlot === SLOT_UNPLACED || bSlot === SLOT_UNPLACED) continue;
		// After swap, a must be valid at b's slot and vice versa.
		// We "ignore" the other unit for the cross-check (it's about to move).
		if (wouldViolate(state, a, bSlot, b) !== null) continue;
		if (wouldViolate(state, b, aSlot, a) !== null) continue;
		return { kind: 'slot-swap', aIdx: a.idx, bIdx: b.idx, aSlot, bSlot };
	}
	return null;
}

/**
 * kempe-chain: pick two days D1, D2 and a grade G; collect all units of grade G
 * placed on D1 and D2; swap all of them between the two days. If the resulting
 * config is hard-feasible, return the move.
 *
 * This is a coarse-grained move that helps escape local minima where individual
 * slot-moves can't fix the day-distribution.
 */
function genKempeChain(state: SolverState, rng: Rng): Move | null {
	for (let tries = 0; tries < 4; tries++) {
		const d1 = rng.int(0, D);
		let d2 = rng.int(0, D);
		while (d2 === d1) d2 = rng.int(0, D);
		const g = (rng.int(0, 4) + 5) as 5 | 6 | 7 | 8;

		const onD1: Unit[] = [];
		const onD2: Unit[] = [];
		for (let i = 0; i < state.nUnits; i++) {
			const u = state.units[i];
			if (u.pinned) continue;
			if (!u.grades.includes(g)) continue;
			const slot = state.placement[u.idx];
			if (slot === SLOT_UNPLACED) continue;
			const dp = dpFromSlot(slot);
			if (dp.dayIndex === d1) onD1.push(u);
			else if (dp.dayIndex === d2) onD2.push(u);
		}
		if (onD1.length === 0 && onD2.length === 0) continue;

		// Build target slots: keep period, swap day.
		const allUnits = [...onD1, ...onD2];
		const fromSlots = allUnits.map(u => state.placement[u.idx]);
		const toSlots = allUnits.map(u => {
			const dp = dpFromSlot(state.placement[u.idx]);
			const newDay = dp.dayIndex === d1 ? d2 : d1;
			return slotFromDP(newDay, dp.period);
		});

		// Validate: simulate the chain by temporarily clearing all involved
		// placements, then check each new placement.
		const saved: number[] = [];
		for (const u of allUnits) {
			saved.push(state.placement[u.idx]);
			state.placement[u.idx] = SLOT_UNPLACED;
		}
		let ok = true;
		for (let i = 0; i < allUnits.length; i++) {
			if (wouldViolate(state, allUnits[i], toSlots[i]) !== null) { ok = false; break; }
			// Tentatively place to detect intra-chain conflicts
			state.placement[allUnits[i].idx] = toSlots[i];
		}
		// Restore original placements no matter what (caller will applyMove if ok)
		for (let i = 0; i < allUnits.length; i++) {
			state.placement[allUnits[i].idx] = saved[i];
		}
		if (!ok) continue;

		return {
			kind: 'kempe-chain',
			unitIdxs: allUnits.map(u => u.idx),
			fromSlots,
			toSlots,
		};
	}
	return null;
}

/**
 * teacher-gap-repair (Solver-Opt Schritt 4): wählt einen zufälligen Lehrer,
 * baut seine Wochen-Occupancy on-the-fly (O(eigene Units) ≈ 5–25), sucht
 * eine Springstunde und versucht, eine SEINER Stunden (blockSize 1, nicht
 * gepinnt) in die Lücke zu ziehen. Kandidaten: Stunden anderer Tage (senkt
 * ggf. Anwesenheitstage) und Randstunden desselben Tages (kompaktet den Tag).
 */
function genTeacherGapRepair(state: SolverState, rng: Rng): Move | null {
	const teachers = state.doc.teachers;
	if (teachers.length === 0) return null;
	for (let tries = 0; tries < 4; tries++) {
		const teacher = teachers[rng.int(0, teachers.length)];
		const units = state.unitsByTeacher.get(teacher.id);
		if (!units || units.length === 0) continue;

		// Wochen-Occupancy des Lehrers: occ[d*P + p-1] = true wenn belegt.
		const occ = new Array<boolean>(D * P).fill(false);
		for (const u of units) {
			const slot = state.placement[u.idx];
			if (slot === SLOT_UNPLACED) continue;
			const dp = dpFromSlot(slot);
			for (let pos = 0; pos < u.blockSize; pos++) {
				const p = dp.period + pos;
				if (p <= P) occ[dp.dayIndex * P + (p - 1)] = true;
			}
		}

		// Alle Lücken (Tag, Periode) sammeln: frei zwischen firstP und lastP.
		const gaps: number[] = []; // encoded d*P + (p-1)
		for (let d = 0; d < D; d++) {
			let firstP = -1;
			let lastP = -1;
			for (let p = 0; p < P; p++) {
				if (occ[d * P + p]) {
					if (firstP === -1) firstP = p;
					lastP = p;
				}
			}
			if (firstP === -1) continue;
			for (let p = firstP + 1; p < lastP; p++) {
				if (!occ[d * P + p]) gaps.push(d * P + p);
			}
		}
		if (gaps.length === 0) continue;
		const gapCode = gaps[rng.int(0, gaps.length)];
		const gapDay = Math.floor(gapCode / P);
		const gapPeriod = (gapCode % P) + 1;
		const toSlot = slotFromDP(gapDay, gapPeriod);

		// Kandidaten: bewegliche Einzelstunden dieses Lehrers, die NICHT
		// bereits auf dem Ziel-Slot liegen. Shuffle light: random start.
		const start = rng.int(0, units.length);
		for (let k = 0; k < units.length; k++) {
			const u = units[(start + k) % units.length];
			if (u.pinned || u.blockSize !== 1) continue;
			const fromSlot = state.placement[u.idx];
			if (fromSlot === SLOT_UNPLACED || fromSlot === toSlot) continue;
			if (wouldViolate(state, u, toSlot) !== null) continue;
			return { kind: 'slot-move', unitIdx: u.idx, fromSlot, toSlot };
		}
	}
	return null;
}

/**
 * day-eliminator (Solver-Opt Schritt 4): findet einen Lehrer-Tag mit nur
 * 1–2 Stunden (Mini-Tag, Anfahrt lohnt nicht) und verschiebt eine davon
 * auf einen Tag, an dem der Lehrer ohnehin präsent ist — bevorzugt
 * angrenzend an seine bestehenden Stunden (kompakt).
 */
function genDayEliminator(state: SolverState, rng: Rng): Move | null {
	const teachers = state.doc.teachers;
	if (teachers.length === 0) return null;
	for (let tries = 0; tries < 4; tries++) {
		const teacher = teachers[rng.int(0, teachers.length)];
		const units = state.unitsByTeacher.get(teacher.id);
		if (!units || units.length === 0) continue;

		// Pro Tag: Anzahl Stunden + Liste der Units.
		const dayCount = new Array<number>(D).fill(0);
		const dayFirst = new Array<number>(D).fill(-1);
		const dayLast = new Array<number>(D).fill(-1);
		for (const u of units) {
			const slot = state.placement[u.idx];
			if (slot === SLOT_UNPLACED) continue;
			const dp = dpFromSlot(slot);
			dayCount[dp.dayIndex] += u.blockSize;
			const pIdx = dp.period - 1;
			if (dayFirst[dp.dayIndex] === -1 || pIdx < dayFirst[dp.dayIndex]) dayFirst[dp.dayIndex] = pIdx;
			const endIdx = pIdx + u.blockSize - 1;
			if (endIdx > dayLast[dp.dayIndex]) dayLast[dp.dayIndex] = endIdx;
		}

		// Mini-Tage (1-2 Stunden) und "Anker-Tage" (>=3 Stunden) finden.
		const miniDays: number[] = [];
		const anchorDays: number[] = [];
		for (let d = 0; d < D; d++) {
			if (dayCount[d] >= 1 && dayCount[d] <= 2) miniDays.push(d);
			else if (dayCount[d] >= 3) anchorDays.push(d);
		}
		if (miniDays.length === 0 || anchorDays.length === 0) continue;
		const miniDay = miniDays[rng.int(0, miniDays.length)];

		// Eine bewegliche Einzelstunde des Mini-Tags wählen.
		const miniUnits = units.filter(u => {
			if (u.pinned || u.blockSize !== 1) return false;
			const slot = state.placement[u.idx];
			if (slot === SLOT_UNPLACED) return false;
			return dpFromSlot(slot).dayIndex === miniDay;
		});
		if (miniUnits.length === 0) continue;
		const unit = miniUnits[rng.int(0, miniUnits.length)];
		const fromSlot = state.placement[unit.idx];

		// Ziel: angrenzend an bestehende Stunden eines Anker-Tags
		// (firstP-1 oder lastP+1), sonst beliebige Periode des Anker-Tags.
		const anchorStart = rng.int(0, anchorDays.length);
		for (let a = 0; a < anchorDays.length; a++) {
			const d = anchorDays[(anchorStart + a) % anchorDays.length];
			const candidates: number[] = [];
			if (dayFirst[d] > 0) candidates.push(dayFirst[d] - 1);
			if (dayLast[d] < P - 1) candidates.push(dayLast[d] + 1);
			// Fallback: zufällige Periode des Tags
			candidates.push(rng.int(0, P));
			for (const pIdx of candidates) {
				const toSlot = slotFromDP(d, pIdx + 1);
				if (toSlot === fromSlot) continue;
				if (wouldViolate(state, unit, toSlot) !== null) continue;
				return { kind: 'slot-move', unitIdx: unit.idx, fromSlot, toSlot };
			}
		}
	}
	return null;
}

/**
 * class-gap-repair (Solver-Opt Schritt 4): findet eine KLASSEN-Lücke
 * (inneres Loch im (Tag, Stufe)-Raster — im strict-Modus die teuerste
 * Verletzung überhaupt, Gewicht 10000) und zieht eine Stunde derselben
 * Stufe hinein. Bench-Befund: Random-Moves treffen die eine spezifische
 * (Unit → Slot)-Kombination praktisch nie; Läufe blieben mit no_free=1
 * stecken.
 */
function genClassGapRepair(state: SolverState, rng: Rng): Move | null {
	for (let tries = 0; tries < 4; tries++) {
		const d = rng.int(0, D);
		const g = (rng.int(0, 4) + 5) as 5 | 6 | 7 | 8;

		// Occupancy der Stufe an Tag d + Kandidaten-Units der Stufe sammeln.
		const occ = new Array<boolean>(P).fill(false);
		const gradeUnits: Unit[] = [];
		for (let i = 0; i < state.nUnits; i++) {
			const u = state.units[i];
			if (!u.grades.includes(g)) continue;
			const slot = state.placement[i];
			if (slot === SLOT_UNPLACED) continue;
			gradeUnits.push(u);
			const dp = dpFromSlot(slot);
			if (dp.dayIndex !== d) continue;
			for (let pos = 0; pos < u.blockSize; pos++) {
				const pIdx = dp.period - 1 + pos;
				if (pIdx < P) occ[pIdx] = true;
			}
		}

		// Innere Lücken + führende Lücken (beide zählen für no_free).
		let firstP = -1;
		let lastP = -1;
		for (let p = 0; p < P; p++) {
			if (occ[p]) {
				if (firstP === -1) firstP = p;
				lastP = p;
			}
		}
		if (firstP === -1) continue;
		const gaps: number[] = [];
		for (let p = 0; p < firstP; p++) gaps.push(p); // führende Lücken
		for (let p = firstP + 1; p < lastP; p++) {
			if (!occ[p]) gaps.push(p);
		}
		if (gaps.length === 0) continue;
		const gapPIdx = gaps[rng.int(0, gaps.length)];
		const toSlot = slotFromDP(d, gapPIdx + 1);

		// Eine bewegliche Einzelstunde der Stufe in die Lücke ziehen —
		// bevorzugt von einem ANDEREN Tag (füllt die Lücke ohne am selben
		// Tag ein neues Loch zu reißen; Randstunden desselben Tages sind
		// aber auch ok — der Score entscheidet).
		const start = rng.int(0, gradeUnits.length);
		for (let k = 0; k < gradeUnits.length; k++) {
			const u = gradeUnits[(start + k) % gradeUnits.length];
			if (u.pinned || u.blockSize !== 1) continue;
			const fromSlot = state.placement[u.idx];
			if (fromSlot === toSlot) continue;
			if (wouldViolate(state, u, toSlot) !== null) continue;
			return { kind: 'slot-move', unitIdx: u.idx, fromSlot, toSlot };
		}
	}
	return null;
}

/**
 * Return all unit references that are currently non-pinned and placed.
 *
 * Runde 2, Schritt 3: exportiert, damit localSearch die Liste EINMAL pro
 * Lauf berechnet und via genMove-Param durchreicht — sie ist während eines
 * LS-Laufs statisch (Moves relozieren nur, sie (ent)platzieren nie) und
 * wurde vorher bei JEDER Move-Generierung neu gebaut (O(n) + Array-Alloc).
 */
export function movableUnits(state: SolverState): Unit[] {
	const out: Unit[] = [];
	for (let i = 0; i < state.nUnits; i++) {
		const u = state.units[i];
		if (u.pinned) continue;
		if (state.placement[i] === SLOT_UNPLACED) continue;
		out.push(u);
	}
	return out;
}

/** Find which unit (if any) currently occupies the given slot. O(nUnits). */
function findOccupantAt(state: SolverState, slot: number): Unit | null {
	for (let i = 0; i < state.nUnits; i++) {
		if (state.placement[i] === slot) return state.units[i];
	}
	return null;
}

/** Apply a move in-place. */
export function applyMove(state: SolverState, move: Move): void {
	switch (move.kind) {
		case 'slot-move':
			state.placement[move.unitIdx] = move.toSlot;
			return;
		case 'slot-swap':
			state.placement[move.aIdx] = move.bSlot;
			state.placement[move.bIdx] = move.aSlot;
			return;
		case 'kempe-chain':
			for (let i = 0; i < move.unitIdxs.length; i++) {
				state.placement[move.unitIdxs[i]] = move.toSlots[i];
			}
			return;
	}
}

/** Revert a previously applied move. Symmetric inverse of applyMove. */
export function revertMove(state: SolverState, move: Move): void {
	switch (move.kind) {
		case 'slot-move':
			state.placement[move.unitIdx] = move.fromSlot;
			return;
		case 'slot-swap':
			state.placement[move.aIdx] = move.aSlot;
			state.placement[move.bIdx] = move.bSlot;
			return;
		case 'kempe-chain':
			for (let i = 0; i < move.unitIdxs.length; i++) {
				state.placement[move.unitIdxs[i]] = move.fromSlots[i];
			}
			return;
	}
}
