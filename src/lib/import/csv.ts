// Parser for the Sokrates "Liste" CSV export.
// See plan §"CSV-Import vom Verwaltungsprogramm".
//
// Header columns: Gegenstand;Klasse(n);Gruppe;Stunden;ErgStunden;Schulstufen;LehrerIn

import type {
	GradeLevel,
	LessonSpec,
	Subject,
	SubjectCategory,
	Teacher
} from '../types';
import { lookupSubjectMeta } from './subject-names';

export interface ImportResult {
	teachers: Teacher[];
	subjects: Subject[];
	specs: LessonSpec[];
	warnings: string[];
}

interface ParsedRow {
	rawSubject: string;        // e.g. "PG_BSP"
	category: SubjectCategory;
	subjectCode: string;       // "BSP"
	classes: string[];         // ["1a"] or ["1a","2a"]
	groupKey: string;          // "" if empty
	stunden: number;
	ergStunden: number;
	grades: GradeLevel[];
	teacherRaw: string;        // raw teacher cell
}

const TEACHER_COLORS = [
	'#ff69b4', '#90ee90', '#ffd700', '#228b22', '#dc143c',
	'#f5deb3', '#9370db', '#87ceeb', '#8b4513', '#40e0d0',
	'#ff7f50', '#6495ed', '#9acd32', '#ffa07a', '#ba55d3',
	'#20b2aa', '#cd853f', '#7b68ee', '#3cb371', '#daa520'
];

function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseDecimal(raw: string): number {
	const t = raw.trim();
	if (t === '') return 0;
	const n = Number(t.replace(',', '.'));
	return Number.isFinite(n) ? n : 0;
}

function parseGrades(raw: string): GradeLevel[] {
	if (!raw.trim()) return [];
	return raw
		.split(/\s*,\s*/)
		.map(part => parseInt(part.replace(/^0+/, ''), 10))
		.filter(n => Number.isFinite(n) && n >= 5 && n <= 8) as GradeLevel[];
}

function parseClasses(raw: string): string[] {
	if (!raw.trim()) return [];
	return raw.split('+').map(s => s.trim()).filter(Boolean);
}

function parseSubjectCell(raw: string): {
	category: SubjectCategory;
	code: string;
} | null {
	const m = raw.match(/^([A-Za-zÄÖÜäöü]+)_(.+)$/);
	if (!m) return null;
	const prefix = m[1];
	const code = m[2].trim();
	const known: SubjectCategory[] = ['PG', 'VÜ', 'FÖ', 'KU'];
	const category = known.includes(prefix as SubjectCategory)
		? (prefix as SubjectCategory)
		: 'PG';
	return { category, code };
}

interface TeacherInfo {
	displayName: string;          // "Nagl Tanja"
	personalNumber?: string;
	isLeader: boolean;
	placeholder: boolean;
}

function parseTeacherCell(raw: string): TeacherInfo {
	const trimmed = raw.trim();

	// Placeholder: "Zz_Planung_318162 01" or "N. N."
	if (/^Zz_Planung/i.test(trimmed) || /^N\.\s*N\.?$/i.test(trimmed)) {
		return { displayName: trimmed, placeholder: true, isLeader: false };
	}

	// Strip optional " (Leitung)" suffix
	const isLeader = / \(Leitung\)\s*$/i.test(trimmed);
	const noLeader = trimmed.replace(/ \(Leitung\)\s*$/i, '').trim();

	// Extract trailing "(<digits>)" as personal number
	const m = noLeader.match(/^(.+?)\s*\((\d+)\)\s*$/);
	if (m) {
		return {
			displayName: m[1].trim(),
			personalNumber: m[2],
			isLeader,
			placeholder: false
		};
	}
	return { displayName: noLeader, isLeader, placeholder: false };
}

function splitCsvLine(line: string): string[] {
	// Sokrates exports plain unquoted semicolons. If a quoted-CSV variant ever
	// appears, harden this; for now keep it dead simple.
	return line.split(';').map(s => s.trim());
}

function parseRow(fields: string[]): ParsedRow | null {
	if (fields.length < 7) return null;
	const [rawSubject, rawClasses, rawGroup, rawStunden, rawErg, rawGrades, rawTeacher] = fields;
	const sub = parseSubjectCell(rawSubject);
	if (!sub) return null;
	return {
		rawSubject,
		category: sub.category,
		subjectCode: sub.code,
		classes: parseClasses(rawClasses),
		groupKey: rawGroup.trim(),
		stunden: parseDecimal(rawStunden),
		ergStunden: parseDecimal(rawErg),
		grades: parseGrades(rawGrades),
		teacherRaw: rawTeacher.trim()
	};
}

function teacherKey(info: TeacherInfo): string {
	if (info.personalNumber) return `pn:${info.personalNumber}`;
	return `name:${info.displayName.toLowerCase()}`;
}

export function importCsv(content: string): ImportResult {
	const text = stripBom(content);
	const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
	if (lines.length === 0) {
		return { teachers: [], subjects: [], specs: [], warnings: ['Datei ist leer.'] };
	}

	const warnings: string[] = [];

	const headerFields = splitCsvLine(lines[0]).map(s => s.toLowerCase());
	const expected = ['gegenstand', 'klasse(n)', 'gruppe', 'stunden', 'ergstunden', 'schulstufen', 'lehrerin'];
	const headerOk = expected.every((e, i) => (headerFields[i] ?? '').includes(e));
	if (!headerOk) {
		warnings.push(
			`Header-Spalten weichen ab. Erwartet: ${expected.join(';')}; gefunden: ${lines[0]}`
		);
	}

	const teacherMap = new Map<string, Teacher>();
	const subjectMap = new Map<string, Subject>();
	const specs: LessonSpec[] = [];
	let teacherCounter = 0;

	for (let i = 1; i < lines.length; i++) {
		const fields = splitCsvLine(lines[i]);
		const row = parseRow(fields);
		if (!row) {
			warnings.push(`Zeile ${i + 1}: konnte nicht geparst werden (${lines[i].slice(0, 60)}…)`);
			continue;
		}

		// 1) Teacher (dedupe by personal number, else by name)
		const tInfo = parseTeacherCell(row.teacherRaw);
		const tKey = teacherKey(tInfo);
		let teacher = teacherMap.get(tKey);
		if (!teacher) {
			teacherCounter++;
			teacher = {
				id: newId(),
				name: tInfo.displayName,
				personalNumber: tInfo.personalNumber,
				shortNumber: teacherCounter,
				color: TEACHER_COLORS[(teacherCounter - 1) % TEACHER_COLORS.length],
				isLeader: tInfo.isLeader || undefined,
				placeholder: tInfo.placeholder || undefined,
				subjects: [],
				unavailable: []
			};
			teacherMap.set(tKey, teacher);
		}
		if (!teacher.subjects.includes(row.subjectCode)) teacher.subjects.push(row.subjectCode);

		// 2) Subject (dedupe by code)
		let subject = subjectMap.get(row.subjectCode);
		if (!subject) {
			const meta = lookupSubjectMeta(row.subjectCode);
			subject = {
				code: row.subjectCode,
				name: meta.name,
				category: row.category,
				isMain: meta.isMain,
				hoursPerWeek: {},
				maxConsecutive: meta.isMain ? 2 : 99
			};
			subjectMap.set(row.subjectCode, subject);
		}
		// Aggregate hoursPerWeek for visibility (informational; specs are the source of truth)
		const count = row.stunden + row.ergStunden;
		for (const g of row.grades) {
			subject.hoursPerWeek[g] = (subject.hoursPerWeek[g] ?? 0) + count;
		}

		// 3) LessonSpec
		if (count <= 0) {
			warnings.push(
				`Zeile ${i + 1}: Stunden = 0 für ${row.rawSubject} (${row.classes.join('+')}) — übersprungen.`
			);
			continue;
		}
		if (row.grades.length === 0) {
			warnings.push(
				`Zeile ${i + 1}: keine Schulstufe für ${row.rawSubject} (${row.classes.join('+')}).`
			);
		}

		specs.push({
			id: newId(),
			subject: row.subjectCode,
			teacher: teacher.id,
			classes: row.classes,
			grades: row.grades,
			weekPattern: 'every',
			groupKey: row.groupKey || undefined,
			count,
			blocks: Array(Math.max(1, Math.round(count))).fill(1),
			includeInSolver: true,
			source: 'csv'
		});
	}

	return {
		teachers: Array.from(teacherMap.values()),
		subjects: Array.from(subjectMap.values()),
		specs,
		warnings
	};
}
