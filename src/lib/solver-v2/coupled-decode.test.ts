// Repro/Regression: gekoppelte Specs (3er-BSP-Kopplung wie im echten
// MS-SiG-Workflow) dürfen beim Decode NICHT vom findHardViolations-
// Safety-Net verworfen werden. Symptom (2026-07-03): Solver meldet
// unplaced=0, aber die UI zeigt 3× „BSP ×1" ungeplant — eine Coupling-
// Unit verschwand zwischen placement[] und PlacedLesson[].

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDoc } from '../types';
import { importCsv } from '../import/csv';
import { migrateDoc } from '../persistence';
import { buildState } from './units';
import { computeScore } from './score';
import { construct } from './construct';
import { iteratedLocalSearch } from './iteratedLS';
import { defaultWeights, SLOT_UNPLACED } from './types';
import { placementToPlacedLessons } from './index';
import { findHardViolations, wouldViolate } from './hardCheck';

function coupledRealDoc() {
	const csvPath = join(__dirname, '..', 'import', '__fixtures__', 'sokrates-liste.csv');
	const csv = readFileSync(csvPath, 'utf8');
	const result = importCsv(csv);
	const doc = emptyDoc('2026/27');
	doc.teachers = result.teachers;
	doc.subjects = result.subjects;
	doc.specs = result.specs;
	migrateDoc(doc);
	// Wie im echten Workflow: Parallel-Gruppen koppeln (BSP Mädchen +
	// Knaben 1/2 + Knaben 3/4; REL 6+7 + 7+8).
	for (const s of doc.specs.filter(s => s.subject === 'BSP' && s.count === 3)) s.couplingId = 'c-bsp';
	for (const s of doc.specs.filter(s => s.subject === 'REL' && s.count === 2)) s.couplingId = 'c-rel';
	return doc;
}

describe('H8 — zwei Occurrences derselben Kopplungsgruppe', () => {
	it('dürfen NICHT auf demselben (Tag, Periode) liegen', () => {
		const doc = coupledRealDoc();
		const state = buildState(doc);
		// Die 3 BSP-Coupling-Units (eine pro Wochenstunde der Kopplung).
		const bspUnits = state.units.filter(u => u.kind === 'coupling' && u.subjectCode === 'BSP');
		expect(bspUnits.length).toBe(3);
		// Unit #1 auf Mo P1 setzen, dann Unit #2 auf DENSELBEN Slot prüfen:
		// zwei verschiedene Wochenstunden gleichzeitig = Doppellage im Grid.
		state.placement[bspUnits[0].idx] = 0; // Mo P1
		const reason = wouldViolate(state, bspUnits[1], 0);
		expect(reason, 'Doppellage zweier Kopplungs-Occurrences muss verboten sein').not.toBeNull();
	});
});

describe('Decode gekoppelter Pläne', () => {
	it('Hot-Start-Roundtrip (Parallel-Pool-Pipeline): decode → doc.placed → buildState verliert keine Stunden', () => {
		// Exakt die Produktions-Pipeline des Parallel-Pools (worker-bridge):
		// Pool-Construction → placementToPlacedLessons → doc.placed →
		// buildState({hotStart}) → weiter optimieren. Jeder Verlust hier
		// erscheint in der UI als „ungeplant", obwohl der Solver 0 meldet.
		for (const seed of [1, 7, 42, 99, 1337]) {
			const doc = coupledRealDoc();
			const state = buildState(doc);
			const w = defaultWeights(doc);
			construct(state, { weights: w, seed });
			const placedUnits1 = state.placement.filter(s => s !== SLOT_UNPLACED).length;
			const decoded = placementToPlacedLessons(state, state.placement);

			// Roundtrip: wie startMainSession in worker-bridge.ts.
			const doc2 = { ...coupledRealDoc(), placed: decoded.map(p => ({ ...p })) };
			// WICHTIG: coupledRealDoc erzeugt NEUE UUIDs — doc muss identisch sein.
			doc2.teachers = doc.teachers;
			doc2.subjects = doc.subjects;
			doc2.specs = doc.specs;
			const state2 = buildState(doc2, { hotStart: true });
			const placedUnits2 = state2.placement.filter(s => s !== SLOT_UNPLACED).length;
			expect(placedUnits2, `Seed ${seed}: Hot-Start-Load verlor Units (${placedUnits1} → ${placedUnits2})`)
				.toBe(placedUnits1);
		}
	}, 30_000);

	it('verwirft keine planmäßig platzierten Coupling-Units (Solver-unplaced == UI-unplaced)', () => {
		const doc = coupledRealDoc();
		const state = buildState(doc);
		const w = defaultWeights(doc);
		construct(state, { weights: w, seed: 42 });
		iteratedLocalSearch(state, computeScore(state, w), {
			weights: w, totalBudgetMs: 4000, innerBudgetMs: 2000, plateauMs: 1000, seed: 42,
		});
		const b = computeScore(state, w);

		// Diagnose-Ausgabe: Wer wird verworfen und warum?
		const offenders = findHardViolations(state);
		const details = offenders.map(i => {
			const u = state.units[i];
			const slot = state.placement[i];
			state.placement[i] = SLOT_UNPLACED;
			const wasPinned = u.pinned;
			u.pinned = false;
			const reason = wouldViolate(state, u, slot);
			u.pinned = wasPinned;
			state.placement[i] = slot;
			return { idx: i, kind: u.kind, subj: u.subjectCode, weekPattern: u.weekPattern, reason };
		});
		// eslint-disable-next-line no-console
		if (details.length > 0) console.log('DECODE-OFFENDERS:', JSON.stringify(details, null, 2));

		// Kern-Assertion: Der Score kennt `unplaced` — der Decode darf nicht
		// zusätzlich Units verschlucken.
		const placedUnits = state.placement.filter(s => s !== SLOT_UNPLACED).length;
		const decoded = placementToPlacedLessons(state, state.placement);
		const decodedSlotUnits = new Set(decoded.map(p => `${p.specId}|${p.day}|${p.period}`));
		// Jede platzierte Unit muss mindestens 1 PlacedLesson pro Spec liefern.
		let decodedUnitCount = 0;
		for (let i = 0; i < state.nUnits; i++) {
			if (state.placement[i] === SLOT_UNPLACED) continue;
			const u = state.units[i];
			const slot = state.placement[i];
			const day = ['Mo', 'Di', 'Mi', 'Do', 'Fr'][Math.floor(slot / 8)];
			const period = (slot % 8) + 1;
			const allThere = u.specIds.every(sid => decodedSlotUnits.has(`${sid}|${day}|${period}`));
			if (allThere) decodedUnitCount++;
		}
		expect(b.unplaced).toBe(state.nUnits - placedUnits);
		expect(decodedUnitCount, 'Decode hat platzierte Units verworfen').toBe(placedUnits);
	}, 20_000);
});
