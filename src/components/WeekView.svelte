<script lang="ts">
	// Phase 16: Wochenplan-View — read-only, schöne Anzeige eines Plan-Stands.
	// Quelle wählbar: aktueller Plan oder ein gespeicherter Snapshot.
	// Filter (Lehrer / Stufe / Fach) im Highlight-Modus (Treffer normal,
	// Rest gedimpft).
	import { useStore } from '../lib/store.svelte';
	import {
		DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES,
		type Day, type GradeLevel, type LessonSpec, type Period, type PlacedLesson
	} from '../lib/types';
	import { teacherById as teacherByIdH } from '../lib/teacher-helpers';
	import { groupColor } from '../lib/blocks';
	import { findCurrentPeriod, currentWeekParity } from '../lib/now';
	import { loadSnapshots, type Snapshot } from '../lib/snapshots';

	const store = useStore();

	// ---- Datenquelle: aktueller Plan oder Snapshot ----
	let snapshots = $state<Snapshot[]>(loadSnapshots());
	let selectedSourceId = $state<string>('current');  // 'current' oder snap.id

	function refreshSnapshots(): void {
		snapshots = loadSnapshots();
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('snapshots-changed', refreshSnapshots);
	}

	// Effective placements: aktueller Plan oder snapshot.placed
	const placed = $derived.by((): PlacedLesson[] => {
		if (selectedSourceId === 'current') {
			void store.doc.placed.length; // reactive dep
			return store.doc.placed;
		}
		const snap = snapshots.find(s => s.id === selectedSourceId);
		return snap?.placed ?? store.doc.placed;
	});

	// Beim Snapshot-Wechsel: refresh + show name in header
	const sourceLabel = $derived.by(() => {
		if (selectedSourceId === 'current') return 'Aktueller Plan';
		const snap = snapshots.find(s => s.id === selectedSourceId);
		return snap ? `${snap.name} (Score ${snap.score})` : 'Aktueller Plan';
	});

	// ---- Spec lookup ----
	function specById(id: string): LessonSpec | undefined {
		return store.doc.specs.find(s => s.id === id);
	}

	// ---- Cell-Daten: pro (day, period, grade) die Placements ----
	interface CellPlacement {
		placed: PlacedLesson;
		spec: LessonSpec;
	}

	function placementsAt(day: Day, period: Period, grade: GradeLevel): CellPlacement[] {
		const out: CellPlacement[] = [];
		const seen = new Set<string>();
		for (const p of placed) {
			if (p.day !== day || p.period !== period || p.grade !== grade) continue;
			const spec = specById(p.specId);
			if (!spec) continue;
			const key = p.specId + '|' + p.day + '|' + p.period + '|' + p.grade;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ placed: p, spec });
		}
		return out;
	}

	// ---- Filter ----
	let selectedTeachers = $state<Set<string>>(new Set());
	let selectedGrades = $state<Set<GradeLevel>>(new Set());
	let selectedSubject = $state<string>('');

	const showAll = $derived(
		selectedTeachers.size === 0 && selectedGrades.size === 0 && !selectedSubject
	);

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

	function isNowCell(day: Day, period: Period): boolean {
		return !!nowState && nowState.day === day && nowState.period === period;
	}

	// ---- Coupling-Hintergrund pro Cell ----
	function couplingBgFor(cellPlacements: CellPlacement[]): string {
		if (cellPlacements.length < 2) return '';
		const keys = cellPlacements.map(cp => cp.spec.couplingId ?? '');
		if (keys.some(k => !k)) return '';
		const uniq = new Set(keys);
		if (uniq.size !== 1) return '';
		return groupColor([...uniq][0]);
	}

	// ---- Teacher-Helper ----
	function teacherById(id: string) {
		return teacherByIdH(store.doc, id);
	}

	// ---- Subject-Liste für Dropdown ----
	const subjectOptions = $derived(
		Array.from(new Set(store.doc.specs.map(s => s.subject))).sort()
	);

	// ---- Stats für Header ----
	const stats = $derived.by(() => {
		const total = placed.length;
		const uniqueSpecs = new Set(placed.map(p => p.specId)).size;
		return { total, uniqueSpecs };
	});
</script>

<div class="weekview">
	<header class="wv-header">
		<div class="hd-row">
			<label class="src-label">
				<span>Plan-Quelle:</span>
				<select bind:value={selectedSourceId} class="src-select">
					<option value="current">Aktueller Plan</option>
					{#if snapshots.length > 0}
						<optgroup label="📸 Snapshots">
							{#each snapshots as s (s.id)}
								<option value={s.id}>{s.name} · Score {s.score}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
			</label>
			<span class="src-info muted small">
				{stats.total} Stunden · {stats.uniqueSpecs} Lerneinheiten · KW {weekInfo.week} · {weekInfo.parity === 'even' ? 'G-Woche' : 'U-Woche'}
			</span>
		</div>

		<div class="hd-row filters">
			<button class="btn-filter clear" class:active={showAll} onclick={clearFilters}>Alle anzeigen</button>
			<span class="filter-divider">|</span>
			<span class="filter-label">Lehrer:</span>
			{#each store.doc.teachers as t (t.id)}
				<button
					type="button"
					class="chip teacher-chip"
					class:active={selectedTeachers.has(t.id)}
					style:--tcolor={t.color}
					onclick={() => toggleTeacher(t.id)}
				>
					{t.name.split(' ')[0]} <span class="lbadge">L{t.shortNumber}</span>
				</button>
			{/each}
		</div>

		<div class="hd-row filters">
			<span class="filter-label">Stufen:</span>
			{#each GRADES as g (g)}
				<button
					type="button"
					class="chip grade-chip"
					class:active={selectedGrades.has(g)}
					onclick={() => toggleGrade(g)}
				>{g}. SSt.</button>
			{/each}
			<span class="filter-divider">|</span>
			<span class="filter-label">Fach:</span>
			<select bind:value={selectedSubject} class="subject-select">
				<option value="">Alle Fächer</option>
				{#each subjectOptions as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</div>
	</header>

	<div class="grid-wrapper">
		<table class="wv-grid">
			<thead>
				<tr class="day-row">
					<th class="time-col" rowspan="2"></th>
					{#each DAYS as d (d)}
						<th colspan={GRADES.length} class="day-head" class:today={nowState?.day === d}>{d}</th>
					{/each}
				</tr>
				<tr class="grade-row">
					{#each DAYS as d (d)}
						{#each GRADES as g (d + '-' + g)}
							<th class="grade-head" class:today={nowState?.day === d}>{g}.</th>
						{/each}
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each PERIODS as p (p)}
					<tr>
						<td class="time-cell">
							<div class="period-num">{p}.</div>
							<div class="period-time">{DEFAULT_PERIOD_TIMES[p - 1]}</div>
						</td>
						{#each DAYS as d (d)}
							{#each GRADES as g (d + '-' + g + '-' + p)}
								{@const cps = placementsAt(d, p, g)}
								{@const couplingBg = couplingBgFor(cps)}
								{@const isNow = isNowCell(d, p)}
								<td
									class="cell"
									class:now={isNow}
									class:coupled={couplingBg !== ''}
									style:background={couplingBg || undefined}
								>
									{#if cps.length > 0}
										<div class="row" class:team={couplingBg !== ''}>
											{#each cps as cp, idx (cp.placed.specId + '|' + idx)}
												{@const teacher = teacherById(cp.spec.teachers[0] ?? '')}
												{@const teacher2 = cp.spec.teachers.length > 1 ? teacherById(cp.spec.teachers[1]) : undefined}
												{@const visible = isHighlighted(cp.spec, g)}
												{@const tcol = teacher?.color ?? '#9ca3af'}
												{@const t2col = teacher2?.color ?? tcol}
												{@const dimmedByWeek = cp.spec.weekPattern !== 'every' && cp.spec.weekPattern !== weekInfo.parity}
												<div
													class="placed"
													class:filtered={!visible}
													class:dimmed-week={dimmedByWeek}
													style:--tcol={tcol}
													style:--t2col={t2col}
													style:background={teacher2
														? `linear-gradient(to right, color-mix(in srgb, ${tcol} 30%, white) 0 50%, color-mix(in srgb, ${t2col} 30%, white) 50% 100%)`
														: `color-mix(in srgb, ${tcol} 30%, white)`}
												>
													<div class="placed-top">
														<span class="subj">{cp.spec.subject}</span>
														<span class="teach-row">
															<span class="lbadge" title={teacher?.name}>L{teacher?.shortNumber ?? '?'}</span>
															{#if teacher2}
																<span class="lbadge two" title={teacher2.name}>L{teacher2.shortNumber}</span>
															{/if}
														</span>
													</div>
													<div class="placed-bot">
														<span class="grades">{cp.spec.grades.join('+')}</span>
														{#if cp.spec.weekPattern !== 'every'}
															<span class="week">{cp.spec.weekPattern === 'even' ? 'G' : 'U'}</span>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</td>
							{/each}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.weekview {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* ---- Header ---- */
	.wv-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.hd-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.hd-row.filters {
		gap: 4px;
	}
	.src-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.src-select {
		min-width: 240px;
		padding: 4px 8px;
		font-size: 13px;
	}
	.src-info {
		margin-left: auto;
	}
	.filter-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		margin-right: 2px;
	}
	.filter-divider {
		color: var(--border);
		margin: 0 4px;
	}
	.subject-select {
		min-width: 120px;
		font-size: 12px;
		padding: 2px 6px;
	}
	.btn-filter {
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: white;
		cursor: pointer;
	}
	.btn-filter.active {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.chip {
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: white;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.chip.teacher-chip {
		border-left: 3px solid var(--tcolor);
	}
	.chip.active {
		background: color-mix(in srgb, var(--tcolor, var(--accent)) 25%, white);
		font-weight: 600;
	}
	.chip.grade-chip.active {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.lbadge {
		display: inline-block;
		font-size: 10px;
		padding: 0 4px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.06);
		font-weight: 600;
	}
	.lbadge.two {
		background: rgba(0, 0, 0, 0.12);
	}

	/* ---- Grid ---- */
	.grid-wrapper {
		overflow-x: auto;
		background: white;
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	table.wv-grid {
		border-collapse: separate;
		border-spacing: 0;
		width: 100%;
		min-width: 1100px;
		font-size: 12px;
	}
	thead th {
		padding: 6px 4px;
		text-align: center;
		font-weight: 600;
		background: var(--bg-soft);
		border-bottom: 1px solid var(--border);
		color: var(--text);
	}
	thead th.day-head {
		font-size: 14px;
		padding: 8px 4px;
		border-right: 2px solid var(--border);
		background: linear-gradient(to bottom, var(--bg-panel), var(--bg-soft));
	}
	thead th.day-head.today {
		background: linear-gradient(to bottom, rgba(255, 215, 0, 0.20), rgba(255, 215, 0, 0.10));
		color: #8a6500;
	}
	thead th.grade-head {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		border-right: 1px solid var(--border);
		padding: 4px;
	}
	thead th.grade-head.today {
		background: rgba(255, 215, 0, 0.06);
	}

	td.time-cell {
		text-align: center;
		padding: 8px 6px;
		background: var(--bg-soft);
		border-right: 2px solid var(--border);
		border-bottom: 1px solid var(--border);
		min-width: 70px;
		vertical-align: middle;
	}
	.period-num {
		font-size: 16px;
		font-weight: 700;
	}
	.period-time {
		font-size: 10px;
		color: var(--text-muted);
		margin-top: 2px;
	}

	td.cell {
		min-height: 56px;
		height: 56px;
		vertical-align: top;
		background: white;
		padding: 0;
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	/* Verstärkter Tag-Trenner: jede 4. (= GRADES.length) Spalte hat einen
	   stärkeren Rand rechts. Über CSS-Selector pro Zelle nicht trivial,
	   stattdessen am letzten <th> der Tag-Gruppe und am letzten <td> via
	   nth-child Logik (wir wissen GRADES = [5,6,7,8] → jede 4. cell-Spalte
	   nach time-col bekommt verstärkten Right-Border). */
	tbody tr td.cell:nth-of-type(4n+1) {
		border-right: 2px solid var(--border);
	}
	thead th.grade-head:nth-of-type(4n) {
		border-right: 2px solid var(--border);
	}

	td.cell.now {
		background: rgba(255, 215, 0, 0.10);
		box-shadow: inset 0 0 0 2px gold;
	}
	td.cell.coupled {
		box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.25);
	}

	.row {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.row > .placed + .placed {
		border-top: 1px dashed rgba(0, 0, 0, 0.20);
	}
	.row.team {
		flex-direction: row;
	}
	.row.team > .placed {
		flex: 1 1 0;
		min-width: 0;
	}
	.row.team > .placed + .placed {
		border-top: none;
		border-left: 1px dashed rgba(0, 0, 0, 0.45);
	}

	.placed {
		min-height: 28px;
		padding: 4px 6px;
		border-left: 3px solid var(--tcol);
		font-size: 11px;
		line-height: 1.15;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		transition: opacity 0.15s ease;
	}
	.placed.filtered {
		opacity: 0.18;
	}
	.placed.dimmed-week {
		opacity: 0.55;
	}
	.placed-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 4px;
	}
	.placed-bot {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 4px;
		margin-top: 2px;
	}
	.subj {
		font-weight: 700;
		font-size: 13px;
		letter-spacing: 0.02em;
	}
	.teach-row {
		display: flex;
		gap: 2px;
	}
	.grades {
		font-size: 10px;
		color: rgba(0, 0, 0, 0.55);
	}
	.week {
		font-size: 10px;
		font-weight: 700;
		color: rgba(0, 0, 0, 0.55);
		padding: 0 3px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.08);
	}
</style>
