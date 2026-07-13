// Feinschliff 2.0 (F2-S4): Zurücktauschen — ein einfacher Undo-Stapel
// über komplette Plan-Stände (placed[]).
//
// Session-lokal (kein localStorage): jeder ausgeführte Tauschvorschlag
// und jeder übernommene Mini-Solve-Lauf legt den VORHER-Stand ab;
// „↩ Zurücknehmen" stellt ihn Zug für Zug wieder her. Ein Plan-Stand
// sind ~150 kleine Objekte — tiefe Kopien sind billig. Das Auto-Backup-
// Snapshot (vor der ersten Änderung) bleibt als zweites Sicherheitsnetz
// über Reloads hinweg.

import type { PlacedLesson } from './types';

export interface UndoEntry {
	/** Was der Zug war — z. B. „Tausch M Mo P1 ⇄ D Mo P4". */
	label: string;
	/** Tiefe Kopie des Plan-Stands VOR dem Zug. */
	placedBefore: PlacedLesson[];
}

/** Maximale Stapel-Tiefe — schützt vor unbegrenztem Wachstum. */
export const UNDO_CAP = 30;

/**
 * Neuen Eintrag oben auflegen (immutable — gibt einen NEUEN Stapel
 * zurück, Svelte-$state-freundlich). Älteste Einträge fallen am Cap raus.
 */
export function pushUndo(
	stack: readonly UndoEntry[],
	label: string,
	placedBefore: readonly PlacedLesson[]
): UndoEntry[] {
	const entry: UndoEntry = {
		label,
		placedBefore: placedBefore.map(p => ({ ...p })),
	};
	return [...stack, entry].slice(-UNDO_CAP);
}

/**
 * Obersten Eintrag abnehmen. Gibt den restaurierbaren Stand (tiefe
 * Kopie) und den Rest-Stapel zurück; auf leerem Stapel `entry: null`.
 */
export function popUndo(stack: readonly UndoEntry[]): {
	entry: UndoEntry | null;
	rest: UndoEntry[];
} {
	if (stack.length === 0) return { entry: null, rest: [] };
	const top = stack[stack.length - 1];
	return {
		entry: { label: top.label, placedBefore: top.placedBefore.map(p => ({ ...p })) },
		rest: stack.slice(0, -1),
	};
}
