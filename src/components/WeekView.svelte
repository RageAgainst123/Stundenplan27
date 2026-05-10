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

	/**
	 * Berechne die Cell-Layout-Sequence für eine (day, period)-Zeile.
	 * Multi-Grade-Specs werden als EINE Cell mit colspan=N statt N
	 * separate Cells gerendert — wenn deren Stufen-Set konsekutiv ist
	 * (z.B. [5,6] oder [5,6,7,8]). Sonst Fallback auf separate Cells.
	 *
	 * Subtle: wenn an der gleichen (day, period) eine Single-Grade-Spec
	 * UND eine Multi-Grade-Spec liegen die Stufe X teilen, ist das ein
	 * Daten-Problem (Hard-Constraint sollte das verhindern). Wir gehen
	 * davon aus dass der Solver das nicht produziert; falls doch,
	 * sortieren wir Multi-Grade als first-come und ignorieren Konflikte.
	 */
	interface CellSlot {
		colspan: number;
		startGrade: GradeLevel;
		placements: CellPlacement[];
	}

	function rowLayout(day: Day, period: Period): CellSlot[] {
		const slots: CellSlot[] = [];
		// Set zur Track: welche Grades sind in dieser (day, period) schon
		// von einem multi-Grade-Slot abgedeckt → überspringen.
		const consumed = new Set<GradeLevel>();
		for (const grade of GRADES) {
			if (consumed.has(grade)) continue;
			const cps = placementsAt(day, period, grade);
			// Suche nach einer Multi-Grade-Spec deren niedrigste Stufe = grade
			// und deren Stufen konsekutiv sind. Erste passende wird als
			// breite Zelle gerendert.
			let multiCp: CellPlacement | null = null;
			for (const cp of cps) {
				const gs = [...cp.spec.grades].sort((a, b) => a - b);
				if (gs.length < 2) continue;
				if (gs[0] !== grade) continue;
				let consec = true;
				for (let i = 1; i < gs.length; i++) {
					if (gs[i] !== gs[i - 1] + 1) { consec = false; break; }
				}
				if (!consec) continue;
				multiCp = cp;
				break;
			}
			if (multiCp) {
				const span = multiCp.spec.grades.length;
				// Filtere placements so dass nur Multi-Grade-Spec im Slot
				// erscheint. Andere Single-Grade-Specs derselben (day, period, grade)
				// sind ein Konflikt — extrem selten, wir ignorieren sie hier.
				slots.push({
					colspan: span,
					startGrade: grade,
					placements: [multiCp]
				});
				for (const g of multiCp.spec.grades) consumed.add(g);
			} else {
				slots.push({
					colspan: 1,
					startGrade: grade,
					placements: cps
				});
			}
		}
		return slots;
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

	// Wochentag-Vollnamen für Header.
	const DAY_FULL: Record<Day, string> = {
		Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag'
	};

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

		<div class="hd-row teachers-row">
			<button class="big-btn primary-clear" class:active={showAll} onclick={clearFilters}>Alle anzeigen</button>
			{#each store.doc.teachers as t (t.id)}
				<button
					type="button"
					class="big-btn teacher-btn"
					class:active={selectedTeachers.has(t.id)}
					style:--tcolor={t.color}
					onclick={() => toggleTeacher(t.id)}
					title={t.name}
				>
					{t.name.split(' ')[0].toUpperCase()} {t.shortNumber}
				</button>
			{/each}
		</div>

		<div class="hd-row sub-filters">
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
						<th colspan={GRADES.length} class="day-head" class:today={nowState?.day === d}>{DAY_FULL[d]}</th>
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
							{#each rowLayout(d, p) as slot, sidx (d + '-' + p + '-' + sidx + '-' + slot.startGrade)}
								{@const couplingBg = couplingBgFor(slot.placements)}
								{@const isNow = isNowCell(d, p)}
								{@const isLastInDay = (slot.startGrade + slot.colspan - 1) === GRADES[GRADES.length - 1]}
								<td
									class="cell"
									class:now={isNow}
									class:coupled={couplingBg !== ''}
									class:end-of-day={isLastInDay}
									colspan={slot.colspan}
									style:background={couplingBg || undefined}
								>
									{#if slot.placements.length > 0}
										<div class="row" class:team={couplingBg !== ''}>
											{#each slot.placements as cp, idx (cp.placed.specId + '|' + idx)}
												{@const teacher = teacherById(cp.spec.teachers[0] ?? '')}
												{@const teacher2 = cp.spec.teachers.length > 1 ? teacherById(cp.spec.teachers[1]) : undefined}
												{@const visible = isHighlighted(cp.spec, slot.startGrade)}
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
														? `linear-gradient(to right, color-mix(in srgb, ${tcol} 45%, white) 0 50%, color-mix(in srgb, ${t2col} 45%, white) 50% 100%)`
														: `color-mix(in srgb, ${tcol} 45%, white)`}
												>
													<span class="subj" title={teacher?.name + (teacher2 ? ' + ' + teacher2.name : '')}>
														{cp.spec.subject}
													</span>
													{#if cp.spec.weekPattern !== 'every'}
														<span class="week-badge">{cp.spec.weekPattern === 'even' ? 'G' : 'U'}</span>
													{/if}
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
		gap: 16px;
	}

	/* ---- Header ---- */
	.wv-header {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.hd-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.src-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 600;
	}
	.src-select {
		min-width: 280px;
		padding: 6px 10px;
		font-size: 13px;
		border-radius: 6px;
		border: 1px solid var(--border);
	}
	.src-info {
		margin-left: auto;
		font-size: 13px;
	}
	.filter-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		margin-right: 4px;
	}
	.filter-divider {
		color: var(--border);
		margin: 0 6px;
	}
	.subject-select {
		min-width: 140px;
		font-size: 13px;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid var(--border);
	}

	/* Lehrer-Filter im Bild-2-Stil: gross, mit Lehrer-Farbe, gerundet */
	.teachers-row {
		gap: 8px;
		flex-wrap: wrap;
	}
	.big-btn {
		font-size: 13px;
		font-weight: 600;
		padding: 8px 16px;
		border-radius: 24px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: transform 0.1s ease, box-shadow 0.1s ease;
		letter-spacing: 0.02em;
	}
	.big-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}
	.big-btn.primary-clear {
		background: #4f9858;
		color: white;
		border-color: #4f9858;
	}
	.big-btn.primary-clear:not(.active) {
		background: white;
		color: #4f9858;
	}
	.big-btn.teacher-btn {
		background: color-mix(in srgb, var(--tcolor) 65%, white);
		color: rgba(0, 0, 0, 0.85);
	}
	.big-btn.teacher-btn:not(.active) {
		opacity: 0.55;
	}
	.big-btn.teacher-btn.active {
		opacity: 1;
		box-shadow: 0 0 0 2px white, 0 0 0 4px var(--tcolor);
	}

	.sub-filters {
		gap: 6px;
		font-size: 13px;
	}
	.chip {
		font-size: 12px;
		padding: 4px 12px;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: white;
		cursor: pointer;
	}
	.chip.grade-chip.active {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}

	/* ---- Grid ---- */
	.grid-wrapper {
		overflow-x: auto;
		background: white;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 10px;
	}
	table.wv-grid {
		border-collapse: separate;
		/* Cell-Spacing für aufgelockerte Optik (Bild 2) */
		border-spacing: 4px;
		width: 100%;
		min-width: 1100px;
		font-size: 12px;
		/* Fixed Layout: alle Stufen-Spalten gleich breit, time-col fix */
		table-layout: fixed;
	}

	/* Spalten-Breiten via colgroup wäre sauberer aber wir haben keine.
	   Stattdessen via th width + first td width: */
	thead th.time-col,
	td.time-cell {
		width: 80px;
	}
	thead th.day-head {
		font-size: 16px;
		font-weight: 700;
		padding: 10px 6px;
		text-align: center;
		color: var(--text);
		background: transparent;
		border: none;
	}
	thead th.day-head.today {
		color: #8a6500;
	}
	thead th.grade-head {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		text-align: center;
		padding: 4px;
		background: var(--bg-soft);
		border-radius: 4px;
	}
	thead th.grade-head.today {
		background: rgba(255, 215, 0, 0.15);
		color: #8a6500;
	}

	td.time-cell {
		text-align: center;
		padding: 10px 6px;
		background: var(--bg-soft);
		border-radius: 6px;
		vertical-align: middle;
	}
	.period-num {
		font-size: 18px;
		font-weight: 700;
	}
	.period-time {
		font-size: 10px;
		color: var(--text-muted);
		margin-top: 3px;
	}

	td.cell {
		min-height: 60px;
		height: 60px;
		vertical-align: middle;
		background: var(--bg-soft);
		padding: 0;
		border-radius: 8px;
		text-align: center;
		overflow: hidden;
	}
	td.cell.now {
		box-shadow: inset 0 0 0 3px gold;
	}
	td.cell.coupled {
		box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.25);
	}

	.row {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 0;
	}
	.row > .placed + .placed {
		border-top: 1px dashed rgba(255, 255, 255, 0.5);
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
		border-left: 1px dashed rgba(255, 255, 255, 0.6);
	}

	.placed {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 6px 4px;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: rgba(0, 0, 0, 0.85);
		transition: opacity 0.15s ease;
		position: relative;
		border-radius: 6px;
	}
	.placed.filtered {
		opacity: 0.15;
	}
	.placed.dimmed-week {
		opacity: 0.55;
	}
	.subj {
		font-weight: 700;
		font-size: 14px;
	}
	.week-badge {
		position: absolute;
		bottom: 2px;
		right: 4px;
		font-size: 9px;
		font-weight: 700;
		color: rgba(0, 0, 0, 0.5);
		padding: 0 3px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.6);
	}
</style>
