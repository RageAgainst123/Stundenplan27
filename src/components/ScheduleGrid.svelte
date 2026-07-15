<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES, type GradeLevel, type LessonSpec } from '../lib/types';
	import type { DragPayload } from '../lib/types-ui';
	import { teacherById as teacherByIdH } from '../lib/teacher-helpers';
	import { unplacedSpecs } from '../lib/schedule-helpers';
	import { buildScheduleExport } from '../lib/schedule-export';
	import { mapScheduleImport, parseScheduleExport } from '../lib/schedule-import';
	import { createBackupSnapshot } from '../lib/backup';
	import { FALLBACK_TEACHER_COLOR } from '../lib/teacher-helpers';
	import { fileTimestamp } from '../lib/format';
	import { findCurrentPeriod, currentWeekParity } from '../lib/now';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DragDropState } from '@thisux/sveltednd';
	import ScheduleCell from './ScheduleCell.svelte';
	import GenerateButton from './GenerateButton.svelte';

	// ---- Filter state ----
	let selectedTeachers = $state<Set<string>>(new Set());
	let selectedGrades = $state<Set<GradeLevel>>(new Set());
	let selectedSubject = $state<string>('');
	let showAll = $derived(selectedTeachers.size === 0 && selectedGrades.size === 0 && !selectedSubject);

	// ---- Planungswerkzeuge ein-/ausklappbar (Fach-Filter, KW, Generator,
	// Snapshots, Export) — Zustand überlebt Reloads via localStorage.
	// WICHTIG: Der Inhalt wird per CSS versteckt (display:none), NICHT per
	// {#if} unmountet — sonst würde eine laufende Solver-Session beim
	// Zuklappen verwaisen (GenerateButton hält den Session-State lokal).
	const TOOLS_OPEN_KEY = 'stundenplan27.ui.toolsOpen';
	let toolsOpen = $state<boolean>(
		typeof localStorage === 'undefined' || localStorage.getItem(TOOLS_OPEN_KEY) !== '0'
	);
	function toggleTools() {
		toolsOpen = !toolsOpen;
		try {
			localStorage.setItem(TOOLS_OPEN_KEY, toolsOpen ? '1' : '0');
		} catch {
			// localStorage voll/gesperrt — Toggle funktioniert trotzdem, nur ohne Persistenz.
		}
	}

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
		if (selectedTeachers.size > 0 && !spec.teachers.some(t => selectedTeachers.has(t))) return false;
		if (selectedSubject && spec.subject !== selectedSubject) return false;
		if (selectedGrades.size > 0) {
			// Multi-Grade-Specs: matched wenn EINE der Spec-Stufen im Filter ist
			// (sonst wird REL (5+6) bei Filter "6. SSt." nicht gehighlightet weil
			// die Zelle zur Anzeige in Spalte 5 gerendert wird).
			const matchByGrades = spec.grades.length > 0
				? spec.grades.some(g => selectedGrades.has(g))
				: selectedGrades.has(gradeOfCell);
			if (!matchByGrades) return false;
		}
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
	// Die Zellen-Interaktion (Drop in Zelle, Pin, Entfernen, Live-Konflikt)
	// lebt komplett in ScheduleCell.svelte — hier nur der Drop ZURÜCK in
	// die Sidebar (Stunde entplanen).
	function handleDropToSidebar(state: DragDropState<DragPayload>) {
		const { specId, fromCell } = state.draggedItem;
		if (!fromCell) return;
		// Remove ALL grade-rows of this spec at the source slot (multi-grade
		// specs occupy spec.grades.length rows simultaneously).
		store.doc.placed = store.doc.placed.filter(
			p => !(p.specId === specId && p.day === fromCell.day && p.period === fromCell.period)
		);
	}

	const teacherById = (id: string) => teacherByIdH(store.doc, id);

	/**
	 * Phase 18: Stundenplan exportieren als JSON.
	 * Enthält Tag, Stunde, Stufe, Lehrer (Name+Farbe), Team-Teaching-Info,
	 * Subject-Name. Denormalisierte byDay-View für direkte Anzeige.
	 */
	function exportSchedule(): void {
		const data = buildScheduleExport(store.doc);
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: 'application/json;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const ts = fileTimestamp();
		a.download = `stundenplan-${ts}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Plan-Import: liest eine mit „Plan exportieren" erzeugte Datei wieder
	 * ein. Matcht kaskadiert (Teacher-ID → Name), funktioniert also auch
	 * nach frischem Stammdaten-Import mit neuen UUIDs — der Rettungsweg
	 * nach einem localStorage-Verlust.
	 */
	async function importScheduleFile(ev: Event): Promise<void> {
		const input = ev.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // gleicher Dateiname erneut wählbar
		if (!file) return;
		const text = await file.text();
		const entries = parseScheduleExport(text);
		if (!entries) {
			alert(
				'Diese Datei ist kein Plan-Export.\n\n' +
				'Erwartet wird eine mit „📤 Plan exportieren" erzeugte Datei ' +
				'(stundenplan-….json mit "placements"). Komplett-Backups gehören ' +
				'in den Reiter Import/Export („JSON laden…").'
			);
			return;
		}
		const result = mapScheduleImport(store.doc, entries);
		if (result.placed.length === 0) {
			alert(
				'Keine der Stunden konnte den aktuellen Lehreinheiten zugeordnet werden.\n' +
				'Passen die Stammdaten (Fächer, Lehrer) zu diesem Export?'
			);
			return;
		}
		const skippedInfo = result.skipped.length > 0
			? `\n\n⚠ ${result.skipped.length} Einträge nicht zuordenbar (werden übersprungen):\n` +
				result.skipped.slice(0, 8).map(s => `• ${s.subject} ${s.day} P${s.period} (${s.grade}. SSt.)`).join('\n') +
				(result.skipped.length > 8 ? `\n… und ${result.skipped.length - 8} weitere` : '')
			: '';
		const ok = confirm(
			`Plan importieren: ${result.matched} von ${result.total} Stunden zuordenbar.${skippedInfo}\n\n` +
			(store.doc.placed.length > 0
				? `Der aktuelle Plan (${store.doc.placed.length} Stunden) wird ersetzt — vorher wird automatisch ein Backup-Snapshot gespeichert.`
				: 'Der Plan wird eingespielt.')
		);
		if (!ok) return;
		createBackupSnapshot(store.doc, 'Backup vor Plan-Import');
		store.doc.placed = result.placed;
		store.persistNow();
	}

	/** Verwirft die nicht-gepinnten Stunden und behält alle 🔒 Pins.
	 *  Standard-Aktion: trifft den häufigen Fall "neu generieren mit
	 *  meinen Vorgaben". */
	function resetUnpinned() {
		const total = store.doc.placed.length;
		if (total === 0) return;
		const removable = store.doc.placed.filter(p => !p.pinned).length;
		const pinnedCount = total - removable;
		if (removable === 0) {
			alert(`Es gibt nichts zu verwerfen — alle ${total} Stunden sind gepinnt.`);
			return;
		}
		const msg = pinnedCount > 0
			? `${removable} nicht-gepinnte Stunden verwerfen? ${pinnedCount} gepinnte Stunden 🔒 bleiben erhalten. Lehrer, Fächer und Lehreinheiten bleiben sowieso erhalten.`
			: `${removable} platzierte Stunden verwerfen? Lehrer, Fächer und Lehreinheiten bleiben erhalten.`;
		if (!confirm(msg)) return;
		store.doc.placed = store.doc.placed.filter(p => p.pinned);
		store.persistNow();
	}

	/** Verwirft ALLES inklusive Pins. Zweistufige Bestätigung weil es
	 *  zerstörerisch ist und manuelle Vorgaben löscht. */
	function resetAll() {
		const total = store.doc.placed.length;
		if (total === 0) return;
		const pinnedCount = store.doc.placed.filter(p => p.pinned).length;
		if (pinnedCount === 0) {
			// Kein Pin im Spiel — gleicher Effekt wie resetUnpinned, also
			// einfache Bestätigung.
			if (!confirm(`Wirklich alle ${total} Stunden verwerfen?`)) return;
		} else {
			if (!confirm(`Wirklich ALLE ${total} Stunden verwerfen — INKLUSIVE der ${pinnedCount} gepinnten 🔒? Manuelle Vorgaben gehen verloren.`)) return;
			if (!confirm(`Sicher? Auch die ${pinnedCount} gepinnten Stunden werden gelöscht.`)) return;
		}
		store.doc.placed = [];
		store.persistNow();
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
</section>

<!-- Planungswerkzeuge: ein-/ausklappbar wie das Lehrer-Qualität-Panel.
     Inhalt bleibt gemountet (nur CSS-hidden), damit laufende Solver-
     Sessions und deren Fortschrittsanzeige den Toggle überleben. -->
<section class="tools-panel">
	<button class="tools-toggle" onclick={toggleTools} aria-expanded={toolsOpen}>
		{toolsOpen ? '▼' : '▶'} 🛠 Planungswerkzeuge
		{#if !toolsOpen}
			<span class="tools-hint muted-inline">
				Generieren · Snapshots · Export{selectedSubject ? ` · Fach-Filter: ${selectedSubject}` : ''}
			</span>
		{/if}
	</button>
	<div class="tools-body" class:hidden={!toolsOpen}>
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
		<label
			class="btn small import-label"
			title="Einen mit ‚Plan exportieren' erzeugten Stundenplan wieder einspielen. Funktioniert auch nach frisch importierten Stammdaten (Zuordnung über Fach + Stufe + Lehrer-Namen). Der aktuelle Plan wird vorher als Backup-Snapshot gesichert."
		>
			📥 Plan importieren
			<input type="file" accept=".json,application/json" onchange={importScheduleFile} hidden />
		</label>
		{#if store.doc.placed.length > 0}
			{@const pinnedCount = store.doc.placed.filter(p => p.pinned).length}
			<button
				class="btn small"
				onclick={exportSchedule}
				title="Stundenplan als JSON exportieren — Tag, Stunde, Stufe, Lehrer mit Farben, Team-Teaching, Subject-Namen"
			>
				📤 Plan exportieren
			</button>
			<button
				class="btn danger small"
				onclick={resetUnpinned}
				title="Nur die nicht-gepinnten Stunden löschen — gepinnte Stunden 🔒 bleiben"
			>
				🗑 Planung verwerfen
				{#if pinnedCount > 0}
					<span class="muted-inline">(🔒 {pinnedCount} bleiben)</span>
				{/if}
			</button>
			{#if pinnedCount > 0}
				<button
					class="btn danger small ghost"
					onclick={resetAll}
					title="ALLES inklusive der gepinnten Stunden löschen"
				>
					🗑 Alles inkl. Pins
				</button>
			{/if}
		{/if}
	</div>
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
					{@const t = teacherById(spec.teachers[0] ?? '')}
					<div
						class="unplaced-item"
						use:draggable={{
							container: 'sidebar',
							dragData: { specId: spec.id } as DragPayload
						}}
						style:--c={t?.color ?? FALLBACK_TEACHER_COLOR}
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
		margin-bottom: 8px;
	}
	/* Planungswerkzeuge-Panel — Look analog TeacherQualityPanel (.tq-panel) */
	.tools-panel {
		padding: 8px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-bottom: 14px;
	}
	.tools-toggle {
		background: none;
		border: 0;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		padding: 2px 4px;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.tools-toggle:hover {
		color: var(--accent);
	}
	.tools-hint {
		font-weight: 400;
		font-size: 12px;
		color: var(--text-muted);
	}
	.tools-body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding-top: 10px;
	}
	.tools-body.hidden {
		display: none;
	}
	.import-label {
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		user-select: none;
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
		width: 52px;
		min-width: 52px;
		background: var(--bg-soft);
		text-align: center;
		padding: 4px 3px;
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
		font-size: 9px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.day-head {
		text-align: center;
		padding: 6px;
		background: var(--bg-soft);
		font-weight: 700;
	}
	.grade-head {
		text-align: center;
		padding: 3px 0;
		background: var(--bg-soft);
		font-weight: 600;
		font-size: 11px;
		color: var(--text-muted);
		min-width: 56px;
	}
	/* Tagestrennung: schmaler aber visuell deutlich. Vorher 10px Leerraum,
	   jetzt 4px farbiger Streifen — klare Tagesgrenze, mehr Platz für die
	   Stunden-Spalten daneben. */
	.day-gap {
		width: 4px;
		min-width: 4px;
		max-width: 4px;
		background: var(--border) !important;
		border: 0 !important;
		padding: 0 !important;
	}
	:global(.drag-over) {
		background: var(--accent-bg) !important;
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.muted.small {
		color: var(--text-muted);
		font-size: 12px;
	}
	.muted-inline {
		opacity: 0.75;
		font-size: 11px;
		margin-left: 4px;
	}
	.btn.ghost {
		background: transparent;
		border: 1px dashed var(--danger, #c44);
	}
</style>
