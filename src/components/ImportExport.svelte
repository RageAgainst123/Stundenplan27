<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { downloadAsJson, readJsonFile } from '../lib/persistence';
	import { importCsv, type ImportResult } from '../lib/import/csv';
	import { emptyDoc } from '../lib/types';

	let preview = $state<ImportResult | null>(null);
	let previewFileName = $state<string>('');
	let importError = $state<string>('');

	async function handleCsvFile(file: File) {
		importError = '';
		try {
			const text = await file.text();
			preview = importCsv(text);
			previewFileName = file.name;
		} catch (e) {
			importError = String(e);
			preview = null;
		}
	}

	function applyImport() {
		if (!preview) return;
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
			const doc = await readJsonFile(file);
			if (!confirm(`Aktuellen Plan durch "${doc.schoolYear}" ersetzen? Bestehende Daten gehen verloren.`)) return;
			store.replace(doc);
			alert('Backup geladen.');
		} catch (e) {
			alert(`Laden fehlgeschlagen: ${e}`);
		}
	}

	function exportJson() {
		downloadAsJson($state.snapshot(store.doc) as any);
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
				<div class="actions">
					<button class="btn" onclick={discardPreview}>Verwerfen</button>
					<button class="btn primary" onclick={applyImport}>Importieren</button>
				</div>
			</div>
		{/if}
	</div>

	<div class="card">
		<h2>JSON Backup</h2>
		<p class="muted">Kompletten Plan als JSON-Datei sichern oder wiederherstellen.</p>
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
	hr {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 16px 0;
	}
</style>
