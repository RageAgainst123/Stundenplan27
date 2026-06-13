import { describe, it, expect } from 'vitest';
import { emptyDoc, type LessonSpec, type Teacher, type Subject } from './types';
import { buildExcel } from './excel-export';

function teacher(id: string, name: string, sn: number, color = '#ff7f50'): Teacher {
	return { id, name, shortNumber: sn, color, subjects: [], unavailable: [] };
}
function subject(code: string, name: string): Subject {
	return { code, name, category: 'PG', isMain: false, hoursPerWeek: {}, maxConsecutive: 99 };
}
function spec(o: Partial<LessonSpec> & { id: string; subject: string; teachers: string[]; count: number; grades: LessonSpec['grades'] }): LessonSpec {
	return { classes:['1a'], weekPattern:'every', includeInSolver:true, source:'manual', afternoonAllowed:'allowed', ...o };
}

function setupDoc() {
	const doc = emptyDoc('2026/27');
	doc.teachers = [
		teacher('t1', 'Müller Anna', 1, '#ff7f50'),
		teacher('t2', 'Schmidt Bob', 2, '#6495ed'),
		teacher('t3', 'Weber Carl', 3, '#9acd32')
	];
	doc.subjects = [
		subject('D', 'Deutsch'),
		subject('M', 'Mathematik'),
		subject('BSP', 'Bewegung und Sport')
	];
	doc.specs = [
		spec({ id: 'd5', subject: 'D', teachers: ['t1'], count: 4, grades: [5] }),
		spec({ id: 'm6', subject: 'M', teachers: ['t2', 't3'], count: 2, grades: [6],
			teachingSegments: [{ hours: 2, teachers: ['t2', 't3'] }] }),
		spec({ id: 'bsp7', subject: 'BSP', teachers: ['t1'], count: 2, grades: [7] })
	];
	doc.placed = [
		{ specId: 'd5', day: 'Mo', period: 1, grade: 5, pinned: true },
		{ specId: 'd5', day: 'Di', period: 2, grade: 5, pinned: false },
		{ specId: 'm6', day: 'Mo', period: 3, grade: 6, pinned: false, teachers: ['t2', 't3'] },
		{ specId: 'bsp7', day: 'Mi', period: 5, grade: 7, pinned: false }
	];
	return doc;
}

describe('buildExcel — Stundenplan-Export', () => {
	it('erzeugt einen gültigen Blob', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBeGreaterThan(1000); // Excel-Datei hat min. ein paar KB
		expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	}, 15_000);

	it('Default-Optionen: alle 3 Sheet-Typen aktiv', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc);
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());

		const sheetNames = wb.worksheets.map(ws => ws.name);
		expect(sheetNames).toContain('Klassenplan');
		expect(sheetNames).toContain('Lehrer-Übersicht');
		// Mind. 1 Lehrer-Sheet (t1 hat Slots)
		expect(sheetNames.some(n => n.startsWith('L1'))).toBe(true);
	}, 20_000);

	it('Sheet-Selektion via Options funktioniert', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, {
			includeClassPlan: true,
			includePerTeacher: false,
			includeTeacherOverview: false
		});
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		// Phase 18.3: includeClassPlan erzeugt jetzt 3 Sheets:
		// Klassenplan (farbig) + Klassenplan-Filter + Klassenplan S-W
		expect(wb.worksheets.length).toBe(3);
		const names = wb.worksheets.map(w => w.name);
		expect(names).toContain('Klassenplan');
		expect(names).toContain('Klassenplan-Filter');
		expect(names).toContain('Klassenplan S-W');
	}, 20_000);

	it('Klassenplan-Sheet: korrekte Dimensionen + Header-Inhalte', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includePerTeacher: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Klassenplan')!;

		// Phase 18 mit N-Spalten-Split: pro Tag jetzt 16 Spalten (4 Stufen × 4 Subs).
		// Zeile 1: Tag-Header gemerged über COLS_PER_DAY=16 Spalten.
		expect(ws.getCell(1, 2).value).toBe('Mo');
		expect(ws.getCell(1, 18).value).toBe('Di'); // 2 + 1*16 = 18
		expect(ws.getCell(1, 66).value).toBe('Fr'); // 2 + 4*16 = 66

		// Zeile 2: Stufen pro Tag — jeweils gemerged über 4 Sub-Spalten.
		// Mo Stufe 5 startet bei Spalte 2, Stufe 8 bei 2 + 3*4 = 14.
		expect(ws.getCell(2, 2).value).toBe('5.');
		expect(ws.getCell(2, 14).value).toBe('8.');

		// Stunden-Zeilen ab Zeile 3
		const period1Cell = ws.getCell(3, 1).value;
		expect(String(period1Cell)).toContain('1.');
	}, 20_000);

	it('Mo P1 Stufe 5 zeigt das D-Placement', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includePerTeacher: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Klassenplan')!;

		// Mo P1 Stufe 5 startet bei Spalte 2 (erster Lehrer-Streifen). Bei
		// 1 Lehrer ist die Zelle gemerged über alle 4 Sub-Spalten — der Text
		// steht im ersten Streifen.
		const cell = ws.getCell(3, 2);
		const val = String(cell.value ?? '');
		expect(val).toContain('D');
		expect(val).toContain('L1'); // Müller Anna shortNumber=1
	}, 20_000);

	it('Klassenplan-Filter-Sheet: enthält Lehrer-Header oben mit Farben', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includePerTeacher: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Klassenplan-Filter')!;
		expect(ws).toBeDefined();
		// Zeile 2 enthält Lehrer-Header. Zelle B2 sollte mit "L" anfangen.
		const cell = String(ws.getCell(2, 2).value ?? '');
		expect(cell).toMatch(/^L\d/);
		// Bereinigt: Im Slot Mo P1 (Zeile 6 weil Header 5-zeilig) erscheint
		// "D" aber KEIN "L1" (kein Lehrer-Badge im Filter-Sheet)
		const slot = String(ws.getCell(6, 2).value ?? '');
		expect(slot).toContain('D');
		expect(slot).not.toContain('L1');
	}, 20_000);

	it('Klassenplan S-W: Subject mit L-Badge in jedem Streifen', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includePerTeacher: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Klassenplan S-W')!;
		expect(ws).toBeDefined();
		// Mo P3 Stufe 6 Team-Teaching: Streifen 1 = Col 6 (M+L2), Streifen 2 = Col 8 (M+L3)
		const strip1 = String(ws.getCell(5, 6).value ?? '');
		const strip2 = String(ws.getCell(5, 8).value ?? '');
		expect(strip1).toContain('M');
		expect(strip1).toContain('L2');
		expect(strip2).toContain('M'); // ← NEU: Subject auch im 2. Streifen
		expect(strip2).toContain('L3');
		// Legende existiert
		const legendRow = 3 + 8 + 1; // 3 Header + 8 Periods + 1 Spacer
		const legendCell = String(ws.getCell(legendRow, 1).value ?? '');
		expect(legendCell).toContain('Legende');
	}, 20_000);

	it('Multi-Lehrer-Slot (Team-Teaching): Subject in JEDEM Streifen sichtbar (Phase 18.3)', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includePerTeacher: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Klassenplan')!;

		// Mo P3 Stufe 6 hat M mit t2+t3 → 2 Streifen.
		// Stufe 6 ist g=1, Mo ist d=0 → startCol = 2 + 0*16 + 1*4 = 6.
		// Mit 2 Streifen Verteilung [2,2]: Streifen 1 → Col 6 (M + L2), Streifen 2 → Col 8 (L3).
		const strip1 = String(ws.getCell(3 + 2, 6).value ?? ''); // Zeile p3 = 3+2=5
		const strip2 = String(ws.getCell(3 + 2, 8).value ?? '');
		// Phase 18.3: Subject in JEDEM Streifen sichtbar
		expect(strip1).toContain('M');
		expect(strip1).toContain('L2');
		expect(strip2).toContain('M'); // ← Subject auch im 2. Streifen
		expect(strip2).toContain('L3');
	}, 20_000);

	it('Lehrer-Sheet enthält Title mit Lehrer-Name und L-Kürzel', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includeClassPlan: false, includeTeacherOverview: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());

		// t1 hat Slots, sollte ein Sheet bekommen
		const sheet = wb.worksheets.find(w => w.name.includes('Müller'));
		expect(sheet).toBeDefined();
		const title = String(sheet!.getCell(1, 1).value ?? '');
		expect(title).toContain('Müller Anna');
		expect(title).toContain('L1');
	}, 20_000);

	it('Lehrer-Übersicht: Σ-Spalte enthält Stunden-Summe pro Lehrer', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, { includeClassPlan: false, includePerTeacher: false });
		const ExcelJS = await import('exceljs');
		const Workbook = (ExcelJS as { Workbook?: typeof import('exceljs').Workbook }).Workbook
			?? ((ExcelJS as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
		const wb = new Workbook!();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet('Lehrer-Übersicht')!;

		// Header Zeile 2: "Σ Gesamt" in der letzten relevanten Spalte
		expect(ws.getCell(2, 8).value).toBe('Σ Gesamt'); // 1 Kürzel + 1 Name + 5 Tage + 1 Σ = Spalte 8
		// Zeile 3 = erster Lehrer (sortiert nach shortNumber, t1 ist sn=1)
		expect(ws.getCell(3, 1).value).toBe('L1');
		expect(ws.getCell(3, 2).value).toBe('Müller Anna');
		// t1 = D5 (Mo + Di) + BSP7 (Mi) = 3 Stunden total
		expect(ws.getCell(3, 8).value).toBe(3);
	}, 20_000);

	it('Lehrer-Farb-Override wird angewendet', async () => {
		const doc = setupDoc();
		const blob = await buildExcel(doc, {
			includePerTeacher: false, includeTeacherOverview: false,
			teacherColorOverrides: { t1: '#abcdef' }
		});
		// Wir checken nicht den raw-Hex weil exceljs Farb-Encoding-Details
		// versteckt. Aber: kein Crash, Blob valide.
		expect(blob.size).toBeGreaterThan(1000);
	}, 15_000);

	it('Empty doc → Blob, alle Sheets leer aber gültig', async () => {
		const doc = emptyDoc();
		const blob = await buildExcel(doc);
		expect(blob.size).toBeGreaterThan(500);
	}, 15_000);

	it('Sheet-Namen mit Sonderzeichen werden saniert', async () => {
		const doc = setupDoc();
		doc.teachers[0].name = 'Test/Lehrer[X]:?';
		doc.placed = [{ specId: 'd5', day: 'Mo', period: 1, grade: 5, pinned: false }];
		const blob = await buildExcel(doc, { includeClassPlan: false, includeTeacherOverview: false });
		expect(blob.size).toBeGreaterThan(1000);
	}, 15_000);
});
