// Audit C-6: Die Datums-/Wochenlogik war das einzige Modul mit echtem
// Fehler-Risiko ohne jede Abdeckung — an isoWeekNumber hängt die
// G/U-Wochen-Anzeige (welche Woche BBO/EH dran ist), und ISO-Wochen sind
// berüchtigt für Jahreswechsel-Randfälle.

import { describe, it, expect } from 'vitest';
import { parsePeriodBounds, findCurrentPeriod, isoWeekNumber, isEvenWeek, currentWeekParity } from './now';
import { DEFAULT_PERIOD_TIMES } from './types';

describe('isoWeekNumber — Jahreswechsel-Randfälle', () => {
	it('normale Wochen mitten im Jahr', () => {
		// 2026-01-01 ist ein Donnerstag → KW 1; 2026-07-13 (Montag) → KW 29.
		expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
		expect(isoWeekNumber(new Date(2026, 6, 13))).toBe(29);
		expect(isoWeekNumber(new Date(2026, 6, 15))).toBe(29);
	});

	it('Jahresanfang, der noch zur letzten KW des Vorjahres gehört', () => {
		// 2027-01-01 ist ein Freitag → gehört zu KW 53 des Jahres 2026.
		expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
		// 2021-01-01 (Freitag) → KW 53 von 2020 (2020 hatte 53 ISO-Wochen).
		expect(isoWeekNumber(new Date(2021, 0, 1))).toBe(53);
	});

	it('Jahresende, das schon zur KW 1 des Folgejahres gehört', () => {
		// 2024-12-30 ist ein Montag → KW 1 von 2025.
		expect(isoWeekNumber(new Date(2024, 11, 30))).toBe(1);
		// 2025-12-29 (Montag) → KW 1 von 2026.
		expect(isoWeekNumber(new Date(2025, 11, 29))).toBe(1);
	});

	it('Wochen-Grenze: Sonntag gehört noch zur selben ISO-Woche', () => {
		// Mo 2026-07-13 bis So 2026-07-19 sind alle KW 29.
		expect(isoWeekNumber(new Date(2026, 6, 19))).toBe(29);
		expect(isoWeekNumber(new Date(2026, 6, 20))).toBe(30);
	});
});

describe('isEvenWeek + currentWeekParity — G/U-Anzeige', () => {
	it('gerade KW = G-Woche (even), ungerade = U-Woche (odd)', () => {
		expect(isEvenWeek(28)).toBe(true);
		expect(isEvenWeek(29)).toBe(false);
		expect(currentWeekParity(new Date(2026, 6, 15))).toEqual({ week: 29, parity: 'odd' });
		expect(currentWeekParity(new Date(2026, 6, 20))).toEqual({ week: 30, parity: 'even' });
	});
});

describe('parsePeriodBounds', () => {
	it('parst die Default-Zeiten in monoton steigende Minuten-Grenzen', () => {
		const bounds = parsePeriodBounds();
		expect(bounds).toHaveLength(DEFAULT_PERIOD_TIMES.length);
		for (const b of bounds) {
			expect(b.endMin).toBeGreaterThan(b.startMin);
		}
		for (let i = 1; i < bounds.length; i++) {
			expect(bounds[i].startMin).toBeGreaterThanOrEqual(bounds[i - 1].endMin);
		}
	});

	it('parst ein explizites Zeitfenster korrekt', () => {
		expect(parsePeriodBounds(['08:00-08:50'])).toEqual([{ startMin: 480, endMin: 530 }]);
	});
});

describe('findCurrentPeriod', () => {
	// 2026-07-13 ist ein Montag (verifiziert oben via KW 29).
	const monday = (minutes: number) =>
		new Date(2026, 6, 13, Math.floor(minutes / 60), minutes % 60);

	it('Wochenende → kein Tag, keine Stunde', () => {
		expect(findCurrentPeriod(new Date(2026, 6, 18, 10, 0))).toEqual({ day: null, period: null }); // Samstag
		expect(findCurrentPeriod(new Date(2026, 6, 19, 10, 0))).toEqual({ day: null, period: null }); // Sonntag
	});

	it('Montag innerhalb von P1 → { Mo, 1 }; innerhalb der letzten Stunde → P8', () => {
		const bounds = parsePeriodBounds();
		expect(findCurrentPeriod(monday(bounds[0].startMin))).toEqual({ day: 'Mo', period: 1 });
		expect(findCurrentPeriod(monday(bounds[7].startMin))).toEqual({ day: 'Mo', period: 8 });
	});

	it('vor der ersten und nach der letzten Stunde → Tag ja, Stunde nein', () => {
		const bounds = parsePeriodBounds();
		expect(findCurrentPeriod(monday(bounds[0].startMin - 1))).toEqual({ day: 'Mo', period: null });
		expect(findCurrentPeriod(monday(bounds[7].endMin))).toEqual({ day: 'Mo', period: null }); // endMin exklusiv
	});
});
