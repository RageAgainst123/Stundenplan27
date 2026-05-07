// Reactive store using Svelte 5 runes. Auto-persists to localStorage on change.
// We use a debounced setTimeout (not $effect) for persistence so that mutations
// inside async/await chains in component code reliably trigger a save without
// fighting Svelte's reactive scheduling.

import { emptyDoc, SCHEMA_VERSION, type ScheduleDoc } from './types';
import { loadFromLocalStorage, saveToLocalStorage } from './persistence';

class ScheduleStore {
	doc = $state<ScheduleDoc>(loadFromLocalStorage() ?? emptyDoc());
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	persist() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			const snapshot = $state.snapshot(this.doc) as ScheduleDoc;
			snapshot.meta = {
				schemaVersion: SCHEMA_VERSION,
				lastModified: new Date().toISOString()
			};
			saveToLocalStorage(snapshot);
		}, 50);
	}

	persistNow() {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const snapshot = $state.snapshot(this.doc) as ScheduleDoc;
		snapshot.meta = {
			schemaVersion: SCHEMA_VERSION,
			lastModified: new Date().toISOString()
		};
		saveToLocalStorage(snapshot);
	}

	reset(schoolYear?: string) {
		this.doc = emptyDoc(schoolYear ?? this.doc.schoolYear);
		this.persistNow();
	}

	replace(next: ScheduleDoc) {
		this.doc = next;
		this.persistNow();
	}
}

export const store = new ScheduleStore();
