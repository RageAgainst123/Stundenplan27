<script lang="ts">
	import type { LessonSpec, TeachingSegment } from '../lib/types';
	import { validateTeachingSegments } from '../lib/types';
	import { teacherById as teacherByIdH } from '../lib/teacher-helpers';
	import { useStore } from '../lib/store.svelte';

	interface Props {
		spec: LessonSpec;
		onClose: () => void;
	}
	let { spec, onClose }: Props = $props();

	const store = useStore();
	const teacherById = (id: string) => teacherByIdH(store.doc, id);

	// Lokaler Editor-State — wird erst beim "Übernehmen" auf spec geschrieben,
	// damit der User abbrechen kann ohne die Spec zu mutieren.
	// $state-Initialisierer aus prop muss in eine Funktion gewrappt werden,
	// um Svelte 5 Initial-Capture-Warning zu vermeiden.
	function initialSegments(): TeachingSegment[] {
		if (spec.teachingSegments && spec.teachingSegments.length > 0) {
			return structuredClone($state.snapshot(spec.teachingSegments)) as TeachingSegment[];
		}
		return [{ hours: spec.count, teachers: [...spec.teachers] }];
	}
	let segments = $state<TeachingSegment[]>(initialSegments());

	const sumHours = $derived(segments.reduce((s, seg) => s + (Number(seg.hours) || 0), 0));
	const errors = $derived(validateTeachingSegments({
		count: spec.count,
		teachers: spec.teachers,
		teachingSegments: segments
	}));
	const valid = $derived(errors.length === 0);

	function addSegment() {
		// Rest-Stunden zur Vereinfachung in das neue Segment
		const remaining = Math.max(0.5, spec.count - sumHours);
		segments.push({
			hours: remaining,
			teachers: [spec.teachers[0]].filter(Boolean) as string[]
		});
		segments = [...segments];
	}

	function removeSegment(idx: number) {
		segments.splice(idx, 1);
		segments = [...segments];
	}

	function toggleTeacherInSegment(idx: number, tid: string) {
		const seg = segments[idx];
		const has = seg.teachers.includes(tid);
		seg.teachers = has ? seg.teachers.filter(t => t !== tid) : [...seg.teachers, tid];
		segments = [...segments];
	}

	function apply() {
		if (!valid) return;
		// Wenn 1 Segment und alle Lehrer = spec.teachers → kein Splitting nötig,
		// teachingSegments löschen (= pre-Phase-17-Verhalten).
		if (segments.length === 1
			&& segments[0].teachers.length === spec.teachers.length
			&& spec.teachers.every(t => segments[0].teachers.includes(t))
		) {
			spec.teachingSegments = undefined;
		} else {
			spec.teachingSegments = segments.map(seg => ({
				hours: Number(seg.hours),
				teachers: [...seg.teachers],
				...(seg.label ? { label: seg.label } : {})
			}));
		}
		store.persistNow();
		onClose();
	}

	function reset() {
		segments = [{ hours: spec.count, teachers: [...spec.teachers] }];
	}
</script>

<div class="tt-editor">
	<div class="header">
		<strong>🤝 Team-Teaching aufteilen — {spec.subject} ({spec.count}h)</strong>
		<button class="close" onclick={onClose} aria-label="Editor schließen">×</button>
	</div>

	<table class="segments">
		<thead>
			<tr>
				<th>#</th>
				<th>Stunden</th>
				{#each spec.teachers as tid (tid)}
					{@const t = teacherById(tid)}
					<th class="teacher-col" style:--c={t?.color ?? '#999'}>
						<span class="teacher-chip">{t?.name ?? '?'}</span>
					</th>
				{/each}
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each segments as seg, idx (idx)}
				<tr>
					<td class="num">{idx + 1}</td>
					<td>
						<input
							type="number"
							min="0.5"
							step="0.5"
							bind:value={seg.hours}
							class="hours-input"
						/> h
					</td>
					{#each spec.teachers as tid (tid)}
						<td class="check-cell">
							<label>
								<input
									type="checkbox"
									checked={seg.teachers.includes(tid)}
									onchange={() => toggleTeacherInSegment(idx, tid)}
								/>
							</label>
						</td>
					{/each}
					<td>
						<button class="remove" onclick={() => removeSegment(idx)} title="Segment entfernen" disabled={segments.length === 1}>×</button>
					</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr>
				<td colspan={2 + spec.teachers.length + 1} class="summary">
					Summe: <strong class:bad={!valid}>{sumHours}</strong>/{spec.count}h
					{#if valid}
						<span class="ok">✓</span>
					{:else}
						<span class="bad">✗</span>
					{/if}
				</td>
			</tr>
		</tfoot>
	</table>

	{#if errors.length > 0}
		<ul class="errs">
			{#each errors as e}<li>{e}</li>{/each}
		</ul>
	{/if}

	<div class="actions">
		<button class="btn" onclick={addSegment}>+ Segment</button>
		<button class="btn" onclick={reset} title="Auf ein Segment mit allen Lehrern zurücksetzen">↺ Zurücksetzen</button>
		<span style="margin-left:auto"></span>
		<button class="btn" onclick={onClose}>Abbrechen</button>
		<button class="btn primary" onclick={apply} disabled={!valid}>Übernehmen</button>
	</div>

	<p class="hint">
		Jedes Segment entspricht einer Anzahl Wochenstunden mit einem
		eigenen Lehrer-Team. Der Solver platziert die Stunden separat — der
		bestehende „🤝-Hinweis" auf der Spec-Zeile zeigt die Aufteilung an.
	</p>
</div>

<style>
	.tt-editor {
		background: #f5fbff;
		border: 1px solid #b8d4f1;
		border-radius: 6px;
		padding: 12px 14px;
		margin: 8px 0;
		font-size: 13px;
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.close {
		background: transparent;
		border: 0;
		font-size: 18px;
		cursor: pointer;
		padding: 0 6px;
	}
	.close:hover {
		color: var(--err);
	}
	table.segments {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 8px;
	}
	table.segments th,
	table.segments td {
		padding: 4px 6px;
		text-align: center;
		border-bottom: 1px solid var(--border);
	}
	th.teacher-col {
		border-bottom: 3px solid var(--c, var(--border));
		font-size: 12px;
		padding-bottom: 4px;
	}
	.teacher-chip {
		display: inline-block;
		padding: 2px 6px;
		background: color-mix(in srgb, var(--c) 25%, white);
		border-radius: 4px;
		font-weight: 600;
		font-size: 11px;
	}
	.num {
		color: var(--text-muted);
		font-weight: 700;
		width: 26px;
	}
	.hours-input {
		width: 56px;
		text-align: right;
		padding: 2px 4px;
		font-family: var(--mono);
	}
	.check-cell input {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}
	.remove {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--err);
		cursor: pointer;
		padding: 0 6px;
		border-radius: 4px;
	}
	.remove:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.summary {
		text-align: right;
		padding-top: 6px;
		font-size: 13px;
	}
	.summary .ok {
		color: var(--ok, #1d9c47);
		margin-left: 4px;
	}
	.summary .bad {
		color: var(--err);
		margin-left: 4px;
	}
	.errs {
		margin: 6px 0;
		padding: 6px 12px;
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 4px;
		color: #991b1b;
		font-size: 12px;
	}
	.errs li {
		margin-left: 12px;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
	.hint {
		margin-top: 10px;
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
	}
</style>
