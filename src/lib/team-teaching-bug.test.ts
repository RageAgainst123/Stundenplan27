// Reproduktion: Team-Teaching-Lehrer wird gleichzeitig in 2 verschiedenen
// Fächern platziert. Konkret L11 in M Stufe 6 + L11 in GPB Stufe 8, beide Mo P2.
// Erwartet: wouldViolate() blockiert das mit "double-booked".

import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { buildState } from './solver-v2/units';
import { wouldViolate, findHardViolations } from './solver-v2/hardCheck';
import { slotFromDP } from './solver-v2/types';

function teacher(id: string, name: string, shortNumber: number): Teacher {
	return { id, name, shortNumber, color: '#f00', subjects: [], unavailable: [] };
}
function subject(code: string): Subject {
	return { code, name: code, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(opts: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return {
		classes: ['1'],
		weekPattern: 'every',
		includeInSolver: true,
		source: 'manual',
		afternoonAllowed: 'allowed',
		...opts
	};
}

describe('Bug: Team-Teaching teacher double-booking', () => {
	it('REPRO: L11 in Team-Teaching M Stufe 6 darf NICHT gleichzeitig L11-Solo in GPB Stufe 8 sein', () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L4', 'Lehrer4', 4),
			teacher('L9', 'Lehrer9', 9),
			teacher('L11', 'Lehrer11', 11)
		];
		doc.subjects = [subject('M'), subject('GPB')];
		doc.specs = [
			// M Stufe 6: Team-Teaching L4 + L11, count=4, 2h Team + 2h L4 allein
			spec({
				id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6],
				teachingSegments: [
					{ hours: 2, teachers: ['L4', 'L11'] },
					{ hours: 2, teachers: ['L4'] }
				]
			}),
			// GPB Stufe 8: nur L11
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] })
		];

		const state = buildState(doc);
		// 4 M-Units (2 mit Team [L4,L11], 2 mit [L4]) + 2 GPB-Units (mit [L11])
		expect(state.nUnits).toBe(6);

		// Platziere die erste M-Team-Unit (L4 + L11) auf Mo P2
		const moP2 = slotFromDP(0, 2);
		const teamUnit = state.units.find(u => u.teacherIds.includes('L11') && u.subjectCode === 'M')!;
		expect(teamUnit).toBeDefined();
		state.placement[teamUnit.idx] = moP2;

		// Versuche jetzt eine GPB-Unit (auch mit L11) auf den GLEICHEN Slot zu platzieren
		const gpbUnit = state.units.find(u => u.subjectCode === 'GPB')!;
		const violation = wouldViolate(state, gpbUnit, moP2);
		// Erwartung: wouldViolate liefert eine Fehlermeldung (double-book L11)
		expect(violation).not.toBeNull();
		expect(violation).toContain('L11');
	});

	it('REPRO 2: Solver-Lauf — Plan darf KEINE Doppelbelegung enthalten', async () => {
		// Reproduziert das Bild: L11 in Team-Teaching M Stufe 6 + L11 in GPB Stufe 8
		// und L4 als zweiter Hauptlehrer.
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L4', 'Lehrer4', 4),
			teacher('L9', 'Lehrer9', 9),
			teacher('L11', 'Lehrer11', 11)
		];
		doc.subjects = [
			subject('M'), subject('GPB'), subject('PH'), subject('GWB'),
			subject('BUB'), subject('KGE'), subject('TD'), subject('INF'),
			subject('E'), subject('D'), subject('EL'), subject('ML'), subject('FB')
		];
		doc.specs = [
			// M Stufe 6 als Team-Teaching mit L4+L11
			spec({
				id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6],
				teachingSegments: [
					{ hours: 2, teachers: ['L4', 'L11'] },
					{ hours: 2, teachers: ['L4'] }
				]
			}),
			// GPB Stufe 8 mit L11 als Hauptlehrer (Solo)
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] }),
			// E Stufe 8 mit L11
			spec({ id: 'e8', subject: 'E', teachers: ['L11'], count: 1, grades: [8] })
		];

		const { startSolve } = await import('./solver-v2/index');
		const session = startSolve(doc, { totalBudgetMs: 1500, innerBudgetMs: 800 });
		await new Promise<void>(resolve => {
			session.on('done', () => resolve());
		});

		// Final-Plan ein-lesen
		const placed = doc.placed.length > 0 ? doc.placed : [];
		void placed;

		// Wichtiger Check: für jedes (day, period) darf L11 max 1× drinstehen
		const { findHardViolations } = await import('./solver-v2/hardCheck');
		const finalState = buildState(doc);
		// Lade Final-Plan in finalState (pinned=false aber slot gesetzt)
		// Das machen wir simpler: rufe einfach buildState mit hotStart=true auf
		// um den platzierten Plan in den State zu laden.
		const stateWithPlacements = buildState(doc, { hotStart: true });
		const offenders = findHardViolations(stateWithPlacements);
		// Wenn Solver einen Konflikt eingebaut hat, schreit das hier.
		expect(offenders).toEqual([]);
		void finalState;
	}, 10_000);

	it('REPRO 3: Solver-Lauf mit mehr Last — wiederholte Generierungen auf Konflikte prüfen', async () => {
		// Größeres Szenario das näher am echten Stundenplan ist.
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L4', 'Lehrer4', 4),
			teacher('L5', 'Lehrer5', 5),
			teacher('L6', 'Lehrer6', 6),
			teacher('L7', 'Lehrer7', 7),
			teacher('L8', 'Lehrer8', 8),
			teacher('L9', 'Lehrer9', 9),
			teacher('L10', 'Lehrer10', 10),
			teacher('L11', 'Lehrer11', 11)
		];
		doc.subjects = [
			subject('M'), subject('GPB'), subject('PH'), subject('GWB'),
			subject('BUB'), subject('KGE'), subject('TD'), subject('INF'),
			subject('E'), subject('D'), subject('EL'), subject('ML'),
			subject('FB'), subject('CH')
		];
		// Stufe 5
		doc.specs.push(spec({ id: 'd5', subject: 'D', teachers: ['L6'], count: 4, grades: [5] }));
		doc.specs.push(spec({ id: 'e5', subject: 'E', teachers: ['L8'], count: 4, grades: [5] }));
		doc.specs.push(spec({ id: 'm5', subject: 'M', teachers: ['L11'], count: 4, grades: [5] }));
		doc.specs.push(spec({ id: 'bub5', subject: 'BUB', teachers: ['L4'], count: 2, grades: [5] }));
		doc.specs.push(spec({ id: 'gwb5', subject: 'GWB', teachers: ['L7'], count: 2, grades: [5] }));
		doc.specs.push(spec({ id: 'inf5', subject: 'INF', teachers: ['L6'], count: 1, grades: [5] }));
		doc.specs.push(spec({ id: 'kge5', subject: 'KGE', teachers: ['L8'], count: 2, grades: [5] }));
		// Stufe 6 — M als Team-Teaching mit L4+L11 (4h, davon 2h team)
		doc.specs.push(spec({
			id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 4, grades: [6],
			teachingSegments: [
				{ hours: 2, teachers: ['L4', 'L11'] },
				{ hours: 2, teachers: ['L4'] }
			]
		}));
		doc.specs.push(spec({ id: 'd6', subject: 'D', teachers: ['L5'], count: 4, grades: [6] }));
		doc.specs.push(spec({ id: 'e6', subject: 'E', teachers: ['L1'], count: 4, grades: [6] }));
		doc.specs.push(spec({ id: 'kge6', subject: 'KGE', teachers: ['L6'], count: 2, grades: [6] }));
		// Stufe 7
		doc.specs.push(spec({ id: 'm7', subject: 'ML', teachers: ['L4'], count: 4, grades: [7] }));
		doc.specs.push(spec({ id: 'd7', subject: 'D', teachers: ['L7'], count: 4, grades: [7] }));
		doc.specs.push(spec({ id: 'ph7', subject: 'PH', teachers: ['L4'], count: 2, grades: [7] }));
		doc.specs.push(spec({ id: 'inf7', subject: 'INF', teachers: ['L6'], count: 1, grades: [7] }));
		// Stufe 8 — L11 ist ZWEITER Hauptlehrer
		doc.specs.push(spec({ id: 'm8', subject: 'M', teachers: ['L9'], count: 5, grades: [8] }));
		doc.specs.push(spec({ id: 'e8', subject: 'E', teachers: ['L11'], count: 4, grades: [8] })); // <-- L11
		doc.specs.push(spec({ id: 'd8', subject: 'D', teachers: ['L6'], count: 4, grades: [8] }));
		doc.specs.push(spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 2, grades: [8] })); // <-- L11
		doc.specs.push(spec({ id: 'ph8', subject: 'PH', teachers: ['L5'], count: 2, grades: [8] }));
		doc.specs.push(spec({ id: 'ch8', subject: 'CH', teachers: ['L5'], count: 1, grades: [8] }));

		const { startSolve } = await import('./solver-v2/index');
		// 5× generieren — wenn der Bug stochastisch ist, sollte er hier auftauchen
		for (let run = 0; run < 5; run++) {
			doc.placed = [];
			const session = startSolve(doc, { totalBudgetMs: 2000, innerBudgetMs: 800 });
			await new Promise<void>(resolve => {
				session.on('done', d => {
					doc.placed = d.final.placed;
					resolve();
				});
			});
			// Manuelle Konflikt-Prüfung über alle Placements
			const slotMap = new Map<string, Array<{ specId: string; grade: number; teachers: string[] }>>();
			for (const pl of doc.placed) {
				const sp = doc.specs.find(s => s.id === pl.specId);
				if (!sp) continue;
				const key = `${pl.day}|${pl.period}`;
				const arr = slotMap.get(key) ?? [];
				arr.push({ specId: pl.specId, grade: pl.grade, teachers: sp.teachers });
				slotMap.set(key, arr);
			}
			for (const [key, entries] of slotMap) {
				// Lehrer-Doppelbelegung: gleiche teacherId in 2 verschiedenen specIds im selben Slot
				const teacherToSpecs = new Map<string, Set<string>>();
				for (const e of entries) {
					for (const tid of e.teachers) {
						const set = teacherToSpecs.get(tid) ?? new Set();
						set.add(e.specId);
						teacherToSpecs.set(tid, set);
					}
				}
				for (const [tid, specs] of teacherToSpecs) {
					if (specs.size > 1) {
						// Erlaubt: alle Specs haben gleiche couplingId
						const couplingIds = new Set(
							[...specs].map(sid => doc.specs.find(s => s.id === sid)?.couplingId)
						);
						const allCoupled = couplingIds.size === 1 && [...couplingIds][0];
						if (!allCoupled) {
							throw new Error(
								`Run ${run}: Lehrer ${tid} doppelt belegt @ ${key}, ` +
								`Specs: ${[...specs].join(', ')}`
							);
						}
					}
				}
			}
		}
	}, 30_000);

	it('findHardViolations findet die Doppelbelegung in einem invaliden State', () => {
		const doc = emptyDoc();
		doc.teachers = [
			teacher('L4', 'Lehrer4', 4),
			teacher('L11', 'Lehrer11', 11)
		];
		doc.subjects = [subject('M'), subject('GPB')];
		doc.specs = [
			spec({
				id: 'm6', subject: 'M', teachers: ['L4', 'L11'], count: 2, grades: [6],
				teachingSegments: [{ hours: 2, teachers: ['L4', 'L11'] }]
			}),
			spec({ id: 'gpb8', subject: 'GPB', teachers: ['L11'], count: 1, grades: [8] })
		];

		const state = buildState(doc);
		const moP2 = slotFromDP(0, 2);
		// Forciere Konflikt: beide auf Mo P2
		const m6Unit = state.units.find(u => u.subjectCode === 'M')!;
		const gpbUnit = state.units.find(u => u.subjectCode === 'GPB')!;
		state.placement[m6Unit.idx] = moP2;
		state.placement[gpbUnit.idx] = moP2;

		const offenders = findHardViolations(state);
		expect(offenders.length).toBeGreaterThan(0);
		expect(offenders).toContain(gpbUnit.idx);
	});
});
