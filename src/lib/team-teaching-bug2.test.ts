// Phase 17 Bug-Reproduction: Lehrer L5 erscheint im Solver-Output
// gleichzeitig in Di P2 für D Stufe 6 (Team-Teaching) UND D Stufe 8
// (separate Team-Teaching). Müsste durch H3 geblockt sein.

import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { buildState } from './solver-v2/units';
import { wouldViolate } from './solver-v2/hardCheck';
import { slotFromDP } from './solver-v2/types';

function teacher(id: string, name: string, shortNumber: number): Teacher {
	return { id, name, shortNumber, color: '#f00', subjects: [], unavailable: [] };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: true, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(opts: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return {
		classes: ['1'], weekPattern: 'every', includeInSolver: true,
		source: 'manual', afternoonAllowed: 'allowed', ...opts
	};
}

describe('Bug: Team-Teaching Lehrer in 2 verschiedenen Specs im selben Slot', () => {
	it('REPRO: D-Stufe-6 mit Team [L5,L6] + D-Stufe-8 mit Team [L6,L5] → KEIN gleicher Slot erlaubt', () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L5', 'Lehrer5', 5),
			teacher('L6', 'Lehrer6', 6)
		];
		doc.subjects = [subject('D')];
		doc.specs = [
			// D Stufe 6 — Team [L5, L6], count=4 mit 2 Segmenten
			spec({
				id: 'd6', subject: 'D', teachers: ['L5', 'L6'], count: 4, grades: [6],
				teachingSegments: [
					{ hours: 2, teachers: ['L5', 'L6'] },
					{ hours: 2, teachers: ['L6'] }
				]
			}),
			// D Stufe 8 — Team [L6, L5], count=4 mit 2 Segmenten
			spec({
				id: 'd8', subject: 'D', teachers: ['L6', 'L5'], count: 4, grades: [8],
				teachingSegments: [
					{ hours: 2, teachers: ['L6', 'L5'] },
					{ hours: 2, teachers: ['L5'] }
				]
			})
		];

		const state = buildState(doc);
		// 4 Units pro Spec = 8 total
		expect(state.nUnits).toBe(8);

		// Versuche: D6 Team-Unit auf Di P2 platzieren
		const diP2 = slotFromDP(1, 2);
		const d6TeamUnit = state.units.find(u =>
			u.subjectCode === 'D' && u.grades.includes(6) && u.teacherIds.includes('L5') && u.teacherIds.includes('L6')
		)!;
		expect(d6TeamUnit).toBeDefined();
		state.placement[d6TeamUnit.idx] = diP2;

		// Jetzt versuche D8 Team-Unit (auch mit L5+L6) auf den GLEICHEN Slot
		const d8TeamUnit = state.units.find(u =>
			u.subjectCode === 'D' && u.grades.includes(8) && u.teacherIds.includes('L5') && u.teacherIds.includes('L6')
		)!;
		expect(d8TeamUnit).toBeDefined();
		const violation = wouldViolate(state, d8TeamUnit, diP2);
		// Erwartung: wouldViolate liefert eine Fehlermeldung (double-book L5 oder L6)
		expect(violation).not.toBeNull();
		expect(violation?.toLowerCase()).toMatch(/double|teacher/i);
	});

	it('REPRO 2: Solver-Lauf — kein Plan mit dieser Konstellation darf L5+L6 doppelt enthalten', async () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L1', 'L1', 1),
			teacher('L2', 'L2', 2),
			teacher('L5', 'Lehrer5', 5),
			teacher('L6', 'Lehrer6', 6),
			teacher('L7', 'L7', 7)
		];
		doc.subjects = [
			subject('D'), subject('M'), subject('E'), subject('FB'), subject('BUB')
		];
		// Anlage analog Bild: Stufe 6 + Stufe 8 beides Deutsch als Team L5+L6
		doc.specs = [
			spec({
				id: 'd6', subject: 'D', teachers: ['L5', 'L6'], count: 4, grades: [6],
				teachingSegments: [
					{ hours: 2, teachers: ['L5', 'L6'] },
					{ hours: 2, teachers: ['L6'] }
				]
			}),
			spec({
				id: 'd8', subject: 'D', teachers: ['L6', 'L5'], count: 4, grades: [8],
				teachingSegments: [
					{ hours: 2, teachers: ['L6', 'L5'] },
					{ hours: 2, teachers: ['L5'] }
				]
			}),
			// Etwas Fülle
			spec({ id: 'm5', subject: 'M', teachers: ['L1'], count: 4, grades: [5] }),
			spec({ id: 'm6', subject: 'M', teachers: ['L2'], count: 4, grades: [6] }),
			spec({ id: 'e5', subject: 'E', teachers: ['L7'], count: 4, grades: [5] }),
			spec({ id: 'e7', subject: 'E', teachers: ['L7'], count: 4, grades: [7] }),
			spec({ id: 'bub5', subject: 'BUB', teachers: ['L1'], count: 2, grades: [5] })
		];

		const { startSolve } = await import('./solver-v2/index');
		// Mehrere Solver-Läufe
		for (let run = 0; run < 5; run++) {
			doc.placed = [];
			const session = startSolve(doc, { totalBudgetMs: 1500, innerBudgetMs: 500 });
			await new Promise<void>(resolve => session.on('done', d => { doc.placed = d.final.placed; resolve(); }));

			// Pro (day, period): Lehrer-Doppelbelegung detektieren.
			// Phase 17: nutze pl.teachers (Segment-Team) falls vorhanden, sonst
			// spec.teachers — sonst zählen wir Stütz-Lehrer in Stunden in denen
			// sie gar nicht anwesend sind.
			const teacherSlotMap = new Map<string, string[]>();
			for (const pl of doc.placed) {
				const sp = doc.specs.find(s => s.id === pl.specId)!;
				const effectiveTeachers = pl.teachers ?? sp.teachers;
				const key = `${pl.day}|${pl.period}`;
				for (const tid of effectiveTeachers) {
					const k = `${key}|${tid}`;
					const arr = teacherSlotMap.get(k) ?? [];
					if (!arr.includes(pl.specId)) arr.push(pl.specId);
					teacherSlotMap.set(k, arr);
				}
			}
			for (const [k, specIds] of teacherSlotMap) {
				if (specIds.length > 1) {
					const allCoupled = new Set(specIds.map(sid =>
						doc.specs.find(s => s.id === sid)?.couplingId ?? ''
					));
					if (allCoupled.size !== 1 || [...allCoupled][0] === '') {
						const [day, period, tid] = k.split('|');
						console.log(`\n=== Run ${run}: KONFLIKT @ ${day} P${period}, Lehrer ${tid} ===`);
						console.log(`Doc.placed (${doc.placed.length} entries):`);
						for (const pl of doc.placed) {
							console.log(`  ${pl.specId} ${pl.day} P${pl.period} grade=${pl.grade}`);
						}
						console.log();
						for (const sid of specIds) {
							const placements = doc.placed.filter(p => p.specId === sid);
							const sp = doc.specs.find(s => s.id === sid)!;
							console.log(`  Spec ${sid}: subj=${sp.subject}, teachers=[${sp.teachers.join(',')}], segs=${JSON.stringify(sp.teachingSegments)}`);
							for (const pl of placements) {
								console.log(`    ${pl.day} P${pl.period} grade=${pl.grade} pinned=${pl.pinned}`);
							}
						}
						// Zusätzlich: rebuild state und prüfe wieviele Units pro spec
						const { buildState } = await import('./solver-v2/units');
						const { findHardViolations } = await import('./solver-v2/hardCheck');
						const st = buildState(doc, { hotStart: true });
						console.log(`\nNach hot-start rebuild: ${st.nUnits} units`);
						const offenders = findHardViolations(st);
						console.log(`Offenders: ${offenders.length}: [${offenders.join(',')}]`);
						for (const idx of offenders) {
							const u = st.units[idx];
							console.log(`  Offender ${idx}: ${u.subjectCode} grades=${u.grades} teachers=[${u.teacherIds.join(',')}] specIds=[${u.specIds.join(',')}]`);
						}
						throw new Error(
							`Run ${run}: Lehrer ${tid} doppelbelegt @ ${day} P${period}, ` +
							`Specs: ${specIds.join(', ')}`
						);
					}
				}
			}
		}
	}, 20_000);
});
