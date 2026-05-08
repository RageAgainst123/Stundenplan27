// localStorage save/load + JSON file download/upload for backups.
// Includes a forward-compatible migration that fills in defaults for fields
// added after the initial schema (blocks, includeInSolver, maxConsecutive).

import { SCHEMA_VERSION, type ScheduleDoc, type LessonSpec, type Subject } from './types';
import { DEFAULT_BLOCK } from './blocks';

const STORAGE_KEY = 'stundenplan27.doc';

/**
 * Apply in-place migrations to a loaded doc. Runs on every load so that
 * older backups (or older localStorage state) get filled with defaults.
 */
export function migrateDoc(doc: ScheduleDoc): ScheduleDoc {
	for (const spec of doc.specs ?? []) {
		const s = spec as LessonSpec & { blocks?: number[]; includeInSolver?: boolean };
		if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
			s.blocks = DEFAULT_BLOCK(s.count);
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
