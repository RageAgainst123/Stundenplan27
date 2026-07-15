// Audit C-5 (2026-07): kleine Format-Helpers, vorher an 2-5 Stellen
// inline dupliziert (Backup-Namen, Datei-Timestamps, Hex-Farbkanäle).

/** Uhrzeit-Label für Backup-/Snapshot-Namen, z. B. „14:30:05". */
export function timeLabel(date = new Date()): string {
	return date.toLocaleTimeString('de-AT');
}

/**
 * Dateiname-tauglicher Zeitstempel: ISO ohne `:` und `.`
 * (z. B. „2026-07-15T09-30-05-123Z").
 */
export function fileTimestamp(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

/** Ein Farbkanal (0-255) als zweistelliges Hex, klein geschrieben. */
export function hexByte(n: number): string {
	return n.toString(16).padStart(2, '0');
}
