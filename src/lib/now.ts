// Time helpers: parse period ranges, find the current period, ISO week parity.
// Adapted from the legacy app's getPeriodBounds / getWeekNumber / isEvenWeek.

import { DAYS, DEFAULT_PERIOD_TIMES, type Day, type Period } from './types';

export interface PeriodBounds {
	startMin: number;
	endMin: number;
}

export function parsePeriodBounds(times: readonly string[] = DEFAULT_PERIOD_TIMES): PeriodBounds[] {
	return times.map(range => {
		const [start, end] = range.split('-');
		const [sh, sm] = start.split(':').map(n => parseInt(n, 10));
		const [eh, em] = end.split(':').map(n => parseInt(n, 10));
		return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
	});
}

export interface NowResult {
	day: Day | null;
	period: Period | null;
}

export function findCurrentPeriod(now: Date = new Date()): NowResult {
	const dayIdx = now.getDay(); // 0=Sun,1=Mon..5=Fri
	if (dayIdx < 1 || dayIdx > 5) return { day: null, period: null };
	const day = DAYS[dayIdx - 1];
	const minutes = now.getHours() * 60 + now.getMinutes();
	const bounds = parsePeriodBounds();
	for (let i = 0; i < bounds.length; i++) {
		if (minutes >= bounds[i].startMin && minutes < bounds[i].endMin) {
			return { day, period: (i + 1) as Period };
		}
	}
	return { day, period: null };
}

export function isoWeekNumber(d: Date): number {
	const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const dayNum = dt.getUTCDay() || 7;
	dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
	return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function isEvenWeek(weekNumber: number): boolean {
	return weekNumber % 2 === 0;
}

export function currentWeekParity(d: Date = new Date()): { week: number; parity: 'even' | 'odd' } {
	const w = isoWeekNumber(d);
	return { week: w, parity: isEvenWeek(w) ? 'even' : 'odd' };
}
