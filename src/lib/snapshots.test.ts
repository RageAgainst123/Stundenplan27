import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadSnapshots,
	saveSnapshot,
	deleteSnapshot,
	clearSnapshots,
	snapshotCount,
	setSnapshotPinned,
	renameSnapshot,
	importSnapshots,
	samePlacements,
	MAX_PLANS,
	MAX_BACKUPS,
	STORAGE_KEY,
	CORRUPT_BACKUP_KEY,
	type Snapshot,
	type SnapshotSource
} from './snapshots';
import type { PlacedLesson } from './types';

// Hilfs-Constructor für ein Test-Snapshot.
function makeSnap(score: number, source: SnapshotSource = 'manual') {
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

	it('Absturz-Härtung: korrupter Eintrag wird in den Rettungs-Key kopiert statt überschrieben', () => {
		localStorage.setItem(STORAGE_KEY, '[{"id": "abgeschnitten-mitten-im-wr');
		expect(loadSnapshots()).toEqual([]);
		// Roh-Inhalt gerettet …
		expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBe('[{"id": "abgeschnitten-mitten-im-wr');
		// … und ein folgender Save zerstört das Rettungs-Backup nicht.
		saveSnapshot(makeSnap(1000));
		expect(loadSnapshots()).toHaveLength(1);
		expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBe('[{"id": "abgeschnitten-mitten-im-wr');
	});

	it('Absturz-Härtung: bestehendes Rettungs-Backup wird von weiteren Fehl-Loads nicht überschrieben', () => {
		localStorage.setItem(CORRUPT_BACKUP_KEY, 'erstes-backup');
		localStorage.setItem(STORAGE_KEY, 'auch kaputt {');
		loadSnapshots();
		expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBe('erstes-backup');
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

describe('snapshots — Gruppen-Limits (SN2)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('removes oldest plan when exceeding MAX_PLANS', async () => {
		// Erst MAX speichern
		const ids: string[] = [];
		for (let i = 0; i < MAX_PLANS; i++) {
			const s = saveSnapshot(makeSnap(5000 + i));
			ids.push(s.id);
			// Kleine Pause damit createdAt-Reihenfolge eindeutig wird.
			await new Promise(r => setTimeout(r, 2));
		}
		expect(loadSnapshots()).toHaveLength(MAX_PLANS);
		// Einer mehr → ältester (ids[0]) muss raus
		await new Promise(r => setTimeout(r, 2));
		const newer = saveSnapshot(makeSnap(9999));
		const left = loadSnapshots();
		expect(left).toHaveLength(MAX_PLANS);
		// Ältester ist weg
		expect(left.find(s => s.id === ids[0])).toBeUndefined();
		// Neuer ist drin
		expect(left.find(s => s.id === newer.id)).toBeTruthy();
	});

	it('Backups verdrängen KEINE Pläne — getrennte Limits', async () => {
		// Galerie mit Plänen randvoll …
		const planIds: string[] = [];
		for (let i = 0; i < MAX_PLANS; i++) {
			planIds.push(saveSnapshot(makeSnap(5000 + i)).id);
			await new Promise(r => setTimeout(r, 1));
		}
		// … dann eine Backup-Flut (mehr als der Ring hält).
		for (let i = 0; i < MAX_BACKUPS + 3; i++) {
			saveSnapshot(makeSnap(0, 'backup'));
			await new Promise(r => setTimeout(r, 1));
		}
		const left = loadSnapshots();
		// ALLE Pläne sind noch da …
		for (const id of planIds) {
			expect(left.find(s => s.id === id)).toBeTruthy();
		}
		// … und der Backup-Ring rotiert bei MAX_BACKUPS.
		expect(left.filter(s => s.source === 'backup')).toHaveLength(MAX_BACKUPS);
	});

	it('Backup-Ring rotiert FIFO: ältestes Backup fliegt zuerst', async () => {
		const first = saveSnapshot(makeSnap(0, 'backup'));
		await new Promise(r => setTimeout(r, 2));
		for (let i = 0; i < MAX_BACKUPS; i++) {
			saveSnapshot(makeSnap(0, 'backup'));
			await new Promise(r => setTimeout(r, 1));
		}
		const backups = loadSnapshots().filter(s => s.source === 'backup');
		expect(backups).toHaveLength(MAX_BACKUPS);
		expect(backups.find(s => s.id === first.id)).toBeUndefined();
	});

	it('gepinnte Snapshots werden NIE verdrängt', async () => {
		// Ältester Plan wird gepinnt …
		const oldest = saveSnapshot(makeSnap(1));
		setSnapshotPinned(oldest.id, true);
		await new Promise(r => setTimeout(r, 2));
		const secondOldest = saveSnapshot(makeSnap(2));
		await new Promise(r => setTimeout(r, 2));
		for (let i = 0; i < MAX_PLANS - 1; i++) {
			saveSnapshot(makeSnap(100 + i));
			await new Promise(r => setTimeout(r, 1));
		}
		const left = loadSnapshots();
		// … der Gepinnte überlebt, das Opfer ist der zweitälteste (ungepinnt).
		expect(left.find(s => s.id === oldest.id)).toBeTruthy();
		expect(left.find(s => s.id === secondOldest.id)).toBeUndefined();
	});

	it('alles gepinnt → Limit wird weich überschritten statt Pins zu opfern', async () => {
		const a = saveSnapshot(makeSnap(0, 'backup'));
		setSnapshotPinned(a.id, true);
		await new Promise(r => setTimeout(r, 1));
		for (let i = 0; i < MAX_BACKUPS; i++) {
			const s = saveSnapshot(makeSnap(0, 'backup'));
			setSnapshotPinned(s.id, true);
			await new Promise(r => setTimeout(r, 1));
		}
		expect(loadSnapshots().filter(s => s.source === 'backup')).toHaveLength(MAX_BACKUPS + 1);
	});
});

describe('snapshots — Pin / Rename / Migration / Import (SN2)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('setSnapshotPinned + renameSnapshot persistieren', () => {
		const s = saveSnapshot(makeSnap(4500));
		setSnapshotPinned(s.id, true);
		renameSnapshot(s.id, '  Bester Plan v3  ');
		const loaded = loadSnapshots().find(x => x.id === s.id);
		expect(loaded?.pinned).toBe(true);
		expect(loaded?.name).toBe('Bester Plan v3'); // getrimmt
		// Leerer Name wird ignoriert.
		renameSnapshot(s.id, '   ');
		expect(loadSnapshots().find(x => x.id === s.id)?.name).toBe('Bester Plan v3');
	});

	it('Migration: Alt-Einträge „Backup vor …" mit source auto → backup', () => {
		const legacy = [
			{ ...makeSnap(0, 'auto'), name: 'Backup vor Restore 14:30:00', id: 'l1', createdAt: '2026-07-01T10:00:00Z' },
			{ ...makeSnap(4500, 'auto'), name: 'Auto #3', id: 'l2', createdAt: '2026-07-01T10:01:00Z' },
			{ ...makeSnap(4400, 'manual'), name: 'Plan #1', id: 'l3', createdAt: '2026-07-01T10:02:00Z' }
		];
		localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
		const loaded = loadSnapshots();
		expect(loaded.find(s => s.id === 'l1')?.source).toBe('backup');
		expect(loaded.find(s => s.id === 'l2')?.source).toBe('auto');
		expect(loaded.find(s => s.id === 'l3')?.source).toBe('manual');
	});

	it('importSnapshots: merged per id, überspringt Bekannte + Ungültige', () => {
		const existing = saveSnapshot(makeSnap(4500));
		const fresh: Snapshot = {
			...makeSnap(4200), id: 'imp-1', createdAt: '2026-07-01T09:00:00Z'
		};
		const dupe = { ...fresh, id: existing.id };
		const broken = { id: 'imp-2', name: 'kaputt' }; // ohne score/placed/createdAt
		const added = importSnapshots([fresh, dupe, broken]);
		expect(added).toBe(1);
		const loaded = loadSnapshots();
		expect(loaded).toHaveLength(2);
		expect(loaded.find(s => s.id === 'imp-1')?.score).toBe(4200);
	});

	it('samePlacements: reihenfolge- und pin-unabhängig, Inhalt zählt', () => {
		const a: PlacedLesson[] = [
			{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false },
			{ specId: 's2', day: 'Di', period: 2, grade: 6, pinned: false }
		];
		const shuffledPinned: PlacedLesson[] = [
			{ specId: 's2', day: 'Di', period: 2, grade: 6, pinned: true },
			{ specId: 's1', day: 'Mo', period: 1, grade: 5, pinned: false }
		];
		const moved: PlacedLesson[] = [
			{ specId: 's1', day: 'Mo', period: 2, grade: 5, pinned: false },
			{ specId: 's2', day: 'Di', period: 2, grade: 6, pinned: false }
		];
		expect(samePlacements(a, shuffledPinned)).toBe(true);
		expect(samePlacements(a, moved)).toBe(false);
		expect(samePlacements(a, a.slice(0, 1))).toBe(false);
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
