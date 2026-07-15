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
import { buildSlotOccupancy, slotKeyOf } from './schedule-helpers';
import { hexByte } from './format';

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
 * Audit A5: die Roh-Auflösung (Spec-Join, effektive Lehrer) kommt aus dem
 * gemeinsamen `buildSlotOccupancy` — hier nur noch das Excel-Shape.
 */
function buildSlotMap(doc: ScheduleDoc): Map<string, SlotEntry[]> {
	const map = new Map<string, SlotEntry[]>();
	for (const [key, occupants] of buildSlotOccupancy(doc)) {
		map.set(key, occupants.map(o => ({
			subject: o.spec.subject,
			teachers: o.teachers,
			grades: [...o.spec.grades],
			weekPattern: o.spec.weekPattern,
			pinned: o.placed.pinned,
			isTeamTeaching: !!(o.spec.teachingSegments && o.spec.teachingSegments.length > 0),
		})));
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
		// Phase 18.3: zwei weitere Klassenplan-Varianten
		addClassPlanFilteredSheet(wb, doc, slotMap, overrides);
		addClassPlanBwSheet(wb, doc, slotMap);
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

/**
 * Phase 18: Wieviele Sub-Spalten pro Stufe. Erlaubt N=1..SUB_PER_GRADE
 * Lehrer-Streifen pro Slot (wie die Multi-Lehrer-Visualisierung im Web).
 * 4 ist ein guter Kompromiss: bis 4 Lehrer eigene Streifen, ab 5 wird der
 * 4. Streifen für "Lehrer 4 + N" mehrfach genutzt (sehr selten — Schul-Realität).
 */
const SUB_PER_GRADE = 4;
const COLS_PER_DAY = GRADES.length * SUB_PER_GRADE; // 16
const TOTAL_DATA_COLS = DAYS.length * COLS_PER_DAY; // 80
const TOTAL_COLS = 1 + TOTAL_DATA_COLS; // 81

function colForGrade(dayIdx: number, gradeIdx: number, sub = 0): number {
	// Spalten-Index 1-basiert. +1 weil Spalte 1 = Stunden-Info.
	return 2 + dayIdx * COLS_PER_DAY + gradeIdx * SUB_PER_GRADE + sub;
}

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
			printTitlesRow: '1:2',
			margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	// Spalten-Layout:
	//   Col 1: Stunden-Info (Nr + Uhrzeit), Breite 13
	//   Pro Stufe: SUB_PER_GRADE schmale Spalten — bei 1 Lehrer alle merged,
	//   bei N Lehrern (N≤4) je Lehrer ein Streifen, bei N>4 ersten 3 Lehrer
	//   eigene Streifen + Rest gemerged.
	ws.getColumn(1).width = 13;
	const subWidth = 11 / SUB_PER_GRADE; // ~2.75 pro Sub-Spalte
	for (let i = 2; i <= TOTAL_COLS; i++) ws.getColumn(i).width = subWidth;

	// === Header Zeile 1: Tag-Namen, gemerged über COLS_PER_DAY Spalten ===
	for (let d = 0; d < DAYS.length; d++) {
		const startCol = 2 + d * COLS_PER_DAY;
		const endCol = startCol + COLS_PER_DAY - 1;
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

	// === Header Zeile 2: Stufen pro Tag (jeweils gemerged über SUB_PER_GRADE) ===
	for (let d = 0; d < DAYS.length; d++) {
		for (let g = 0; g < GRADES.length; g++) {
			const startCol = colForGrade(d, g, 0);
			const endCol = startCol + SUB_PER_GRADE - 1;
			ws.mergeCells(2, startCol, 2, endCol);
			const cell = ws.getCell(2, startCol);
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

	// === Stunden-Zeilen ===
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 3 + p;
		const period = PERIODS[p];
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
				const startCol = colForGrade(d, g, 0);
				const endCol = startCol + SUB_PER_GRADE - 1;
				const entries = slotMap.get(slotKeyOf(DAYS[d], period, GRADES[g])) ?? [];

				if (entries.length === 0) {
					// Leerer Slot — alle Sub-Spalten gemerged + weiß
					ws.mergeCells(rowIdx, startCol, rowIdx, endCol);
					const cell = ws.getCell(rowIdx, startCol);
					cell.style = {
						border: thinBorder('FFD1D5DB'),
						fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
					};
					continue;
				}

				// Alle Lehrer der Entries sammeln (deduped, in Reihenfolge des Auftretens).
				// Bei Coupling: Spec A + Spec B haben verschiedene teacher[0] → 2 Streifen.
				// Bei Team-Teaching: 1 Spec hat teachers=[A,B,C] → 3 Streifen.
				const teachers: SlotEntry['teachers'] = [];
				const seenIds = new Set<string>();
				for (const e of entries) {
					for (const t of e.teachers) {
						if (!seenIds.has(t.id)) {
							seenIds.add(t.id);
							teachers.push(t);
						}
					}
				}

				// Anzahl Streifen: bis SUB_PER_GRADE eigene Streifen, danach
				// bekommt der letzte Streifen die Farbe von Lehrer #(SUB_PER_GRADE-1)
				// und L-Badges zeigen weiterhin alle (inkl. "+N").
				const stripCount = Math.min(teachers.length, SUB_PER_GRADE);
				// Verteilung der Sub-Spalten auf Streifen — gleichmäßig.
				// Bei stripCount=1 → ein Streifen über alle 4 Sub-Spalten (merged).
				// Bei stripCount=2 → 2+2. Bei 3 → 2+1+1. Bei 4 → 1+1+1+1.
				const widths = distributeStripWidths(SUB_PER_GRADE, stripCount);

				renderSlotStrips(ws, rowIdx, startCol, entries, teachers, stripCount, widths, overrides, 'colored');
			}
		}
		ws.getRow(rowIdx).height = 44;
	}

	// Tagestrenner sichtbar — letzten Sub-Spalte pro Tag bekommen rechte Mittel-Border
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 3 + p;
		for (let d = 0; d < DAYS.length - 1; d++) {
			const lastCol = 2 + (d + 1) * COLS_PER_DAY - 1;
			const cell = ws.getCell(rowIdx, lastCol);
			cell.border = {
				...cell.border,
				right: { style: 'medium', color: { argb: 'FF374151' } },
			};
		}
	}
}

/**
 * Verteilt `total` Sub-Spalten gleichmäßig auf `count` Streifen.
 * Bei Rest mehr Spalten an die ersten Streifen.
 *
 * distributeStripWidths(4, 1) → [4]
 * distributeStripWidths(4, 2) → [2, 2]
 * distributeStripWidths(4, 3) → [2, 1, 1]
 * distributeStripWidths(4, 4) → [1, 1, 1, 1]
 */
function distributeStripWidths(total: number, count: number): number[] {
	if (count <= 0) return [];
	if (count === 1) return [total];
	const base = Math.floor(total / count);
	const rest = total - base * count;
	const widths = new Array(count).fill(base);
	for (let i = 0; i < rest; i++) widths[i]++;
	return widths;
}

/**
 * Render-Modi für `renderSlotStrips`:
 * - 'colored': Streifen mit Lehrerfarbe + Subject in jedem Streifen + L-Badge
 * - 'filtered': wie colored, aber nur Subject + Streifenfarbe (kein L-Badge)
 *               Wenn ein Filter-Lehrer aktiv ist (filterTeacherId), werden
 *               Slots OHNE diesen Lehrer ausgegraut.
 * - 'bw': schwarz/weiß, Subject in jedem Streifen + L-Badge, keine Hintergrundfarbe
 */
type SlotRenderMode = 'colored' | 'filtered' | 'bw';

function renderSlotStrips(
	ws: import('exceljs').Worksheet,
	rowIdx: number,
	startCol: number,
	entries: SlotEntry[],
	teachers: SlotEntry['teachers'],
	stripCount: number,
	widths: number[],
	overrides: Record<string, string>,
	mode: SlotRenderMode,
	opts: { filterTeacherId?: string } = {}
): void {
	const primary = entries[0];
	const gradesStr = primary.grades.length > 1 ? primary.grades.join('+') : primary.grades[0]?.toString() ?? '';
	const weekBadge = primary.weekPattern === 'every' ? '' : (primary.weekPattern === 'even' ? ' [G]' : ' [U]');
	const showPlus = teachers.length > stripCount;

	// Filter-Modus: Slot ist „aktiv" wenn der gefilterte Lehrer drin ist.
	const filterActive = mode === 'filtered' && !!opts.filterTeacherId;
	const slotMatchesFilter = filterActive
		? teachers.some(t => t.id === opts.filterTeacherId)
		: true;

	let col = startCol;
	for (let s = 0; s < stripCount; s++) {
		const width = widths[s];
		const stripStart = col;
		const stripEnd = col + width - 1;
		if (width > 1) ws.mergeCells(rowIdx, stripStart, rowIdx, stripEnd);
		const cell = ws.getCell(rowIdx, stripStart);
		const teacher = teachers[s];
		const teacherColor = colorOf(teacher, overrides);
		const argbStripe = hexToArgb(teacherColor);

		void argbStripe; // jetzt nicht mehr als Border-Akzent verwendet (Fix 3)

		// === Hintergrundfarbe + Text-Farbe ===
		// Fix 3: Border-Farben jetzt EINHEITLICH grau (colored/filtered) bzw.
		// schwarz (bw). Kein farbiger Left-Border mehr — sah uneinheitlich aus.
		let bgArgb: string;
		let textArgb: string;
		if (mode === 'bw') {
			bgArgb = 'FFFFFFFF';
			textArgb = 'FF000000';
		} else if (mode === 'filtered' && filterActive && !slotMatchesFilter) {
			bgArgb = 'FFF3F4F6';
			textArgb = 'FF9CA3AF';
		} else {
			const lightFill = blendWithWhite(teacherColor, 0.65);
			bgArgb = hexToArgb(lightFill);
			textArgb = isDarkColor(lightFill) ? 'FFFFFFFF' : 'FF111827';
		}

		// === Text-Inhalt ===
		// Phase 18.3: Subject in JEDEM Streifen sichtbar (User-Wunsch).
		// Fix 4: Im 'filtered'-Mode KEINE Stufen + Wochenpattern (User wollte
		// die im bereinigten Klassenplan nicht sehen — Stufen sind durch
		// Spalten-Header ersichtlich).
		let text: string;
		const isLast = s === stripCount - 1;
		const plusBadge = (isLast && showPlus) ? ` +${teachers.length - stripCount}` : '';

		if (mode === 'filtered') {
			// "Bereinigt": nur Subject — kein L-Badge, kein Stufen-Zusatz
			text = primary.subject;
		} else {
			// 'colored' und 'bw': Subject + L-Badge in jedem Streifen
			const badge = `L${teacher.shortNumber}`;
			if (s === 0 && mode === 'colored') {
				// Nur farbig: Stufe + Wochenpattern in zweiter Zeile des ersten Streifens
				text = `${primary.subject} ${badge}${plusBadge}\n${gradesStr}${weekBadge}`;
			} else {
				text = `${primary.subject} ${badge}${plusBadge}`;
			}
		}

		// Einheitliche Border-Farbe: thin grau (colored/filtered) bzw. thin schwarz (bw)
		const borderArgb = mode === 'bw' ? 'FF000000' : 'FFD1D5DB';
		cell.value = text;
		cell.style = {
			font: { size: s === 0 ? 9 : 8, bold: true, color: { argb: textArgb } },
			alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } },
			border: {
				top: { style: 'thin', color: { argb: borderArgb } },
				bottom: { style: 'thin', color: { argb: borderArgb } },
				left: { style: 'thin', color: { argb: borderArgb } },
				right: { style: 'thin', color: { argb: borderArgb } },
			},
		};
		col += width;
	}
}

// ============================================================================
// Sheet 1b: Klassenplan (bereinigt) — Lehrer-Filter mit Dropdown
// ============================================================================

function addClassPlanFilteredSheet(
	wb: import('exceljs').Workbook,
	doc: ScheduleDoc,
	slotMap: Map<string, SlotEntry[]>,
	overrides: Record<string, string>
): void {
	const ws = wb.addWorksheet('Klassenplan-Filter', {
		pageSetup: {
			paperSize: 8 as unknown as import('exceljs').PaperSize,
			orientation: 'landscape',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 1,
			printTitlesRow: '4:5',
			margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	ws.getColumn(1).width = 13;
	const subWidth = 11 / SUB_PER_GRADE;
	for (let i = 2; i <= TOTAL_COLS; i++) ws.getColumn(i).width = subWidth;

	// === Zeile 1: Filter-Steuerung ===
	// In Zelle B1 wählt der User den Lehrer aus. Conditional Formatting greift
	// für jeden Slot — Slots ohne den gewählten Lehrer werden ausgegraut.
	// Die Logik dafür baut auf "Slots tragen ihren Lehrer-ID-Hash in einer
	// Hilfs-Zelle" — DAS geht aber nicht ohne Formeln pro Zelle. Stattdessen:
	// User wechselt im Dropdown, ich erzeuge für JEDEN Lehrer eine eigene
	// Variante? — Excel Conditional Formatting hat keine "Zelle enthält Wert
	// aus Dropdown"-Logik die zellweise färbt.
	// Pragmatischer Ansatz: ohne Dropdown — der Sheet zeigt einfach den
	// "bereinigten" Plan ohne L-Badges, Subject sichtbar in jedem Streifen,
	// Lehrerfarbe als Streifen. Wenn User EINEN Lehrer hervorheben will,
	// nutzt er die N+ Lehrer-Tabs (sind eh dabei).
	// Plus: Statt Dropdown nutzen wir ein LISTEN-Header oben mit allen
	// Lehrern (als visuelle Filter-Anweisung) — User kann via Find/Replace
	// oder einfach durchklicken die Tab-Übersicht nutzen.
	ws.getCell(1, 1).value = 'Klassenplan bereinigt — visuelles Lehrer-Farb-Mapping unten. Für gefilterte Einzelansicht eines Lehrers den jeweiligen Lehrer-Tab nutzen.';
	ws.mergeCells(1, 1, 1, TOTAL_COLS);
	ws.getCell(1, 1).style = {
		font: { bold: true, size: 12 },
		alignment: { horizontal: 'left', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } },
		border: thinBorder('FF6B7280'),
	};
	ws.getRow(1).height = 20;

	// === Zeile 2: Lehrer-Übersicht mit Farben (visuelles "Filter-Header") ===
	ws.getCell(2, 1).value = 'Lehrer:';
	ws.getCell(2, 1).style = {
		font: { bold: true, size: 10 },
		alignment: { horizontal: 'right', vertical: 'middle' },
	};
	const activeTeacherIds = new Set<string>();
	for (const entries of slotMap.values()) {
		for (const e of entries) {
			for (const t of e.teachers) activeTeacherIds.add(t.id);
		}
	}
	const activeTeachers = doc.teachers
		.filter(t => activeTeacherIds.has(t.id))
		.sort((a, b) => a.shortNumber - b.shortNumber);
	const colsPerTeacher = Math.max(2, Math.floor((TOTAL_COLS - 1) / Math.max(1, activeTeachers.length)));
	let teacherCol = 2;
	for (const teacher of activeTeachers) {
		const startCol = teacherCol;
		const endCol = Math.min(teacherCol + colsPerTeacher - 1, TOTAL_COLS);
		if (endCol > startCol) ws.mergeCells(2, startCol, 2, endCol);
		const cell = ws.getCell(2, startCol);
		const teacherColor = colorOf(teacher, overrides);
		const lightFill = blendWithWhite(teacherColor, 0.5);
		cell.value = `L${teacher.shortNumber}: ${teacher.name}`;
		cell.style = {
			font: { bold: true, size: 9, color: { argb: isDarkColor(lightFill) ? 'FFFFFFFF' : 'FF111827' } },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(lightFill) } },
			border: {
				top: { style: 'thin', color: { argb: 'FF6B7280' } },
				bottom: { style: 'medium', color: { argb: hexToArgb(teacherColor) } },
				left: { style: 'thin', color: { argb: 'FF6B7280' } },
				right: { style: 'thin', color: { argb: 'FF6B7280' } },
			},
		};
		teacherCol = endCol + 1;
		if (teacherCol > TOTAL_COLS) break;
	}
	ws.getRow(2).height = 18;

	// Zeile 3 als visueller Trenner / Spacer
	ws.getCell(3, 1).value = '';
	ws.mergeCells(3, 1, 3, TOTAL_COLS);
	ws.getCell(3, 1).style = {
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
	};
	ws.getRow(3).height = 4;

	// === Zeile 4: Tag-Header (gleich wie Klassenplan) ===
	for (let d = 0; d < DAYS.length; d++) {
		const startCol = 2 + d * COLS_PER_DAY;
		const endCol = startCol + COLS_PER_DAY - 1;
		ws.mergeCells(4, startCol, 4, endCol);
		const cell = ws.getCell(4, startCol);
		cell.value = DAYS[d];
		cell.style = {
			font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } },
			border: thinBorder('FF1F2937'),
		};
	}
	ws.getRow(4).height = 24;

	// Fix 4: Keine Stufen-Zeile im Filter-Sheet (User-Wunsch — Stufen sind
	// im "bereinigten" Plan visuell durch die Spalten-Position klar).
	// Stunden-Zeilen starten direkt ab Zeile 5.
	ws.pageSetup.printTitlesRow = '4:4'; // nur Tag-Header bei Druck wiederholen

	// === Stunden-Zeilen ab Zeile 5 ===
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 5 + p;
		const period = PERIODS[p];
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
				const startCol = colForGrade(d, g, 0);
				const endCol = startCol + SUB_PER_GRADE - 1;
				const entries = slotMap.get(slotKeyOf(DAYS[d], period, GRADES[g])) ?? [];

				if (entries.length === 0) {
					ws.mergeCells(rowIdx, startCol, rowIdx, endCol);
					const cell = ws.getCell(rowIdx, startCol);
					cell.style = {
						border: thinBorder('FFD1D5DB'),
						fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
					};
					continue;
				}
				const teachers: SlotEntry['teachers'] = [];
				const seenIds = new Set<string>();
				for (const e of entries) for (const t of e.teachers) {
					if (!seenIds.has(t.id)) { seenIds.add(t.id); teachers.push(t); }
				}
				const stripCount = Math.min(teachers.length, SUB_PER_GRADE);
				const widths = distributeStripWidths(SUB_PER_GRADE, stripCount);
				renderSlotStrips(ws, rowIdx, startCol, entries, teachers, stripCount, widths, overrides, 'filtered');
			}
		}
		ws.getRow(rowIdx).height = 38;
	}

	// Tagestrenner (Stunden-Zeilen starten jetzt bei Zeile 5)
	for (let p = 0; p < PERIODS.length; p++) {
		const rowIdx = 5 + p;
		for (let d = 0; d < DAYS.length - 1; d++) {
			const lastCol = 2 + (d + 1) * COLS_PER_DAY - 1;
			const cell = ws.getCell(rowIdx, lastCol);
			cell.border = { ...cell.border, right: { style: 'medium', color: { argb: 'FF374151' } } };
		}
	}
}

// ============================================================================
// Sheet 1c: Klassenplan schwarz/weiß mit Legende
// ============================================================================

function addClassPlanBwSheet(
	wb: import('exceljs').Workbook,
	doc: ScheduleDoc,
	slotMap: Map<string, SlotEntry[]>
): void {
	// Layout: Tage UNTEREINANDER (Fix 5).
	// Spalten: Col 1 = Stunden-Info, danach 4 Stufen × SUB_PER_GRADE Sub-Spalten
	//          (insgesamt 1 + 4*4 = 17 Spalten).
	// Stufen-Header NUR einmal ganz oben (Fix 6 — Stufen sind durch Spalten klar).
	// Pro Tag: 1 Tag-Titel-Zeile (gemerged) + 8 Stunden-Zeilen.
	// A4 quer (Fix 7).
	const COLS_PER_GRADE_BW = SUB_PER_GRADE; // 4 sub-Spalten pro Stufe
	const SW_COLS_DATA = GRADES.length * COLS_PER_GRADE_BW; // 16
	const SW_TOTAL_COLS = 1 + SW_COLS_DATA; // 17

	const ws = wb.addWorksheet('Klassenplan S-W', {
		pageSetup: {
			paperSize: 9 as unknown as import('exceljs').PaperSize, // A4 (Fix 7)
			orientation: 'landscape',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 1,
			printTitlesRow: '1:1', // Stufen-Header bei Druck wiederholen
			blackAndWhite: true,
			margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
		},
	});

	function colForGradeSw(gradeIdx: number, sub = 0): number {
		return 2 + gradeIdx * COLS_PER_GRADE_BW + sub;
	}

	ws.getColumn(1).width = 11;
	const subWidthSw = 28 / COLS_PER_GRADE_BW; // breiter weil weniger Spalten
	for (let i = 2; i <= SW_TOTAL_COLS; i++) ws.getColumn(i).width = subWidthSw;

	// === Zeile 1: Stufen-Header (einmal ganz oben) ===
	const headerCell = ws.getCell(1, 1);
	headerCell.value = 'Stunde';
	headerCell.style = {
		font: { bold: true, size: 10, color: { argb: 'FF000000' } },
		alignment: { horizontal: 'center', vertical: 'middle' },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
		border: thinBorder('FF000000'),
	};
	for (let g = 0; g < GRADES.length; g++) {
		const startCol = colForGradeSw(g, 0);
		const endCol = startCol + COLS_PER_GRADE_BW - 1;
		ws.mergeCells(1, startCol, 1, endCol);
		const cell = ws.getCell(1, startCol);
		cell.value = `${GRADES[g]}. Stufe`;
		cell.style = {
			font: { bold: true, size: 11, color: { argb: 'FF000000' } },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
			border: thinBorder('FF000000'),
		};
	}
	ws.getRow(1).height = 20;

	// Track which teachers actually appear in the plan (for legend)
	const usedTeachers = new Map<string, Teacher>();

	// === Pro Tag: 1 Titel-Zeile + 8 Stunden-Zeilen, gestapelt ===
	let currentRow = 2;
	for (let d = 0; d < DAYS.length; d++) {
		// Tag-Titel-Zeile (gemerged über alle Spalten, schwarzer Hintergrund + weißer Text)
		ws.mergeCells(currentRow, 1, currentRow, SW_TOTAL_COLS);
		const titleCell = ws.getCell(currentRow, 1);
		titleCell.value = DAYS[d];
		titleCell.style = {
			font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
			alignment: { horizontal: 'center', vertical: 'middle' },
			fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } },
			border: thinBorder('FF000000'),
		};
		ws.getRow(currentRow).height = 22;
		currentRow++;

		// Stunden-Zeilen
		for (let p = 0; p < PERIODS.length; p++) {
			const period = PERIODS[p];
			// Linke Spalte: Stunden-Nr + Uhrzeit
			const periodCell = ws.getCell(currentRow, 1);
			periodCell.value = `${period}.\n${DEFAULT_PERIOD_TIMES[p]}`;
			periodCell.style = {
				font: { bold: true, size: 9 },
				alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
				fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
				border: thinBorder('FF000000'),
			};

			for (let g = 0; g < GRADES.length; g++) {
				const startCol = colForGradeSw(g, 0);
				const endCol = startCol + COLS_PER_GRADE_BW - 1;
				const entries = slotMap.get(slotKeyOf(DAYS[d], period, GRADES[g])) ?? [];
				if (entries.length === 0) {
					ws.mergeCells(currentRow, startCol, currentRow, endCol);
					const cell = ws.getCell(currentRow, startCol);
					cell.style = {
						border: thinBorder('FF000000'),
						fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
					};
					continue;
				}
				const teachers: SlotEntry['teachers'] = [];
				const seenIds = new Set<string>();
				for (const e of entries) for (const t of e.teachers) {
					if (!seenIds.has(t.id)) {
						seenIds.add(t.id);
						teachers.push(t);
						usedTeachers.set(t.id, t);
					}
				}
				const stripCount = Math.min(teachers.length, COLS_PER_GRADE_BW);
				const widths = distributeStripWidths(COLS_PER_GRADE_BW, stripCount);
				renderSlotStrips(ws, currentRow, startCol, entries, teachers, stripCount, widths, {}, 'bw');
			}
			ws.getRow(currentRow).height = 26;
			currentRow++;
		}
	}

	// === Legende unten ===
	currentRow++; // 1 Zeile Spacer
	ws.getCell(currentRow, 1).value = 'Legende — Lehrer-Kürzel:';
	ws.mergeCells(currentRow, 1, currentRow, SW_TOTAL_COLS);
	ws.getCell(currentRow, 1).style = {
		font: { bold: true, italic: true, size: 11 },
		alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
		fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
		border: thinBorder('FF000000'),
	};
	ws.getRow(currentRow).height = 20;
	currentRow++;

	const sortedLehrer = [...usedTeachers.values()].sort((a, b) => a.shortNumber - b.shortNumber);
	const legendCols = 4;
	const legendColWidth = Math.floor(SW_TOTAL_COLS / legendCols);
	let cIdx = 0;
	for (const teacher of sortedLehrer) {
		const startCol = 1 + cIdx * legendColWidth;
		const endCol = Math.min(startCol + legendColWidth - 1, SW_TOTAL_COLS);
		ws.mergeCells(currentRow, startCol, currentRow, endCol);
		const cell = ws.getCell(currentRow, startCol);
		cell.value = `L${teacher.shortNumber}  —  ${teacher.name}`;
		cell.style = {
			font: { size: 10 },
			alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
			border: thinBorder('FF000000'),
		};
		cIdx++;
		if (cIdx >= legendCols) {
			cIdx = 0;
			ws.getRow(currentRow).height = 16;
			currentRow++;
		}
	}
	if (cIdx > 0) ws.getRow(currentRow).height = 16;
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
				const arr = slotMap.get(slotKeyOf(DAYS[d], period, grade)) ?? [];
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
	const toHex = (n: number) => hexByte(n).toUpperCase();
	return `#${toHex(bl(r))}${toHex(bl(g))}${toHex(bl(b))}`;
}
