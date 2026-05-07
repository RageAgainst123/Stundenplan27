// localStorage save/load + JSON file download/upload for backups.
import { SCHEMA_VERSION, type ScheduleDoc } from './types';

const STORAGE_KEY = 'stundenplan27.doc';

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
		return parsed;
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
	return parsed;
}
