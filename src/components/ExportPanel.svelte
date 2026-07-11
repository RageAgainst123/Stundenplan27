<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES } from '../lib/types';
	import { buildSlotOccupancy } from '../lib/schedule-helpers';
	import { teacherStripeBackground, teacherTint } from '../lib/teacher-helpers';
	const store = useStore();

	// Optionen
	let includeClassPlan = $state(true);
	let includePerTeacher = $state(true);
	let includeTeacherOverview = $state(true);
	let busy = $state(false);
	let lastError = $state<string>('');

	// Lehrer-Farb-Overrides für diesen Export
	let colorOverrides = $state<Record<string, string>>({});

	function effectiveColor(teacherId: string, baseColor: string): string {
		return colorOverrides[teacherId] ?? baseColor;
	}

	function resetColors(): void {
		colorOverrides = {};
	}

	function setOverride(teacherId: string, color: string): void {
		colorOverrides = { ...colorOverrides, [teacherId]: color };
	}

	// Vorschau-Daten — gemeinsame Slot-Map (Audit A5, identischer Lookup
	// wie excel-export.ts und WeekView).
	const slotMap = $derived.by(() => {
		void store.doc.placed.length;
		void store.doc.specs.length;
		return buildSlotOccupancy(store.doc);
	});

	const hasPlan = $derived(store.doc.placed.length > 0);
	const activeTeachers = $derived.by(() => {
		const ids = new Set<string>();
		for (const pl of store.doc.placed) {
			const spec = store.doc.specs.find(s => s.id === pl.specId);
			if (!spec) continue;
			const tids = pl.teachers ?? spec.teachers;
			tids.forEach(t => ids.add(t));
		}
		return store.doc.teachers
			.filter(t => ids.has(t.id))
			.sort((a, b) => a.shortNumber - b.shortNumber);
	});

	async function downloadExcel(): Promise<void> {
		busy = true;
		lastError = '';
		try {
			const mod = await import('../lib/excel-export');
			const blob = await mod.buildExcel(store.doc, {
				includeClassPlan,
				includePerTeacher,
				includeTeacherOverview,
				teacherColorOverrides: colorOverrides
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
			a.download = `stundenplan-${ts}.xlsx`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			console.error('Excel export failed', e);
		} finally {
			busy = false;
		}
	}

</script>

<div class="export-panel">
	{#if !hasPlan}
		<div class="empty-hint">
			<p>Es gibt noch keinen platzierten Plan zum Exportieren.</p>
			<p class="muted small">Wechsle zum „Stundenplan"-Tab und klicke „Plan generieren".</p>
		</div>
	{:else}
		<section class="config">
			<h2>📊 Excel-Export</h2>
			<p class="muted">
				Generiert eine <code>.xlsx</code>-Datei mit Klassenplan (farbig),
				pro Lehrer einen persönlichen Wochenplan (schwarz/weiß für Druck) und
				eine Lehrer-Übersicht mit Last-Verteilung.
			</p>

			<div class="opts">
				<label>
					<input type="checkbox" bind:checked={includeClassPlan} />
					<strong>Klassenplan-Sheets (3)</strong>
					<small>— „Klassenplan" farbig + „Klassenplan-Filter" bereinigt (mit Lehrer-Header) + „Klassenplan S-W" schwarz/weiß mit Legende</small>
				</label>
				<label>
					<input type="checkbox" bind:checked={includePerTeacher} />
					<strong>Pro Lehrer ein Wochenplan</strong> — schwarz/weiß, A4 quer,
					mit Legende (L1 → Lehrer XYZ)
				</label>
				<label>
					<input type="checkbox" bind:checked={includeTeacherOverview} />
					<strong>Lehrer-Übersicht</strong> — Stunden pro Tag + Σ Gesamt, A4 hoch
				</label>
			</div>

			<div class="actions">
				<button class="btn primary big" onclick={downloadExcel} disabled={busy || (!includeClassPlan && !includePerTeacher && !includeTeacherOverview)}>
					{#if busy}⏳ Generiere…{:else}📥 Excel herunterladen{/if}
				</button>
				{#if lastError}
					<div class="err">{lastError}</div>
				{/if}
			</div>
		</section>

		<section class="colors">
			<h3>🎨 Lehrer-Farben (Override für diesen Export)</h3>
			<p class="muted small">
				Hier definierte Farben überschreiben die Stamm-Farben des Lehrers
				NUR für diesen Excel-Export. Stammdaten bleiben unverändert.
			</p>
			<div class="color-grid">
				{#each activeTeachers as t (t.id)}
					{@const eff = effectiveColor(t.id, t.color)}
					{@const overridden = colorOverrides[t.id] !== undefined}
					<div class="color-row" class:overridden>
						<span class="badge">L{t.shortNumber}</span>
						<span class="name">{t.name}</span>
						<input
							type="color"
							value={eff}
							onchange={e => setOverride(t.id, (e.currentTarget as HTMLInputElement).value)}
							title="Farbe für diesen Export wählen"
						/>
						{#if overridden}
							<button class="btn ghost xs" onclick={() => { const c = { ...colorOverrides }; delete c[t.id]; colorOverrides = c; }} title="Override zurücksetzen">↺</button>
						{/if}
					</div>
				{/each}
			</div>
			{#if Object.keys(colorOverrides).length > 0}
				<button class="btn small" onclick={resetColors}>↺ Alle Overrides zurücksetzen</button>
			{/if}
		</section>

		<section class="preview">
			<h3>👁 Vorschau — Klassenplan (wie das Excel aussieht)</h3>
			<div class="grid-wrap">
				<table class="preview-grid">
					<thead>
						<tr>
							<th class="time-col"></th>
							{#each DAYS as d, i}
								<th colspan="4" class="day-head">{d}</th>
								{#if i < DAYS.length - 1}<th class="gap"></th>{/if}
							{/each}
						</tr>
						<tr>
							<th class="time-col"></th>
							{#each DAYS as _, i}
								{#each GRADES as g}<th class="grade-head">{g}.</th>{/each}
								{#if i < DAYS.length - 1}<th class="gap"></th>{/if}
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each PERIODS as period, pIdx}
							<tr>
								<th class="time-col">
									<span class="pnum">{period}.</span>
									<span class="ptime">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
								</th>
								{#each DAYS as day, dIdx}
									{#each GRADES as grade}
										{@const entries = slotMap.get(`${day}|${period}|${grade}`) ?? []}
										{@const primary = entries[0]}
										{#if primary}
											{@const allTeachers = (() => {
												const seen = new Set<string>();
												const list: typeof entries[number]['teachers'] = [];
												for (const e of entries) {
													for (const t of e.teachers) {
														if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
													}
												}
												return list;
											})()}
											{@const firstColor = allTeachers[0] ? effectiveColor(allTeachers[0].id, allTeachers[0].color) : '#9ca3af'}
											{@const bgGradient = allTeachers.length === 0
												? teacherTint('#9ca3af')
												: teacherStripeBackground(allTeachers.map(t => effectiveColor(t.id, t.color)))}
											<td class="slot filled" style:background={bgGradient} style:border-left={`3px solid ${firstColor}`}>
												<div class="slot-line">
													<span class="subj">{primary.spec.subject}</span>
													<span class="teach">{allTeachers.slice(0, 3).map(t => 'L' + t.shortNumber).join(' ')}{#if allTeachers.length > 3} +{allTeachers.length - 3}{/if}</span>
												</div>
												<div class="slot-meta">
													{primary.spec.grades.join('+')}
													{#if primary.spec.weekPattern !== 'every'}[{primary.spec.weekPattern === 'even' ? 'G' : 'U'}]{/if}
												</div>
											</td>
										{:else}
											<td class="slot"></td>
										{/if}
									{/each}
									{#if dIdx < DAYS.length - 1}<td class="gap"></td>{/if}
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>

<style>
	.export-panel {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.empty-hint {
		padding: 24px;
		text-align: center;
		background: var(--bg-panel);
		border: 1px dashed var(--border);
		border-radius: 8px;
	}
	.config, .colors, .preview {
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 14px 16px;
	}
	.config h2, .colors h3, .preview h3 {
		margin: 0 0 8px;
	}
	.config h2 {
		font-size: 18px;
	}
	.colors h3, .preview h3 {
		font-size: 14px;
	}
	.muted {
		color: var(--text-muted);
		font-size: 13px;
		margin-bottom: 12px;
	}
	.muted.small {
		font-size: 12px;
	}
	.opts {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 14px;
	}
	.opts label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		cursor: pointer;
	}
	.opts label strong {
		font-weight: 700;
	}
	.opts label small {
		color: var(--text-muted);
		font-size: 11px;
		display: inline;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.btn.big {
		padding: 10px 20px;
		font-size: 14px;
		width: fit-content;
	}
	.err {
		color: var(--err);
		font-size: 13px;
		padding: 6px 10px;
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 4px;
	}
	.color-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 6px;
		margin-bottom: 10px;
	}
	.color-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 12px;
	}
	.color-row.overridden {
		border-color: #6ba7e0;
		background: #f0f7ff;
	}
	.badge {
		font-family: var(--mono);
		font-weight: 700;
		color: var(--text-muted);
		min-width: 22px;
	}
	.name {
		flex: 1;
	}
	.color-row input[type="color"] {
		width: 36px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--border);
		cursor: pointer;
	}
	.btn.xs {
		padding: 2px 5px;
		font-size: 11px;
	}
	.btn.ghost {
		background: transparent;
		border: 1px solid var(--border);
	}
	.grid-wrap {
		overflow-x: auto;
		max-width: 100%;
	}
	table.preview-grid {
		border-collapse: collapse;
		font-size: 10px;
		min-width: 100%;
	}
	.preview-grid th, .preview-grid td {
		border: 1px solid var(--border);
	}
	.preview-grid .day-head {
		background: #374151;
		color: white;
		font-weight: 700;
		padding: 4px;
	}
	.preview-grid .grade-head {
		background: #e5e7eb;
		color: #374151;
		font-weight: 600;
		min-width: 56px;
		padding: 2px 4px;
	}
	.preview-grid .time-col {
		background: #f3f4f6;
		min-width: 60px;
		padding: 4px;
		text-align: center;
	}
	.preview-grid .time-col .pnum {
		display: block;
		font-weight: 700;
	}
	.preview-grid .time-col .ptime {
		display: block;
		font-size: 9px;
		color: var(--text-muted);
	}
	.preview-grid .gap {
		width: 6px;
		background: #374151;
		border: 0;
	}
	.preview-grid .slot {
		min-width: 56px;
		height: 42px;
		padding: 2px 4px;
		vertical-align: middle;
	}
	.preview-grid .slot.filled {
		font-weight: 700;
	}
	.preview-grid .slot-line {
		display: flex;
		justify-content: space-between;
		gap: 4px;
	}
	.preview-grid .slot-line .subj {
		font-weight: 800;
	}
	.preview-grid .slot-line .teach {
		font-family: var(--mono);
		opacity: 0.8;
	}
	.preview-grid .slot-meta {
		font-size: 9px;
		opacity: 0.75;
		margin-top: 2px;
	}
</style>
