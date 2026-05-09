<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
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
	<div class="rule sub" title="Wenn aktiv: Solver erzwingt freistundenfreie Pläne. Findet er keine, läuft eine zweite Phase mit Soft-Penalty und meldet die Lockerung im UI.">
		<label class="lbl">
			<input
				type="checkbox"
				bind:checked={c.noFreePeriodsForClass.strict}
				disabled={!c.noFreePeriodsForClass.enabled}
			/>
			↳ strikt (mit Auto-Lockerung bei Unmöglichkeit)
		</label>
	</div>

	<div class="rule">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.noMainSubjectAfternoon.enabled} />
			Hauptfach nicht am Nachmittag (ab Stunde
			<input type="number" min="1" max="8" bind:value={c.noMainSubjectAfternoon.afternoonStartsAtPeriod} class="inline" />)
		</label>
		<input type="number" min="0" step="5" bind:value={c.noMainSubjectAfternoon.weight} disabled={!c.noMainSubjectAfternoon.enabled} />
	</div>

	<div class="rule sub">
		<label class="lbl">
			<input type="checkbox" bind:checked={c.noMainSubjectAfternoon.applyToAllSubjects} disabled={!c.noMainSubjectAfternoon.enabled} />
			↳ Auch Nebenfächer am Nachmittag vermeiden (schwächer als Hauptfächer)
		</label>
		<input type="number" min="0" step="5" bind:value={c.noMainSubjectAfternoon.weightAllSubjects} disabled={!c.noMainSubjectAfternoon.enabled || !c.noMainSubjectAfternoon.applyToAllSubjects} />
	</div>

	<div class="rule">
		<span class="lbl">
			Mindest-Stunden pro Tag pro Schulstufe
			<span class="hint" title="Hartes Constraint. Default 4 (= jeder Tag mindestens 4 Stunden pro Stufe). 0 deaktiviert die Regel. Bei UNSAT lockert der Solver automatisch auf 3, dann 0.">ℹ</span>
		</span>
		<input type="number" min="0" max="8" bind:value={c.minDailySlotsPerGrade} aria-label="Mindest-Stunden pro Tag pro Schulstufe" />
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
	.rule.sub {
		padding-left: 22px;
		font-size: 12px;
		color: var(--text-muted);
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
	.rule.sub {
		padding-left: 32px;
		background: var(--bg-soft);
		font-size: 13px;
		color: var(--text-muted);
	}
	.hint {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: 6px;
		font-size: 11px;
		color: var(--text-muted);
		border-radius: 50%;
		background: var(--bg-soft);
		cursor: help;
		user-select: none;
	}
</style>
