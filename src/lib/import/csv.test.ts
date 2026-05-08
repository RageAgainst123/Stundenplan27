import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importCsv } from './csv';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__', 'sokrates-liste.csv'), 'utf8');

describe('importCsv – real Sokrates fixture', () => {
	const result = importCsv(fixture);

	it('parses without fatal errors', () => {
		expect(result.specs.length).toBeGreaterThan(40);
	});

	it('deduplicates teachers by personal number', () => {
		const nagl = result.teachers.filter(t => t.name === 'Nagl Tanja');
		expect(nagl).toHaveLength(1);
		expect(nagl[0].personalNumber).toBe('90391614');
		expect(nagl[0].isLeader).toBe(true);
	});

	it('marks placeholders correctly', () => {
		const placeholders = result.teachers.filter(t => t.placeholder);
		// Two distinct Zz_Planung_… (01 and 02) plus "N. N." = 3 unique placeholder slots
		expect(placeholders.length).toBeGreaterThanOrEqual(3);
		expect(result.teachers.find(t => t.name === 'N. N.')?.placeholder).toBe(true);
	});

	it('extracts subject codes (PG_BSP → BSP, VÜ_BBO → BBO)', () => {
		const codes = result.subjects.map(s => s.code).sort();
		expect(codes).toContain('BSP');
		expect(codes).toContain('BBO');
		expect(codes).toContain('M');
		expect(codes).toContain('D');
		expect(codes).toContain('E');
	});

	it('preserves subject categories', () => {
		const bbo = result.subjects.find(s => s.code === 'BBO');
		expect(bbo?.category).toBe('VÜ');
		const fö = result.subjects.find(s => s.code === 'FÖ');
		expect(fö?.category).toBe('FÖ');
		const m = result.subjects.find(s => s.code === 'M');
		expect(m?.category).toBe('PG');
	});

	it('flags Hauptfächer (M, D, E)', () => {
		expect(result.subjects.find(s => s.code === 'M')?.isMain).toBe(true);
		expect(result.subjects.find(s => s.code === 'D')?.isMain).toBe(true);
		expect(result.subjects.find(s => s.code === 'E')?.isMain).toBe(true);
		expect(result.subjects.find(s => s.code === 'BSP')?.isMain).toBe(false);
	});

	it('count = Stunden + ErgStunden (both treated as plain weekly hours)', () => {
		// "PG_D;1a;;0;4;06;Hackl Simone" → count = 4
		const dForGrade6 = result.specs.find(
			s => s.subject === 'D' && s.grades.length === 1 && s.grades[0] === 6
		);
		expect(dForGrade6).toBeDefined();
		expect(dForGrade6!.count).toBe(4);

		// "PG_D;1a;;4;0;05;Hackl Simone" → count = 4
		const dForGrade5 = result.specs.find(
			s => s.subject === 'D' && s.grades.length === 1 && s.grades[0] === 5
		);
		expect(dForGrade5!.count).toBe(4);
	});

	it('parses cross-class "1a+2a" as multiple classes', () => {
		const mädchen = result.specs.find(s => s.groupLabel === 'Bewegung und Sport Mädchen');
		expect(mädchen).toBeDefined();
		expect(mädchen!.classes).toEqual(['1a', '2a']);
		expect(mädchen!.grades).toEqual([5, 6, 7, 8]);
	});

	it('parses comma-separated Schulstufen with whitespace', () => {
		const mu56 = result.specs.find(
			s => s.subject === 'MU' && s.grades.length === 2 && s.grades[0] === 5
		);
		expect(mu56).toBeDefined();
		expect(mu56!.grades).toEqual([5, 6]);
	});

	it('handles cross-grade religion 6+7', () => {
		const rel67 = result.specs.find(s => s.groupLabel === 'PG_REL_RRK_1');
		expect(rel67).toBeDefined();
		expect(rel67!.grades).toEqual([6, 7]);
	});

	it('parses half periods (BBO 0.5)', () => {
		const bboSpecs = result.specs.filter(s => s.subject === 'BBO');
		expect(bboSpecs.length).toBe(2);
		expect(bboSpecs.every(s => s.count === 0.5)).toBe(true);
	});

	it('uses Schulstufen column for grades, not Klasse(n)', () => {
		// "PG_M;1a;;4;0;05;…" must produce grades=[5], not [5,6] (which would be the "1a" mapping)
		const mForGrade5 = result.specs.find(s => s.subject === 'M' && s.grades.length === 1 && s.grades[0] === 5);
		expect(mForGrade5).toBeDefined();
		expect(mForGrade5!.classes).toEqual(['1a']);
	});

	it('all specs default to weekPattern "every"', () => {
		expect(result.specs.every(s => s.weekPattern === 'every')).toBe(true);
	});

	it('groupLabel is set when CSV had a Gruppe value, undefined otherwise', () => {
		const withGroup = result.specs.find(s => s.groupLabel === 'Bewegung und Sport Knaben 1/2');
		expect(withGroup).toBeDefined();
		const noGroup = result.specs.find(
			s => s.subject === 'M' && s.classes[0] === '1a' && s.grades[0] === 5
		);
		expect(noGroup?.groupLabel).toBeUndefined();
	});

	it('Phase 8 v3: CSV imports never set couplingId (only manual via UI)', () => {
		expect(result.specs.every(s => s.couplingId === undefined)).toBe(true);
	});

	it('all specs have source=csv', () => {
		expect(result.specs.every(s => s.source === 'csv')).toBe(true);
	});

	it('skips zero-hour rows but warns', () => {
		// All specs in the parsed result must have count > 0
		expect(result.specs.every(s => s.count > 0)).toBe(true);
	});

	it('warns about KU_VS-NaSt (empty Schulstufen)', () => {
		const found = result.warnings.some(w => w.includes('VS-NaSt'));
		expect(found).toBe(true);
	});
});

describe('importCsv – edge cases', () => {
	it('handles BOM at start of file', () => {
		const content = '﻿Gegenstand;Klasse(n);Gruppe;Stunden;ErgStunden;Schulstufen;LehrerIn\nPG_M;1a;;4;0;05;Test (123)';
		const r = importCsv(content);
		expect(r.specs).toHaveLength(1);
		expect(r.teachers).toHaveLength(1);
		expect(r.teachers[0].personalNumber).toBe('123');
	});

	it('treats decimal comma the same as decimal point', () => {
		const content = 'Gegenstand;Klasse(n);Gruppe;Stunden;ErgStunden;Schulstufen;LehrerIn\nVÜ_BBO;2a;;0,5;0;08;Test (1)';
		const r = importCsv(content);
		expect(r.specs[0].count).toBe(0.5);
	});

	it('returns warning on empty input', () => {
		const r = importCsv('');
		expect(r.warnings).toContain('Datei ist leer.');
		expect(r.specs).toHaveLength(0);
	});

	it('parses "N. N." as placeholder teacher', () => {
		const content = 'Gegenstand;Klasse(n);Gruppe;Stunden;ErgStunden;Schulstufen;LehrerIn\nFÖ_FÖ;1a;FÖ_FÖ;5;0;05;N. N.';
		const r = importCsv(content);
		expect(r.teachers[0].placeholder).toBe(true);
		expect(r.teachers[0].name).toBe('N. N.');
	});
});
