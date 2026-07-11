// Reactive store using Svelte 5 runes — Context-Pattern.
//
// We use `setContext`/`getContext` instead of `export const` to ensure each
// component subscribes through the official cross-component reactivity boundary.
// `export const` of `$state(...)` works in single-component apps but produces
// subtle reactivity gaps when nested mutations happen in async handlers (like
// our solver run in GenerateButton).

import { getContext, setContext } from 'svelte';
import { emptyDoc, SCHEMA_VERSION, type ScheduleDoc } from './types';
import { loadFromLocalStorage, saveToLocalStorage } from './persistence';

const KEY = Symbol('stundenplan-store');

export class ScheduleStore {
	doc = $state<ScheduleDoc>(loadFromLocalStorage() ?? emptyDoc());
	/**
	 * Audit A2b: true wenn der letzte Auto-Save fehlschlug (z. B. localStorage-
	 * Quota voll). App.svelte zeigt dann einen persistenten Warn-Banner —
	 * vorher arbeitete der User unwissend ohne Persistenz weiter.
	 */
	saveFailed = $state<boolean>(false);
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	persist() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.persistNow();
		}, 50);
	}

	persistNow() {
		const snapshot = $state.snapshot(this.doc) as ScheduleDoc;
		snapshot.meta = {
			schemaVersion: SCHEMA_VERSION,
			lastModified: new Date().toISOString()
		};
		this.saveFailed = !saveToLocalStorage(snapshot);
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

export function initStore(): ScheduleStore {
	const s = new ScheduleStore();
	setContext(KEY, s);
	// Auto-save on any nested mutation. Uses an effect root so it lives for the
	// whole app lifetime; explicit JSON.stringify forces a deep dependency read.
	//
	// Audit A5 — BEWUSST SO GELASSEN: Ja, das serialisiert das Doc doppelt
	// (einmal hier als Deep-Tracker, einmal in saveToLocalStorage). Der
	// JSON.stringify ist aber der einzige zuverlässige Weg, JEDE verschachtelte
	// Mutation (bind:value in Tabellenzellen, Array-Pushes im Solver-Apply)
	// als Dependency zu erfassen — jede "Optimierung" hier riskiert die
	// CLAUDE.md-Reactivity-Falle (Auto-Save-Lücken nach Tab-Wechseln).
	// Kosten real ~1-2 ms pro Mutation. Nicht anfassen.
	$effect.root(() => {
		$effect(() => {
			JSON.stringify(s.doc);
			s.persist();
		});
	});
	return s;
}

export function useStore(): ScheduleStore {
	const s = getContext<ScheduleStore>(KEY);
	if (!s) throw new Error('ScheduleStore not initialized — call initStore() in App.svelte');
	return s;
}
