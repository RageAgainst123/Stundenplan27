import { describe, it, expect } from 'vitest';
import { timeLabel, fileTimestamp, hexByte } from './format';

describe('format — kleine Format-Helpers (Audit C-5)', () => {
	it('timeLabel: de-AT-Uhrzeit einer fixen Date', () => {
		const d = new Date('2026-07-15T09:30:05');
		expect(timeLabel(d)).toBe(d.toLocaleTimeString('de-AT'));
		expect(timeLabel(d)).toMatch(/\d{1,2}:\d{2}:\d{2}/);
	});

	it('fileTimestamp: keine Doppelpunkte/Punkte (dateiname-sicher)', () => {
		const d = new Date('2026-07-15T09:30:05.123Z');
		const ts = fileTimestamp(d);
		expect(ts).toBe('2026-07-15T09-30-05-123Z');
		expect(ts).not.toMatch(/[:.]/);
	});

	it('hexByte: zweistellig, klein, 0-255', () => {
		expect(hexByte(0)).toBe('00');
		expect(hexByte(10)).toBe('0a');
		expect(hexByte(153)).toBe('99');
		expect(hexByte(255)).toBe('ff');
	});
});
