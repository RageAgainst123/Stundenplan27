<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { downloadAsJson, readJsonFile } from '../lib/persistence';
	import { loadSnapshots, importSnapshots } from '../lib/snapshots';
	import { importCsv, type ImportResult } from '../lib/import/csv';
	import { emptyDoc } from '../lib/types';

	let preview = $state<ImportResult | null>(null);
	let previewFileName = $state<string>('');
	let lastCsvText = $state<string>('');
	let importError = $state<string>('');
	/**
	 * Wenn true, werden VOR dem Import alle Lehrer/Fächer/Lehreinheiten/Placements
	 * gelöscht — sinnvoll wenn man eine andere Schule importiert und NICHT
	 * mergen will. Default false (= bisheriges Merge-Verhalten).
	 */
	let replaceOnImport = $state<boolean>(false);
	/**
	 * Phase 17: Smart-Merge — Team-Teaching aus Sokrates erkennen. Default
	 * false → exakt das bisherige Verhalten (eine Spec pro CSV-Zeile).
	 * Aktivieren wenn die Lehrfächerverteilung Team-Teaching nutzt
	 * (z.B. Hauptlehrer mit Stütz-Lehrern in einigen Stunden).
	 */
	let smartMerge = $state<boolean>(false);

	async function handleCsvFile(file: File) {
		importError = '';
		try {
			const text = await file.text();
			lastCsvText = text;
			preview = importCsv(text, { smartMerge });
			previewFileName = file.name;
		} catch (e) {
			importError = String(e);
			preview = null;
		}
	}

	// Bei Toggle der Smart-Merge-Option live neu parsen, wenn schon eine Vorschau aktiv ist
	$effect(() => {
		void smartMerge;
		if (lastCsvText && preview) {
			try {
				preview = importCsv(lastCsvText, { smartMerge });
			} catch (e) {
				importError = String(e);
			}
		}
	});

	function applyImport() {
		if (!preview) return;
		// Wenn replaceOnImport: vorher alle bestehenden Stamm- und Plan-Daten
		// wegwerfen. Schuljahr bleibt erhalten (= weiterhin im Header sichtbar).
		// Zweite Bestätigung als Schutz: Verlust ist unwiderruflich.
		if (replaceOnImport) {
			const total = store.doc.teachers.length + store.doc.subjects.length + store.doc.specs.length;
			if (total > 0) {
				if (!confirm(
					`⚠ Achtung: Alle vorhandenen Daten werden VOR dem Import gelöscht.\n\n` +
					`${store.doc.teachers.length} Lehrer, ${store.doc.subjects.length} Fächer, ` +
					`${store.doc.specs.length} Lehreinheiten und ${store.doc.placed.length} Platzierungen ` +
					`gehen unwiderruflich verloren.\n\nTrotzdem fortfahren?`
				)) return;
			}
			store.replace(emptyDoc(store.doc.schoolYear));
		}
		// Merge strategy: add new teachers/subjects/specs, do not overwrite existing.
		// Existing items are matched by stable keys: teacher.personalNumber (or name+placeholder)
		// and subject.code.
		const existingTeacherKeys = new Set(
			store.doc.teachers.map(t =>
				t.personalNumber ? `pn:${t.personalNumber}` : `nm:${t.name.toLowerCase()}`
			)
		);
		const existingSubjectCodes = new Set(store.doc.subjects.map(s => s.code));

		// Map imported teacher.id → final id (existing one if matched, else imported)
		const teacherIdMap = new Map<string, string>();
		for (const imported of preview.teachers) {
			const key = imported.personalNumber
				? `pn:${imported.personalNumber}`
				: `nm:${imported.name.toLowerCase()}`;
			if (existingTeacherKeys.has(key)) {
				const existing = store.doc.teachers.find(t =>
					imported.personalNumber
						? t.personalNumber === imported.personalNumber
						: t.name.toLowerCase() === imported.name.toLowerCase()
				)!;
				teacherIdMap.set(imported.id, existing.id);
				// Merge new subjects into existing teacher's list
				for (const sc of imported.subjects) {
					if (!existing.subjects.includes(sc)) existing.subjects.push(sc);
				}
			} else {
				store.doc.teachers.push(imported);
				teacherIdMap.set(imported.id, imported.id);
			}
		}
		for (const imported of preview.subjects) {
			if (!existingSubjectCodes.has(imported.code)) {
				store.doc.subjects.push(imported);
			}
		}
		for (const imported of preview.specs) {
			// Remap every team member id through the teacherIdMap so newly-
			// imported teachers point at the correct existing/new teacher rows.
			const finalTeachers = imported.teachers.map(tid => teacherIdMap.get(tid) ?? tid);
			store.doc.specs.push({ ...imported, teachers: finalTeachers });
		}

		store.persistNow();
		preview = null;
		previewFileName = '';
		alert(
			`Import erfolgreich. Aktuell: ${store.doc.teachers.length} Lehrer, ${store.doc.subjects.length} Fächer, ${store.doc.specs.length} Lehreinheiten.`
		);
	}

	function discardPreview() {
		preview = null;
		previewFileName = '';
	}

	async function handleJsonFile(file: File) {
		try {
			const { doc, snapshots } = await readJsonFile(file);
			const snapInfo = snapshots.length > 0 ? `\nEnthält außerdem ${snapshots.length} Plan-Snapshots (werden zur Galerie hinzugefügt).` : '';
			if (!confirm(`Aktuellen Plan durch "${doc.schoolYear}" ersetzen? Bestehende Daten gehen verloren.${snapInfo}`)) return;
			store.replace(doc);
			// SN2: mitgesicherte Snapshots in die Galerie mergen (per id,
			// Duplikate werden übersprungen).
			let added = 0;
			if (snapshots.length > 0) {
				added = importSnapshots(snapshots);
				window.dispatchEvent(new CustomEvent('snapshots-changed'));
			}
			alert(added > 0 ? `Backup geladen. ${added} Snapshots übernommen.` : 'Backup geladen.');
		} catch (e) {
			alert(`Laden fehlgeschlagen: ${e}`);
		}
	}

	/**
	 * SN2: Snapshots optional mitsichern (Default an). Damit überleben die
	 * Plan-Varianten auch Browser-Wechsel/Origin-Probleme — Snapshots leben
	 * sonst NUR im localStorage dieses Browsers.
	 */
	let includeSnapshots = $state<boolean>(true);

	function exportJson() {
		const snaps = includeSnapshots ? loadSnapshots() : [];
		downloadAsJson($state.snapshot(store.doc) as any, undefined, snaps);
	}

	function resetAll() {
		if (!confirm('Wirklich ALLE Daten löschen und neu beginnen?')) return;
		store.replace(emptyDoc(store.doc.schoolYear));
	}

	// ---- preview helpers ----
	function previewCounts() {
		if (!preview) return { newTeachers: 0, existingTeachers: 0, newSubjects: 0, newSpecs: 0 };
		const existingTeacherKeys = new Set(
			store.doc.teachers.map(t =>
				t.personalNumber ? `pn:${t.personalNumber}` : `nm:${t.name.toLowerCase()}`
			)
		);
		const existingSubjectCodes = new Set(store.doc.subjects.map(s => s.code));
		let newTeachers = 0,
			existingTeachers = 0,
			newSubjects = 0;
		for (const t of preview.teachers) {
			const key = t.personalNumber ? `pn:${t.personalNumber}` : `nm:${t.name.toLowerCase()}`;
			if (existingTeacherKeys.has(key)) existingTeachers++;
			else newTeachers++;
		}
		for (const s of preview.subjects) {
			if (!existingSubjectCodes.has(s.code)) newSubjects++;
		}
		return { newTeachers, existingTeachers, newSubjects, newSpecs: preview.specs.length };
	}
</script>

<section class="grid">
	<div class="card">
		<h2>CSV importieren</h2>
		<p class="muted">
			Sokrates-Export („Liste") als <code>.csv</code> hochladen. Wird als Basis angelegt, kann
			danach im Editor frei verändert werden.
		</p>

		<details class="howto">
			<summary>📋 Wie exportiere ich die Liste aus Sokrates?</summary>
			<ol>
				<li><strong>Auswertungen</strong> → <strong>Dynamische Suche</strong> öffnen</li>
				<li><strong>Lehrerliste</strong> auswählen</li>
				<li>Eintrag <strong>800 Lehrfächerverteilung</strong> wählen</li>
				<li>Folgende Spalten-Checkboxen aktivieren:
					<ul class="checks">
						<li>☑ Gegenstand</li>
						<li>☑ Klasse(n)</li>
						<li>☑ Gruppe</li>
						<li>☑ Stunden</li>
						<li>☑ ErgStunden</li>
						<li>☑ Schulstufen</li>
						<li>☑ LehrerIn</li>
					</ul>
				</li>
				<li>Als <code>.csv</code> (Semikolon-getrennt) exportieren und hier hochladen</li>
			</ol>
		</details>

		<label class="smart-merge-toggle" class:on={smartMerge}>
			<input type="checkbox" bind:checked={smartMerge} />
			<span>
				<strong>🔬 Team-Teaching erkennen (experimentell)</strong>
				<small>Wenn aktiv: Hauptlehrer + Stütz-Lehrer (Erg-Stunden) werden zu
				EINER Lehreinheit zusammengeführt. Leistungsgruppen (Stand/AHS) werden
				automatisch gekoppelt. <strong>Bei MS-SiG-Liste aus lassen.</strong></small>
			</span>
		</label>

		<input
			type="file"
			accept=".csv,text/csv"
			onchange={e => {
				const f = (e.currentTarget as HTMLInputElement).files?.[0];
				if (f) handleCsvFile(f);
			}}
		/>

		{#if importError}
			<div class="err">{importError}</div>
		{/if}

		{#if preview}
			{@const c = previewCounts()}
			<div class="diff">
				<h3>Vorschau – {previewFileName}</h3>
				<ul>
					<li>{c.newTeachers} neue Lehrer · {c.existingTeachers} bereits vorhanden</li>
					<li>{c.newSubjects} neue Fächer</li>
					<li>{c.newSpecs} Lehreinheiten werden angelegt</li>
				</ul>
				{#if preview.smartMergeStats}
					{@const s = preview.smartMergeStats}
					<div class="merge-stats">
						<strong>🔬 Smart-Merge aktiv:</strong>
						<ul>
							{#if s.teamGroupsMerged > 0}
								<li>{s.teamGroupsMerged} Team-Teaching-Gruppen zusammengeführt
								(Hauptlehrer + Stütz-Lehrer)</li>
							{/if}
							{#if s.sameTeacherRowsCollapsed > 0}
								<li>{s.sameTeacherRowsCollapsed} Mehrfachzeilen desselben Lehrers summiert</li>
							{/if}
							{#if s.leistungsCouplings > 0}
								<li>{s.leistungsCouplings} Leistungsgruppen-Kopplungen automatisch gesetzt
								(Stand+AHS laufen parallel)</li>
							{/if}
							{#if s.teamGroupsMerged === 0 && s.sameTeacherRowsCollapsed === 0 && s.leistungsCouplings === 0}
								<li>Keine Team-Teaching-Muster in dieser CSV gefunden — Resultat
								identisch zum normalen Import.</li>
							{/if}
						</ul>
					</div>
				{/if}
				{#if preview.warnings.length > 0}
					<details>
						<summary>{preview.warnings.length} Warnungen</summary>
						<ul class="warnings">
							{#each preview.warnings as w}
								<li>{w}</li>
							{/each}
						</ul>
					</details>
				{/if}
				<label class="replace-toggle" class:on={replaceOnImport}>
					<input type="checkbox" bind:checked={replaceOnImport} />
					<span><strong>⚠ Alle bestehenden Daten vor dem Import löschen</strong>
					<small>Aktivieren wenn du eine andere Schule importierst und NICHT mit den
					bisherigen Daten zusammenführen willst.</small></span>
				</label>
				<div class="actions">
					<button class="btn" onclick={discardPreview}>Verwerfen</button>
					<button
						class="btn"
						class:primary={!replaceOnImport}
						class:danger={replaceOnImport}
						onclick={applyImport}
					>
						{replaceOnImport ? '🗑 Alles löschen & Importieren' : 'Importieren (mergen)'}
					</button>
				</div>
			</div>
		{/if}

		{#if !preview && (store.doc.teachers.length > 0 || store.doc.subjects.length > 0 || store.doc.specs.length > 0)}
			<div class="reset-hint">
				<button class="btn danger" onclick={resetAll}>
					🗑 Alle Daten löschen und von vorne beginnen
				</button>
				<small>
					Aktuell:
					<strong>{store.doc.teachers.length}</strong> Lehrer ·
					<strong>{store.doc.subjects.length}</strong> Fächer ·
					<strong>{store.doc.specs.length}</strong> Lehreinheiten ·
					<strong>{store.doc.placed.length}</strong> Platzierungen
				</small>
			</div>
		{/if}
	</div>

	<div class="card">
		<h2>JSON Backup</h2>
		<p class="muted">Kompletten Plan als JSON-Datei sichern oder wiederherstellen.</p>
		<label class="muted" style="display:flex; align-items:center; gap:6px; font-size:13px; margin-bottom:8px; cursor:pointer" title="Snapshots leben sonst nur im Browser-Speicher dieses Rechners — mitgesichert überleben sie auch Browser-Wechsel und Speicher-Verlust">
			<input type="checkbox" bind:checked={includeSnapshots} />
			📸 Plan-Snapshots mitsichern
		</label>
		<div class="actions">
			<button class="btn primary" onclick={exportJson}>Als JSON exportieren</button>
			<label class="btn" style="cursor:pointer">
				JSON laden…
				<input
					type="file"
					accept=".json,application/json"
					hidden
					onchange={e => {
						const f = (e.currentTarget as HTMLInputElement).files?.[0];
						if (f) handleJsonFile(f);
					}}
				/>
			</label>
		</div>
		<hr />
		<button class="btn danger" onclick={resetAll}>Alles zurücksetzen</button>
	</div>
</section>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
		gap: 20px;
	}
	.card {
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 20px;
		box-shadow: var(--shadow-sm);
	}
	.card h2 {
		margin-bottom: 8px;
		font-size: 16px;
	}
	.muted {
		color: var(--text-muted);
		font-size: 13px;
		margin-bottom: 14px;
	}
	.howto {
		margin: 8px 0 14px;
		padding: 8px 12px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 13px;
	}
	.howto > summary {
		cursor: pointer;
		font-weight: 600;
		user-select: none;
	}
	.howto ol {
		margin: 10px 0 4px 22px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.howto .checks {
		list-style: none;
		margin: 6px 0 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 2px 12px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.err {
		color: var(--err);
		padding: 8px 10px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 6px;
		margin-top: 12px;
		font-size: 13px;
	}
	.diff {
		margin-top: 16px;
		padding: 12px 14px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.diff h3 {
		font-size: 14px;
		margin-bottom: 8px;
	}
	.diff ul {
		margin: 6px 0 12px 18px;
		font-size: 13px;
	}
	.warnings {
		max-height: 200px;
		overflow: auto;
		font-family: var(--mono);
		font-size: 11px;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.smart-merge-toggle {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin: 0 0 10px;
		padding: 10px 12px;
		background: #f0f7ff;
		border: 1px solid #b8d4f1;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.smart-merge-toggle:hover {
		background: #e6f0fb;
	}
	.smart-merge-toggle.on {
		background: #dcebfa;
		border-color: #6ba7e0;
	}
	.smart-merge-toggle input {
		margin-top: 2px;
		flex-shrink: 0;
	}
	.smart-merge-toggle span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.smart-merge-toggle small {
		color: var(--text-muted);
		font-size: 11px;
	}
	.merge-stats {
		margin: 10px 0;
		padding: 8px 12px;
		background: #f0f7ff;
		border: 1px solid #b8d4f1;
		border-radius: 6px;
		font-size: 12px;
	}
	.merge-stats > strong {
		display: block;
		margin-bottom: 4px;
	}
	.merge-stats ul {
		margin: 0 0 0 18px;
	}
	.replace-toggle {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin-top: 14px;
		padding: 10px 12px;
		background: #fffaf0;
		border: 1px solid #f4d4a0;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.replace-toggle:hover {
		background: #fff5e0;
	}
	.replace-toggle.on {
		background: #fef2f2;
		border-color: #fca5a5;
		color: #991b1b;
	}
	.replace-toggle input {
		margin-top: 2px;
		flex-shrink: 0;
	}
	.replace-toggle span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.replace-toggle small {
		color: var(--text-muted);
		font-size: 11px;
	}
	.replace-toggle.on small {
		color: #b34141;
	}
	.reset-hint {
		margin-top: 16px;
		padding: 12px;
		background: #fef2f2;
		border: 1px dashed #fca5a5;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-start;
	}
	.reset-hint small {
		color: #7a3737;
		font-size: 11px;
	}
	hr {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 16px 0;
	}
</style>
