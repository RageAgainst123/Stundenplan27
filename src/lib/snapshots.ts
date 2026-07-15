// Phase 15: Plan-Snapshot-Galerie. SN2 (2026-07): Backup/Plan-Trennung.
//
// Konzept: Plan-Stände werden in localStorage konserviert (Key
// `stundenplan27.snapshots`). User kann sie wiederherstellen, von ihnen
// aus diversifizieren, pinnen, umbenennen oder löschen.
//
// Zwei getrennte Gruppen mit EIGENEN Limits (SN2):
//  - Pläne   (source 'manual' | 'auto'): bewusst gespeicherte Stände +
//    Auto-Snapshots bei >= 5% Score-Improvement. Limit MAX_PLANS.
//  - Backups (source 'backup'): Sicherheitsnetze vor Restore/Diversify/
//    Feinschliff/Plan-Import. Kurzlebiger Ring, Limit MAX_BACKUPS.
// Vorher teilten sich beide EIN 10er-FIFO — die Backup-Flut aus einer
// Arbeitssitzung verdrängte dabei manuell gespeicherte Best-Pläne.
//
// Gepinnte Snapshots (pinned=true) werden NIE automatisch verdrängt,
// weder vom Gruppen-Limit noch vom Quota-Notfall-Cleanup.
//
// Snapshots sind separat vom Plan-Doc — sie überleben ein Doc-Reset.
// Im JSON-Export sind sie seit SN2 OPTIONAL enthalten (Checkbox).

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
/** Limit für Pläne (manual + auto). ~15-20 KB pro Snapshot → 30 sind unkritisch. */
export const MAX_PLANS = 30;
/** Limit für den Backup-Ring (Sicherheitsnetze „Backup vor …"). */
export const MAX_BACKUPS = 5;

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
	/** R3-S5: Max-in-Folge pro Fach überschritten. */
	subject_run?: number;
	total: number;
}

/**
 * SN2: 'backup' = Sicherheitsnetz („Backup vor …"), eigener Ring.
 * 'manual'/'auto' = echte Pläne (User-Save bzw. ≥5%-Improvement-Auto).
 */
export type SnapshotSource = 'auto' | 'manual' | 'backup';

export interface Snapshot {
	id: string;            // UUID
	name: string;          // "Plan #1" oder User-gewählt
	score: number;         // niedriger = besser
	placed: PlacedLesson[];
	scoreBreakdown?: SnapshotScoreBreakdown;
	createdAt: string;     // ISO-Timestamp
	source: SnapshotSource;
	/** SN2: Gepinnt = nie automatisch verdrängt (Limit- UND Quota-Cleanup). */
	pinned?: boolean;
}

/** Gruppen-Zuordnung: Backups vs. Pläne (manual + auto). */
export function isBackupSnapshot(s: Pick<Snapshot, 'source'>): boolean {
	return s.source === 'backup';
}

/**
 * Audit C-4: Name des window-Events, mit dem UI-Teile über Snapshot-
 * Änderungen informiert werden — vorher ein Magic-String an 11 Stellen.
 */
export const SNAPSHOTS_CHANGED_EVENT = 'snapshots-changed';

/** Snapshot-Änderung an alle UI-Listener melden (no-op ohne window). */
export function notifySnapshotsChanged(): void {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(SNAPSHOTS_CHANGED_EVENT));
	}
}

/** Strukturelle Mindest-Prüfung eines (fremden) Snapshot-Eintrags. */
export function isValidSnapshot(s: unknown): s is Snapshot {
	return (
		typeof s === 'object' && s !== null &&
		typeof (s as Snapshot).id === 'string' &&
		typeof (s as Snapshot).name === 'string' &&
		typeof (s as Snapshot).score === 'number' &&
		Array.isArray((s as Snapshot).placed) &&
		typeof (s as Snapshot).createdAt === 'string'
	);
}

/**
 * SN2-Migration (in-place, idempotent): Alt-Bestände kannten nur
 * 'auto'/'manual' — Sicherheitsnetze hießen „Backup vor …" mit
 * source 'auto'. Die wandern in die Backup-Gruppe, damit sie echte
 * Pläne nicht mehr verdrängen. Unbekannte source-Werte → 'manual'
 * (konservativ: lieber als Plan behalten als als Backup rotieren).
 */
function migrateSnapshot(s: Snapshot): Snapshot {
	if (s.source !== 'auto' && s.source !== 'manual' && s.source !== 'backup') {
		s.source = 'manual';
	}
	if (s.source === 'auto' && s.name.startsWith('Backup vor ')) {
		s.source = 'backup';
	}
	if (typeof s.pinned !== 'boolean') s.pinned = false;
	return s;
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
		return parsed.filter(isValidSnapshot).map(migrateSnapshot);
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

/** Ältester (createdAt) Eintrag der auf `match` passt, oder undefined. */
function oldestIndexWhere(list: Snapshot[], match: (s: Snapshot) => boolean): number | undefined {
	return list
		.map((s, i) => ({ s, i }))
		.filter(x => match(x.s))
		.sort((a, b) => a.s.createdAt.localeCompare(b.s.createdAt))[0]?.i;
}

/** Schreibe alle Snapshots nach localStorage. */
function writeSnapshots(snapshots: Snapshot[]): void {
	// Absturz-Härtung: bei Quota-Fehlern (localStorage voll) erneut
	// versuchen und dabei opfern in dieser Reihenfolge: älteste ungepinnte
	// BACKUPS zuerst, dann älteste ungepinnte AUTO-Pläne. Manuelle und
	// gepinnte Snapshots werden nie angerührt — dann lieber der Save-Warn.
	const work = [...snapshots];
	for (;;) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(work));
			return;
		} catch (e) {
			const victimIdx =
				oldestIndexWhere(work, s => s.source === 'backup' && !s.pinned) ??
				oldestIndexWhere(work, s => s.source === 'auto' && !s.pinned);
			if (victimIdx === undefined || work.length === 0) {
				console.warn('Snapshot-Speichern fehlgeschlagen (auch nach Cleanup)', e);
				return;
			}
			work.splice(victimIdx, 1);
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
 * SN2: Gruppen-Limit durchsetzen — entfernt so lange den ÄLTESTEN
 * UNGEPINNTEN Eintrag der Gruppe, bis das Limit hält. Sind nur noch
 * gepinnte übrig, wird das Limit weich überschritten (Platz ist da;
 * ein Pin ist ein Versprechen, nichts wegzuwerfen). `protectId` nimmt
 * den GERADE gespeicherten Eintrag vom Cleanup aus — sonst würde ein
 * neuer Save sich selbst verdrängen, wenn alles andere gepinnt ist.
 */
function trimGroup(list: Snapshot[], group: 'plan' | 'backup', protectId?: string): void {
	const inGroup = (s: Snapshot) => isBackupSnapshot(s) === (group === 'backup');
	const limit = group === 'backup' ? MAX_BACKUPS : MAX_PLANS;
	for (;;) {
		if (list.filter(inGroup).length <= limit) return;
		const victimIdx = oldestIndexWhere(list, s => inGroup(s) && !s.pinned && s.id !== protectId);
		if (victimIdx === undefined) return;
		list.splice(victimIdx, 1);
	}
}

/**
 * Speichere ein neues Snapshot. SN2: Limit gilt PRO GRUPPE (Pläne vs.
 * Backups) — ein Backup kann nie einen Plan verdrängen und umgekehrt.
 * Gepinnte Einträge werden nie entfernt. Returnt das gespeicherte
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
	trimGroup(existing, isBackupSnapshot(snap) ? 'backup' : 'plan', snap.id);
	writeSnapshots(existing);
	return snap;
}

/** SN2: Pin setzen/lösen — gepinnte Snapshots überleben jedes Auto-Cleanup. */
export function setSnapshotPinned(id: string, pinned: boolean): void {
	const existing = loadSnapshots();
	const s = existing.find(x => x.id === id);
	if (!s) return;
	s.pinned = pinned;
	writeSnapshots(existing);
}

/** SN2: Snapshot umbenennen (leerer Name wird ignoriert). */
export function renameSnapshot(id: string, name: string): void {
	const trimmed = name.trim();
	if (!trimmed) return;
	const existing = loadSnapshots();
	const s = existing.find(x => x.id === id);
	if (!s) return;
	s.name = trimmed;
	writeSnapshots(existing);
}

/**
 * SN2: Snapshots aus einem JSON-Backup einspielen. Merge per id —
 * bereits vorhandene bleiben unangetastet, ungültige Einträge werden
 * übersprungen. Danach greifen die normalen Gruppen-Limits.
 * Returnt die Anzahl neu übernommener Snapshots.
 */
export function importSnapshots(incoming: unknown[]): number {
	const existing = loadSnapshots();
	const knownIds = new Set(existing.map(s => s.id));
	let added = 0;
	for (const raw of incoming) {
		if (!isValidSnapshot(raw)) continue;
		const snap = migrateSnapshot({
			...raw,
			placed: raw.placed.map(p => ({ ...p })),
			scoreBreakdown: raw.scoreBreakdown ? { ...raw.scoreBreakdown } : undefined
		});
		if (knownIds.has(snap.id)) continue;
		knownIds.add(snap.id);
		existing.push(snap);
		added++;
	}
	if (added > 0) {
		trimGroup(existing, 'plan');
		trimGroup(existing, 'backup');
		writeSnapshots(existing);
	}
	return added;
}

/**
 * SN2: Sind zwei Plan-Stände inhaltlich identisch? Reihenfolge- und
 * Pin-unabhängig (Pinnen ändert den Stundenplan nicht). Grundlage für
 * das „= aktueller Plan"-Badge in Galerie und Wochenplan.
 */
export function samePlacements(a: PlacedLesson[], b: PlacedLesson[]): boolean {
	if (a.length !== b.length) return false;
	const key = (p: PlacedLesson) => `${p.specId}|${p.day}|${p.period}|${p.grade}`;
	const as = a.map(key).sort();
	const bs = b.map(key).sort();
	return as.every((k, i) => k === bs[i]);
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
 * verwendet — nach dem FIFO-Cleanup (Gruppen-Limit) sank die Länge wieder
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
