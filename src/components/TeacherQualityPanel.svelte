<script lang="ts">
	// Solver-Opt Schritt 6: Lehrer-Qualitäts-Report.
	// Beantwortet „WARUM ist der Plan gut/schlecht für Lehrer X?" —
	// aufklappbares Panel, schlechtester Lehrer zuerst.
	import { useStore } from '../lib/store.svelte';
	import { computeTeacherQuality } from '../lib/teacher-quality';
	import { DAYS } from '../lib/types';
	const store = useStore();

	let open = $state<boolean>(false);
	let expandedId = $state<string | null>(null);

	const rows = $derived(computeTeacherQuality(store.doc));
	const totalGaps = $derived(rows.reduce((s, r) => s + r.gaps, 0));
	const totalMiniDays = $derived(rows.reduce((s, r) => s + r.miniDays, 0));

	function gapClass(gaps: number): string {
		if (gaps === 0) return 'good';
		if (gaps <= 2) return 'mid';
		return 'bad';
	}

	function fmtPeriods(periods: number[]): string {
		// Kompakt: [1,2,3,6] → "1–3, 6"
		if (periods.length === 0) return '—';
		const parts: string[] = [];
		let start = periods[0];
		let prev = periods[0];
		for (let i = 1; i <= periods.length; i++) {
			const p = periods[i];
			if (p === prev + 1) {
				prev = p;
				continue;
			}
			parts.push(start === prev ? `${start}` : `${start}–${prev}`);
			start = p;
			prev = p;
		}
		return parts.join(', ');
	}

	function toggleExpand(id: string): void {
		expandedId = expandedId === id ? null : id;
	}
</script>

<div class="tq-panel">
	<button class="tq-toggle" onclick={() => (open = !open)} aria-expanded={open}>
		{open ? '▼' : '▶'} 👩‍🏫 Lehrer-Qualität
		{#if rows.length > 0}
			<span class="tq-summary-chips">
				<span class="chip {gapClass(totalGaps)}">{totalGaps} Springstunde{totalGaps === 1 ? '' : 'n'}</span>
				{#if totalMiniDays > 0}
					<span class="chip mid">{totalMiniDays} Mini-Tag{totalMiniDays === 1 ? '' : 'e'}</span>
				{/if}
			</span>
		{/if}
	</button>
	{#if open}
		{#if rows.length === 0}
			<p class="muted small">Noch kein Plan vorhanden — erst generieren, dann zeigt dieser Report pro Lehrer Springstunden, Anwesenheitstage und Mini-Tage.</p>
		{:else}
			<p class="muted small">Sortiert: schlechtester Lehrer zuerst (meiste Springstunden). Zeile anklicken für Tagesdetails.</p>
			<table class="tq-table">
				<thead>
					<tr>
						<th>Lehrer</th>
						<th title="Unterrichtsstunden pro Woche">h/Woche</th>
						<th title="Anwesenheitstage / Ideal. Ideal = Wochenstunden ÷ 6 aufgerundet; bei Anwesenheitspflicht (Lehrer-Tabelle) mindestens die geforderten Tage. 📌 = Pflicht gesetzt, ⚠ = Pflicht verletzt.">Tage</th>
						<th title="Springstunden = innere Lücken im Tagesplan, ganze Woche">Lücken</th>
						<th title="Schlimmster Einzeltag">max/Tag</th>
						<th title="Summe der Späteinstiege (P1-Start = 0)">Spätstart</th>
						<th title="Tage mit nur 1 Stunde">Mini-Tage</th>
						<th title="Lange Tage (≥6h) ohne freie 5./6. Stunde">Mittag ✗</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.teacherId)}
						<tr class="tq-row" class:expanded={expandedId === r.teacherId} onclick={() => toggleExpand(r.teacherId)}>
							<td class="tq-name">
								<span class="dot" style:background={r.color}></span>
								{r.name}
							</td>
							<td>{r.weekLessons}</td>
							<td
								class:warn-cell={r.daysPresent > r.idealDays + 1 || r.missingPresenceDays > 0}
								title={r.minDaysPresent > 0
									? (r.missingPresenceDays > 0
										? `Anwesenheitspflicht verletzt: nur ${r.daysPresent} von ${r.minDaysPresent} geforderten Tagen`
										: `Anwesenheitspflicht erfüllt (mind. ${r.minDaysPresent} Tage)`)
									: undefined}
							>{r.daysPresent}<span class="muted small">/{r.idealDays}</span>{#if r.minDaysPresent > 0}<span class="presence-flag">{r.missingPresenceDays > 0 ? ' ⚠' : ' 📌'}</span>{/if}</td>
							<td><span class="chip {gapClass(r.gaps)}">{r.gaps}</span></td>
							<td>{r.worstDayGaps}</td>
							<td>{r.lateStarts}</td>
							<td class:warn-cell={r.miniDays > 0}>{r.miniDays}</td>
							<td class:warn-cell={r.missedLunch > 0}>{r.missedLunch}</td>
						</tr>
						{#if expandedId === r.teacherId}
							<tr class="tq-detail">
								<td colspan="8">
									<div class="detail-days">
										{#each DAYS as day (day)}
											<span class="detail-day">
												<strong>{day}</strong> {fmtPeriods(r.periodsByDay[day])}
											</span>
										{/each}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</div>

<style>
	.tq-panel {
		flex: 0 0 100%;
		max-width: 800px;
		margin-top: 8px;
		padding: 8px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 13px;
	}
	.tq-toggle {
		background: none;
		border: 0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		padding: 2px 4px;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.tq-toggle:hover {
		color: var(--accent);
	}
	.tq-summary-chips {
		display: flex;
		gap: 6px;
	}
	.chip {
		display: inline-block;
		padding: 1px 8px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 600;
	}
	.chip.good {
		background: #dcfce7;
		color: #15803d;
	}
	.chip.mid {
		background: #fef3c7;
		color: #b45309;
	}
	.chip.bad {
		background: #fee2e2;
		color: #b91c1c;
	}
	.tq-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 6px;
		font-size: 12px;
	}
	.tq-table th {
		text-align: left;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
		font-weight: 600;
		color: var(--text-muted);
		cursor: help;
	}
	.tq-table td {
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
	}
	.tq-row {
		cursor: pointer;
	}
	.tq-row:hover {
		background: var(--bg-soft);
	}
	.tq-row.expanded {
		background: var(--bg-soft);
	}
	.tq-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		white-space: nowrap;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1px solid rgba(0, 0, 0, 0.15);
	}
	.warn-cell {
		color: #b45309;
		font-weight: 600;
	}
	.tq-detail td {
		background: var(--bg-soft);
		padding: 6px 12px;
	}
	.detail-days {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		font-size: 12px;
	}
	.detail-day strong {
		color: var(--text-muted);
		margin-right: 4px;
	}
	.muted.small {
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
