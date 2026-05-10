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
</script>

<header class="app-header">
	<h1>MS SiG – Stundenplan {store.doc.schoolYear}</h1>
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
