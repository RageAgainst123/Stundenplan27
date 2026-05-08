<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import type { GradeLevel, LessonSpec, WeekPattern } from '../lib/types';
	import { GRADES } from '../lib/types';
	import { blockPresets, blockLabel, blockKey, parseBlockKey, groupColor } from '../lib/blocks';

	let filterTeacher = $state<string>('');
	let filterSubject = $state<string>('');
	let filterGroup = $state<string>('');
	let groupBy = $state<'none' | 'group'>('group');
	let selectedIds = $state<Set<string>>(new Set());

	const weekOptions: { v: WeekPattern; label: string }[] = [
		{ v: 'every', label: 'jede Woche' },
		{ v: 'even', label: 'gerade Woche (G)' },
		{ v: 'odd', label: 'ungerade Woche (U)' }
	];

	const filtered = $derived.by(() => {
		const list = store.doc.specs.filter(s => {
			if (filterTeacher && s.teacher !== filterTeacher) return false;
			if (filterSubject && s.subject !== filterSubject) return false;
			if (filterGroup && s.groupKey !== filterGroup) return false;
			return true;
		});
		if (groupBy === 'group') {
			// Specs with groupKey first, sorted by groupKey, then ungrouped
			return [...list].sort((a, b) => {
				const ag = a.groupKey ?? '';
				const bg = b.groupKey ?? '';
				if (ag && !bg) return -1;
				if (!ag && bg) return 1;
				if (ag !== bg) return ag.localeCompare(bg);
				return a.subject.localeCompare(b.subject);
			});
		}
		return list;
	});

	const allGroups = $derived.by(() => {
		const set = new Set<string>();
		for (const s of store.doc.specs) if (s.groupKey) set.add(s.groupKey);
		return Array.from(set).sort();
	});

	function teacherName(id: string) {
		return store.doc.teachers.find(t => t.id === id)?.name ?? '–';
	}
	function teacherColor(id: string) {
		return store.doc.teachers.find(t => t.id === id)?.color ?? '#9ca3af';
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
			// Phase 7B: blocks=undefined → Auto-Modus (Solver entscheidet).
			blocks: undefined,
			includeInSolver: true,
			source: 'manual'
		};
		store.doc.specs.push(s);
	}

	function duplicateSpec(s: LessonSpec) {
		const idx = store.doc.specs.findIndex(x => x.id === s.id);
		const snap = $state.snapshot(s) as LessonSpec;
		const copy: LessonSpec = { ...snap, id: crypto.randomUUID(), source: 'manual' };
		store.doc.specs.splice(idx + 1, 0, copy);
	}

	function removeSpec(id: string) {
		store.doc.placed = store.doc.placed.filter(p => p.specId !== id);
		store.doc.specs = store.doc.specs.filter(s => s.id !== id);
		selectedIds.delete(id);
		selectedIds = new Set(selectedIds);
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

	// ---- Block-Pattern handling ----
	const AUTO_KEY = 'auto';
	function isAutoMode(s: LessonSpec): boolean {
		return !s.blocks || s.blocks.length === 0;
	}
	function currentBlockKey(s: LessonSpec): string {
		if (isAutoMode(s)) return AUTO_KEY;
		return blockKey(s.blocks!);
	}
	function setBlockFromKey(s: LessonSpec, key: string) {
		if (key === AUTO_KEY) {
			s.blocks = undefined;
			return;
		}
		const b = parseBlockKey(key);
		if (b.length > 0) s.blocks = b;
	}
	function syncCount(s: LessonSpec) {
		// When count changes: if user has an explicit pattern that no longer
		// sums to count, reset to Auto-Modus. Auto stays Auto.
		if (isAutoMode(s)) return;
		const sum = (s.blocks ?? []).reduce((a, c) => a + c, 0);
		if (Math.abs(sum - s.count) > 0.001) {
			s.blocks = undefined;
		}
	}

	// ---- Selection / Bulk ops ----
	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
		selectedIds = new Set(selectedIds);
	}
	function toggleSelectAll() {
		if (selectedIds.size === filtered.length) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(filtered.map(s => s.id));
		}
	}
	function clearSelection() {
		selectedIds = new Set();
	}

	function bulkDelete() {
		if (!confirm(`Wirklich ${selectedIds.size} Lehreinheiten löschen?`)) return;
		store.doc.placed = store.doc.placed.filter(p => !selectedIds.has(p.specId));
		store.doc.specs = store.doc.specs.filter(s => !selectedIds.has(s.id));
		clearSelection();
	}
	function bulkDuplicate() {
		const toCopy = store.doc.specs.filter(s => selectedIds.has(s.id));
		for (const s of toCopy) {
			const snap = $state.snapshot(s) as LessonSpec;
			store.doc.specs.push({ ...snap, id: crypto.randomUUID(), source: 'manual' });
		}
		clearSelection();
	}
	function bulkSetSolver(value: boolean) {
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id)) s.includeInSolver = value;
		}
	}
	function bulkSetWeek(pattern: WeekPattern) {
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id)) s.weekPattern = pattern;
		}
	}
	function bulkSetAutoBlocks() {
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id)) s.blocks = undefined;
		}
	}

	// ---- Coupling ops ----
	function bulkCouple() {
		const sel = store.doc.specs.filter(s => selectedIds.has(s.id));
		if (sel.length < 2) {
			alert('Bitte mindestens zwei Lehreinheiten auswählen.');
			return;
		}
		// If they already share a non-empty groupKey, do nothing.
		const existingKeys = new Set(sel.map(s => s.groupKey ?? ''));
		const onlyKey = existingKeys.size === 1 ? [...existingKeys][0] : '';
		// Soft validation: warn on count mismatch
		const counts = Array.from(new Set(sel.map(s => s.count)));
		if (counts.length > 1) {
			const ok = confirm(
				`Die ausgewählten Einheiten haben unterschiedliche Stundenzahlen (${counts.join(', ')}).\n` +
				`Trotzdem koppeln? Der Solver bindet sie nur für die Anzahl gemeinsamer Stunden parallel.`
			);
			if (!ok) return;
		}
		// Decide on the group key:
		const candidate =
			(onlyKey ||
				sel.find(s => s.groupKey)?.groupKey ||
				`Kopplung ${new Date().toLocaleString('de-AT', { hour12: false }).replace(/[\s,:.]+/g, '-')}`);
		const proposed = prompt(
			`Gruppen-Name (oder Enter bestätigen):`,
			candidate
		);
		if (proposed === null) return;
		const finalKey = proposed.trim() || candidate;
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id)) s.groupKey = finalKey;
		}
	}

	function bulkUncouple() {
		const sel = store.doc.specs.filter(s => selectedIds.has(s.id));
		const couplable = sel.filter(s => s.groupKey);
		if (couplable.length === 0) {
			alert('Keine der ausgewählten Lehreinheiten ist gekoppelt.');
			return;
		}
		if (!confirm(`${couplable.length} Lehreinheiten entkoppeln?`)) return;
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id) && s.groupKey) s.groupKey = undefined;
		}
	}

	function uncoupleSingle(specId: string) {
		const spec = store.doc.specs.find(s => s.id === specId);
		if (!spec || !spec.groupKey) return;
		spec.groupKey = undefined;
	}

	// ---- Group analysis (for bulk-toolbar visibility) ----
	const selectedSpecs = $derived(store.doc.specs.filter(s => selectedIds.has(s.id)));
	const canCouple = $derived(selectedSpecs.length >= 2);
	const canUncouple = $derived(selectedSpecs.some(s => s.groupKey));

	// ---- Active stats for header ----
	const activeCount = $derived(store.doc.specs.filter(s => s.includeInSolver).length);
	const ignoredCount = $derived(store.doc.specs.filter(s => !s.includeInSolver).length);
</script>

<div class="head">
	<h2>Lehreinheiten ({filtered.length}/{store.doc.specs.length})</h2>
	<div class="stats">
		<span class="stat ok">{activeCount} aktiv</span>
		{#if ignoredCount > 0}<span class="stat muted">{ignoredCount} ignoriert</span>{/if}
	</div>
	<div class="filters">
		<select bind:value={filterTeacher}>
			<option value="">Alle Lehrer</option>
			{#each store.doc.teachers as t}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<select bind:value={filterSubject}>
			<option value="">Alle Fächer</option>
			{#each store.doc.subjects as s}<option value={s.code}>{s.code}</option>{/each}
		</select>
		<select bind:value={filterGroup}>
			<option value="">Alle Gruppen</option>
			{#each allGroups as g}<option value={g}>{g}</option>{/each}
		</select>
		<label class="check-inline">
			<input type="checkbox" checked={groupBy === 'group'} onchange={(e) => (groupBy = (e.currentTarget as HTMLInputElement).checked ? 'group' : 'none')} />
			gruppieren
		</label>
	</div>
	<button class="btn primary" onclick={newSpec}>+ Neue Lehreinheit</button>
</div>

{#if selectedIds.size > 0}
	<div class="bulk-toolbar">
		<strong>{selectedIds.size}</strong> ausgewählt:
		<button class="btn small primary" disabled={!canCouple} onclick={bulkCouple} title="Gemeinsamer Slot — Lehrer unterrichten zeitgleich">⛓ Koppeln</button>
		<button class="btn small" disabled={!canUncouple} onclick={bulkUncouple} title="Kopplung auflösen">⛓̸ Entkoppeln</button>
		<span class="separator"></span>
		<button class="btn small" onclick={bulkDuplicate}>⎘ Duplizieren</button>
		<button class="btn small" onclick={() => bulkSetSolver(true)}>Solver an</button>
		<button class="btn small" onclick={() => bulkSetSolver(false)}>Solver aus</button>
		<button class="btn small" onclick={bulkSetAutoBlocks} title="Solver wählt Aufteilung selbst (max 1 Doppelstunde)">Block-Pattern Auto</button>
		<select class="bulk-select" onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) bulkSetWeek(v as WeekPattern); (e.currentTarget as HTMLSelectElement).value = ''; }}>
			<option value="">Wochen-Muster setzen…</option>
			{#each weekOptions as w}<option value={w.v}>{w.label}</option>{/each}
		</select>
		<button class="btn danger small" onclick={bulkDelete}>🗑 Löschen</button>
		<span style="margin-left:auto"></span>
		<button class="btn small" onclick={clearSelection}>Auswahl aufheben</button>
	</div>
{/if}

{#if filtered.length === 0}
	<div class="empty-hint">Keine Lehreinheiten.</div>
{:else}
	<table class="specs">
		<thead>
			<tr>
				<th class="sel"><input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onchange={toggleSelectAll} /></th>
				<th>Solver</th>
				<th>Fach</th>
				<th>Lehrer</th>
				<th>Klasse(n)</th>
				<th>Schulstufen</th>
				<th>Stunden</th>
				<th>Block-Pattern</th>
				<th>Woche</th>
				<th>Kopplung</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as s (s.id)}
				{@const gColor = s.groupKey ? groupColor(s.groupKey) : 'transparent'}
				<tr
					class:selected={selectedIds.has(s.id)}
					class:ignored={!s.includeInSolver}
					style:--group-color={gColor}
					style:border-left-color={gColor}
				>
					<td class="sel"><input type="checkbox" checked={selectedIds.has(s.id)} onchange={() => toggleSelect(s.id)} /></td>
					<td class="solver-toggle">
						<label class="switch" title={s.includeInSolver ? 'Wird vom Generator platziert' : 'Vom Generator ignoriert'}>
							<input type="checkbox" bind:checked={s.includeInSolver} />
							<span class="slider"></span>
						</label>
					</td>
					<td>
						<select bind:value={s.subject}>
							{#each store.doc.subjects as sub}
								<option value={sub.code}>{sub.code}</option>
							{/each}
						</select>
					</td>
					<td>
						<select bind:value={s.teacher} style:border-left={`4px solid ${teacherColor(s.teacher)}`}>
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
						<input type="number" min="0.5" step="0.5" bind:value={s.count} class="hours-input" onchange={() => syncCount(s)} />
					</td>
					<td class="block-cell">
						<select
							value={currentBlockKey(s)}
							onchange={(e) => setBlockFromKey(s, (e.currentTarget as HTMLSelectElement).value)}
							class="block-select"
							class:auto={isAutoMode(s)}
						>
							<option value={AUTO_KEY}>Automatisch</option>
							{#each blockPresets(s.count) as preset (blockKey(preset))}
								<option value={blockKey(preset)}>{blockLabel(preset)}</option>
							{/each}
						</select>
						<span
							class="info-icon"
							title={"Automatisch: Der Solver wählt zwischen Einzelstunden und maximal einer Doppelstunde. Beispiel: bei 3 Stunden → entweder 3 Einzelne oder 1 Doppel + 1 Einzel an verschiedenen Tagen.\n\nFür eine bestimmte Aufteilung im Dropdown ein konkretes Pattern wählen."}
							aria-label="Info zum Block-Pattern"
						>ℹ</span>
					</td>
					<td>
						<select bind:value={s.weekPattern}>
							{#each weekOptions as w}<option value={w.v}>{w.label}</option>{/each}
						</select>
					</td>
					<td>
						{#if s.groupKey}
							<span class="group-tag-wrap">
								<button class="group-tag" style:background={gColor} onclick={() => (filterGroup = filterGroup === s.groupKey ? '' : s.groupKey ?? '')} title="Klick: Gruppe filtern">
									{s.groupKey}
								</button>
								<button class="group-tag-x" onclick={() => uncoupleSingle(s.id)} title="Aus Gruppe entfernen">×</button>
							</span>
						{:else}
							<input type="text" bind:value={s.groupKey} placeholder="–" size="14" class="group-input" />
						{/if}
					</td>
					<td class="actions">
						<button class="btn small" onclick={() => duplicateSpec(s)} title="Duplizieren">⎘</button>
						<button class="btn danger small" onclick={() => removeSpec(s.id)} title="Löschen">×</button>
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
		gap: 12px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.head h2 {
		font-size: 18px;
	}
	.stats {
		display: flex;
		gap: 6px;
	}
	.stat {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 600;
	}
	.stat.ok {
		background: rgba(34, 197, 94, 0.15);
		color: var(--ok);
	}
	.stat.muted {
		background: var(--bg-soft);
		color: var(--text-muted);
	}
	.filters {
		display: flex;
		gap: 6px;
		margin-left: auto;
		margin-right: 8px;
		align-items: center;
	}
	.filters select {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 13px;
	}
	.check-inline {
		display: inline-flex;
		gap: 4px;
		font-size: 12px;
		color: var(--text-muted);
		align-items: center;
	}
	.bulk-toolbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 8px 12px;
		margin-bottom: 8px;
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		border-radius: 6px;
		font-size: 13px;
	}
	.bulk-select {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 12px;
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
	table.specs tr {
		border-left: 4px solid transparent;
	}
	table.specs tr.selected {
		background: rgba(37, 99, 235, 0.06);
	}
	table.specs tr.ignored {
		opacity: 0.55;
		background: var(--bg-soft);
	}
	td.sel,
	th.sel {
		width: 22px;
		padding: 6px 4px;
	}
	.solver-toggle {
		width: 38px;
		text-align: center;
	}
	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
	}
	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}
	.slider {
		position: absolute;
		cursor: pointer;
		inset: 0;
		background: var(--border-strong);
		border-radius: 999px;
		transition: 0.15s;
	}
	.slider:before {
		content: '';
		position: absolute;
		left: 2px;
		bottom: 2px;
		width: 14px;
		height: 14px;
		background: white;
		border-radius: 50%;
		transition: 0.15s;
	}
	.switch input:checked + .slider {
		background: var(--ok);
	}
	.switch input:checked + .slider:before {
		transform: translateX(14px);
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
		width: 56px;
	}
	.block-select {
		min-width: 110px;
	}
	.block-select.auto {
		font-style: italic;
		color: var(--text-muted);
	}
	.info-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: 4px;
		font-size: 11px;
		color: var(--text-muted);
		border-radius: 50%;
		background: var(--bg-soft);
		cursor: help;
		user-select: none;
	}
	.info-icon:hover {
		background: var(--accent-bg);
		color: var(--accent);
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
	.group-tag-wrap {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.group-tag-wrap:hover .group-tag-x {
		visibility: visible;
	}
	.group-tag {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid rgba(0, 0, 0, 0.15);
		font-weight: 600;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.7);
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.group-tag-x {
		visibility: hidden;
		width: 18px;
		height: 18px;
		border: 0;
		background: rgba(0, 0, 0, 0.08);
		border-radius: 50%;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		color: var(--err);
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.group-tag-x:hover {
		background: var(--err);
		color: white;
	}
	.group-input {
		font-size: 12px;
		opacity: 0.6;
	}
	.separator {
		width: 1px;
		height: 18px;
		background: rgba(0, 0, 0, 0.12);
		margin: 0 4px;
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	.btn.small {
		padding: 3px 8px;
		font-size: 12px;
	}
</style>
