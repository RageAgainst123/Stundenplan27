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

	// Phase 16.3: Vergleichsmodus mit 1-4 Slots.
	// slotIds[i] ist die Plan-Quelle für Slot i ('current' oder snap.id).
	// slotCount = sichtbare Slots (1..4). Reduktion verwirft hintere Slots
	// nicht — sie bleiben in slotIds erhalten falls User wieder hochregelt.
	let slotCount = $state<number>(1);
	let slotIds = $state<string[]>(['current', 'current', 'current', 'current']);

	function refreshSnapshots(): void {
		snapshots = loadSnapshots();
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('snapshots-changed', refreshSnapshots);
	}

	function placedFor(sourceId: string): PlacedLesson[] {
		if (sourceId === 'current') {
			void store.doc.placed.length; // reactive dep
			return store.doc.placed;
		}
		const snap = snapshots.find(s => s.id === sourceId);
		return snap?.placed ?? [];
	}

	function sourceLabelFor(sourceId: string): string {
		if (sourceId === 'current') return 'Aktueller Plan';
		const snap = snapshots.find(s => s.id === sourceId);
		return snap ? `${snap.name} · Score ${snap.score}` : 'Aktueller Plan';
	}

	// ---- Spec lookup ----
	function specById(id: string): LessonSpec | undefined {
		return store.doc.specs.find(s => s.id === id);
	}

	// ---- Cell-Daten: pro (day, period, grade) die Placements ----
	interface CellPlacement {
		placed: PlacedLesson;
		spec: LessonSpec;
	}

	function placementsAt(placed: PlacedLesson[], day: Day, period: Period, grade: GradeLevel): CellPlacement[] {
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

	function rowLayout(placed: PlacedLesson[], day: Day, period: Period): CellSlot[] {
		const slots: CellSlot[] = [];
		// Set zur Track: welche Grades sind in dieser (day, period) schon
		// von einem multi-Grade-Slot abgedeckt → überspringen.
		const consumed = new Set<GradeLevel>();
		for (const grade of GRADES) {
			if (consumed.has(grade)) continue;
			const cps = placementsAt(placed, day, period, grade);
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
		// Bug-Fix Phase 16.5: Multi-Grade-Specs (z.B. REL für [5,6]) wurden
		// fälschlicherweise gefiltert wenn nur eine ihrer Stufen markiert war
		// und die Cell mit der ANDEREN Stufe gerendert wurde. rowLayout()
		// rendert Multi-Grade-Cells mit startGrade=min(spec.grades) — dann
		// scheiterte selectedGrades.has(startGrade) wenn User die andere
		// Stufe gefiltert hat. Lösung: prüfe ob IRGENDEINE der spec.grades
		// im Filter ist. gradeOfCell bleibt Fallback für Single-Grade-Specs.
		if (selectedGrades.size > 0) {
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

	// ---- Stats pro Slot ----
	function statsFor(placed: PlacedLesson[]) {
		const total = placed.length;
		const uniqueSpecs = new Set(placed.map(p => p.specId)).size;
		return { total, uniqueSpecs };
	}
</script>

<div class="weekview">
	<header class="wv-header">
		<div class="hd-row top-row">
			<div class="slot-toggle">
				<span class="filter-label">Vergleich:</span>
				{#each [1, 2, 3, 4] as n (n)}
					<button
						type="button"
						class="slot-btn"
						class:active={slotCount === n}
						onclick={() => (slotCount = n)}
						title="{n} Plan{n === 1 ? '' : ' ne'}{n === 1 ? '' : 'beneinander vergleichen'}"
					>{n}</button>
				{/each}
			</div>
			<span class="kw-info muted small">
				KW {weekInfo.week} · {weekInfo.parity === 'even' ? 'G-Woche' : 'U-Woche'}
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
			{#if slotCount > 1}
				<span class="filter-divider">|</span>
				<span class="muted small">Filter gilt für alle {slotCount} Pläne</span>
			{/if}
		</div>
	</header>

	<!-- Phase 16.3: 1-4 Slots als Grid. Layout passt sich an Slot-Anzahl an. -->
	<div class="slots-grid" class:cols-1={slotCount === 1} class:cols-2={slotCount === 2} class:cols-3={slotCount === 3} class:cols-4={slotCount === 4}>
		{#each Array(slotCount) as _, slotIdx (slotIdx)}
			{@const placedHere = placedFor(slotIds[slotIdx])}
			{@const slotStats = statsFor(placedHere)}
			<div class="plan-slot" class:compact-2={slotCount === 2} class:compact-3-4={slotCount >= 3}>
				<div class="slot-header">
					<select bind:value={slotIds[slotIdx]} class="slot-select">
						<option value="current">Aktueller Plan</option>
						{#if snapshots.length > 0}
							<optgroup label="📸 Snapshots">
								{#each snapshots as s (s.id)}
									<option value={s.id}>{s.name} · Score {s.score}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
					<span class="slot-stats muted small">{slotStats.total}h · {slotStats.uniqueSpecs} LE</span>
				</div>

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
									{#each GRADES as g, gi (d + '-' + g)}
										<th
											class="grade-head"
											class:today={nowState?.day === d}
											class:end-of-day={gi === GRADES.length - 1}
										>{g}.</th>
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
										{#each rowLayout(placedHere, d, p) as slot, sidx (d + '-' + p + '-' + sidx + '-' + slot.startGrade)}
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
															{@const teachersAll = cp.spec.teachers.map(tid => teacherById(tid)).filter((t): t is NonNullable<typeof t> => !!t)}
															{@const visible = isHighlighted(cp.spec, slot.startGrade)}
															{@const tcol = teachersAll[0]?.color ?? '#9ca3af'}
															{@const tcolLast = teachersAll.length > 1 ? teachersAll[teachersAll.length - 1].color : tcol}
															{@const teachersBg = teachersAll.length <= 1
																? `color-mix(in srgb, ${tcol} 45%, white)`
																: 'linear-gradient(to right, ' + teachersAll.map((t, i) => {
																	const from = ((i / teachersAll.length) * 100).toFixed(2);
																	const to = (((i + 1) / teachersAll.length) * 100).toFixed(2);
																	return `color-mix(in srgb, ${t.color} 45%, white) ${from}% ${to}%`;
																}).join(', ') + ')'}
															{@const namesTooltip = teachersAll.map(t => t.name).join(' + ')}
															{@const dimmedByWeek = cp.spec.weekPattern !== 'every' && cp.spec.weekPattern !== weekInfo.parity}
															<div
																class="placed"
																class:filtered={!visible}
																class:dimmed-week={dimmedByWeek}
																class:multi-teacher={teachersAll.length > 2}
																style:--tcol={tcol}
																style:--t2col={tcolLast}
																style:background={teachersBg}
															>
																<span class="subj" title={namesTooltip}>
																	{cp.spec.subject}
																</span>
																{#if teachersAll.length > 2}
																	<span class="teacher-count" title={namesTooltip}>{teachersAll.length}👥</span>
																{/if}
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
		{/each}
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
	/* Phase 16.3: Slot-Toggle (1-4 Pläne vergleichen) */
	.top-row {
		justify-content: space-between;
	}
	.slot-toggle {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.slot-btn {
		font-size: 13px;
		font-weight: 600;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: white;
		cursor: pointer;
		min-width: 32px;
	}
	.slot-btn.active {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.kw-info {
		font-size: 12px;
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
		font-size: 12px;
		font-weight: 600;
		padding: 6px 12px;
		border-radius: 18px;
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

	/* ---- Slots-Grid (Vergleichsmodus) ---- */
	.slots-grid {
		display: grid;
		gap: 12px;
	}
	.slots-grid.cols-1 {
		grid-template-columns: 1fr;
	}
	.slots-grid.cols-2 {
		grid-template-columns: repeat(2, 1fr);
	}
	.slots-grid.cols-3 {
		grid-template-columns: repeat(3, 1fr);
	}
	.slots-grid.cols-4 {
		/* 4 nebeneinander wäre zu schmal — 2x2 grid */
		grid-template-columns: repeat(2, 1fr);
	}
	/* Auf schmalen Screens: 3-4 Slots stacken (gelockert weil
	   Compact-Modus die Slots viel schmaler macht) */
	@media (max-width: 1300px) {
		.slots-grid.cols-3,
		.slots-grid.cols-4 {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 900px) {
		.slots-grid.cols-2 {
			grid-template-columns: 1fr;
		}
	}
	.plan-slot {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.slot-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 8px 8px 0 0;
		border-bottom: none;
	}
	.slot-select {
		flex: 1;
		min-width: 0;
		padding: 4px 8px;
		font-size: 13px;
		border-radius: 5px;
		border: 1px solid var(--border);
	}
	.slot-stats {
		font-size: 12px;
		white-space: nowrap;
	}

	/* ---- Grid ---- */
	.grid-wrapper {
		overflow-x: auto;
		background: white;
		border: 1px solid var(--border);
		border-radius: 0 0 10px 10px;
		padding: 8px;
	}
	table.wv-grid {
		border-collapse: separate;
		/* Cell-Spacing für aufgelockerte Optik */
		border-spacing: 3px;
		width: 100%;
		min-width: 980px;
		font-size: 11px;
		/* Fixed Layout: alle Stufen-Spalten gleich breit, time-col fix */
		table-layout: fixed;
	}

	thead th.time-col,
	td.time-cell {
		width: 60px;
	}
	thead th.day-head {
		font-size: 14px;
		font-weight: 700;
		padding: 6px 4px;
		text-align: center;
		color: var(--text);
		background: transparent;
		border: none;
	}
	thead th.day-head.today {
		color: #8a6500;
	}
	thead th.grade-head {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-align: center;
		padding: 3px;
		background: var(--bg-soft);
		border-radius: 4px;
	}
	thead th.grade-head.today {
		background: rgba(255, 215, 0, 0.15);
		color: #8a6500;
	}
	/* Tag-Trennung: rechte Padding-Spalte mit fixer Breite zwischen
	   Tagen, schafft den visuellen Spalt. Erzeugt durch zusätzlichen
	   margin-right auf der letzten Cell pro Tag (= 4. Stufen-Spalte
	   bei 4 Grades = jede 4. Cell ab time-col, also nth-child(4n+1)
	   wenn man ab der ersten Cell zählt — siehe end-of-day Klasse). */
	td.cell.end-of-day,
	thead th.grade-head.end-of-day {
		margin-right: 12px;
	}
	/* margin auf table-cells funktioniert nicht — stattdessen extra
	   border-right space via box-shadow oder ein verstecktes Spacer-
	   Element. Cleanste Lösung: extra padding-right via :after wäre
	   tricky; einfachster Weg: dickerer border-right in Hintergrundfarbe
	   (= weiß) der visuell wie Spacing wirkt. */
	td.cell.end-of-day {
		border-right: 12px solid white;
		box-sizing: border-box;
	}
	thead th.grade-head.end-of-day {
		border-right: 12px solid white;
	}

	td.time-cell {
		text-align: center;
		padding: 6px 4px;
		background: var(--bg-soft);
		border-radius: 6px;
		vertical-align: middle;
	}
	.period-num {
		font-size: 15px;
		font-weight: 700;
	}
	.period-time {
		font-size: 9px;
		color: var(--text-muted);
		margin-top: 2px;
	}

	td.cell {
		min-height: 44px;
		height: 44px;
		vertical-align: middle;
		background: var(--bg-soft);
		padding: 0;
		border-radius: 7px;
		text-align: center;
		overflow: hidden;
	}
	td.cell.now {
		box-shadow: inset 0 0 0 2px gold;
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
		gap: 3px;
		padding: 4px 3px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: rgba(0, 0, 0, 0.85);
		transition: opacity 0.15s ease;
		position: relative;
		border-radius: 5px;
	}
	.placed.filtered {
		opacity: 0.15;
	}
	.placed.dimmed-week {
		opacity: 0.55;
	}
	.subj {
		font-weight: 700;
		font-size: 12px;
	}
	.week-badge {
		position: absolute;
		bottom: 1px;
		right: 3px;
		font-size: 8px;
		font-weight: 700;
		color: rgba(0, 0, 0, 0.5);
		padding: 0 2px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.6);
	}
	/* Phase 17: bei 3+ Lehrern dezent "N👥" Badge oben rechts — damit User
	   trotz visueller Streifen erkennt wieviele Lehrer drin sind. */
	.teacher-count {
		position: absolute;
		top: 1px;
		right: 2px;
		font-size: 9px;
		font-weight: 700;
		color: rgba(0, 0, 0, 0.65);
		padding: 0 3px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.7);
		line-height: 1.2;
	}
	.placed.multi-teacher {
		/* Kleine Hervorhebung des Multi-Teaching-Status durch dezenten Rahmen */
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
	}

	/* ---- Compact-Modus für Vergleichsansicht (slotCount > 1) ---- */
	/* 2 Slots nebeneinander: kompaktere Cells, kleinere Schrift,
	   schmalere Period-Spalte. Min-Width damit beide auf 1280er Screen
	   nebeneinander passen. */
	.plan-slot.compact-2 .grid-wrapper {
		padding: 4px;
	}
	.plan-slot.compact-2 table.wv-grid {
		min-width: 640px;
		border-spacing: 2px;
		font-size: 10px;
	}
	.plan-slot.compact-2 thead th.time-col,
	.plan-slot.compact-2 td.time-cell {
		width: 42px;
	}
	.plan-slot.compact-2 td.time-cell {
		padding: 3px 2px;
	}
	.plan-slot.compact-2 .period-num {
		font-size: 13px;
	}
	.plan-slot.compact-2 .period-time {
		display: none; /* Zeit weg im Compact, nur Periodennummer */
	}
	.plan-slot.compact-2 thead th.day-head {
		font-size: 12px;
		padding: 4px 2px;
	}
	.plan-slot.compact-2 thead th.grade-head {
		font-size: 10px;
		padding: 2px;
	}
	.plan-slot.compact-2 td.cell {
		min-height: 30px;
		height: 30px;
		border-radius: 4px;
	}
	.plan-slot.compact-2 td.cell.end-of-day,
	.plan-slot.compact-2 thead th.grade-head.end-of-day {
		border-right: 6px solid white;
	}
	.plan-slot.compact-2 .placed {
		padding: 2px 2px;
		font-size: 10px;
		border-radius: 3px;
	}
	.plan-slot.compact-2 .subj {
		font-size: 10px;
	}

	/* 3-4 Slots: extra-kompakt. Mindestens 480px Tabellenbreite damit
	   bei 1500-1920er Screens 3-4 nebeneinander passen würden;
	   media-query stackt sie aber heute schon ab 1300px. */
	.plan-slot.compact-3-4 .grid-wrapper {
		padding: 3px;
	}
	.plan-slot.compact-3-4 table.wv-grid {
		min-width: 480px;
		border-spacing: 1px;
		font-size: 9px;
	}
	.plan-slot.compact-3-4 thead th.time-col,
	.plan-slot.compact-3-4 td.time-cell {
		width: 32px;
	}
	.plan-slot.compact-3-4 td.time-cell {
		padding: 2px 1px;
	}
	.plan-slot.compact-3-4 .period-num {
		font-size: 11px;
	}
	.plan-slot.compact-3-4 .period-time {
		display: none;
	}
	.plan-slot.compact-3-4 thead th.day-head {
		font-size: 10px;
		padding: 3px 1px;
	}
	.plan-slot.compact-3-4 thead th.grade-head {
		font-size: 9px;
		padding: 1px;
	}
	.plan-slot.compact-3-4 td.cell {
		min-height: 24px;
		height: 24px;
		border-radius: 3px;
	}
	.plan-slot.compact-3-4 td.cell.end-of-day,
	.plan-slot.compact-3-4 thead th.grade-head.end-of-day {
		border-right: 4px solid white;
	}
	.plan-slot.compact-3-4 .placed {
		padding: 1px 1px;
		font-size: 9px;
		border-radius: 2px;
	}
	.plan-slot.compact-3-4 .subj {
		font-size: 9px;
	}
	.plan-slot.compact-3-4 .week-badge {
		display: none; /* zu klein für G/U-Badge — Tooltip via title bleibt */
	}
	.plan-slot.compact-3-4 .teacher-count {
		display: none; /* gleicher Grund — Tooltip via title bleibt */
	}
	.plan-slot.compact-2 .teacher-count {
		font-size: 8px;
		padding: 0 2px;
	}
</style>
