// Audit C-6: Farb-/Lookup-Helpers hatten keinerlei Abdeckung, werden aber
// von 8 Komponenten benutzt (Zell-Hintergründe, Chips, Druck).

import { describe, it, expect } from 'vitest';
import {
	teacherById, teacherColor, teacherName, teacherTint, teacherStripeBackground,
	FALLBACK_TEACHER_COLOR, TEACHER_TINT_PERCENT,
} from './teacher-helpers';
import { emptyDoc, type Teacher } from './types';

function docWithTeacher(): { doc: ReturnType<typeof emptyDoc>; t: Teacher } {
	const doc = emptyDoc('2026/27');
	const t: Teacher = { id: 't1', name: 'Alpha Anna', shortNumber: 1, color: '#e11d48', subjects: [], unavailable: [] };
	doc.teachers.push(t);
	return { doc, t };
}

describe('teacher-helpers — Lookups mit Fallbacks', () => {
	it('teacherById findet per id, undefined bei unbekannter id', () => {
		const { doc, t } = docWithTeacher();
		expect(teacherById(doc, 't1')).toBe(t);
		expect(teacherById(doc, 'nope')).toBeUndefined();
	});

	it('teacherColor: echte Farbe bzw. FALLBACK_TEACHER_COLOR', () => {
		const { doc } = docWithTeacher();
		expect(teacherColor(doc, 't1')).toBe('#e11d48');
		expect(teacherColor(doc, 'nope')).toBe(FALLBACK_TEACHER_COLOR);
	});

	it('teacherName: echter Name bzw. Gedankenstrich', () => {
		const { doc } = docWithTeacher();
		expect(teacherName(doc, 't1')).toBe('Alpha Anna');
		expect(teacherName(doc, 'nope')).toBe('–');
	});
});

describe('teacher-helpers — Tint + Streifen-Gradient', () => {
	it('teacherTint: color-mix mit dem kanonischen Tint-Prozentsatz', () => {
		expect(teacherTint('#e11d48')).toBe(`color-mix(in srgb, #e11d48 ${TEACHER_TINT_PERCENT}%, white)`);
	});

	it('Streifen: leer → Fallback-Tint, einer → einfacher Tint', () => {
		expect(teacherStripeBackground([])).toBe(teacherTint(FALLBACK_TEACHER_COLOR));
		expect(teacherStripeBackground(['#111111'])).toBe(teacherTint('#111111'));
	});

	it('Streifen: zwei Lehrer → vertikaler 50/50-Gradient in Tint-Farben', () => {
		const bg = teacherStripeBackground(['#111111', '#222222']);
		expect(bg).toMatch(/^linear-gradient\(to right, /);
		expect(bg).toContain(`${teacherTint('#111111')} 0.00% 50.00%`);
		expect(bg).toContain(`${teacherTint('#222222')} 50.00% 100.00%`);
	});
});
