<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { DAYS, PERIODS, type AvailabilityCell, type Day, type Period, type Teacher } from '../lib/types';
	import { FALLBACK_TEACHER_COLOR } from '../lib/teacher-helpers';
	import AvailabilityGrid from './AvailabilityGrid.svelte';

	let editingId = $state<string | null>(null);

	function newTeacher() {
		const next = store.doc.teachers.length + 1;
		const t: Teacher = {
			id: crypto.randomUUID(),
			name: 'Neuer Lehrer',
			shortNumber: next,
			color: FALLBACK_TEACHER_COLOR,
			subjects: [],
			unavailable: []
		};
		store.doc.teachers.push(t);
		editingId = t.id;
	}

	function removeTeacher(id: string) {
		const t = store.doc.teachers.find(x => x.id === id);
		if (!t) return;
		const usedBy = store.doc.specs.filter(s => s.teachers.includes(id)).length;
		if (usedBy > 0) {
			if (!confirm(`Lehrer "${t.name}" hat ${usedBy} Lehreinheiten. Wirklich löschen?`)) return;
			// Remove the teacher from all specs. Specs that had this teacher
			// as the ONLY team member are deleted; specs where they were
			// the second teacher just lose them from the team.
			store.doc.specs = store.doc.specs
				.map(s => ({ ...s, teachers: s.teachers.filter(tid => tid !== id) }))
				.filter(s => s.teachers.length > 0);
		}
		store.doc.teachers = store.doc.teachers.filter(x => x.id !== id);
	}

	function toggleSubject(t: Teacher, code: string) {
		const idx = t.subjects.indexOf(code);
		if (idx >= 0) t.subjects.splice(idx, 1);
		else t.subjects.push(code);
	}

	// Anwesenheitspflicht: 0/undefined = Auto (kompakt optimieren),
	// 2-5 = Mindest-Anwesenheitstage. Für Vollzeit/Supplierungs-Reserve.
	function setMinDays(t: Teacher, raw: string) {
		const v = parseInt(raw, 10);
		t.minDaysPresent = Number.isFinite(v) && v > 0 ? v : undefined;
	}

	function unavailableHas(t: Teacher, day: Day, period: Period): boolean {
		return t.unavailable.some(u => u.day === day && u.period === period);
	}
	function toggleUnavailable(t: Teacher, day: Day, period: Period) {
		const idx = t.unavailable.findIndex(u => u.day === day && u.period === period);
		if (idx >= 0) t.unavailable.splice(idx, 1);
		else t.unavailable.push({ day, period });
	}
</script>

<div class="head">
	<h2>Lehrer ({store.doc.teachers.length})</h2>
	<button class="btn primary" onclick={newTeacher}>+ Neuer Lehrer</button>
</div>

{#if store.doc.teachers.length === 0}
	<div class="empty-hint">
		Keine Lehrer angelegt. CSV-Import auf Seite "Import / Export" oder manuell anlegen.
	</div>
{:else}
	<table class="teachers">
		<thead>
			<tr>
				<th>#</th>
				<th>Farbe</th>
				<th>Name</th>
				<th>Pers.-Nr.</th>
				<th>Fächer</th>
				<th title="Anwesenheitspflicht: Muss der Lehrer an einer Mindest-Anzahl von Tagen an der Schule sein? ‚Auto' = der Generator darf kompakt planen (freie Tage möglich). ‚Jeden Tag' für Vollzeitlehrer und Supplierungs-Reserven. Gewicht der Regel im Reiter ‚Regeln'.">Anwesenheit&nbsp;ⓘ</th>
				<th>Verf.</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each store.doc.teachers as t (t.id)}
				<tr class:placeholder={t.placeholder}>
					<td>L{t.shortNumber}</td>
					<td>
						<input type="color" bind:value={t.color} />
					</td>
					<td>
						<input type="text" bind:value={t.name} class="name-input" />
						{#if t.isLeader}<span class="badge">Leitung</span>{/if}
						{#if t.placeholder}<span class="badge warn">Platzhalter</span>{/if}
					</td>
					<td class="mono">{t.personalNumber ?? '–'}</td>
					<td class="subjects-cell">
						{#each store.doc.subjects as s (s.code)}
							<label class="chip" class:on={t.subjects.includes(s.code)}>
								<input
									type="checkbox"
									checked={t.subjects.includes(s.code)}
									onchange={() => toggleSubject(t, s.code)}
								/>
								{s.code}
							</label>
						{/each}
					</td>
					<td>
						<select
							class="presence-select"
							class:active={(t.minDaysPresent ?? 0) > 0}
							value={String(t.minDaysPresent ?? 0)}
							onchange={e => setMinDays(t, (e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="0">Auto</option>
							<option value="2">mind. 2 Tage</option>
							<option value="3">mind. 3 Tage</option>
							<option value="4">mind. 4 Tage</option>
							<option value="5">Jeden Tag</option>
						</select>
					</td>
					<td>
						<button
							class="btn small"
							onclick={() => (editingId = editingId === t.id ? null : t.id)}
						>
							{t.unavailable.length} ✗ {editingId === t.id ? '▴' : '▾'}
						</button>
					</td>
					<td>
						<button class="btn danger small" onclick={() => removeTeacher(t.id)}>×</button>
					</td>
				</tr>
				{#if editingId === t.id}
					<tr class="expanded-row">
						<td colspan="8">
							<div class="expanded">
								<strong>Verfügbarkeit –</strong>
								<span class="muted">Felder anklicken, um Slots als „nicht verfügbar" zu markieren.</span>
								<AvailabilityGrid
									cells={t.unavailable}
									onToggle={(day, period) => toggleUnavailable(t, day, period)}
									has={(day, period) => unavailableHas(t, day, period)}
								/>
							</div>
						</td>
					</tr>
				{/if}
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
	table.teachers {
		width: 100%;
		border-collapse: collapse;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	table.teachers th,
	table.teachers td {
		padding: 8px 10px;
		text-align: left;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
		vertical-align: middle;
	}
	table.teachers th {
		background: var(--bg-soft);
		color: var(--text-muted);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
	}
	tr.placeholder {
		background: #fffbeb;
	}
	tr.expanded-row td {
		background: var(--bg-soft);
		padding: 12px 16px;
	}
	.expanded {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.muted {
		color: var(--text-muted);
		font-size: 12px;
	}
	/* Anwesenheitspflicht-Dropdown: aktiv (Pflicht gesetzt) hervorheben. */
	.presence-select {
		padding: 3px 6px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-panel);
	}
	.presence-select.active {
		border-color: var(--accent);
		font-weight: 600;
	}
	.name-input {
		border: 0;
		background: transparent;
		font: inherit;
		font-weight: 600;
		min-width: 200px;
	}
	.name-input:focus {
		outline: 1px solid var(--accent);
		border-radius: 4px;
		padding: 2px 4px;
		background: white;
	}
	.subjects-cell {
		max-width: 380px;
	}
	.chip {
		display: inline-block;
		padding: 2px 8px;
		margin: 2px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 11px;
		cursor: pointer;
		background: var(--bg-soft);
	}
	.chip.on {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.chip input {
		display: none;
	}
	.badge {
		display: inline-block;
		padding: 1px 6px;
		margin-left: 6px;
		font-size: 10px;
		border-radius: 4px;
		background: var(--accent-bg);
		color: var(--accent);
		font-weight: 600;
		text-transform: uppercase;
	}
	.badge.warn {
		background: #fef3c7;
		color: var(--warn);
	}
	.btn.small {
		padding: 3px 8px;
		font-size: 12px;
	}
	.mono {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text-muted);
	}
	input[type='color'] {
		width: 28px;
		height: 22px;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0;
	}
</style>
