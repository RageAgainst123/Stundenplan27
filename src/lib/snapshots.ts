// Phase 15: Plan-Snapshot-Galerie.
//
// Konzept: Bis zu MAX_SNAPSHOTS Plan-Stände werden in localStorage
// konserviert (Key `stundenplan27.snapshots`). User kann sie
// wiederherstellen, von ihnen aus diversifizieren, oder löschen.
//
// Snapshots sind separat vom Plan-Doc — sie überleben kein Doc-Reset
// und werden NICHT im JSON-Export inkludiert. Pro Browser/Gerät.
//
// Auto-Snapshot wird vom GenerateButton getriggert wenn ein Solver-Lauf
// >= 5% Score-Improvement liefert. Manueller Save jederzeit möglich.

import type { PlacedLesson } from './types';

export const STORAGE_KEY = 'stundenplan27.snapshots';
/**
 * Rettungs-Key: Wenn der Snapshot-Eintrag beim Laden nicht parsebar ist
 * (z. B. Browser-Crash mitten im Write), wird der Roh-Inhalt HIERHIN
 * kopiert statt beim nächsten Save endgültig überschrieben zu werden.
 * Manuell inspizier-/rettbar über die DevTools.
 */
export const CORRUPT_BACKUP_KEY = 'stundenplan27.snapshots.corrupt';
/** Persistenter Namens-Zähler — siehe nextSnapshotNumber(). */
export const COUNTER_KEY = 'stundenplan27.snapshots.counter';
export const MAX_SNAPSHOTS = 10;

/** Solver-Score-Komponenten (gespiegelt aus solver-v2/index PenaltyBreakdown). */
export interface SnapshotScoreBreakdown {
	main_aft?: number;
	any_aft?: number;
	main_early?: number;
	main_run?: number;
	no_free?: number;
	uneven_days?: number;
	compact?: number;
	time_pref?: number;
	subject_twice?: number;
	spec_spread?: number;
	teacher_late_start?: number;
	teacher_under_min?: number;
	target_daily?: number;
	afternoon_preferred?: number;
	main_twice?: number;
	main_block_split?: number;
	total: number;
}

export interface Snapshot {
	id: string;            // UUID
	name: string;          // "Plan #1" oder User-gewählt
	score: number;         // niedriger = besser
	placed: PlacedLesson[];
	scoreBreakdown?: SnapshotScoreBreakdown;
	createdAt: string;     // ISO-Timestamp
	source: 'auto' | 'manual';
}

/** Lade alle Snapshots aus localStorage. Empty array bei keinem Eintrag. */
export function loadSnapshots(): Snapshot[] {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			rescueCorruptRaw(raw);
			return [];
		}
		// Defensive Filter: nur strukturell gültige Einträge.
		return parsed.filter(
			(s): s is Snapshot =>
				typeof s === 'object' && s !== null &&
				typeof (s as Snapshot).id === 'string' &&
				typeof (s as Snapshot).name === 'string' &&
				typeof (s as Snapshot).score === 'number' &&
				Array.isArray((s as Snapshot).placed) &&
				typeof (s as Snapshot).createdAt === 'string'
		);
	} catch {
		// Absturz-Härtung: korrupte Daten NICHT still verwerfen — vor dem
		// Fix überschrieb der nächste saveSnapshot() (load → [] → write)
		// den rettbaren Alt-Inhalt endgültig.
		if (raw) rescueCorruptRaw(raw);
		return [];
	}
}

/** Kopiert nicht-parsebaren Snapshot-Inhalt in den Rettungs-Key. */
function rescueCorruptRaw(raw: string): void {
	try {
		// Nur sichern wenn dort nicht schon ein Rettungs-Backup liegt —
		// wiederholte fehlgeschlagene Loads dürfen es nicht überschreiben.
		if (localStorage.getItem(CORRUPT_BACKUP_KEY) === null) {
			localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
			console.warn(`Snapshots nicht lesbar — Roh-Inhalt nach ${CORRUPT_BACKUP_KEY} gesichert.`);
		}
	} catch {
		// Quota voll o. ä. — mehr können wir hier nicht tun.
	}
}

/** Schreibe alle Snapshots nach localStorage. */
function writeSnapshots(snapshots: Snapshot[]): void {
	// Absturz-Härtung: bei Quota-Fehlern (localStorage voll) die ältesten
	// AUTO-Snapshots opfern und erneut versuchen — manuell gespeicherte
	// bleiben so lange wie möglich erhalten. Vorher ging der Save still
	// verloren (nur console.warn).
	const work = [...snapshots];
	for (;;) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(work));
			return;
		} catch (e) {
			const oldestAutoIdx = work
				.map((s, i) => ({ s, i }))
				.filter(x => x.s.source === 'auto')
				.sort((a, b) => a.s.createdAt.localeCompare(b.s.createdAt))[0]?.i;
			if (oldestAutoIdx === undefined || work.length === 0) {
				console.warn('Snapshot-Speichern fehlgeschlagen (auch nach Cleanup)', e);
				return;
			}
			work.splice(oldestAutoIdx, 1);
		}
	}
}

/** Generiere eine UUID. Browser-API + Fallback für ältere Umgebungen. */
function generateId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Fallback: Timestamp + Random
	return `snap-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

/**
 * Speichere ein neues Snapshot. Bei Überschreitung von MAX_SNAPSHOTS wird
 * der älteste (createdAt) entfernt — FIFO-Cleanup. Returnt das gespeicherte
 * Snapshot mit generierter id + createdAt.
 */
export function saveSnapshot(input: Omit<Snapshot, 'id' | 'createdAt'>): Snapshot {
	const snap: Snapshot = {
		...input,
		id: generateId(),
		createdAt: new Date().toISOString(),
		// Deep-Clone der Placements damit spätere Mutations am Doc nicht
		// das Snapshot betreffen.
		placed: input.placed.map(p => ({ ...p })),
		scoreBreakdown: input.scoreBreakdown ? { ...input.scoreBreakdown } : undefined
	};
	const existing = loadSnapshots();
	existing.push(snap);
	// Cleanup: wenn über Limit, älteste entfernen
	if (existing.length > MAX_SNAPSHOTS) {
		existing.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		existing.splice(0, existing.length - MAX_SNAPSHOTS);
	}
	writeSnapshots(existing);
	return snap;
}

/** Lösche ein einzelnes Snapshot per id. */
export function deleteSnapshot(id: string): void {
	const existing = loadSnapshots();
	writeSnapshots(existing.filter(s => s.id !== id));
}

/** Lösche alle Snapshots. */
export function clearSnapshots(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (e) {
		console.warn('Snapshot-Cleanup fehlgeschlagen', e);
	}
}

/** Anzahl gespeicherter Snapshots. */
export function snapshotCount(): number {
	return loadSnapshots().length;
}

/**
 * Persistenter, monoton steigender Zähler für Default-Snapshot-Namen
 * („Auto #N", „Plan #N"). Vorher wurde `loadSnapshots().length + 1`
 * verwendet — nach dem FIFO-Cleanup (MAX_SNAPSHOTS) sank die Länge wieder
 * und neue Snapshots bekamen bereits vergebene Nummern (Audit A5).
 * Jeder Aufruf vergibt die nächste Nummer und persistiert den Stand.
 */
export function nextSnapshotNumber(): number {
	let current = 0;
	try {
		const raw = localStorage.getItem(COUNTER_KEY);
		const parsed = raw === null ? NaN : parseInt(raw, 10);
		if (Number.isFinite(parsed) && parsed > 0) current = parsed;
	} catch {
		// localStorage gesperrt — unten greift der Galerie-Fallback.
	}
	// Sanfte Migration / Fallback: nie hinter die bestehende Galerie
	// zurückfallen (Alt-Stände ohne Zähler-Key zählen ab Galerie-Größe).
	current = Math.max(current, loadSnapshots().length);
	const next = current + 1;
	try {
		localStorage.setItem(COUNTER_KEY, String(next));
	} catch {
		// Ohne Persistenz bleibt die Nummer für diesen Aufruf trotzdem gültig.
	}
	return next;
}
