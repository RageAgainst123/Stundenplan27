<script lang="ts">
	import { initStore } from './lib/store.svelte';
	const store = initStore();
	import TeacherList from './components/TeacherList.svelte';
	import SubjectList from './components/SubjectList.svelte';
	import SpecList from './components/SpecList.svelte';
	import ScheduleGrid from './components/ScheduleGrid.svelte';
	import RulesPanel from './components/RulesPanel.svelte';
	import ImportExport from './components/ImportExport.svelte';
	import WeekView from './components/WeekView.svelte';
	import FinetuneView from './components/FinetuneView.svelte';
	import ExportPanel from './components/ExportPanel.svelte';
	import { findPlanConflicts, removeConflictedPlacements } from './lib/plan-validation';

	type Tab = 'teachers' | 'subjects' | 'specs' | 'schedule' | 'finetune' | 'weekview' | 'rules' | 'import' | 'export';
	let active: Tab = $state('import');

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'import', label: 'Import / Export' },
		{ id: 'teachers', label: 'Lehrer' },
		{ id: 'subjects', label: 'Fächer' },
		{ id: 'specs', label: 'Lehreinheiten' },
		{ id: 'schedule', label: 'Stundenplan' },
		{ id: 'finetune', label: 'Feinschliff 🔧' },
		{ id: 'weekview', label: 'Wochenplan 📋' },
		{ id: 'export', label: 'Export 📊' },
		{ id: 'rules', label: 'Regeln' }
	];

	// Phase 17: globaler Konflikt-Detektor.
	// WICHTIG: $derived hätte hier bei jedem CSV-Import den UI-Thread blockiert,
	// weil findPlanConflicts O(placed²) durchläuft und bei jeder spec.push()-
	// Mutation synchron neu gerechnet würde. Wir verwenden $effect mit
	// requestIdleCallback/setTimeout-Debounce — UI bleibt responsive, der
	// Banner aktualisiert sich nach ~150ms statt blockierend bei jedem Push.
	let conflicts = $state<ReturnType<typeof findPlanConflicts>>([]);
	let conflictDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		// Touch reactive dependencies — sehr leicht, kein eigentliches Lesen.
		void store.doc.specs.length;
		void store.doc.placed.length;
		void store.doc.teachers.length;
		// Debounce: bei Bulk-Mutations (CSV-Import) feuert das hier 100× hintereinander.
		// Wir rechnen erst 150ms nach der LETZTEN Mutation.
		if (conflictDebounceTimer !== null) clearTimeout(conflictDebounceTimer);
		conflictDebounceTimer = setTimeout(() => {
			conflicts = findPlanConflicts(store.doc);
			conflictDebounceTimer = null;
		}, 150);
		return () => {
			if (conflictDebounceTimer !== null) {
				clearTimeout(conflictDebounceTimer);
				conflictDebounceTimer = null;
			}
		};
	});

	function autoCleanupConflicts(): void {
		// Vor dem Cleanup nochmal frisch berechnen — falls Banner-State stale ist.
		const fresh = findPlanConflicts(store.doc);
		const removed = removeConflictedPlacements(store.doc, fresh);
		if (removed > 0) {
			store.persistNow();
			conflicts = findPlanConflicts(store.doc); // refresh state
			alert(`${removed} konfliktverursachende Platzierungen entfernt. Gepinnte Stunden 🔒 bleiben erhalten.`);
		}
	}

	function conflictSummary(): string {
		if (conflicts.length === 0) return '';
		const teacherConflicts = conflicts.filter(c => c.reason === 'teacher-double').length;
		const gradeConflicts = conflicts.filter(c => c.reason === 'grade-double').length;
		const parts: string[] = [];
		if (teacherConflicts > 0) parts.push(`${teacherConflicts}× Lehrer doppelt belegt`);
		if (gradeConflicts > 0) parts.push(`${gradeConflicts}× Stufe doppelt belegt`);
		return parts.join(' · ');
	}
</script>

<header class="app-header">
	<h1>Stundenplancalc {store.doc.schoolYear}</h1>
	<input
		class="year"
		type="text"
		bind:value={store.doc.schoolYear}
		size="9"
		aria-label="Schuljahr"
	/>
	<div style="margin-left:auto; color: var(--text-muted); font-size: 12px;">
		{store.doc.teachers.length} Lehrer · {store.doc.subjects.length} Fächer · {store.doc.specs.length} Einheiten
	</div>
</header>

<nav class="tabs">
	{#each tabs as t (t.id)}
		<button type="button" class="tab" class:active={active === t.id} onclick={() => (active = t.id)}>
			{t.label}
		</button>
	{/each}
</nav>

{#if store.saveFailed}
	<div class="conflict-banner save-failed" role="alert">
		<span class="icon">💾</span>
		<span class="msg">
			<strong>Speichern fehlgeschlagen!</strong>
			Der Browser-Speicher konnte nicht beschrieben werden (vermutlich voll).
			Deine Änderungen gehen beim Schließen verloren —
			<strong>jetzt im Reiter Import/Export ein JSON-Backup exportieren</strong>
			und ggf. alte Plan-Snapshots löschen.
		</span>
		<button class="btn small" onclick={() => store.persistNow()} title="Speichern erneut versuchen">
			↻ Erneut versuchen
		</button>
	</div>
{/if}

{#if conflicts.length > 0}
	<div class="conflict-banner" role="alert">
		<span class="icon">⚠</span>
		<span class="msg">
			<strong>Konflikte im aktuellen Plan:</strong>
			{conflictSummary()}
			<small>Aufgetreten oft nach Stammdaten-Änderungen (z.B. Lehrer hinzugefügt). Klick auf den Stundenplan-Tab zeigt die Konflikte rot markiert.</small>
		</span>
		<button class="btn small" onclick={autoCleanupConflicts} title="Konfliktverursachende Platzierungen entfernen (gepinnte 🔒 bleiben)">
			🧹 Konflikte aufräumen
		</button>
	</div>
{/if}

<main class="tab-content">
	{#if active === 'import'}
		<ImportExport />
	{:else if active === 'teachers'}
		<TeacherList />
	{:else if active === 'subjects'}
		<SubjectList />
	{:else if active === 'specs'}
		<SpecList />
	{:else if active === 'schedule'}
		<ScheduleGrid />
	{:else if active === 'finetune'}
		<FinetuneView />
	{:else if active === 'weekview'}
		<WeekView />
	{:else if active === 'export'}
		<ExportPanel />
	{:else if active === 'rules'}
		<RulesPanel />
	{/if}
</main>
