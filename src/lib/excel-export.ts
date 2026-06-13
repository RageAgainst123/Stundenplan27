// Phase 18: Excel-Export des Stundenplans.
//
// Drei Sheet-Typen:
//   1. "Klassenplan" — Tag/Stufe/Stunde Grid wie das ScheduleGrid, FARBIG.
//   2. Pro Lehrer — sein persönlicher Wochenplan, SCHWARZ/WEISS.
//   3. "Lehrer-Übersicht" — Last-Verteilung pro Lehrer × Tag, mit Σ.
//
// Print-Setup:
//   - Klassenplan + Übersicht: A3 quer (paperSize 8), 1 Seite breit
//   - Lehrer-Pläne: A4 quer (paperSize 9), Header-Zeilen wiederholt
//
// Build-Strategie: pure Funktion, exceljs lazy-imported damit der Stamm-Bundle
// nicht 150 KB schwerer wird. Caller in der UI macht `await import('./excel-export')`.

import type { ScheduleDoc, Day, GradeLevel, Period, Teacher } from './types';
import { DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES } from './types';
import { buildScheduleExport } from './schedule-export';

export interface ExcelExportOptions {
	includeClassPlan?: boolean;
	includePerTeacher?: boolean;
	includeTeacherOverview?: boolean;
	/**
	 * Optionale Farb-Overrides pro Teacher-ID. Falls gesetzt überschreibt
	 * der Wert die `teacher.color` für DIESEN Export. So kann der User
	 * im Export-Panel die Farben anpassen ohne die Stammdaten zu ändern.
	 */
	teacherColorOverrides?: Record<string, string>;
}

const DEFAULT_OPTS: Required<Omit<ExcelExportOptions, 'teacherColorOverrides'>> & { teacherColorOverrides: Record<string, string> } = {
	includeClassPlan: true,
	includePerTeacher: true,
	includeTeacherOverview: true,
	teacherColorOverrides: {},
};

interface SlotEntry {
	subject: string;
	teachers: Teacher[];
	grades: GradeLevel[];
	weekPattern: 'every' | 'even' | 'odd';
	pinned: boolean;
	isTeamTeaching: boolean;
}

/**
 * Map (day, period, grade) → SlotEntry[].
 * Mehrere Einträge pro Slot wenn Coupling/Multi-Grade.
 */
function buildSlotMap(doc: ScheduleDoc): Map<string, SlotEntry[]> {
	const teacherById = new Map(doc.teachers.map(t => [t.id, t]));
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const map = new Map<string, SlotEntry[]>();
	for (const pl of doc.placed) {
		const spec = specById.get(pl.specId);
		if (!spec) continue;
		const teacherIds = pl.teachers ?? spec.teachers;
		const teachers = teacherIds.map(tid => teacherById.get(tid)).filter((t): t is Teacher => !!t);
		const key = `${pl.day}|${pl.period}|${pl.grade}`;
		const entry: SlotEntry = {
			subject: spec.subject,
			teachers,
			grades: [...spec.grades],
			weekPattern: spec.weekPattern,
			pinned: pl.pinned,
			isTeamTeaching: !!(spec.teachingSegments && spec.teachingSegments.length > 0),
		};
		const arr = map.get(key) ?? [];
		arr.push(entry);
		map.set(key, arr);
	}
	return map;
}

/** Hex `#abcdef` → ARGB `FFABCDEF` für exceljs. */
function hexToArgb(hex: string): string {
	const clean = hex.replace('#', '').toUpperCase();
	if (clean.length === 3) {
		return 'FF' + clean.split('').map(c => c + c).join('');
	}
	return 'FF' + clean.padEnd(6, '0').slice(0, 6);
}

/** Hex → grobes „dunkles?" Heuristic für Textfarbe (schwarz vs weiß). */
function isDarkColor(hex: string): boolean {
	const clean = hex.replace('#', '');
	const r = parseInt(clean.slice(0, 2), 16);
	const g = parseInt(clean.slice(2, 4), 16);
	const b = parseInt(clean.slice(4, 6), 16);
	// Y' luma — schwellwert bei ~140 von 255
	const luma = 0.299 * r + 0.587 * g + 0.114 * b;
	return luma < 140;
}

function colorOf(teacher: Teacher, overrides: Record<string, string>): string {
	return overrides[teacher.id] ?? teacher.color;
}

/**
 * Cell-Inhalt-Helper: subject + L-Badges + Stufe + G/U
 * Wird als Multi-Line Plain-Text gebaut (xlsx Cell-Rich-Text wäre overkill).
 */
function formatCellText(entry: SlotEntry): string {
	const teacherBadges = entry.teachers.length <= 3
		? entry.teachers.map(t => `L${t.shortNumber}`).join(' ')
		: entry.teachers.slice(0, 2).map(t => `L${t.shortNumber}`).join(' ') + ` +${entry.teachers.length - 2}`;
	const gradesStr = entry.grades.length > 1 ? entry.grades.join('+') : entry.grades[0]?.toString() ?? '';
	const weekBadge = entry.weekPattern === 'every' ? '' : (entry.weekPattern === 'even' ? ' [G]' : ' [U]');
	return `${entry.subject}  ${teacherBadges}\n${gradesStr}${weekBadge}`;
}

/**
 * Hauptbau-Funktion. Lazy-importiert exceljs.
 */
export async function buildExcel(doc: ScheduleDoc, options: ExcelExportOptions = {}): Promise<Blob> {
	const opts = { ...DEFAULT_OPTS, ...options };
	const overrides = opts.teacherColorOverrides;

	// Lazy-import damit exceljs nicht im Main-Bundle landet.
	const ExcelJSMod = await import('exceljs');
	// exceljs ist sowohl CJS als auch ESM — Workbook ist auf der default-Export
	// ODER direkt am Modul, je nach Bundler. Defensive Lookup.
	const Workbook = (ExcelJSMod as { Workbook?: typeof import('exceljs').Workbook }).Workbook
		?? ((ExcelJSMod as { default?: { Workbook: typeof import('exceljs').Workbook } }).default?.Workbook);
	if (!Workbook) throw new Error('exceljs Workbook konstructor not found');

	const wb = new Workbook();
	wb.creator = 'Stundenplancalc';
	wb.created = new Date();

	const slotMap = buildSlotMap(doc);
	const summary = buildScheduleExport(doc);
	void summary; // for future use (counts etc.)

	if (opts.includeClassPlan) {
		addClassPlanSheet(wb, doc, slotMap, overrides);
	}
	if (opts.includePerTeacher) {
		for (const teacher of doc.teachers) {
			// Nur Lehrer mit mindestens 1 Slot exportieren
			const hasSlot = doc.placed.some(p => {
				const spec = doc.specs.find(s => s.id === p.specId);
				if (!spec) return false;
				const tids = p.teachers ?? spec.teachers;
				return tids.includes(teacher.id);
			});
			if (!hasSlot) continue;
			addTeacherSheet(wb, doc, teacher, slotMap, overrides);
		}
	}
	if (opts.includeTeacherOverview) {
		addTeacherOverviewSheet(wb, doc, overrides);
	}

	const buf = await wb.xlsx.writeBuffer();
	return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ============================================================================
// Sheet 1: Klassenplan
// ============================================================================

function addClassPlanSheet(
	wb: import('exceljs').Workbook,
	doc: ScheduleDoc,
	slotMap: Map<string, SlotEntry[]>,
	overrides: Record<string, string>
): void {
	const ws = wb.addWorksheet('Klassenplan', {
		pageSetup: {
			paperSize: 8 as unknown as import('exceljs').PaperSize, // A3
			orientation: 'landscape',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 1,
			printTitlesRow: '1:3',
			margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	// Spalten-Layout:
	//   Col A: Stunden-Info (Nr + Uhrzeit), Breite 12
	//   Pro Tag: 4 Spalten (Stufen 5/6/7/8), je 9 breit
	//   Total: 1 + 5×4 = 21 Spalten
	ws.getColumn(1).width = 13;
	for (let i = 2; i <= 21; i++) ws.getColumn(i).width = 11;

	// === Header Zeile 1: Tag-Namen, gemerged über 4 Spalten ===
	ws.getCell(1, 1).value = '';
	for (let d = 0; d < DAYS.length; d++) {
		const startCol = 2 + d * 4;
		const endCol = startCol + 3;
		ws.mergeCells(1, startCol, 1, endCol);
		const cell = ws.getCell(1, startCol);
		cell.value = DAYS[d];
		cell.style = {
			font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } },
			border: thinBorder('FF1F2937'),
		};
	}
	ws.getRow(1).height = 24;

	// === Header Zeile 2: Stufen pro Tag ===
	ws.getCell(2, 1).value = '';
	for (let d = 0; d < DAYS.length; d++) {
		for (let g = 0; g < GRADES.length; g++) {
			const col = 2 + d * 4 + g;
			const cell = ws.getCell(2, col);
			cell.value = `${GRADES[g]}.`;
			cell.style = {
				font: { bold: true, size: 11, color: { argb: 'FF374151' } },
				alignment: { horizontal: 'center', vertical: 'middle' },
				fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
				border: thinBorder('FF9CA3AF'),
			};
		}
	}
	ws.getRow(2).height = 18;

	// === Header Zeile 3: Stunden-Header-Zeile (leer/reserved für Title-Repeat) ===
	// Wir machen Zeile 3 als Header-Hilfszeile NICHT — die Stunden starten direkt in Zeile 3
	// printTitlesRow '1:3' wiederholt Zeile 1-3. Wir machen Zeile 3 als Stunden-Trenn-Zeile leer.
	// Stattdessen: nur 2 Header-Zeilen, printTitlesRow auf '1:2' setzen. Anpassen:
	ws.pageSetup.printTitlesRow = '1:2';

	// === Stunden-Zeilen ===
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 3 + p;
		const period = PERIODS[p];
		// Linke Spalte: Stunden-Nr + Uhrzeit
		const periodCell = ws.getCell(rowIdx, 1);
		periodCell.value = `${period}.\n${DEFAULT_PERIOD_TIMES[p]}`;
		periodCell.style = {
			font: { bold: true, size: 10 },
			alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
			border: thinBorder('FF9CA3AF'),
		};

		for (let d = 0; d < DAYS.length; d++) {
			for (let g = 0; g < GRADES.length; g++) {
				const col = 2 + d * 4 + g;
				const cell = ws.getCell(rowIdx, col);
				const entries = slotMap.get(`${DAYS[d]}|${period}|${GRADES[g]}`) ?? [];
				if (entries.length === 0) {
					// Leerer Slot
					cell.style = {
						border: thinBorder('FFD1D5DB'),
						fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
					};
					continue;
				}
				// Bei mehreren Entries (z.B. Coupling) den ersten dominant nehmen,
				// weitere als Text dazu hängen
				const primary = entries[0];
				const lehrer = primary.teachers[0];
				const lehrerColor = lehrer ? colorOf(lehrer, overrides) : '#9CA3AF';
				const argbFill = hexToArgb(lehrerColor);
				// Helle Tönung: nur halbe Sättigung für Background
				const lightFill = blendWithWhite(lehrerColor, 0.65);
				const argbLight = hexToArgb(lightFill);
				const textArgb = isDarkColor(lightFill) ? 'FFFFFFFF' : 'FF111827';

				let text = formatCellText(primary);
				if (entries.length > 1) {
					for (let e = 1; e < entries.length; e++) {
						text += `\n${formatCellText(entries[e])}`;
					}
				}
				cell.value = text;
				cell.style = {
					font: { size: 9, bold: true, color: { argb: textArgb } },
					alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
					fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbLight } },
					border: {
						top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
						right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
						bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
						left: { style: 'medium', color: { argb: argbFill } },
					},
				};
			}
		}
		ws.getRow(rowIdx).height = 42;
	}

	// Tagestrenner sichtbar — letzten Stunden-Spalte pro Tag bekommen rechte Mittel-Border
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 3 + p;
		for (let d = 0; d < DAYS.length - 1; d++) {
			const col = 2 + d * 4 + 3; // letzte Spalte des Tags
			const cell = ws.getCell(rowIdx, col);
			cell.border = {
				...cell.border,
				right: { style: 'medium', color: { argb: 'FF374151' } },
			};
		}
	}
}

// ============================================================================
// Sheet pro Lehrer (schwarz/weiß)
// ============================================================================

function addTeacherSheet(
	wb: import('exceljs').Workbook,
	doc: ScheduleDoc,
	teacher: Teacher,
	slotMap: Map<string, SlotEntry[]>,
	overrides: Record<string, string>
): void {
	// Sheet-Namen dürfen keine Sonderzeichen enthalten, max 31 Zeichen
	const sheetName = sanitizeSheetName(`L${teacher.shortNumber} ${teacher.name}`);
	const ws = wb.addWorksheet(sheetName, {
		pageSetup: {
			paperSize: 9, // A4
			orientation: 'landscape',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 1,
			printTitlesRow: '1:3',
			blackAndWhite: true,
			margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	// Title-Zeile
	ws.getCell(1, 1).value = `Wochenplan: ${teacher.name} (L${teacher.shortNumber})`;
	ws.mergeCells(1, 1, 1, 1 + DAYS.length);
	ws.getCell(1, 1).style = {
		font: { bold: true, size: 14 },
		alignment: { horizontal: 'center', vertical: 'middle' },
		border: thinBorder('FF000000'),
	};
	ws.getRow(1).height = 22;

	// Header: leere Ecke + Tag-Spalten
	ws.getCell(2, 1).value = 'Stunde';
	ws.getCell(2, 1).style = {
		font: { bold: true, size: 11 },
		alignment: { horizontal: 'center', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
		border: thinBorder('FF000000'),
	};
	for (let d = 0; d < DAYS.length; d++) {
		const cell = ws.getCell(2, 2 + d);
		cell.value = DAYS[d];
		cell.style = {
			font: { bold: true, size: 12 },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
			border: thinBorder('FF000000'),
		};
	}
	ws.getRow(2).height = 20;

	// "Zeit"-Zeile als 3. Header-Zeile (für printTitlesRow)
	ws.getCell(3, 1).value = 'Uhrzeit';
	ws.getCell(3, 1).style = {
		font: { italic: true, size: 9 },
		alignment: { horizontal: 'center', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
		border: thinBorder('FF6B7280'),
	};
	for (let d = 0; d < DAYS.length; d++) {
		const cell = ws.getCell(3, 2 + d);
		cell.value = '';
		cell.style = {
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
			border: thinBorder('FF6B7280'),
		};
	}
	ws.getRow(3).height = 6;

	ws.getColumn(1).width = 14;
	for (let d = 0; d < DAYS.length; d++) ws.getColumn(2 + d).width = 24;

	// Wir sammeln pro Slot die Stunden des Lehrers — Lehrer kann in mehreren Stufen
	// (Multi-Grade) drin sein; wir mergen Subject+Grades dazu.
	const usedCoTeachers = new Set<Teacher>();

	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 4 + p;
		const period = PERIODS[p];
		const cell = ws.getCell(rowIdx, 1);
		cell.value = `${period}.\n${DEFAULT_PERIOD_TIMES[p]}`;
		cell.style = {
			font: { bold: true, size: 10 },
			alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
			border: thinBorder('FF000000'),
		};

		for (let d = 0; d < DAYS.length; d++) {
			const slotCell = ws.getCell(rowIdx, 2 + d);
			// Alle Slots dieses Lehrers an (day, period) sammeln über alle Stufen
			const entries: { entry: SlotEntry; grade: GradeLevel }[] = [];
			for (const grade of GRADES) {
				const arr = slotMap.get(`${DAYS[d]}|${period}|${grade}`) ?? [];
				for (const e of arr) {
					if (e.teachers.some(t => t.id === teacher.id)) {
						entries.push({ entry: e, grade });
					}
				}
			}
			if (entries.length === 0) {
				slotCell.style = {
					border: thinBorder('FF9CA3AF'),
				};
				continue;
			}
			// Subject + alle vorkommenden Stufen + Co-Lehrer
			const subjects = [...new Set(entries.map(e => e.entry.subject))];
			const grades = [...new Set(entries.flatMap(e => e.entry.grades))].sort();
			const coTeachers = new Set<Teacher>();
			for (const { entry } of entries) {
				for (const t of entry.teachers) if (t.id !== teacher.id) coTeachers.add(t);
			}
			for (const t of coTeachers) usedCoTeachers.add(t);

			const subjectsStr = subjects.join(' / ');
			const gradesStr = grades.length === 1 ? `Stufe ${grades[0]}` : `Stufen ${grades.join('+')}`;
			const coStr = coTeachers.size > 0
				? `\nmit ${[...coTeachers].map(t => `L${t.shortNumber}`).join(', ')}`
				: '';
			const weekStr = entries.some(e => e.entry.weekPattern !== 'every')
				? `\n[${entries[0].entry.weekPattern === 'even' ? 'G' : 'U'}-Woche]`
				: '';

			slotCell.value = `${subjectsStr}\n${gradesStr}${coStr}${weekStr}`;
			slotCell.style = {
				font: { size: 10, bold: true },
				alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
				border: {
					top: { style: 'medium', color: { argb: 'FF000000' } },
					right: { style: 'medium', color: { argb: 'FF000000' } },
					bottom: { style: 'medium', color: { argb: 'FF000000' } },
					left: { style: 'medium', color: { argb: 'FF000000' } },
				},
			};
		}
		ws.getRow(rowIdx).height = 50;
	}

	// Legende unter dem Plan
	const legendStartRow = 4 + PERIODS.length + 1;
	ws.getCell(legendStartRow, 1).value = 'Legende — Co-Lehrer und Eigene Kürzel:';
	ws.mergeCells(legendStartRow, 1, legendStartRow, 1 + DAYS.length);
	ws.getCell(legendStartRow, 1).style = {
		font: { bold: true, italic: true, size: 10 },
		alignment: { horizontal: 'left' },
	};
	let row = legendStartRow + 1;
	// Lehrer selbst
	ws.getCell(row, 1).value = `L${teacher.shortNumber}`;
	ws.getCell(row, 1).style = { font: { bold: true, size: 10 }, alignment: { horizontal: 'center' } };
	ws.getCell(row, 2).value = `${teacher.name}  (=  dieser Plan)`;
	ws.mergeCells(row, 2, row, 1 + DAYS.length);
	row++;
	// Co-Lehrer sortiert nach shortNumber
	const sortedCo = [...usedCoTeachers].sort((a, b) => a.shortNumber - b.shortNumber);
	for (const co of sortedCo) {
		ws.getCell(row, 1).value = `L${co.shortNumber}`;
		ws.getCell(row, 1).style = { font: { bold: true, size: 10 }, alignment: { horizontal: 'center' } };
		ws.getCell(row, 2).value = co.name;
		ws.mergeCells(row, 2, row, 1 + DAYS.length);
		row++;
	}
	void doc;
}

// ============================================================================
// Sheet "Lehrer-Übersicht" — Last-Verteilung
// ============================================================================

function addTeacherOverviewSheet(
	wb: import('exceljs').Workbook,
	doc: ScheduleDoc,
	overrides: Record<string, string>
): void {
	const ws = wb.addWorksheet('Lehrer-Übersicht', {
		pageSetup: {
			paperSize: 9, // A4
			orientation: 'portrait',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 1,
			printTitlesRow: '1:2',
			margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	// Stunden pro Lehrer pro Tag berechnen
	const specById = new Map(doc.specs.map(s => [s.id, s]));
	const hoursByTeacherDay = new Map<string, number>();
	for (const pl of doc.placed) {
		const spec = specById.get(pl.specId);
		if (!spec) continue;
		const teacherIds = pl.teachers ?? spec.teachers;
		// Pro PlacedLesson zählt jeder Lehrer 1 Stunde an dem Tag.
		// Multi-Grade-Specs erzeugen mehrere PlacedLessons pro Slot —
		// für die Last sollten wir aber pro echter Stunde nur 1× zählen.
		// → Dedup per (teacherId, day, period)
		for (const tid of teacherIds) {
			const key = `${tid}|${pl.day}|${pl.period}`;
			if (!hoursByTeacherDay.has(key)) hoursByTeacherDay.set(key, 0);
		}
	}
	// Jetzt pro (teacher, day, period) als 1 zählen, dann pro (teacher, day) summieren
	const tdSum = new Map<string, number>();
	for (const key of hoursByTeacherDay.keys()) {
		const [tid, day] = key.split('|');
		const k2 = `${tid}|${day}`;
		tdSum.set(k2, (tdSum.get(k2) ?? 0) + 1);
	}

	// === Header ===
	ws.getCell(1, 1).value = 'Lehrer-Stunden pro Tag (Last-Verteilung)';
	ws.mergeCells(1, 1, 1, 2 + DAYS.length + 1);
	ws.getCell(1, 1).style = {
		font: { bold: true, size: 14 },
		alignment: { horizontal: 'center', vertical: 'middle' },
	};
	ws.getRow(1).height = 22;

	ws.getCell(2, 1).value = 'Kürzel';
	ws.getCell(2, 2).value = 'Lehrer';
	for (let d = 0; d < DAYS.length; d++) {
		ws.getCell(2, 3 + d).value = DAYS[d];
	}
	ws.getCell(2, 3 + DAYS.length).value = 'Σ Gesamt';
	for (let c = 1; c <= 3 + DAYS.length; c++) {
		ws.getCell(2, c).style = {
			font: { bold: true, size: 11 },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
			border: thinBorder('FF000000'),
		};
	}
	ws.getRow(2).height = 20;

	ws.getColumn(1).width = 8;
	ws.getColumn(2).width = 28;
	for (let d = 0; d < DAYS.length; d++) ws.getColumn(3 + d).width = 8;
	ws.getColumn(3 + DAYS.length).width = 10;

	// === Zeilen ===
	// Lehrer sortiert nach shortNumber
	const sortedTeachers = [...doc.teachers].sort((a, b) => a.shortNumber - b.shortNumber);
	let rowIdx = 3;
	const dayTotals: Record<Day, number> = { Mo: 0, Di: 0, Mi: 0, Do: 0, Fr: 0 };
	for (const teacher of sortedTeachers) {
		let total = 0;
		ws.getCell(rowIdx, 1).value = `L${teacher.shortNumber}`;
		ws.getCell(rowIdx, 1).style = {
			font: { bold: true, size: 10 },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
			border: {
				top: { style: 'thin', color: { argb: 'FF000000' } },
				right: { style: 'thin', color: { argb: 'FF000000' } },
				bottom: { style: 'thin', color: { argb: 'FF000000' } },
				left: { style: 'medium', color: { argb: hexToArgb(colorOf(teacher, overrides)) } },
			},
		};
		ws.getCell(rowIdx, 2).value = teacher.name;
		ws.getCell(rowIdx, 2).style = {
			font: { size: 10 },
			alignment: { horizontal: 'left', vertical: 'middle' },
			border: thinBorder('FF000000'),
		};
		for (let d = 0; d < DAYS.length; d++) {
			const day = DAYS[d];
			const hours = tdSum.get(`${teacher.id}|${day}`) ?? 0;
			ws.getCell(rowIdx, 3 + d).value = hours > 0 ? hours : '';
			ws.getCell(rowIdx, 3 + d).style = {
				font: { size: 10 },
				alignment: { horizontal: 'center', vertical: 'middle' },
				border: thinBorder('FF000000'),
			};
			total += hours;
			dayTotals[day] += hours;
		}
		ws.getCell(rowIdx, 3 + DAYS.length).value = total;
		ws.getCell(rowIdx, 3 + DAYS.length).style = {
			font: { bold: true, size: 11 },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
			border: thinBorder('FF000000'),
		};
		rowIdx++;
	}

	// Footer-Zeile: Σ pro Tag
	ws.getCell(rowIdx, 1).value = '';
	ws.getCell(rowIdx, 2).value = 'Σ pro Tag';
	ws.getCell(rowIdx, 2).style = {
		font: { bold: true, italic: true, size: 11 },
		alignment: { horizontal: 'right', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
		border: thinBorder('FF000000'),
	};
	let grandTotal = 0;
	for (let d = 0; d < DAYS.length; d++) {
		ws.getCell(rowIdx, 3 + d).value = dayTotals[DAYS[d]];
		ws.getCell(rowIdx, 3 + d).style = {
			font: { bold: true, size: 11 },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
			border: thinBorder('FF000000'),
		};
		grandTotal += dayTotals[DAYS[d]];
	}
	ws.getCell(rowIdx, 3 + DAYS.length).value = grandTotal;
	ws.getCell(rowIdx, 3 + DAYS.length).style = {
		font: { bold: true, size: 12 },
		alignment: { horizontal: 'center', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } },
		border: thinBorder('FF000000'),
	};
}

// ============================================================================
// Helpers
// ============================================================================

function thinBorder(argb: string): import('exceljs').Borders {
	const side = { style: 'thin' as const, color: { argb } };
	return { top: side, right: side, bottom: side, left: side } as import('exceljs').Borders;
}

function sanitizeSheetName(name: string): string {
	// Excel verbietet: \ / * ? : [ ]
	let clean = name.replace(/[\\/*?:[\]]/g, '_').trim();
	if (clean.length > 31) clean = clean.slice(0, 31);
	return clean || 'Sheet';
}

/** Blend hex color with white, ratio 0..1 (1 = pure white). */
function blendWithWhite(hex: string, ratio: number): string {
	const clean = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
	const r = parseInt(clean.slice(0, 2), 16);
	const g = parseInt(clean.slice(2, 4), 16);
	const b = parseInt(clean.slice(4, 6), 16);
	const bl = (c: number) => Math.round(c + (255 - c) * ratio);
	const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
	return `#${toHex(bl(r))}${toHex(bl(g))}${toHex(bl(b))}`;
}
