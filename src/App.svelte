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
	import { findPlanConflicts, removeConflictedPlacements } from './lib/plan-validation';

	type Tab = 'teachers' | 'subjects' | 'specs' | 'schedule' | 'weekview' | 'rules' | 'import';
	let active: Tab = $state('import');

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'import', label: 'Import / Export' },
		{ id: 'teachers', label: 'Lehrer' },
		{ id: 'subjects', label: 'Fächer' },
		{ id: 'specs', label: 'Lehreinheiten' },
		{ id: 'schedule', label: 'Stundenplan' },
		{ id: 'weekview', label: 'Wochenplan 📋' },
		{ id: 'rules', label: 'Regeln' }
	];

	// Phase 17: globaler Konflikt-Detektor — läuft bei jeder Doc-Änderung.
	const conflicts = $derived.by(() => {
		// Touch reactive dependencies explizit
		void store.doc.specs.length;
		void store.doc.placed.length;
		return findPlanConflicts(store.doc);
	});

	function autoCleanupConflicts(): void {
		const removed = removeConflictedPlacements(store.doc, conflicts);
		if (removed > 0) {
			store.persistNow();
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
	{:else if active === 'weekview'}
		<WeekView />
	{:else if active === 'rules'}
		<RulesPanel />
	{/if}
</main>
