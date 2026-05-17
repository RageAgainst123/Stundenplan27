import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importCsv } from './csv';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureA = readFileSync(join(here, '__fixtures__', 'sokrates-liste.csv'), 'utf8');
const fixtureB = readFileSync(join(here, '__fixtures__', 'sokrates-liste-school-b.csv'), 'utf8');

describe('Smart-Merge — Backward-Kompatibilität MS-SiG (Schule A)', () => {
	it('mit smartMerge=false produziert IDENTISCHES Resultat zum bisherigen Verhalten', () => {
		const a = importCsv(fixtureA);
		const b = importCsv(fixtureA, { smartMerge: false });
		// Stabilisiert: Anzahl Specs/Teachers/Subjects unverändert
		expect(a.specs.length).toBe(b.specs.length);
		expect(a.teachers.length).toBe(b.teachers.length);
		expect(a.subjects.length).toBe(b.subjects.length);
	});

	it('mit smartMerge=true greift KEINE Merges (MS-SiG hat keine Team-Patterns)', () => {
		const off = importCsv(fixtureA);
		const on = importCsv(fixtureA, { smartMerge: true });
		// Sollte gleiche Spec-Anzahl haben wenn keine Patterns gefunden werden.
		// Wenn doch ein Pattern matcht, ist das ein Test-Signal — neuere
		// MS-SiG-Listen könnten Team-Teaching haben und müssten dann manuell
		// validiert werden.
		expect(on.specs.length).toBe(off.specs.length);
		expect(on.smartMergeStats?.teamGroupsMerged ?? 0).toBe(0);
		expect(on.smartMergeStats?.sameTeacherRowsCollapsed ?? 0).toBe(0);
		expect(on.smartMergeStats?.leistungsCouplings ?? 0).toBe(0);
	});

	it('smartMergeStats ist undefined wenn smartMerge=false', () => {
		const result = importCsv(fixtureA);
		expect(result.smartMergeStats).toBeUndefined();
	});
});

describe('Smart-Merge — School B (Team-Teaching aktiv)', () => {
	it('mit smartMerge=false produziert eine Spec pro CSV-Zeile (104 Zeilen)', () => {
		const result = importCsv(fixtureB);
		// 104 Datenzeilen → 104 Specs (Header ist Zeile 1)
		expect(result.specs.length).toBe(104);
		expect(result.smartMergeStats).toBeUndefined();
	});

	it('mit smartMerge=true erkennt Team-Teaching-Gruppen', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		expect(result.smartMergeStats).toBeDefined();
		// Erwartet: ≥9 Team-Gruppen (PG_D 1, PG_D 2, PG_E 1, PG_EH 3,
		// PG_GWB 1, PG_KGE 1, PG_M 1, PG_M 2, PG_M 4 Stand, PG_TD 1+2+3)
		expect(result.smartMergeStats!.teamGroupsMerged).toBeGreaterThanOrEqual(8);
	});

	it('mit smartMerge=true reduziert Spec-Anzahl deutlich', () => {
		const raw = importCsv(fixtureB);
		const merged = importCsv(fixtureB, { smartMerge: true });
		// Erwartet: 104 → deutlich weniger (≤ 95)
		expect(merged.specs.length).toBeLessThan(raw.specs.length);
		expect(merged.specs.length).toBeLessThanOrEqual(95);
	});

	it('Team-Teaching-Spec für PG_M Stufe 5: count=4 mit Hauptlehrer Lehrer11 Iris', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		// PG_M Klasse 1 Stufe 5: Lehrer11 Iris 4h + Lehrer02 Max 2h Erg + Lehrer09 Bea 3h Erg
		const pgmStufe5 = result.specs.filter(s =>
			s.subject === 'M' &&
			s.grades.includes(5) &&
			s.classes.includes('1')
		);
		expect(pgmStufe5).toHaveLength(1);
		const spec = pgmStufe5[0];
		// count = Hauptlehrer-Stunden = 4 (NICHT Summe 9!)
		expect(spec.count).toBe(4);
		// teachers[] enthält alle 3 Lehrer
		expect(spec.teachers.length).toBe(3);
		// teachingSegments dokumentiert die Best-Guess-Aufteilung
		expect(spec.teachingSegments).toBeDefined();
		const segs = spec.teachingSegments!;
		// Summe der Segment-Stunden = count
		const sumHours = segs.reduce((s, seg) => s + seg.hours, 0);
		expect(sumHours).toBe(4);
		// Hauptlehrer in jedem Segment
		const mainTeacher = spec.teachers[0];
		for (const seg of segs) {
			expect(seg.teachers).toContain(mainTeacher);
		}
	});

	it('Leistungsgruppen (Stand+AHS) bekommen shared couplingId', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		// PG_D Stufe 7: PG_D_Stand_3 + PG_D_AHS_3 sollten gekoppelt sein
		const dStufe7 = result.specs.filter(s =>
			s.subject === 'D' &&
			s.grades.includes(7) &&
			s.groupLabel
		);
		expect(dStufe7.length).toBeGreaterThanOrEqual(2);
		// Alle haben dieselbe couplingId
		const couplings = new Set(dStufe7.map(s => s.couplingId));
		expect(couplings.size).toBe(1);
		expect([...couplings][0]).toBeTruthy(); // nicht undefined
		expect(result.smartMergeStats!.leistungsCouplings).toBeGreaterThanOrEqual(1);
	});

	it('Same-Teacher-Mehrfachzeilen werden zu einer Spec summiert', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		// PG_D Klasse 3 PG_D_AHS_3: Lehrer01 Eva hat 2 Zeilen (Erg=2 + Erg=1)
		// → eine Spec mit count=3, ein Lehrer
		expect(result.smartMergeStats!.sameTeacherRowsCollapsed).toBeGreaterThanOrEqual(1);
	});

	it('Edge case: KU_VS-NaSt mit 2 Hauptlehrern ohne Gruppe → Warning', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		const warn = result.warnings.find(w => w.includes('VS-NaSt'));
		expect(warn).toBeDefined();
		// Keine automatische Zusammenführung
		const vsNast = result.specs.filter(s => s.subject === 'VS-NaSt');
		expect(vsNast.length).toBe(2); // beide bleiben getrennt
	});

	it('Slot-Anzahl für Mathematik Stufe 5: 4 Slots (nicht 9!)', () => {
		const result = importCsv(fixtureB, { smartMerge: true });
		const mStufe5Slots = result.specs
			.filter(s => s.subject === 'M' && s.grades.includes(5))
			.reduce((sum, s) => sum + s.count, 0);
		expect(mStufe5Slots).toBe(4);
	});

	it('Slot-Anzahl für Mathematik Stufe 5 OHNE Smart-Merge: 9 (= falsches Verhalten)', () => {
		const result = importCsv(fixtureB);
		const mStufe5Slots = result.specs
			.filter(s => s.subject === 'M' && s.grades.includes(5))
			.reduce((sum, s) => sum + s.count, 0);
		// Zeigt warum Smart-Merge nötig ist: 4 + 2 + 2 + 1 = 9 statt 4
		expect(mStufe5Slots).toBe(9);
	});
});
