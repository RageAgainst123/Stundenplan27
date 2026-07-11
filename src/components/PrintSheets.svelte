<script lang="ts">
	// Audit A7 / Phase 18: Print-Layout.
	//
	// Rendert Druck-Blätter (eine A4-Querformat-Seite pro Lehrer bzw. Stufe,
	// oder den ganzen Plan als eine Seite) als Bildschirm-Vorschau; „Drucken"
	// ruft window.print(). Die @media-print-Regeln blenden App-Chrome
	// (Header, Tabs, Banner, Toolbar) aus — nur die Blätter kommen aufs
	// Papier. Toner-schonend: schwarzer Text, Lehrerfarbe nur als schmaler
	// linker Rand der Einträge.
	import { useStore } from '../lib/store.svelte';
	import {
		DAYS, PERIODS, GRADES, DEFAULT_PERIOD_TIMES,
		type Day, type GradeLevel, type PlacedLesson, type Period, type Teacher, type WeekPattern
	} from '../lib/types';
	import { buildSlotOccupancy, slotKeyOf, type SlotOccupant } from '../lib/schedule-helpers';
	import type { PrintMode } from '../lib/types-ui';

	interface Props {
		mode: PrintMode;
		/** Placements der gewählten Plan-Quelle (aktueller Plan oder Snapshot). */
		placed: PlacedLesson[];
		/** Anzeige-Name der Quelle (z. B. „Aktueller Plan" oder Snapshot-Name). */
		sourceLabel: string;
		onClose: () => void;
	}
	let { mode, placed, sourceLabel, onClose }: Props = $props();

	const store = useStore();

	const DAY_FULL: Record<Day, string> = {
		Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag'
	};

	const dateStr = new Date().toLocaleDateString('de-AT', {
		day: '2-digit', month: '2-digit', year: 'numeric'
	});

	const occupancy = $derived(buildSlotOccupancy(store.doc, placed));

	// ---- Pro-Lehrer-Blätter ----
	// Ein Eintrag = eine Unterrichtsstunde des Lehrers in (Tag, Periode);
	// Multi-Grade-Zeilen derselben Spec werden zu EINEM Eintrag mit
	// zusammengeführten Stufen (5+6).
	interface PrintEntry {
		subject: string;
		grades: GradeLevel[];
		weekPattern: WeekPattern;
		/** Mit-Lehrer (Team-Teaching/Kopplung im selben Eintrag). */
		co: Teacher[];
		color: string;
	}

	function cellsForTeacher(t: Teacher): Map<string, PrintEntry[]> {
		const byDp = new Map<string, Map<string, PrintEntry>>();
		for (const occs of occupancy.values()) {
			for (const occ of occs) {
				if (!occ.teachers.some(x => x.id === t.id)) continue;
				const dp = `${occ.placed.day}|${occ.placed.period}`;
				let inner = byDp.get(dp);
				if (!inner) { inner = new Map(); byDp.set(dp, inner); }
				const existing = inner.get(occ.spec.id);
				if (existing) {
					if (!existing.grades.includes(occ.placed.grade)) existing.grades.push(occ.placed.grade);
				} else {
					inner.set(occ.spec.id, {
						subject: occ.spec.subject,
						grades: [occ.placed.grade],
						weekPattern: occ.spec.weekPattern,
						co: occ.teachers.filter(x => x.id !== t.id),
						color: t.color,
					});
				}
			}
		}
		const out = new Map<string, PrintEntry[]>();
		for (const [dp, inner] of byDp) {
			const list = [...inner.values()];
			for (const e of list) e.grades.sort((a, b) => a - b);
			out.set(dp, list);
		}
		return out;
	}

	const teacherSheets = $derived.by(() => {
		const sheets: { teacher: Teacher; cells: Map<string, PrintEntry[]>; hours: number }[] = [];
		const sorted = [...store.doc.teachers].sort((a, b) => a.shortNumber - b.shortNumber);
		for (const t of sorted) {
			const cells = cellsForTeacher(t);
			let hours = 0;
			for (const list of cells.values()) hours += list.length;
			if (hours > 0) sheets.push({ teacher: t, cells, hours });
		}
		return sheets;
	});

	// ---- Pro-Stufe-Blätter + Gesamtansicht ----
	function entriesAt(day: Day, period: Period, grade: GradeLevel): SlotOccupant[] {
		return occupancy.get(slotKeyOf(day, period, grade)) ?? [];
	}

	const gradeSheets = $derived.by(() =>
		GRADES.map(g => {
			let hours = 0;
			for (const d of DAYS) for (const p of PERIODS) hours += entriesAt(d, p, g).length;
			return { grade: g, hours };
		}).filter(s => s.hours > 0)
	);

	/** Legende L# → Name für Stufen-/Gesamt-Blätter. */
	const legend = $derived(
		[...store.doc.teachers]
			.filter(t => {
				for (const occs of occupancy.values()) {
					if (occs.some(o => o.teachers.some(x => x.id === t.id))) return true;
				}
				return false;
			})
			.sort((a, b) => a.shortNumber - b.shortNumber)
	);

	function weekBadge(wp: WeekPattern): string {
		return wp === 'every' ? '' : wp === 'even' ? 'G' : 'U';
	}

	function doPrint(): void {
		window.print();
	}
</script>

<div class="print-root">
	<div class="print-toolbar no-print">
		<button class="btn primary" onclick={doPrint}>🖨 Drucken</button>
		<button class="btn" onclick={onClose}>✕ Schließen</button>
		<span class="muted">
			{mode === 'teachers'
				? `${teacherSheets.length} Blätter (A4 quer, eines pro Lehrer)`
				: mode === 'grades'
					? `${gradeSheets.length} Blätter (A4 quer, eines pro Stufe)`
					: '1 Blatt (A4 quer, ganzer Plan)'}
			· Quelle: {sourceLabel}
		</span>
	</div>

	{#if mode === 'teachers'}
		{#each teacherSheets as sheet (sheet.teacher.id)}
			<section class="sheet">
				<header class="sheet-head" style:border-color={sheet.teacher.color}>
					<strong>{sheet.teacher.name}</strong>
					<span>Stundenplan {store.doc.schoolYear}</span>
					<span>{sheet.hours} Wochenstunden · Stand {dateStr}</span>
				</header>
				<table class="sheet-grid">
					<thead>
						<tr>
							<th class="time-col"></th>
							{#each DAYS as d (d)}<th>{DAY_FULL[d]}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each PERIODS as p, pIdx (p)}
							<tr>
								<th class="time-col">
									<span class="pnum">{p}.</span>
									<span class="ptime">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
								</th>
								{#each DAYS as d (d)}
									{@const entries = sheet.cells.get(`${d}|${p}`) ?? []}
									<td>
										{#each entries as e, i (e.subject + '|' + i)}
											<div class="entry" style:border-left-color={e.color}>
												<span class="subj">{e.subject}</span>
												<span class="meta">
													{e.grades.join('+')}. SSt.
													{#if weekBadge(e.weekPattern)}<span class="wk">[{weekBadge(e.weekPattern)}]</span>{/if}
													{#if e.co.length > 0}<span class="co">+ {e.co.map(c => `L${c.shortNumber}`).join(' ')}</span>{/if}
												</span>
											</div>
										{/each}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
		{#if teacherSheets.length === 0}
			<p class="empty no-print">Keine Lehrer mit platzierten Stunden in dieser Quelle.</p>
		{/if}
	{:else if mode === 'grades'}
		{#each gradeSheets as sheet (sheet.grade)}
			<section class="sheet">
				<header class="sheet-head">
					<strong>{sheet.grade}. Schulstufe</strong>
					<span>Stundenplan {store.doc.schoolYear}</span>
					<span>{sheet.hours} Wochenstunden · Stand {dateStr}</span>
				</header>
				<table class="sheet-grid">
					<thead>
						<tr>
							<th class="time-col"></th>
							{#each DAYS as d (d)}<th>{DAY_FULL[d]}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each PERIODS as p, pIdx (p)}
							<tr>
								<th class="time-col">
									<span class="pnum">{p}.</span>
									<span class="ptime">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
								</th>
								{#each DAYS as d (d)}
									{@const entries = entriesAt(d, p, sheet.grade)}
									<td>
										{#each entries as occ, i (occ.spec.id + '|' + i)}
											<div class="entry" style:border-left-color={occ.teachers[0]?.color ?? '#999'}>
												<span class="subj">{occ.spec.subject}</span>
												<span class="meta">
													{occ.teachers.map(t => `L${t.shortNumber}`).join(' ')}
													{#if weekBadge(occ.spec.weekPattern)}<span class="wk">[{weekBadge(occ.spec.weekPattern)}]</span>{/if}
												</span>
											</div>
										{/each}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				<footer class="sheet-legend">
					{#each legend as t (t.id)}<span class="lg"><b>L{t.shortNumber}</b> {t.name}</span>{/each}
				</footer>
			</section>
		{/each}
		{#if gradeSheets.length === 0}
			<p class="empty no-print">Keine platzierten Stunden in dieser Quelle.</p>
		{/if}
	{:else}
		<section class="sheet">
			<header class="sheet-head">
				<strong>Gesamtplan</strong>
				<span>Stundenplan {store.doc.schoolYear}</span>
				<span>Stand {dateStr}</span>
			</header>
			<table class="sheet-grid all-grid">
				<thead>
					<tr>
						<th class="time-col"></th>
						{#each DAYS as d (d)}<th colspan={GRADES.length}>{DAY_FULL[d]}</th>{/each}
					</tr>
					<tr>
						<th class="time-col"></th>
						{#each DAYS as d (d)}
							{#each GRADES as g (d + '-' + g)}<th class="g-head">{g}.</th>{/each}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each PERIODS as p, pIdx (p)}
						<tr>
							<th class="time-col">
								<span class="pnum">{p}.</span>
								<span class="ptime">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
							</th>
							{#each DAYS as d (d)}
								{#each GRADES as g (d + '-' + g)}
									{@const entries = entriesAt(d, p, g)}
									<td class="mini">
										{#each entries as occ, i (occ.spec.id + '|' + i)}
											<div class="entry mini-entry" style:border-left-color={occ.teachers[0]?.color ?? '#999'}>
												<span class="subj">{occ.spec.subject}</span>
												<span class="meta">{occ.teachers.map(t => `L${t.shortNumber}`).join(' ')}{#if weekBadge(occ.spec.weekPattern)} [{weekBadge(occ.spec.weekPattern)}]{/if}</span>
											</div>
										{/each}
									</td>
								{/each}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
			<footer class="sheet-legend">
				{#each legend as t (t.id)}<span class="lg"><b>L{t.shortNumber}</b> {t.name}</span>{/each}
			</footer>
		</section>
	{/if}
</div>

<style>
	/* ---- Bildschirm-Vorschau: Blätter als weiße Karten ---- */
	.print-root {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.print-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.print-toolbar .muted {
		color: var(--text-muted);
		font-size: 12px;
	}
	.empty {
		color: var(--text-muted);
		padding: 16px;
	}
	.sheet {
		background: white;
		color: black;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 10mm;
		max-width: 277mm;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
	}

	/* ---- Blatt-Inhalt (Bildschirm UND Druck) ---- */
	.sheet-head {
		display: flex;
		align-items: baseline;
		gap: 16px;
		border-bottom: 3px solid #333;
		padding-bottom: 4px;
		margin-bottom: 8px;
	}
	.sheet-head strong {
		font-size: 16pt;
	}
	.sheet-head span {
		font-size: 10pt;
		color: #444;
	}
	.sheet-head span:last-child {
		margin-left: auto;
	}
	.sheet-grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.sheet-grid th,
	.sheet-grid td {
		border: 1px solid #888;
		padding: 2px 4px;
		vertical-align: top;
		font-size: 9pt;
	}
	.sheet-grid thead th {
		background: #eee;
		font-size: 10pt;
		padding: 4px;
	}
	.sheet-grid .time-col {
		width: 18mm;
		background: #f5f5f5;
		text-align: center;
	}
	.time-col .pnum {
		display: block;
		font-weight: 700;
	}
	.time-col .ptime {
		display: block;
		font-size: 7pt;
		color: #555;
	}
	.sheet-grid tbody tr {
		height: 16mm;
	}
	.entry {
		border-left: 3px solid #999;
		padding: 1px 4px;
		margin-bottom: 2px;
	}
	.entry .subj {
		display: block;
		font-weight: 700;
	}
	.entry .meta {
		display: block;
		font-size: 8pt;
		color: #333;
	}
	.entry .wk {
		font-weight: 700;
	}
	.entry .co {
		color: #555;
	}
	.all-grid th,
	.all-grid td {
		font-size: 7pt;
		padding: 1px 2px;
	}
	.all-grid .g-head {
		font-size: 7pt;
		background: #f5f5f5;
	}
	.all-grid tbody tr {
		height: 12mm;
	}
	.mini-entry {
		border-left-width: 2px;
	}
	.mini-entry .subj {
		font-size: 7pt;
	}
	.mini-entry .meta {
		font-size: 6pt;
	}
	.sheet-legend {
		margin-top: 6px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 8pt;
		color: #333;
	}

	/* ---- Druck: nur die Blätter, eine Seite pro Blatt ---- */
	@page {
		size: A4 landscape;
		margin: 10mm;
	}
	@media print {
		/* App-Chrome weg — Header, Tabs, Banner, sonstiger Tab-Inhalt. */
		:global(header.app-header),
		:global(nav.tabs),
		:global(.conflict-banner) {
			display: none !important;
		}
		:global(main.tab-content) {
			padding: 0 !important;
			margin: 0 !important;
			max-width: none !important;
		}
		.print-toolbar,
		.no-print {
			display: none !important;
		}
		.print-root {
			gap: 0;
		}
		.sheet {
			border: 0;
			border-radius: 0;
			box-shadow: none;
			padding: 0;
			max-width: none;
			page-break-after: always;
		}
		.sheet:last-child {
			page-break-after: auto;
		}
	}
</style>
