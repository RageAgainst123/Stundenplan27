<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { DEFAULT_CONSTRAINTS } from '../lib/types';

	function reset() {
		if (!confirm('Alle Regeln auf die Standard-Werte zurücksetzen? Deine angepassten Gewichte gehen verloren.')) return;
		store.doc.constraints = structuredClone(DEFAULT_CONSTRAINTS);
	}

	const c = $derived(store.doc.constraints);
</script>

<div class="head">
	<h2>Regeln (weiche Constraints)</h2>
	<button class="btn" onclick={reset} title="Alle Regeln auf den Stift-Default zurücksetzen">Zurücksetzen</button>
</div>
<p class="muted">
	Diese Regeln führt der Solver beim Generieren als Penalty-Funktion an. Höheres Gewicht = stärker
	bestraft. Harte Regeln (Lehrer-Doppelbelegung, Verfügbarkeit, Pinnings, Couplings) sind nicht
	abschaltbar. Ein Score von 0 = perfekter Plan.
</p>

<!-- ============================================================
	  Sektion 1: Klassen / Schulstufen
	  ============================================================ -->
<section>
	<h3>Klassen & Schulstufen</h3>
	<div class="rules">
		<!-- Keine Freistunden -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.noFreePeriodsForClass.enabled} />
				<span>
					Keine Freistunden für Klassen
					<span class="hint" title="Penalty pro Sandwich-Lücke je (Tag, Stufe). Beispiel: P1+P3 belegt, P2 leer = 1 Lücke. Im strict-Modus wird das Gewicht intern ×50 multipliziert (de facto hart) und bei UNSAT automatisch gelockert.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.noFreePeriodsForClass.weight} disabled={!c.noFreePeriodsForClass.enabled} class="weight" />
		</div>
		<div class="rule sub">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.noFreePeriodsForClass.strict} disabled={!c.noFreePeriodsForClass.enabled} />
				↳ strikt (Constraint quasi-hart, Auto-Lockerung bei Unmöglichkeit)
			</label>
		</div>

		<!-- Mindest-Stunden pro Tag -->
		<div class="rule">
			<label class="lbl">
				<span>
					Mindest-Stunden pro Tag pro Stufe
					<span class="hint" title="Hartes Anti-Wochenend-Pendel: jede aktive Stufe braucht mindestens N Stunden pro Tag. 0 deaktiviert die Regel. Default 4 für die MS SiG.">ℹ</span>
				</span>
				<input type="number" min="0" max="8" bind:value={c.minDailySlotsPerGrade} class="inline" />
			</label>
			<input type="number" min="0" step="50" bind:value={c.minDailyWeight} class="weight" />
		</div>

		<!-- Tagesausgleich -->
		<div class="rule">
			<span class="lbl">
				Tagesausgleich (gleichmäßige Verteilung)
				<span class="hint" title="Bestraft Stufen-Tage mit zu wenig Stunden — der Solver verteilt Lerneinheiten gleichmäßiger über Mo–Fr statt früh in der Woche zu stapeln.">ℹ</span>
			</span>
			<input type="number" min="0" step="10" bind:value={c.unevenDaysWeight} class="weight" />
		</div>

		<!-- Beginn in 1. Stunde -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.mustStartFirstPeriod.enabled} />
				<span>
					Beginn in 1. Stunde (kein Lücken-Anfang)
					<span class="hint" title="Wenn ein Stufentag aktiv ist, muss P1 belegt sein. Verhindert 'Schule beginnt 4. Stunde'-Pläne. Bei UNSAT in der Auto-Lockerung deaktiviert.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="50" bind:value={c.mustStartFirstPeriod.weight} disabled={!c.mustStartFirstPeriod.enabled} class="weight" />
		</div>

		<!-- Fach max 1× pro Tag -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.subjectMaxOncePerDay.enabled} />
				<span>
					Fach max. 1× pro Tag pro Stufe
					<span class="hint" title="Verhindert 'M morgens, M nachmittags' am gleichen Tag. Eine Doppelstunde zählt als 1× — sie wird nicht bestraft.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="10" bind:value={c.subjectMaxOncePerDay.weight} disabled={!c.subjectMaxOncePerDay.enabled} class="weight" />
		</div>

		<!-- Lerneinheiten über Wochentage verteilen -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.preferDoubleLessonsContiguous.enabled} />
				<span>
					Lerneinheiten über Wochentage verteilen
					<span class="hint" title="Mehrere Stunden derselben Lerneinheit sollen nicht am selben Tag liegen. Nützlich bei BSP-Doppelstunden, EH usw. — vermeidet 'Mathe-Marathon-Tag'.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.preferDoubleLessonsContiguous.weight} disabled={!c.preferDoubleLessonsContiguous.enabled} class="weight" />
		</div>
	</div>
</section>

<!-- ============================================================
	  Sektion 2: Hauptfächer & Pädagogik
	  ============================================================ -->
<section>
	<h3>Hauptfächer & Pädagogik</h3>
	<div class="rules">
		<!-- Hauptfach Nachmittag -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.noMainSubjectAfternoon.enabled} />
				<span>
					Hauptfach nicht am Nachmittag
					<span class="hint" title="Hauptfächer (D, E, M, …) sollen vor der angegebenen Stunde stattfinden. Lerneinheiten mit timePref='spät' sind ausgenommen (User-Wunsch hat Vorrang).">ℹ</span>
					(ab Stunde
					<input type="number" min="1" max="8" bind:value={c.noMainSubjectAfternoon.afternoonStartsAtPeriod} class="inline" />)
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.noMainSubjectAfternoon.weight} disabled={!c.noMainSubjectAfternoon.enabled} class="weight" />
		</div>
		<div class="rule sub">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.noMainSubjectAfternoon.applyToAllSubjects} disabled={!c.noMainSubjectAfternoon.enabled} />
				↳ Auch Nebenfächer am Nachmittag vermeiden (schwächer)
			</label>
			<input type="number" min="0" step="5" bind:value={c.noMainSubjectAfternoon.weightAllSubjects} disabled={!c.noMainSubjectAfternoon.enabled || !c.noMainSubjectAfternoon.applyToAllSubjects} class="weight" />
		</div>

		<!-- max Hauptfächer in Folge -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.maxConsecutiveMain.enabled} />
				<span>
					Max.
					<input type="number" min="1" max="8" bind:value={c.maxConsecutiveMain.max} class="inline" />
					Hauptfächer in Folge
					<span class="hint" title="Verhindert 'M-D-E-M' am Stück. Übliches Limit ist 2.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.maxConsecutiveMain.weight} disabled={!c.maxConsecutiveMain.enabled} class="weight" />
		</div>

		<!-- Hauptfächer früh -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.preferMainEarly.enabled} />
				<span>
					Hauptfächer bevorzugt früh am Tag
					<span class="hint" title="Tie-Breaker: Bei sonst gleichwertigen Optionen rutschen Hauptfächer in Richtung P1. Klein halten — höhere Werte würden den Plan in P1 stapeln.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="1" bind:value={c.preferMainEarly.weight} disabled={!c.preferMainEarly.enabled} class="weight" />
		</div>

		<!-- timePref Gewicht -->
		<div class="rule">
			<span class="lbl">
				Tageszeit-Präferenz pro Lerneinheit
				<span class="hint" title="Gewicht für das pro-Lerneinheit-Feld 'Zeit' (Früh/Spät). Wirkt nur auf Specs, die explizit eine Präferenz gesetzt haben.">ℹ</span>
			</span>
			<input type="number" min="0" step="10" bind:value={c.timePrefWeight} class="weight" />
		</div>
	</div>
</section>

<!-- ============================================================
	  Sektion 3: Lehrer
	  ============================================================ -->
<section>
	<h3>Lehrer</h3>
	<div class="rules">
		<!-- Kompakte Lehrer-Tage -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.compactTeacherDays.enabled} />
				<span>
					Lehrer-Tage kompakt (wenig Freistunden)
					<span class="hint" title="Sandwich-Lücken pro (Lehrer, Tag), QUADRATISCH gewichtet. 0 Lücken = 0 Strafe, 1 Lücke = 1, 2 Lücken = 4, 3 Lücken = 9. So ist 1 Freistunde ok, 2 sind deutlich schlechter, 3+ praktisch tabu.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.compactTeacherDays.weight} disabled={!c.compactTeacherDays.enabled} class="weight" />
		</div>

		<!-- Tagesanfang-Fairness -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.teacherEarlyStartBalance.enabled} />
				<span>
					Früher Tagesbeginn fair verteilen
					<span class="hint" title="Penalty steigt linear mit der Periode des ersten Lehrer-Slots am Tag. Belohnt Lehrer die in P1 starten — verhindert dass immer derselbe Lehrer 'der Spätstarter' ist. Lehrer die in P1 gesperrt sind werden nicht bestraft.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.teacherEarlyStartBalance.weight} disabled={!c.teacherEarlyStartBalance.enabled} class="weight" />
		</div>

		<!-- Mindest-Stunden pro Lehrer-Tag -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.teacherMinLessonsPerDay.enabled} />
				<span>
					Mind.
					<input type="number" min="1" max="8" bind:value={c.teacherMinLessonsPerDay.min} class="inline" disabled={!c.teacherMinLessonsPerDay.enabled} />
					Stunden pro Lehrer-Tag
					<span class="hint" title="Wenn ein Lehrer an einem Tag arbeitet, soll er mindestens N Stunden haben — sonst lohnt der Anfahrtsweg nicht. 0 Stunden (freier Tag) wird nicht bestraft.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="10" bind:value={c.teacherMinLessonsPerDay.weight} disabled={!c.teacherMinLessonsPerDay.enabled} class="weight" />
		</div>

	</div>
</section>

<!-- ============================================================
	  Hinweis: weitere Regeln auf Lerneinheits-Ebene
	  ============================================================ -->
<p class="muted footer">
	<strong>Pro Lerneinheit:</strong> Tageszeit-Präferenz (Früh/Spät), Block-Pattern, Wochenrhythmus
	und Kopplungen werden im Reiter <em>Lerneinheiten</em> gesetzt. <br />
	<strong>Pro Lehrer:</strong> Verfügbarkeit (Sperrstunden) und maximale Tageslast werden im Reiter
	<em>Lehrer</em> gesetzt.
</p>

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
	.muted.footer {
		margin-top: 18px;
		max-width: 720px;
	}
	section {
		max-width: 720px;
		margin-bottom: 18px;
	}
	section h3 {
		font-size: 14px;
		font-weight: 600;
		margin: 4px 0 6px;
		color: var(--text);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rules {
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
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
	}
	.rule:last-child {
		border-bottom: 0;
	}
	.rule.sub {
		padding: 8px 14px 8px 28px;
		background: var(--bg-soft);
		font-size: 12px;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border);
	}
	.rule.sub:last-child {
		border-bottom: 0;
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		flex: 1;
	}
	.weight {
		width: 72px;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	input.inline {
		width: 50px;
		padding: 2px 4px;
		border: 1px solid var(--border);
		border-radius: 3px;
		font-size: 13px;
	}
	.hint {
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
</style>
