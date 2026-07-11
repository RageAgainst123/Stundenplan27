// Shared UI types — used by Svelte components for drag-and-drop, state
// passing, and other plumbing that doesn't belong in the domain model
// (`types.ts`).
//
// Keep this file thin. Domain types live in `types.ts`; solver-internal
// types live in `solver-v2/types.ts`.

import type { Day, Period } from './types';

/**
 * Drag-payload for moving a `LessonSpec` (by id) between cells of the
 * schedule grid. `fromCell` is set when the drag originates from an
 * already-placed lesson — the drop handler removes that placement
 * before adding the new one. Sidebar drags (unplaced specs) leave it
 * undefined.
 */
export interface DragPayload {
	specId: string;
	fromCell?: { day: Day; period: Period };
}

/**
 * Audit A7 / Phase 18: Druckmodus des Wochenplans — eine A4-Seite pro
 * Lehrer ('teachers'), pro Schulstufe ('grades') oder der ganze Plan auf
 * einer Seite ('view'). `null` in der UI = normaler Vergleichsmodus.
 */
export type PrintMode = 'teachers' | 'grades' | 'view';
