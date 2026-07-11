<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import type { GradeLevel, Subject, SubjectCategory } from '../lib/types';
	import { GRADES } from '../lib/types';

	const CATEGORIES: SubjectCategory[] = ['PG', 'VÜ', 'FÖ', 'KU'];

	function newSubject() {
		const s: Subject = {
			code: 'NEU',
			name: 'Neues Fach',
			category: 'PG',
			isMain: false,
			hoursPerWeek: {},
			maxConsecutive: 99
		};
		store.doc.subjects.push(s);
	}

	function removeSubject(code: string) {
		const usedBy = store.doc.specs.filter(x => x.subject === code).length;
		if (usedBy > 0) {
			if (!confirm(`Fach "${code}" wird in ${usedBy} Lehreinheiten verwendet. Wirklich löschen?`)) return;
			store.doc.specs = store.doc.specs.filter(x => x.subject !== code);
		}
		store.doc.subjects = store.doc.subjects.filter(x => x.code !== code);
	}

	function setHours(s: Subject, grade: GradeLevel, val: string) {
		const n = Number(val);
		if (n > 0) s.hoursPerWeek[grade] = n;
		else delete s.hoursPerWeek[grade];
	}
</script>

<div class="head">
	<h2>Fächer ({store.doc.subjects.length})</h2>
	<button class="btn primary" onclick={newSubject}>+ Neues Fach</button>
</div>

{#if store.doc.subjects.length === 0}
	<div class="empty-hint">Noch keine Fächer.</div>
{:else}
	<table class="subjects">
		<thead>
			<tr>
				<th>Code</th>
				<th>Name</th>
				<th>Kat.</th>
				<th>Hauptfach</th>
				<!-- Audit A6: ehrlicher Tooltip — das Feld ist im Solver v2 (noch)
				     nicht angebunden; main_run nutzt nur das globale Regeln-Limit. -->
				<th title="Maximale Anzahl gleicher Fächer in Folge an einem Tag. ⚠ Wirkt derzeit NICHT im Generator — es gilt nur das globale Limit im Reiter ‚Regeln‘ (max. Hauptfächer in Folge). Pro-Fach-Anbindung ist Backlog.">Max&nbsp;in Folge&nbsp;ⓘ</th>
				<th>Stunden 5./6./7./8. (informativ)</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each store.doc.subjects as s (s.code)}
				<tr>
					<td><input type="text" bind:value={s.code} class="mono" size="6" /></td>
					<td><input type="text" bind:value={s.name} class="name-input" /></td>
					<td>
						<select bind:value={s.category}>
							{#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
						</select>
					</td>
					<td>
						<input type="checkbox" bind:checked={s.isMain} />
					</td>
					<td>
						<input type="number" min="1" max="8" step="1" bind:value={s.maxConsecutive} class="max-consec-input" placeholder="—" />
					</td>
					<td class="hours">
						{#each GRADES as g}
							<input
								type="number"
								min="0"
								step="0.5"
								value={s.hoursPerWeek[g] ?? ''}
								onchange={e => setHours(s, g, (e.currentTarget as HTMLInputElement).value)}
							/>
						{/each}
					</td>
					<td>
						<button class="btn danger small" onclick={() => removeSubject(s.code)}>×</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.head h2 {
		font-size: 18px;
	}
	table.subjects {
		width: 100%;
		border-collapse: collapse;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	table.subjects th,
	table.subjects td {
		padding: 8px 10px;
		text-align: left;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	table.subjects th {
		background: var(--bg-soft);
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
	}
	.mono {
		font-family: var(--mono);
		font-weight: 700;
		border: 0;
		background: transparent;
	}
	.mono:focus {
		outline: 1px solid var(--accent);
		border-radius: 4px;
		background: white;
	}
	.name-input {
		border: 0;
		background: transparent;
		font: inherit;
		min-width: 200px;
	}
	.name-input:focus {
		outline: 1px solid var(--accent);
		border-radius: 4px;
		padding: 1px 4px;
		background: white;
	}
	.max-consec-input {
		width: 50px;
		padding: 3px 6px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		text-align: center;
	}
	.hours {
		display: flex;
		gap: 4px;
	}
	.hours input {
		width: 50px;
		padding: 3px 6px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	select {
		padding: 3px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 12px;
	}
	.btn.small {
		padding: 3px 8px;
		font-size: 12px;
	}
</style>
