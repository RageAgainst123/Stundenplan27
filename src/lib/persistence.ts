// localStorage save/load + JSON file download/upload for backups.
// Includes forward-compatible migrations.

import { SCHEMA_VERSION, type ScheduleDoc, type LessonSpec, type Subject } from './types';

const STORAGE_KEY = 'stundenplan27.doc';

/**
 * Apply in-place migrations to a loaded doc. Runs on every load so that
 * older backups (or older localStorage state) get filled with defaults.
 *
 * Phase 7B migration: blocks that match the legacy default pattern
 * (= count singles, e.g. [1,1,1,1] for count=4) are interpreted as
 * "user never picked anything" and reset to undefined, which now means
 * "automatic — solver decides". Explicit non-default patterns like
 * [2,1] stay strict.
 */
export function migrateDoc(doc: ScheduleDoc): ScheduleDoc {
	for (const spec of doc.specs ?? []) {
		const s = spec as LessonSpec & { blocks?: number[]; includeInSolver?: boolean };
		if (Array.isArray(s.blocks) && s.blocks.length > 0) {
			const isLegacyAllSingles = s.blocks.every(n => n === 1) && s.blocks.length === Math.round(s.count);
			if (isLegacyAllSingles) {
				// Legacy default — was implicit, now means "auto mode"
				s.blocks = undefined;
			}
			// else: explicit pattern, keep
		} else if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
			s.blocks = undefined;
		}
		if (typeof s.includeInSolver !== 'boolean') {
			s.includeInSolver = true;
		}
	}
	for (const subject of doc.subjects ?? []) {
		const sub = subject as Subject & { maxConsecutive?: number };
		if (typeof sub.maxConsecutive !== 'number') {
			sub.maxConsecutive = sub.isMain ? 2 : 99;
		}
	}
	return doc;
}

export function saveToLocalStorage(doc: ScheduleDoc): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
	} catch (e) {
		console.warn('localStorage save failed', e);
	}
}

export function loadFromLocalStorage(): ScheduleDoc | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as ScheduleDoc;
		if (parsed?.meta?.schemaVersion !== SCHEMA_VERSION) {
			console.warn(
				`Schema version mismatch (found ${parsed?.meta?.schemaVersion}, expected ${SCHEMA_VERSION}). Loaded as-is.`
			);
		}
		return migrateDoc(parsed);
	} catch (e) {
		console.warn('localStorage load failed', e);
		return null;
	}
}

export function clearLocalStorage(): void {
	localStorage.removeItem(STORAGE_KEY);
}

export function downloadAsJson(doc: ScheduleDoc, filename?: string): void {
	const safeYear = doc.schoolYear.replace(/[/\\: ]/g, '-');
	const name = filename ?? `stundenplan-${safeYear}.json`;
	const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<ScheduleDoc> {
	const text = await file.text();
	const parsed = JSON.parse(text) as ScheduleDoc;
	if (!parsed?.meta || parsed.meta.schemaVersion !== SCHEMA_VERSION) {
		throw new Error(
			`Inkompatibles Schema (gefunden: ${parsed?.meta?.schemaVersion ?? 'unbekannt'}, erwartet: ${SCHEMA_VERSION})`
		);
	}
	return migrateDoc(parsed);
}
