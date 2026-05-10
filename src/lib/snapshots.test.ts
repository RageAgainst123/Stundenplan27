import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadSnapshots,
	saveSnapshot,
	deleteSnapshot,
	clearSnapshots,
	snapshotCount,
	MAX_SNAPSHOTS,
	STORAGE_KEY
} from './snapshots';
import type { PlacedLesson } from './types';

// Hilfs-Constructor für ein Test-Snapshot.
function makeSnap(score: number, source: 'auto' | 'manual' = 'manual') {
	const placed: PlacedLesson[] = [
		{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false }
	];
	return {
		name: `Plan ${score}`,
		score,
		placed,
		source,
		scoreBreakdown: { total: score }
	};
}

describe('snapshots — Storage roundtrip', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('loadSnapshots returns empty array when nothing stored', () => {
		expect(loadSnapshots()).toEqual([]);
		expect(snapshotCount()).toBe(0);
	});

	it('saveSnapshot persists with generated id + createdAt', () => {
		const saved = saveSnapshot(makeSnap(4604));
		expect(saved.id).toBeTruthy();
		expect(saved.createdAt).toBeTruthy();
		expect(saved.score).toBe(4604);

		const loaded = loadSnapshots();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].id).toBe(saved.id);
		expect(loaded[0].score).toBe(4604);
	});

	it('saveSnapshot deep-clones placed array (mutation safe)', () => {
		const input = makeSnap(4500);
		const saved = saveSnapshot(input);
		// Mutate input AFTER save
		input.placed[0].day = 'Fr';
		const loaded = loadSnapshots();
		// Stored snapshot is unaffected
		expect(loaded[0].placed[0].day).toBe('Mo');
		expect(saved.placed[0].day).toBe('Mo');
	});

	it('deleteSnapshot removes by id', () => {
		const a = saveSnapshot(makeSnap(4500));
		saveSnapshot(makeSnap(4600));
		expect(loadSnapshots()).toHaveLength(2);
		deleteSnapshot(a.id);
		const left = loadSnapshots();
		expect(left).toHaveLength(1);
		expect(left[0].score).toBe(4600);
	});

	it('clearSnapshots removes all', () => {
		saveSnapshot(makeSnap(4500));
		saveSnapshot(makeSnap(4600));
		expect(loadSnapshots()).toHaveLength(2);
		clearSnapshots();
		expect(loadSnapshots()).toEqual([]);
	});
});

describe('snapshots — MAX_SNAPSHOTS cleanup', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('removes oldest when exceeding MAX_SNAPSHOTS', async () => {
		// Erst MAX speichern
		const ids: string[] = [];
		for (let i = 0; i < MAX_SNAPSHOTS; i++) {
			const s = saveSnapshot(makeSnap(5000 + i));
			ids.push(s.id);
			// Kleine Pause damit createdAt-Reihenfolge eindeutig wird.
			await new Promise(r => setTimeout(r, 2));
		}
		expect(loadSnapshots()).toHaveLength(MAX_SNAPSHOTS);
		// Einer mehr → ältester (ids[0]) muss raus
		await new Promise(r => setTimeout(r, 2));
		const newer = saveSnapshot(makeSnap(9999));
		const left = loadSnapshots();
		expect(left).toHaveLength(MAX_SNAPSHOTS);
		// Ältester ist weg
		expect(left.find(s => s.id === ids[0])).toBeUndefined();
		// Neuer ist drin
		expect(left.find(s => s.id === newer.id)).toBeTruthy();
	});
});

describe('snapshots — STORAGE_KEY isolation', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('uses dedicated storage key (not stundenplan27.doc)', () => {
		saveSnapshot(makeSnap(4500));
		expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
		expect(STORAGE_KEY).toBe('stundenplan27.snapshots');
		// doc-Key bleibt unangetastet
		expect(localStorage.getItem('stundenplan27.doc')).toBeNull();
	});

	it('source field is stored and returned', () => {
		const auto = saveSnapshot(makeSnap(4500, 'auto'));
		const manual = saveSnapshot(makeSnap(4600, 'manual'));
		const loaded = loadSnapshots();
		const a = loaded.find(s => s.id === auto.id);
		const m = loaded.find(s => s.id === manual.id);
		expect(a?.source).toBe('auto');
		expect(m?.source).toBe('manual');
	});

	it('survives malformed localStorage entry (defensive)', () => {
		localStorage.setItem(STORAGE_KEY, 'not-json');
		expect(loadSnapshots()).toEqual([]);
	});
});
