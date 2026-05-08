<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES, type Day, type GradeLevel, type LessonSpec, type Period } from '../lib/types';
	import { unplacedSpecs, checkPlacementConflict } from '../lib/schedule-helpers';
	import { findCurrentPeriod, currentWeekParity } from '../lib/now';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DragDropState } from '@thisux/sveltednd';
	import LessonCell from './LessonCell.svelte';
	import ScheduleCell from './ScheduleCell.svelte';
	import GenerateButton from './GenerateButton.svelte';

	// ---- Filter state ----
	let selectedTeachers = $state<Set<string>>(new Set());
	let selectedGrades = $state<Set<GradeLevel>>(new Set());
	let selectedSubject = $state<string>('');
	let showAll = $derived(selectedTeachers.size === 0 && selectedGrades.size === 0 && !selectedSubject);

	function toggleTeacher(id: string) {
		if (selectedTeachers.has(id)) selectedTeachers.delete(id);
		else selectedTeachers.add(id);
		selectedTeachers = new Set(selectedTeachers);
	}
	function toggleGrade(g: GradeLevel) {
		if (selectedGrades.has(g)) selectedGrades.delete(g);
		else selectedGrades.add(g);
		selectedGrades = new Set(selectedGrades);
	}
	function clearFilters() {
		selectedTeachers.clear();
		selectedGrades.clear();
		selectedSubject = '';
		selectedTeachers = new Set();
		selectedGrades = new Set();
	}

	function isHighlighted(spec: LessonSpec, gradeOfCell: GradeLevel): boolean {
		if (showAll) return true;
		if (selectedTeachers.size > 0 && !selectedTeachers.has(spec.teacher)) return false;
		if (selectedSubject && spec.subject !== selectedSubject) return false;
		if (selectedGrades.size > 0 && !selectedGrades.has(gradeOfCell)) return false;
		return true;
	}

	// ---- Now / week ----
	let nowState = $state(findCurrentPeriod());
	$effect(() => {
		const id = setInterval(() => (nowState = findCurrentPeriod()), 60_000);
		return () => clearInterval(id);
	});
	const weekInfo = $derived(currentWeekParity());

	// ---- Sidebar: unplaced ----
	const unplaced = $derived.by(() => {
		// Touch reactive dependencies explicitly so the derived re-runs on changes.
		void store.doc.placed.length;
		void store.doc.specs.length;
		return unplacedSpecs(store.doc);
	});

	// (Cell rendering moved to ScheduleCell.svelte for proper Svelte 5 reactivity scoping.)

	// ---- Drag & Drop ----
	interface DragPayload {
		specId: string;
		fromCell?: { day: Day; period: Period };
	}

	let dragHoverConflict = $state<{ day: Day; period: Period; reasons: string[] } | null>(null);

	function handleDropToSidebar(state: DragDropState<DragPayload>) {
		const { specId, fromCell } = state.draggedItem;
		if (!fromCell) return;
		// remove placement at fromCell
		store.doc.placed = store.doc.placed.filter(
			p => !(p.specId === specId && p.day === fromCell.day && p.period === fromCell.period)
		);
		dragHoverConflict = null;
	}

	function handleDropToCell(day: Day, period: Period, state: DragDropState<DragPayload>) {
		const { specId, fromCell } = state.draggedItem;
		const spec = store.doc.specs.find(s => s.id === specId);
		if (!spec) return;
		const conflict = checkPlacementConflict(store.doc, spec, day, period, fromCell ? specId : undefined);
		if (conflict.hasConflict) {
			alert('Kann hier nicht platziert werden:\n' + conflict.reasons.join('\n'));
			return;
		}
		// remove from old cell if move
		if (fromCell) {
			store.doc.placed = store.doc.placed.filter(
				p => !(p.specId === specId && p.day === fromCell.day && p.period === fromCell.period)
			);
		}
		store.doc.placed.push({ specId, day, period, pinned: true });
		dragHoverConflict = null;
	}

	function togglePin(specId: string, day: Day, period: Period) {
		const p = store.doc.placed.find(x => x.specId === specId && x.day === day && x.period === period);
		if (p) p.pinned = !p.pinned;
	}

	function removePlacement(specId: string, day: Day, period: Period) {
		store.doc.placed = store.doc.placed.filter(
			p => !(p.specId === specId && p.day === day && p.period === period)
		);
	}

	function teacherById(id: string) {
		return store.doc.teachers.find(t => t.id === id);
	}

	// Probe a cell for live conflict highlighting while dragging
	function probeConflict(day: Day, period: Period, draggedSpecId: string | undefined): string[] {
		if (!draggedSpecId) return [];
		const spec = store.doc.specs.find(s => s.id === draggedSpecId);
		if (!spec) return [];
		return checkPlacementConflict(store.doc, spec, day, period).reasons;
	}
</script>

<section class="filter-bar">
	<button class="btn" class:primary={showAll} onclick={clearFilters}>Alle anzeigen</button>
	<span class="sep"></span>
	<div class="chips">
		{#each store.doc.teachers as t (t.id)}
			<button
				class="chip"
				class:on={selectedTeachers.has(t.id)}
				style:--c={t.color}
				style:background={selectedTeachers.has(t.id) ? t.color : `color-mix(in srgb, ${t.color} 25%, white)`}
				onclick={() => toggleTeacher(t.id)}
				title={t.name}
			>
				{t.name.split(' ')[0]} <span class="num">L{t.shortNumber}</span>
			</button>
		{/each}
	</div>
	<span class="sep"></span>
	<div class="chips">
		{#each GRADES as g}
			<button class="chip grade" class:on={selectedGrades.has(g)} onclick={() => toggleGrade(g)}>
				{g}. SSt.
			</button>
		{/each}
	</div>
	<select bind:value={selectedSubject} class="subject-select">
		<option value="">Alle Fächer</option>
		{#each store.doc.subjects as s}<option value={s.code}>{s.code} – {s.name}</option>{/each}
	</select>
	<span class="sep"></span>
	<span class="week-info" class:even={weekInfo.parity === 'even'}>
		KW {weekInfo.week} · <strong>{weekInfo.parity === 'even' ? 'G' : 'U'}</strong>
	</span>
	<span class="sep"></span>
	<GenerateButton />
</section>

<div class="layout">
	<aside
		class="sidebar"
		use:droppable={{
			container: 'sidebar',
			callbacks: { onDrop: handleDropToSidebar }
		}}
	>
		<h3>Ungeplant ({unplaced.length})</h3>
		{#if unplaced.length === 0}
			<p class="muted small">Alle Lehreinheiten sind platziert.</p>
		{:else}
			<div class="unplaced-list">
				{#each unplaced as { spec, remaining } (spec.id)}
					{@const t = teacherById(spec.teacher)}
					<div
						class="unplaced-item"
						use:draggable={{
							container: 'sidebar',
							dragData: { specId: spec.id } as DragPayload
						}}
						style:--c={t?.color ?? '#9ca3af'}
					>
						<div class="row1">
							<span class="subj">{spec.subject}</span>
							<span class="rem">×{remaining}</span>
						</div>
						<div class="row2">
							<span class="t-name">{t?.name ?? '?'}</span>
							<span class="grades">{spec.grades.join('+')}</span>
						</div>
						{#if spec.weekPattern !== 'every'}
							<span class="week-tag">{spec.weekPattern === 'even' ? 'G' : 'U'}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</aside>

	<div class="grid-wrap">
		<table class="schedule">
			<thead>
				<tr>
					<th class="time-col"></th>
					{#each DAYS as d, dayIdx}
						<th class="day-head" colspan="4">{d}</th>
						{#if dayIdx < DAYS.length - 1}<th class="day-gap"></th>{/if}
					{/each}
				</tr>
				<tr>
					<th class="time-col"></th>
					{#each DAYS as d, dayIdx}
						{#each GRADES as g}
							<th class="grade-head">{g}.</th>
						{/each}
						{#if dayIdx < DAYS.length - 1}<th class="day-gap"></th>{/if}
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each PERIODS as period, pIdx}
					<tr>
						<th class="time-col time-cell" class:now={nowState.period === period}>
							<span class="period-num">{period}.</span>
							<span class="period-time">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
						</th>
						{#each DAYS as day, dayIdx}
								{#each GRADES as grade}
									<ScheduleCell
										day={day}
										period={period}
										grade={grade}
										isNow={nowState.day === day && nowState.period === period}
										isHighlighted={isHighlighted}
										weekParity={weekInfo.parity}
										teacherById={teacherById}
									/>
								{/each}
							{#if dayIdx < DAYS.length - 1}<td class="day-gap"></td>{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-bottom: 14px;
	}
	.sep {
		width: 1px;
		height: 22px;
		background: var(--border);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		border: 1px solid var(--border-strong);
		background: var(--bg-panel);
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.chip.on {
		color: white;
		border-color: var(--c, var(--accent));
		font-weight: 700;
	}
	.chip .num {
		opacity: 0.7;
		font-size: 10px;
		margin-left: 4px;
	}
	.chip.grade {
		font-family: var(--mono);
	}
	.chip.grade.on {
		background: var(--accent) !important;
		color: white;
		border-color: var(--accent);
	}
	.subject-select {
		padding: 4px 8px;
		font-size: 13px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.week-info {
		font-size: 12px;
		padding: 4px 10px;
		background: var(--bg-soft);
		border-radius: 6px;
		font-family: var(--mono);
	}
	.week-info.even strong {
		color: var(--accent);
	}
	.layout {
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 14px;
	}
	.sidebar {
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 12px;
		max-height: 80vh;
		overflow: auto;
	}
	.sidebar h3 {
		font-size: 13px;
		margin-bottom: 8px;
		text-transform: uppercase;
		color: var(--text-muted);
		letter-spacing: 0.04em;
	}
	.unplaced-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.unplaced-item {
		position: relative;
		padding: 6px 8px;
		background: var(--bg-soft);
		border-left: 4px solid var(--c, var(--accent));
		border-radius: 4px;
		cursor: grab;
		font-size: 12px;
	}
	.unplaced-item:active {
		cursor: grabbing;
	}
	.unplaced-item .row1 {
		display: flex;
		justify-content: space-between;
		font-weight: 700;
	}
	.unplaced-item .row2 {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--text-muted);
	}
	.unplaced-item .week-tag {
		position: absolute;
		top: 4px;
		right: 28px;
		background: var(--accent);
		color: white;
		border-radius: 3px;
		padding: 0 4px;
		font-size: 10px;
		font-weight: 700;
	}
	.grid-wrap {
		overflow: auto;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px;
	}
	table.schedule {
		border-collapse: collapse;
		width: 100%;
	}
	.schedule th,
	.schedule td {
		border: 1px solid var(--border);
		padding: 0;
		font-size: 11px;
	}
	.schedule .time-col {
		width: 64px;
		min-width: 64px;
		background: var(--bg-soft);
		text-align: center;
		padding: 6px 4px;
	}
	.time-cell {
		display: flex;
		flex-direction: column;
		font-family: var(--mono);
	}
	.time-cell .period-num {
		font-weight: 700;
	}
	.time-cell .period-time {
		font-size: 10px;
		color: var(--text-muted);
	}
	.day-head {
		text-align: center;
		padding: 6px;
		background: var(--bg-soft);
		font-weight: 700;
	}
	.grade-head {
		text-align: center;
		padding: 4px 0;
		background: var(--bg-soft);
		font-weight: 600;
		font-size: 11px;
		color: var(--text-muted);
		min-width: 70px;
	}
	.day-gap {
		width: 10px;
		background: transparent !important;
		border: 0 !important;
	}
	:global(.drag-over) {
		background: var(--accent-bg) !important;
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.muted.small {
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
