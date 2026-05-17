<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import type { GradeLevel, LessonSpec, TeachingSegment, WeekPattern } from '../lib/types';
	import { GRADES } from '../lib/types';
	import { blockPresets, blockLabel, blockKey, parseBlockKey, groupColor } from '../lib/blocks';
	import { teacherColor as teacherColorH } from '../lib/teacher-helpers';
	import TeamTeachingEditor from './TeamTeachingEditor.svelte';

	let filterTeacher = $state<string>('');
	let filterSubject = $state<string>('');
	let filterGroup = $state<string>('');
	let groupBy = $state<'none' | 'group'>('group');
	let selectedIds = $state<Set<string>>(new Set());
	/** Phase 17: welche Spec-Zeilen haben den Team-Teaching-Editor offen */
	let expandedTeamEditor = $state<Set<string>>(new Set());

	const weekOptions: { v: WeekPattern; label: string }[] = [
		{ v: 'every', label: 'jede Woche' },
		{ v: 'even', label: 'gerade Woche (G)' },
		{ v: 'odd', label: 'ungerade Woche (U)' }
	];

	const filtered = $derived.by(() => {
		const list = store.doc.specs.filter(s => {
			if (filterTeacher && !s.teachers.includes(filterTeacher)) return false;
			if (filterSubject && s.subject !== filterSubject) return false;
			// Filter dropdown lists couplings (solver-relevant).
			if (filterGroup && s.couplingId !== filterGroup) return false;
			return true;
		});
		if (groupBy === 'group') {
			// Specs with a coupling first (sorted by couplingId), then ungrouped.
			return [...list].sort((a, b) => {
				const ag = a.couplingId ?? '';
				const bg = b.couplingId ?? '';
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
		for (const s of store.doc.specs) if (s.couplingId) set.add(s.couplingId);
		return Array.from(set).sort();
	});

	const teacherColor = (id: string) => teacherColorH(store.doc, id);

	/** Set the primary teacher; preserve all other teachers (de-duplicate).
	 *  Phase 17: bestehende Placements werden auf neue Konflikte geprüft. */
	function setPrimaryTeacher(s: LessonSpec, id: string) {
		const oldTeachers = [...s.teachers];
		const rest = s.teachers.slice(1).filter(t => t !== id);
		s.teachers = id ? [id, ...rest] : rest;
		validateAndCleanupAfterTeacherChange(s, oldTeachers);
	}

	/** Phase 17: Lehrer zur Spec hinzufügen (Team-Teaching). */
	function addTeacherToSpec(s: LessonSpec, id: string) {
		if (!id || s.teachers.includes(id)) return;
		const oldTeachers = [...s.teachers];
		s.teachers = [...s.teachers, id];
		validateAndCleanupAfterTeacherChange(s, oldTeachers);
	}

	/** Phase 17: Lehrer aus Team entfernen. */
	function removeTeacherFromSpec(s: LessonSpec, id: string) {
		const oldTeachers = [...s.teachers];
		s.teachers = s.teachers.filter(t => t !== id);
		// teachingSegments aufräumen — Segmente die den entfernten Lehrer
		// enthielten dürfen ihn nicht mehr referenzieren.
		if (s.teachingSegments && s.teachingSegments.length > 0) {
			const cleaned = s.teachingSegments
				.map(seg => ({ ...seg, teachers: seg.teachers.filter(t => t !== id) }))
				.filter(seg => seg.teachers.length > 0);
			if (cleaned.length === 0) {
				s.teachingSegments = undefined;
			} else {
				s.teachingSegments = cleaned;
			}
		}
		validateAndCleanupAfterTeacherChange(s, oldTeachers);
	}

	/**
	 * Phase 17: Nach Lehrer-Änderung an einer Spec prüfen, ob die aktuellen
	 * Placements neue Lehrer-Doppelbelegungen erzeugen. Wenn ja, betroffene
	 * Placements entfernen — der User wird beim nächsten Solver-Lauf neu
	 * platzieren müssen, aber wir verhindern dass die UI inkonsistente Daten
	 * zeigt.
	 */
	function validateAndCleanupAfterTeacherChange(s: LessonSpec, oldTeachers: string[]): void {
		const added = s.teachers.filter(t => !oldTeachers.includes(t));
		if (added.length === 0) return;
		// Pro hinzugefügten Lehrer: checke ob er in einem der spec-eigenen Slots
		// schon woanders unterrichtet.
		const placementsOfThis = store.doc.placed.filter(p => p.specId === s.id);
		const conflictKeys = new Set<string>();
		for (const pl of placementsOfThis) {
			const slotKey = `${pl.day}|${pl.period}`;
			for (const other of store.doc.placed) {
				if (other.specId === s.id) continue;
				if (other.day !== pl.day || other.period !== pl.period) continue;
				const otherSpec = store.doc.specs.find(x => x.id === other.specId);
				if (!otherSpec) continue;
				// Wenn coupling-id gleich ist → erlaubte parallel teaching → kein Konflikt
				if (s.couplingId && otherSpec.couplingId && s.couplingId === otherSpec.couplingId) continue;
				const sharedTeacher = added.find(t => otherSpec.teachers.includes(t));
				if (sharedTeacher) conflictKeys.add(slotKey);
			}
		}
		if (conflictKeys.size === 0) return;
		// Entferne ALLE Placements (s.specId) für die Konflikt-Slots — der User
		// soll explizit neu platzieren bzw. Solver laufen lassen.
		const beforeCount = store.doc.placed.length;
		store.doc.placed = store.doc.placed.filter(p => {
			if (p.specId !== s.id) return true;
			const key = `${p.day}|${p.period}`;
			return !conflictKeys.has(key);
		});
		const removed = beforeCount - store.doc.placed.length;
		console.warn(
			`Phase 17 Cleanup: ${removed} Placements von Spec ${s.subject} entfernt, ` +
			`weil hinzugefügter Lehrer (${added.join(',')}) andere parallele Lehreinheiten blockt.`
		);
		store.persistNow();
	}

	/** Set the optional time-of-day preference for a single spec. */
	function setTimePref(s: LessonSpec, v: string) {
		if (v === 'early' || v === 'late') s.timePref = v;
		else s.timePref = undefined;
	}

	/** Bulk: apply a time-pref to every selected spec. Pass '' to clear. */
	function bulkSetTimePref(v: '' | 'early' | 'late') {
		for (const s of store.doc.specs) {
			if (!selectedIds.has(s.id)) continue;
			if (v === '') s.timePref = undefined;
			else s.timePref = v;
		}
	}

	/** Phase 13: Nachmittag-Politik pro Spec. */
	function setAfternoon(s: LessonSpec, v: string) {
		if (v === 'never' || v === 'allowed' || v === 'preferred') s.afternoonAllowed = v;
	}

	/** Phase 13 Bulk: Nachmittag-Politik für alle ausgewählten Specs. */
	function bulkSetAfternoon(v: 'never' | 'allowed' | 'preferred') {
		for (const s of store.doc.specs) {
			if (!selectedIds.has(s.id)) continue;
			s.afternoonAllowed = v;
		}
	}

	function newSpec() {
		const firstTeacher = store.doc.teachers[0]?.id ?? '';
		const firstSubject = store.doc.subjects[0]?.code ?? '';
		// Phase 13: afternoonAllowed default abhängig vom Subject.isMain.
		const subj = store.doc.subjects.find(x => x.code === firstSubject);
		const afternoonDefault: 'never' | 'allowed' = subj?.isMain ? 'never' : 'allowed';
		const s: LessonSpec = {
			id: crypto.randomUUID(),
			subject: firstSubject,
			teachers: firstTeacher ? [firstTeacher] : [],
			classes: [],
			grades: [],
			weekPattern: 'every',
			count: 1,
			// Phase 7B: blocks=undefined → Auto-Modus (Solver entscheidet).
			blocks: undefined,
			afternoonAllowed: afternoonDefault,
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

	// ---- Coupling ops (Phase 8 v3) ----
	// "Kopplung" = solver constraint: parallel teaching, same slot, multiple
	// teachers. Stored in spec.couplingId. Distinct from spec.groupLabel,
	// which is the descriptive Sokrates "Gruppe" column ("DGB 1/2") and has
	// no solver effect.
	function bulkCouple() {
		const sel = store.doc.specs.filter(s => selectedIds.has(s.id));
		if (sel.length < 2) {
			alert('Bitte mindestens zwei Lehreinheiten auswählen.');
			return;
		}
		// If they already share a non-empty couplingId, do nothing.
		const existingKeys = new Set(sel.map(s => s.couplingId ?? ''));
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
		// Decide on the coupling id (default: prefill with one of the selected
		// specs' groupLabel if available, else generate a timestamp name).
		const candidate =
			(onlyKey ||
				sel.find(s => s.couplingId)?.couplingId ||
				sel.find(s => s.groupLabel)?.groupLabel ||
				`Kopplung ${new Date().toLocaleString('de-AT', { hour12: false }).replace(/[\s,:.]+/g, '-')}`);
		const proposed = prompt(
			`Kopplungs-Name (Solver platziert diese Einheiten zeitgleich):`,
			candidate
		);
		if (proposed === null) return;
		const finalKey = proposed.trim() || candidate;
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id)) s.couplingId = finalKey;
		}
	}

	function bulkUncouple() {
		const sel = store.doc.specs.filter(s => selectedIds.has(s.id));
		const couplable = sel.filter(s => s.couplingId);
		if (couplable.length === 0) {
			alert('Keine der ausgewählten Lehreinheiten ist gekoppelt.');
			return;
		}
		if (!confirm(`${couplable.length} Lehreinheiten entkoppeln?`)) return;
		for (const s of store.doc.specs) {
			if (selectedIds.has(s.id) && s.couplingId) s.couplingId = undefined;
		}
	}

	function uncoupleSingle(specId: string) {
		const spec = store.doc.specs.find(s => s.id === specId);
		if (!spec || !spec.couplingId) return;
		spec.couplingId = undefined;
	}

	// ---- Phase 17: Team-Teaching-Editor (inline) ----
	function toggleTeamEditor(specId: string): void {
		if (expandedTeamEditor.has(specId)) expandedTeamEditor.delete(specId);
		else expandedTeamEditor.add(specId);
		expandedTeamEditor = new Set(expandedTeamEditor);
	}
	function closeTeamEditor(specId: string): void {
		expandedTeamEditor.delete(specId);
		expandedTeamEditor = new Set(expandedTeamEditor);
	}

	// ---- Phase 17: Bulk-Aktion "Als Team-Teaching zusammenführen" ----
	function bulkMergeTeamTeaching(): void {
		const sel = store.doc.specs.filter(s => selectedIds.has(s.id));
		if (sel.length < 2) {
			alert('Bitte mindestens zwei Lehreinheiten auswählen.');
			return;
		}
		// Validierung: gleicher Subject + gleiche Klasse(n) + gleiche Stufen
		const subj = sel[0].subject;
		const klStr = [...sel[0].classes].sort().join('+');
		const gradStr = [...sel[0].grades].sort().join(',');
		const mismatchedIdx = sel.findIndex(s =>
			s.subject !== subj
			|| [...s.classes].sort().join('+') !== klStr
			|| [...s.grades].sort().join(',') !== gradStr
		);
		if (mismatchedIdx >= 0) {
			alert(
				`Zusammenführen nur möglich bei gleichem Fach, Klasse und Stufe.\n\n` +
				`Erste Spec: ${subj} / ${klStr} / Stufe ${gradStr}\n` +
				`${mismatchedIdx + 1}. Spec weicht ab: ${sel[mismatchedIdx].subject} / ` +
				`${sel[mismatchedIdx].classes.join('+')} / Stufe ${sel[mismatchedIdx].grades.join(',')}`
			);
			return;
		}
		// Hauptlehrer = der mit den meisten Stunden. Bei Gleichstand: erster.
		const sortedByCount = [...sel].sort((a, b) => b.count - a.count);
		const main = sortedByCount[0];
		const supportSpecs = sortedByCount.slice(1);
		// Alle Lehrer-IDs sammeln (in der Reihenfolge: Haupt + Stützen nach Stunden absteigend)
		const allTeachers: string[] = [];
		const seen = new Set<string>();
		for (const sp of sortedByCount) {
			for (const tid of sp.teachers) {
				if (!seen.has(tid)) {
					allTeachers.push(tid);
					seen.add(tid);
				}
			}
		}
		// Heuristik für Vorschlags-Segmente:
		//   Hauptlehrer ist in allen Segmenten.
		//   Pro Stütz-Lehrer: x Stunden mit dem Stütz dazu.
		//   Konkret: greifen die Anzahl-Stunden der Stützen und bauen
		//   abgestufte Segmente von "alle drei" → "nur einer Stütz" → "allein".
		const supportHours = supportSpecs.map(sp => Math.min(sp.count, main.count));
		// Sortiere absteigend für nested coverage:
		supportHours.sort((a, b) => b - a);
		const segments: TeachingSegment[] = [];
		let remaining = main.count;
		let prevStart = 0;
		// Anzahl Stützen die in den Stunden 0..supportHours[i]-1 dabei sind
		// = number of supports with supportHours[i] > prevStart
		const breakpoints = [0, ...supportHours, main.count]
			.filter((v, i, a) => a.indexOf(v) === i)
			.sort((a, b) => a - b);
		for (let i = 0; i + 1 < breakpoints.length; i++) {
			const segStart = breakpoints[i];
			const segEnd = breakpoints[i + 1];
			const segHours = segEnd - segStart;
			if (segHours <= 0) continue;
			// In diesem Slot-Bereich sind alle Stützen drin deren supportHours > segStart
			const teachers = [main.teachers[0] ?? allTeachers[0]];
			for (let k = 0; k < supportHours.length; k++) {
				if (supportHours[k] > segStart) {
					const tid = supportSpecs[k].teachers[0];
					if (tid && !teachers.includes(tid)) teachers.push(tid);
				}
			}
			segments.push({ hours: segHours, teachers });
			remaining -= segHours;
			void prevStart;
		}
		void remaining;
		// Confirm-Dialog mit Vorschau
		const teamNames = allTeachers
			.map(tid => store.doc.teachers.find(t => t.id === tid)?.name ?? tid)
			.join(', ');
		const segmentsText = segments
			.map((seg, i) => {
				const names = seg.teachers
					.map(tid => store.doc.teachers.find(t => t.id === tid)?.name?.split(' ')[0] ?? '?')
					.join(' + ');
				return `  ${i + 1}. ${seg.hours}h: ${names}`;
			})
			.join('\n');
		const ok = confirm(
			`🤝 ${sel.length} Lehreinheiten als Team-Teaching zusammenführen?\n\n` +
			`Subject: ${subj}, Klasse ${klStr}, Stufe ${gradStr}\n` +
			`Lehrer-Team: ${teamNames}\n` +
			`Hauptlehrer (mit den meisten Stunden): ${store.doc.teachers.find(t => t.id === main.teachers[0])?.name}\n\n` +
			`Slot-Anzahl der neuen Spec: ${main.count}h\n\n` +
			`Vorgeschlagene Aufteilung:\n${segmentsText}\n\n` +
			`⚠ Die anderen ${supportSpecs.length} Lehreinheiten werden gelöscht.\n\n` +
			`Du kannst die Aufteilung danach noch im Team-Teaching-Editor anpassen.`
		);
		if (!ok) return;
		// In-place mutation des Haupt-Specs + Löschen der Support-Specs.
		main.teachers = [...allTeachers];
		main.teachingSegments = segments;
		// Pinned Placements der gelöschten Specs werden entfernt (sind eh
		// inkonsistent, weil die Specs nicht mehr existieren).
		const supportIds = new Set(supportSpecs.map(s => s.id));
		store.doc.specs = store.doc.specs.filter(s => !supportIds.has(s.id));
		store.doc.placed = store.doc.placed.filter(p => !supportIds.has(p.specId));
		// Auswahl bereinigen + Editor öffnen damit User die Aufteilung sieht
		selectedIds.clear();
		selectedIds = new Set();
		expandedTeamEditor.add(main.id);
		expandedTeamEditor = new Set(expandedTeamEditor);
		store.persistNow();
	}

	// ---- Group analysis (for bulk-toolbar visibility) ----
	const selectedSpecs = $derived(store.doc.specs.filter(s => selectedIds.has(s.id)));
	const canCouple = $derived(selectedSpecs.length >= 2);
	const canUncouple = $derived(selectedSpecs.some(s => s.couplingId));
	// canMergeTeamTeaching: 2+ Specs, alle gleiches Subject + Klasse + Stufe
	const canMergeTeamTeaching = $derived.by(() => {
		if (selectedSpecs.length < 2) return false;
		const first = selectedSpecs[0];
		const subj = first.subject;
		const klStr = [...first.classes].sort().join('+');
		const gradStr = [...first.grades].sort().join(',');
		return selectedSpecs.every(s =>
			s.subject === subj
			&& [...s.classes].sort().join('+') === klStr
			&& [...s.grades].sort().join(',') === gradStr
		);
	});

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
		<select bind:value={filterGroup} title="Filter: nur eine Solver-Kopplung anzeigen">
			<option value="">Alle Kopplungen</option>
			{#each allGroups as g}<option value={g}>{g}</option>{/each}
		</select>
		<label class="check-inline">
			<input type="checkbox" checked={groupBy === 'group'} onchange={(e) => (groupBy = (e.currentTarget as HTMLInputElement).checked ? 'group' : 'none')} />
			nach Kopplung gruppieren
		</label>
	</div>
	<button class="btn primary" onclick={newSpec}>+ Neue Lehreinheit</button>
</div>

{#if selectedIds.size > 0}
	<div class="bulk-toolbar">
		<strong>{selectedIds.size}</strong> ausgewählt:
		<button class="btn small primary" disabled={!canCouple} onclick={bulkCouple} title="Gemeinsamer Slot — Lehrer unterrichten zeitgleich (getrennte Gruppen)">⛓ Koppeln</button>
		<button
			class="btn small primary"
			disabled={!canMergeTeamTeaching}
			onclick={bulkMergeTeamTeaching}
			title={canMergeTeamTeaching
				? 'Mehrere Lehreinheiten gleichen Fachs/Klasse/Stufe zu einer Team-Teaching-Spec mit Segmenten zusammenführen'
				: 'Erfordert 2+ Specs mit gleichem Fach, Klasse und Stufe'}
		>🤝 Als Team-Teaching</button>
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
		<select class="bulk-select" onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; bulkSetTimePref(v as '' | 'early' | 'late'); (e.currentTarget as HTMLSelectElement).value = ''; }} title="Tageszeit-Präferenz für ausgewählte Lerneinheiten">
			<option value="">Tageszeit setzen…</option>
			<option value="">Egal (zurücksetzen)</option>
			<option value="early">Früh (P1–P3)</option>
			<option value="late">Spät (P5–P8)</option>
		</select>
		<select class="bulk-select" onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v === 'never' || v === 'allowed' || v === 'preferred') bulkSetAfternoon(v); (e.currentTarget as HTMLSelectElement).value = ''; }} title="Nachmittag-Politik (P7–P8) für ausgewählte Lerneinheiten">
			<option value="">Nachmittag…</option>
			<option value="never">🌅 Nie nachmittags (Hard)</option>
			<option value="allowed">↔ Egal</option>
			<option value="preferred">🌆 Bevorzugt nachmittags</option>
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
				<th title="Optionale Tageszeit-Präferenz: bevorzuge frühe oder späte Stunden">Zeit</th>
				<th title="Nachmittag-Politik (P7–P8): 'Nie' = Hard-Constraint (Hauptfächer), 'Egal' = soft, 'Bevorzugt' = soll nachmittags sein">Nachm.</th>
				<th>Woche</th>
				<th>Kopplung</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as s (s.id)}
				{@const gColor = s.couplingId ? groupColor(s.couplingId) : 'transparent'}
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
					<td class="teachers-cell">
						<select
							value={s.teachers[0] ?? ''}
							onchange={e => setPrimaryTeacher(s, (e.currentTarget as HTMLSelectElement).value)}
							style:border-left={`4px solid ${teacherColor(s.teachers[0] ?? '')}`}
						>
							{#each store.doc.teachers as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
						<!-- Phase 17: Mehrere Lehrer werden als Chips angezeigt + Hinzufügen-Select -->
						<div class="teacher-extras">
							{#each s.teachers.slice(1) as tid (tid)}
								<span class="teacher-chip-row" style:--c={teacherColor(tid)}>
									{store.doc.teachers.find(t => t.id === tid)?.name?.split(' ')[0] ?? '?'}
									<button class="chip-remove" onclick={() => removeTeacherFromSpec(s, tid)} title="Lehrer entfernen">×</button>
								</span>
							{/each}
							<select
								value=""
								onchange={e => { const v = (e.currentTarget as HTMLSelectElement).value; addTeacherToSpec(s, v); (e.currentTarget as HTMLSelectElement).value = ''; }}
								class="add-teacher-select"
								title="Weiteren Lehrer hinzufügen (Team-Teaching)"
							>
								<option value="">+ Lehrer</option>
								{#each store.doc.teachers as t}
									{#if !s.teachers.includes(t.id)}<option value={t.id}>{t.name}</option>{/if}
								{/each}
							</select>
							{#if s.teachers.length >= 2}
								<button
									class="tt-toggle"
									class:has-segments={!!s.teachingSegments && s.teachingSegments.length > 0}
									onclick={() => toggleTeamEditor(s.id)}
									title={s.teachingSegments && s.teachingSegments.length > 0
										? `Team-Teaching mit ${s.teachingSegments.length} Segment(en) — Editor öffnen`
										: 'Alle Lehrer in allen Stunden. Klick zum Aufsplitten'}
								>🤝{#if s.teachingSegments && s.teachingSegments.length > 0}<sup>{s.teachingSegments.length}</sup>{/if}</button>
							{/if}
						</div>
					</td>
					<td>
						<div class="classes-cell">
							<input
								type="text"
								value={classesString(s)}
								onchange={e => setClassesString(s, (e.currentTarget as HTMLInputElement).value)}
								placeholder="1a oder 1a+2a"
								size="8"
							/>
							{#if s.groupLabel}
								<span class="group-label" title={`Sokrates-Gruppe (Stufenbezeichnung, ohne Solver-Effekt): ${s.groupLabel}`}>{s.groupLabel}</span>
							{/if}
						</div>
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
					<td class="time-pref-cell">
						<select
							value={s.timePref ?? ''}
							onchange={e => setTimePref(s, (e.currentTarget as HTMLSelectElement).value)}
							class="time-pref-select"
							class:active={!!s.timePref}
							title="Wenn 'Früh': Solver bevorzugt P1–P3. Wenn 'Spät': Solver bevorzugt P5–P8. Egal = keine Präferenz."
						>
							<option value="">Egal</option>
							<option value="early">Früh</option>
							<option value="late">Spät</option>
						</select>
					</td>
					<td class="afternoon-cell">
						<select
							value={s.afternoonAllowed ?? 'allowed'}
							onchange={e => setAfternoon(s, (e.currentTarget as HTMLSelectElement).value)}
							class="afternoon-select"
							class:never={s.afternoonAllowed === 'never'}
							class:preferred={s.afternoonAllowed === 'preferred'}
							title="Nachmittag (P7–P8): 'Nie' = Hard-Constraint, 'Egal' = soft, 'Bevorzugt' = soll nachmittags sein"
						>
							<option value="never">🌅 Nie</option>
							<option value="allowed">↔ Egal</option>
							<option value="preferred">🌆 Bevorzugt</option>
						</select>
					</td>
					<td>
						<select bind:value={s.weekPattern}>
							{#each weekOptions as w}<option value={w.v}>{w.label}</option>{/each}
						</select>
					</td>
					<td>
						{#if s.couplingId}
							<span class="group-tag-wrap">
								<button class="group-tag" style:background={gColor} onclick={() => (filterGroup = filterGroup === s.couplingId ? '' : s.couplingId ?? '')} title="Klick: Kopplung filtern">
									{s.couplingId}
								</button>
								<button class="group-tag-x" onclick={() => uncoupleSingle(s.id)} title="Aus Kopplung entfernen">×</button>
							</span>
						{:else}
							<input type="text" bind:value={s.couplingId} placeholder="–" size="14" class="group-input" title="Solver-Kopplung: Lehreinheiten mit gleichem Wert werden zeitgleich platziert" />
						{/if}
					</td>
					<td class="actions">
						<button class="btn small" onclick={() => duplicateSpec(s)} title="Duplizieren">⎘</button>
						<button class="btn danger small" onclick={() => removeSpec(s.id)} title="Löschen">×</button>
					</td>
				</tr>
				{#if expandedTeamEditor.has(s.id)}
					<tr class="tt-editor-row">
						<td colspan="13">
							<TeamTeachingEditor spec={s} onClose={() => closeTeamEditor(s.id)} />
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
	.time-pref-cell {
		min-width: 70px;
	}
	.time-pref-select {
		min-width: 70px;
		font-size: 11px;
	}
	/* The select shows in a muted style when no preference is set, and
	   becomes visually prominent once the user picks one. */
	.time-pref-select:not(.active) {
		color: var(--text-muted);
		background: transparent;
		border-style: dashed;
	}
	.afternoon-cell {
		min-width: 90px;
	}
	.afternoon-select {
		min-width: 90px;
		font-size: 11px;
	}
	.afternoon-select.never {
		background: rgba(34, 139, 230, 0.1);
		color: #1971c2;
		font-weight: 600;
	}
	.afternoon-select.preferred {
		background: rgba(244, 162, 97, 0.15);
		color: #c47e34;
		font-weight: 600;
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
	.classes-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: flex-start;
	}
	.teachers-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.teachers-cell select {
		width: 100%;
	}
	/* Phase 17: ".second-teacher" wurde durch Multi-Lehrer-Chips ersetzt. */
	/* Phase 17: Multi-Lehrer-Chips + Add-Select + Team-Toggle */
	.teacher-extras {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: center;
	}
	.teacher-chip-row {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px 1px 7px;
		background: color-mix(in srgb, var(--c, #888) 25%, white);
		border-left: 3px solid var(--c, #888);
		border-radius: 3px;
		font-size: 10px;
		font-weight: 600;
	}
	.chip-remove {
		background: transparent;
		border: 0;
		color: var(--text-muted);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	.chip-remove:hover {
		color: var(--err);
	}
	.add-teacher-select {
		font-size: 10px;
		padding: 1px 2px;
		border: 1px dashed var(--border);
		background: transparent;
		color: var(--text-muted);
		flex: 0 1 auto;
		max-width: 90px;
	}
	.tt-toggle {
		border: 1px solid var(--border);
		background: white;
		border-radius: 4px;
		padding: 1px 6px;
		font-size: 12px;
		cursor: pointer;
		line-height: 1.4;
	}
	.tt-toggle:hover {
		background: #f0f7ff;
		border-color: #6ba7e0;
	}
	.tt-toggle.has-segments {
		background: #dcebfa;
		border-color: #6ba7e0;
		font-weight: 700;
	}
	.tt-toggle sup {
		font-size: 9px;
		color: #2563b4;
		margin-left: 1px;
	}
	.tt-editor-row > td {
		background: #f8fcff;
		padding: 0 !important;
		border-top: 0 !important;
	}
	.group-label {
		display: inline-block;
		padding: 1px 6px;
		font-size: 10px;
		color: var(--text-muted);
		background: var(--bg-soft);
		border: 1px dashed var(--border-strong);
		border-radius: 3px;
		white-space: nowrap;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		font-style: italic;
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
