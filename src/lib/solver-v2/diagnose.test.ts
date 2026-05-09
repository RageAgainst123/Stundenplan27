import { describe, it, expect } from 'vitest';
import { diagnose, bestHint } from './diagnose';
import { emptyDoc, type LessonSpec, type Subject, type Teacher } from '../types';

function teacher(id: string, name: string, unavailable: { day: 'Mo'|'Di'|'Mi'|'Do'|'Fr'; period: 1|2|3|4|5|6|7|8 }[] = []): Teacher {
	return { id, name, shortNumber: 1, color: '#000', subjects: [], unavailable };
}

function subject(code: string, isMain = false): Subject {
	return { code, name: code, category: 'PG', isMain, hoursPerWeek: {}, maxConsecutive: 99 };
}

function spec(id: string, sub: string, t: string, grades: number[], count: number, opts: Partial<LessonSpec> = {}): LessonSpec {
	return {
		id, subject: sub, teachers: [t], classes: ['1a'], grades: grades as any,
		weekPattern: 'every', count,
		blocks: 'blocks' in opts ? opts.blocks : Array(count).fill(1),
		includeInSolver: opts.includeInSolver ?? true,
		groupLabel: opts.groupLabel,
		couplingId: opts.couplingId,
		source: 'manual'
	};
}

describe('diagnose: teacher overload', () => {
	it('reports error when teacher has more hours than available slots', () => {
		const doc = emptyDoc();
		// Teacher with all weekdays (Mo,Di,Mi,Do) blocked → only Fr (8 slots)
		doc.teachers.push(teacher('t1', 'Overloaded', [
			...['Mo','Di','Mi','Do'].flatMap(d =>
				[1,2,3,4,5,6,7,8].map(p => ({ day: d as any, period: p as any }))
			)
		]));
		doc.subjects.push(subject('M'));
		// 12 hours assigned but only 8 available
		doc.specs.push(spec('s1', 'M', 't1', [5], 12));
		const hints = diagnose(doc);
		const error = hints.find(h => h.severity === 'error');
		expect(error).toBeTruthy();
		expect(error!.message).toContain('Overloaded');
		expect(error!.message).toMatch(/12.*Wochenstunden.*8.*Slots/);
	});

	it('reports error when teacher has zero available slots but specs assigned', () => {
		const doc = emptyDoc();
		const allSlots = ['Mo','Di','Mi','Do','Fr'].flatMap(d =>
			[1,2,3,4,5,6,7,8].map(p => ({ day: d as any, period: p as any }))
		);
		doc.teachers.push(teacher('t1', 'Blocked', allSlots));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1));
		const hints = diagnose(doc);
		expect(hints.some(h => h.severity === 'error' && h.message.includes('keine verfügbaren Slots'))).toBe(true);
	});
});

describe('diagnose: pin conflicts', () => {
	it('reports error when teacher pinned twice in same slot without group', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.subjects.push(subject('M'), subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1));
		doc.specs.push(spec('s2', 'D', 't1', [5], 1));
		doc.placed.push({ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: true });
		doc.placed.push({ specId: 's2', day: 'Mo', period: 1, grade: 5, pinned: true });
		const hints = diagnose(doc);
		const conflict = hints.find(h => h.severity === 'error' && h.message.includes('mehrfach gepinnt'));
		expect(conflict).toBeTruthy();
	});

	it('does NOT report conflict when both pinned specs share the same couplingId', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.subjects.push(subject('M'), subject('D'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1, { couplingId: 'G' }));
		doc.specs.push(spec('s2', 'D', 't1', [5], 1, { couplingId: 'G' }));
		doc.placed.push({ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: true });
		doc.placed.push({ specId: 's2', day: 'Mo', period: 1, grade: 5, pinned: true });
		const hints = diagnose(doc);
		expect(hints.find(h => h.message.includes('mehrfach gepinnt'))).toBeUndefined();
	});

	it('reports error when pinned slot conflicts with teacher availability', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1', [{ day: 'Mo', period: 1 }]));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 't1', [5], 1));
		doc.placed.push({ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: true });
		const hints = diagnose(doc);
		const block = hints.find(h => h.severity === 'error' && h.message.includes('unverfügbar'));
		expect(block).toBeTruthy();
	});
});

describe('diagnose: spec validation', () => {
	it('warns when spec has empty grades', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 't1', [], 1));
		const hints = diagnose(doc);
		expect(hints.find(h => h.message.includes('keine Schulstufen'))).toBeTruthy();
	});

	it('errors when spec references non-existent teacher', () => {
		const doc = emptyDoc();
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s1', 'M', 'tNONE', [5], 1));
		const hints = diagnose(doc);
		expect(hints.find(h => h.severity === 'error' && h.message.includes('nicht existierenden Lehrer'))).toBeTruthy();
	});
});

describe('diagnose: bestHint', () => {
	it('returns null for no hints', () => {
		expect(bestHint([])).toBeNull();
	});

	it('prefers errors over warnings', () => {
		const hints = [
			{ severity: 'warn' as const, message: 'just a warning' },
			{ severity: 'error' as const, message: 'real problem' }
		];
		expect(bestHint(hints)?.severity).toBe('error');
	});
});

describe('diagnose: coupling — Stunden pro Coupling-Gruppe nur einmal', () => {
	it('zählt zwei gekoppelte Specs (BSP K/M) nicht doppelt für die Stufen-Auslastung', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('tNagl', 'Nagl'));
		doc.teachers.push(teacher('tSchlegel', 'Schlegel'));
		doc.subjects.push(subject('BSP'));
		// Knaben + Mädchen 7+8, beide 3h, gekoppelt → zählen zusammen als 3h
		doc.specs.push(spec('bspK', 'BSP', 'tNagl', [7, 8], 3, { couplingId: 'bsp78' }));
		doc.specs.push(spec('bspM', 'BSP', 'tSchlegel', [7, 8], 3, { couplingId: 'bsp78' }));
		// Setze min_daily so, dass die Stunden-Soll-Aggregation aktiv wird
		doc.constraints.minDailySlotsPerGrade = 4;
		const hints = diagnose(doc);
		// Wenn die alte Logik doppelt zählt, sieht es so aus als hätten Stufe 7
		// und 8 je 6h Sport. Wir prüfen indirekt: bei nur 6h Total dürfte die
		// Tagespensum-Warnung NICHT auftauchen, wenn doppelt gezählt würde.
		// Mit korrekter Single-Counting: 3h < 20h Soll → Warnung erscheint.
		const stufe7Warn = hints.find(
			h => h.severity === 'warn' && h.message.includes('Schulstufe 7') && h.message.includes('mindestens')
		);
		expect(stufe7Warn).toBeTruthy();
		expect(stufe7Warn!.message).toContain('3 Wochenstunden');
	});

	it('ungekoppelte Specs zählen weiterhin separat', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t1', 'L1'));
		doc.teachers.push(teacher('t2', 'L2'));
		doc.subjects.push(subject('M'));
		doc.subjects.push(subject('D'));
		// Zwei separate Specs ohne Coupling → 4 + 3 = 7 Stunden für Stufe 5
		doc.specs.push(spec('m', 'M', 't1', [5], 4));
		doc.specs.push(spec('d', 'D', 't2', [5], 3));
		doc.constraints.minDailySlotsPerGrade = 4;
		const hints = diagnose(doc);
		const stufe5Warn = hints.find(
			h => h.severity === 'warn' && h.message.includes('Schulstufe 5') && h.message.includes('mindestens')
		);
		expect(stufe5Warn).toBeTruthy();
		expect(stufe5Warn!.message).toContain('7 Wochenstunden');
	});
});

describe('diagnose: Phase 9 — Mindest-Tagespensum + Singles-Pattern', () => {
	it('warnt wenn Stufe weniger als D × min_daily Wochenstunden hat', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// Stufe 5 hat nur 18 Stunden, min_daily=4 → braucht 20.
		doc.specs.push(spec('s', 'M', 't', [5], 18));
		doc.constraints.minDailySlotsPerGrade = 4;
		const hints = diagnose(doc);
		const warn = hints.find(h => h.severity === 'warn' && h.message.includes('mindestens'));
		expect(warn).toBeTruthy();
		expect(warn!.message).toContain('Schulstufe 5');
	});

	it('warnt nicht wenn Stufe genug Stunden hat', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		doc.specs.push(spec('s', 'M', 't', [5], 25));
		doc.constraints.minDailySlotsPerGrade = 4;
		const hints = diagnose(doc);
		const tagespensumWarn = hints.find(h => h.message.includes('Stunden pro Tag'));
		expect(tagespensumWarn).toBeUndefined();
	});

	it('warnt bei strikt-Singles count > 5 Wochentage', () => {
		const doc = emptyDoc();
		doc.teachers.push(teacher('t', 'L'));
		doc.subjects.push(subject('M'));
		// 6 Singles, 5 Wochentage → mit Constraint 11 unmöglich
		doc.specs.push(spec('s', 'M', 't', [5], 6, { blocks: [1, 1, 1, 1, 1, 1] }));
		const hints = diagnose(doc);
		const warn = hints.find(h => h.severity === 'warn' && h.message.includes('Einzelstunden'));
		expect(warn).toBeTruthy();
	});
});

describe('diagnose: User-Phase-7A scenario', () => {
	it('REL multi-grade pinned + Mittwochs-Lehrer should NOT trigger fatal hints', () => {
		const doc = emptyDoc();
		// Simon Maximilian, only Wednesday available (block all other days)
		const blocked = ['Mo', 'Di', 'Do', 'Fr'].flatMap(d =>
			[1, 2, 3, 4, 5, 6, 7, 8].map(p => ({ day: d as any, period: p as any }))
		);
		doc.teachers.push(teacher('tREL', 'Simon Maximilian', blocked as any));
		doc.subjects.push(subject('REL'));
		// REL für 6+7 und REL für 7+8, je 2 Stunden
		doc.specs.push(spec('s67', 'REL', 'tREL', [6, 7], 2));
		doc.specs.push(spec('s78', 'REL', 'tREL', [7, 8], 2));
		// Pin them on Wednesday (4 hours total, teacher has 8 slots Mi → fits)
		// Phase 8 v2: pin both grade columns of each multi-grade spec.
		doc.placed.push({ specId: 's67', day: 'Mi', period: 1, grade: 6, pinned: true });
		doc.placed.push({ specId: 's67', day: 'Mi', period: 1, grade: 7, pinned: true });
		doc.placed.push({ specId: 's67', day: 'Mi', period: 2, grade: 6, pinned: true });
		doc.placed.push({ specId: 's67', day: 'Mi', period: 2, grade: 7, pinned: true });
		doc.placed.push({ specId: 's78', day: 'Mi', period: 3, grade: 7, pinned: true });
		doc.placed.push({ specId: 's78', day: 'Mi', period: 3, grade: 8, pinned: true });
		doc.placed.push({ specId: 's78', day: 'Mi', period: 4, grade: 7, pinned: true });
		doc.placed.push({ specId: 's78', day: 'Mi', period: 4, grade: 8, pinned: true });
		const hints = diagnose(doc);
		// Should not fail pre-flight: 4 hours assigned, 8 available on Mi
		const errors = hints.filter(h => h.severity === 'error');
		expect(errors).toHaveLength(0);
	});
});
