// Audit C-4 (2026-07): DER eine Weg, ein Sicherheits-Backup des aktuellen
// Plans anzulegen. Vorher war derselbe Block 4× inline kopiert
// (FinetuneView 2×, ScheduleGrid, WeekView) + 1× als lokaler Helper in
// GenerateButton — und driftete bereits: die Inline-Kopien speicherten
// kein scoreBreakdown, WeekView dispatchte das Änderungs-Event ohne
// window-Guard und auch dann, wenn gar kein Backup entstand.
//
// Eigenes Modul (nicht snapshots.ts), weil das ehrliche Scoring
// scorePlacedPlan → solver-v2 hereinzieht; snapshots.ts bleibt reine
// Storage-Schicht ohne Solver-Abhängigkeit.

import type { ScheduleDoc } from './types';
import { saveSnapshot, notifySnapshotsChanged, type Snapshot } from './snapshots';
import { scorePlacedPlan } from './quality';
import { timeLabel } from './format';

/**
 * Backup-Snapshot des aktuellen Plans (source 'backup', eigener Ring,
 * verdrängt nie Pläne). Scored den IST-Stand lokal (inkl. Breakdown für
 * die Galerie) und benachrichtigt die UI. Leerer Plan → null, kein Event.
 */
export function createBackupSnapshot(doc: ScheduleDoc, label: string): Snapshot | null {
	if (doc.placed.length === 0) return null;
	const breakdown = scorePlacedPlan(doc);
	const snap = saveSnapshot({
		name: `${label} ${timeLabel()}`,
		score: Math.round(breakdown.total),
		placed: doc.placed.map(p => ({ ...p })),
		scoreBreakdown: breakdown as unknown as Snapshot['scoreBreakdown'],
		source: 'backup',
	});
	notifySnapshotsChanged();
	return snap;
}
