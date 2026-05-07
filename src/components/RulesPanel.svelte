<script lang="ts">
	import { store } from '../lib/store.svelte';
	import { DEFAULT_CONSTRAINTS } from '../lib/types';

	function reset() {
		store.doc.constraints = structuredClone(DEFAULT_CONSTRAINTS);
	}

	const c = $derived(store.doc.constraints);
</script>

<div class="head">
	<h2>Regeln (weiche Constraints)</h2>
	<button class="btn" onclick={reset}>Zurücksetzen</button>
</div>
<p class="muted">
	Diese Regeln führt der Solver beim Generieren als Penalty-Funktion an. Höheres Gewicht = stärker
	bestraft. Harte Regeln (Lehrer-Doppelbelegung, Verfügbarkeit) sind nicht abschaltbar.
</p>

<div class="rules">
	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.noFreePeriodsForClass.enabled} />
			Keine Freistunden für Klassen
		</label>
		<input type="number" min="0" step="5" bind:value={c.noFreePeriodsForClass.weight} disabled={!c.noFreePeriodsForClass.enabled} />
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.noMainSubjectAfternoon.enabled} />
			Hauptfach nicht am Nachmittag (ab Stunde
			<input type="number" min="1" max="8" bind:value={c.noMainSubjectAfternoon.afternoonStartsAtPeriod} class="inline" />)
		</label>
		<input type="number" min="0" step="5" bind:value={c.noMainSubjectAfternoon.weight} disabled={!c.noMainSubjectAfternoon.enabled} />
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.maxConsecutiveMain.enabled} />
			Max. <input type="number" min="1" max="8" bind:value={c.maxConsecutiveMain.max} class="inline" /> Hauptfächer in Folge
		</label>
		<input type="number" min="0" step="5" bind:value={c.maxConsecutiveMain.weight} disabled={!c.maxConsecutiveMain.enabled} />
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.preferMainEarly.enabled} />
			Hauptfächer bevorzugt früh am Tag
		</label>
		<input type="number" min="0" step="5" bind:value={c.preferMainEarly.weight} disabled={!c.preferMainEarly.enabled} />
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.preferDoubleLessonsContiguous.enabled} />
			Doppelstunden zusammenhängend bevorzugen
		</label>
		<input type="number" min="0" step="5" bind:value={c.preferDoubleLessonsContiguous.weight} disabled={!c.preferDoubleLessonsContiguous.enabled} />
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.compactTeacherDays.enabled} />
			Lehrer-Tage kompakt halten (wenig Freistunden)
		</label>
		<input type="number" min="0" step="5" bind:value={c.compactTeacherDays.weight} disabled={!c.compactTeacherDays.enabled} />
	</div>
</div>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.head h2 {
		font-size: 18px;
	}
	.muted {
		color: var(--text-muted);
		font-size: 13px;
		margin-bottom: 18px;
	}
	.rules {
		max-width: 720px;
		display: flex;
		flex-direction: column;
		gap: 0;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.rule {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
	}
	.rule:last-child {
		border-bottom: 0;
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	.rule > input[type='number'] {
		width: 80px;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		text-align: right;
	}
	input.inline {
		width: 50px;
		padding: 2px 4px;
		border: 1px solid var(--border);
		border-radius: 3px;
		font-size: 13px;
	}
</style>
