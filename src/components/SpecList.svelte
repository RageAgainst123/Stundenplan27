<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import type { GradeLevel, LessonSpec, WeekPattern } from '../lib/types';
	import { GRADES } from '../lib/types';

	let filterTeacher = $state<string>('');
	let filterSubject = $state<string>('');

	const weekOptions: { v: WeekPattern; label: string }[] = [
		{ v: 'every', label: 'jede Woche' },
		{ v: 'even', label: 'gerade Woche (G)' },
		{ v: 'odd', label: 'ungerade Woche (U)' }
	];

	const filtered = $derived.by(() => {
		return store.doc.specs.filter(s => {
			if (filterTeacher && s.teacher !== filterTeacher) return false;
			if (filterSubject && s.subject !== filterSubject) return false;
			return true;
		});
	});

	function teacherName(id: string) {
		return store.doc.teachers.find(t => t.id === id)?.name ?? '–';
	}

	function newSpec() {
		const firstTeacher = store.doc.teachers[0]?.id ?? '';
		const firstSubject = store.doc.subjects[0]?.code ?? '';
		const s: LessonSpec = {
			id: crypto.randomUUID(),
			subject: firstSubject,
			teacher: firstTeacher,
			classes: [],
			grades: [],
			weekPattern: 'every',
			count: 1,
			source: 'manual'
		};
		store.doc.specs.push(s);
	}

	function removeSpec(id: string) {
		// also drop placements referencing this spec
		store.doc.placed = store.doc.placed.filter(p => p.specId !== id);
		store.doc.specs = store.doc.specs.filter(s => s.id !== id);
	}

	function toggleGrade(s: LessonSpec, g: GradeLevel) {
		const idx = s.grades.indexOf(g);
		if (idx >= 0) s.grades.splice(idx, 1);
		else {
			s.grades.push(g);
			s.grades.sort((a, b) => a - b);
		}
	}

	function classesString(s: LessonSpec) {
		return s.classes.join('+');
	}
	function setClassesString(s: LessonSpec, val: string) {
		s.classes = val
			.split(/[+\s]+/)
			.map(x => x.trim())
			.filter(Boolean);
	}
</script>

<div class="head">
	<h2>Lehreinheiten ({filtered.length}/{store.doc.specs.length})</h2>
	<div class="filters">
		<select bind:value={filterTeacher}>
			<option value="">Alle Lehrer</option>
			{#each store.doc.teachers as t}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<select bind:value={filterSubject}>
			<option value="">Alle Fächer</option>
			{#each store.doc.subjects as s}<option value={s.code}>{s.code}</option>{/each}
		</select>
	</div>
	<button class="btn primary" onclick={newSpec}>+ Neue Lehreinheit</button>
</div>

{#if filtered.length === 0}
	<div class="empty-hint">Keine Lehreinheiten.</div>
{:else}
	<table class="specs">
		<thead>
			<tr>
				<th>Fach</th>
				<th>Lehrer</th>
				<th>Klasse(n)</th>
				<th>Schulstufen</th>
				<th>Stunden</th>
				<th>Woche</th>
				<th>Kopplung</th>
				<th>Quelle</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as s (s.id)}
				<tr>
					<td>
						<select bind:value={s.subject}>
							{#each store.doc.subjects as sub}
								<option value={sub.code}>{sub.code}</option>
							{/each}
						</select>
					</td>
					<td>
						<select bind:value={s.teacher}>
							{#each store.doc.teachers as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
					</td>
					<td>
						<input
							type="text"
							value={classesString(s)}
							onchange={e => setClassesString(s, (e.currentTarget as HTMLInputElement).value)}
							placeholder="1a oder 1a+2a"
							size="8"
						/>
					</td>
					<td class="grades">
						{#each GRADES as g}
							<label class="grade-chip" class:on={s.grades.includes(g)}>
								<input
									type="checkbox"
									checked={s.grades.includes(g)}
									onchange={() => toggleGrade(s, g)}
								/>
								{g}
							</label>
						{/each}
					</td>
					<td>
						<input type="number" min="0.5" step="0.5" bind:value={s.count} class="hours-input" />
					</td>
					<td>
						<select bind:value={s.weekPattern}>
							{#each weekOptions as w}<option value={w.v}>{w.label}</option>{/each}
						</select>
					</td>
					<td>
						<input
							type="text"
							bind:value={s.groupKey}
							placeholder="Gruppen-Schlüssel"
							size="14"
						/>
					</td>
					<td><span class="source {s.source}">{s.source}</span></td>
					<td><button class="btn danger small" onclick={() => removeSpec(s.id)}>×</button></td>
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
		gap: 16px;
		margin-bottom: 16px;
	}
	.head h2 {
		font-size: 18px;
	}
	.filters {
		display: flex;
		gap: 8px;
		margin-left: auto;
		margin-right: 12px;
	}
	.filters select {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 13px;
	}
	table.specs {
		width: 100%;
		border-collapse: collapse;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 13px;
	}
	table.specs th,
	table.specs td {
		padding: 6px 8px;
		text-align: left;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	table.specs th {
		background: var(--bg-soft);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
	}
	select,
	input[type='text'],
	input[type='number'] {
		padding: 3px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 12px;
		font: inherit;
	}
	.hours-input {
		width: 60px;
	}
	.grades {
		white-space: nowrap;
	}
	.grade-chip {
		display: inline-block;
		padding: 2px 6px;
		margin: 1px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 11px;
		cursor: pointer;
		background: var(--bg-soft);
	}
	.grade-chip.on {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.grade-chip input {
		display: none;
	}
	.source {
		display: inline-block;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 10px;
		text-transform: uppercase;
		font-weight: 600;
	}
	.source.csv {
		background: var(--accent-bg);
		color: var(--accent);
	}
	.source.manual {
		background: var(--bg-soft);
		color: var(--text-muted);
	}
	.btn.small {
		padding: 3px 8px;
		font-size: 12px;
	}
</style>
