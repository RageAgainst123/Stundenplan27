<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	const store = useStore();
	import { DEFAULT_CONSTRAINTS, type ConstraintConfig } from '../lib/types';

	function reset() {
		if (!confirm('Alle Regeln auf die Standard-Werte zurücksetzen? Deine angepassten Gewichte gehen verloren.')) return;
		store.doc.constraints = structuredClone(DEFAULT_CONSTRAINTS);
	}

	// R3-S6: Gewichts-Presets — ein Klick stellt alle Regler auf ein
	// stimmiges Profil (Basis: DEFAULT_CONSTRAINTS, dann gezielte
	// Verschiebungen). Feintuning danach jederzeit möglich.
	const PRESETS: { id: string; label: string; hint: string; tweak: (c: ConstraintConfig) => void }[] = [
		{
			id: 'ausgewogen',
			label: '⚖ Ausgewogen',
			hint: 'Die Standard-Gewichte — Klassen-Qualität ist Pflicht, Lehrer-Komfort moderat. Identisch mit „Zurücksetzen".',
			tweak: () => { /* Defaults unverändert */ },
		},
		{
			id: 'lehrer',
			label: '👩‍🏫 Lehrer-freundlich',
			hint: 'Weniger Springstunden, kompaktere Lehrer-Tage, weniger Anwesenheitstage, Mittagspause aktiv — auf Kosten von etwas Klassen-Feinschliff.',
			tweak: (c) => {
				c.compactTeacherDays.weight = 160;
				c.teacherGapFairness.weight = 40;
				c.teacherDaysPresent.weight = 240;
				c.teacherEarlyStartBalance.weight = 60;
				c.teacherMinLessonsPerDay.weight = 250;
				c.teacherMiddayBreak = { enabled: true, weight: 100 };
			},
		},
		{
			id: 'klassen',
			label: '🎓 Klassen-freundlich',
			hint: 'Strenge Tagesstruktur für die Schüler: Zieltagespensum, gleichmäßige Wochen, keine Hauptfach-Häufung — Lehrer-Komfort zählt weniger.',
			tweak: (c) => {
				c.minDailyWeight = 800;
				c.targetDailyLessons.weight = 150;
				c.unevenDaysWeight = 250;
				c.maxConsecutiveMain.weight = 80;
				c.subjectMaxConsecutive.weight = 80;
				c.subjectMaxOncePerDay.weight = 100;
				c.noMainSubjectAfternoon.weight = 300;
				c.compactTeacherDays.weight = 40;
				c.teacherDaysPresent.weight = 60;
			},
		},
		{
			id: 'kompakt',
			label: '📦 Streng kompakt',
			hint: 'Alles dicht gepackt: keine Lücken irgendwo, früher Schluss — maximaler Druck auf Kompaktheit für Klassen UND Lehrer.',
			tweak: (c) => {
				c.compactTeacherDays.weight = 200;
				c.teacherGapFairness.weight = 50;
				c.mustStartFirstPeriod.weight = 500;
				c.teacherEarlyStartBalance.weight = 80;
				c.unevenDaysWeight = 250;
				c.teacherMinLessonsPerDay.weight = 300;
			},
		},
	];

	function applyPreset(preset: (typeof PRESETS)[number]): void {
		if (!confirm(`Preset „${preset.label.replace(/^\S+\s/, '')}" anwenden? Deine aktuellen Gewichte werden überschrieben (Feintuning danach möglich).`)) return;
		const next = structuredClone(DEFAULT_CONSTRAINTS);
		preset.tweak(next);
		store.doc.constraints = next;
	}

	const c = $derived(store.doc.constraints);
</script>

<div class="head">
	<h2>Regeln (weiche Constraints)</h2>
	<div class="head-actions">
		{#each PRESETS as p (p.id)}
			<button class="btn small" onclick={() => applyPreset(p)} title={p.hint}>{p.label}</button>
		{/each}
		<button class="btn" onclick={reset} title="Alle Regeln auf den Stift-Default zurücksetzen">Zurücksetzen</button>
	</div>
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
		<!-- Solver-Opt R2: Vollständigkeit — dominante Strafe pro ungeplanter Stunde -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.unplacedPenalty.enabled} />
				<span>
					Alle Stunden müssen platziert werden
					<span class="hint" title="Dominante Strafe pro NICHT platzierter Stunde. Ohne diese Regel 'spart' der Solver unbequeme Stunden einfach ein (eine weggelassene Stunde erzeugt sonst keine Penalty und kann den Score sogar verbessern). Das Gewicht sollte deutlich über allen anderen liegen — Default 100000. Nur abschalten, wenn du bewusst Teilpläne vergleichen willst.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="1000" bind:value={c.unplacedPenalty.weight} disabled={!c.unplacedPenalty.enabled} class="weight" />
		</div>

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

		<!-- Phase 13: Zieltagespensum -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.targetDailyLessons.enabled} />
				<span>
					Zieltagespensum pro Stufe
					<span class="hint" title="Quadratische Penalty pro (Tag, Stufe) für Abweichung vom Ziel. Wirkt nach OBEN und unten — verhindert 'Mo: 4 Stunden, Fr: 8 Stunden'. Inaktive Tage sind ausgenommen.">ℹ</span>
					<input type="number" min="3" max="8" bind:value={c.targetDailyLessons.target} class="inline" disabled={!c.targetDailyLessons.enabled} />
				</span>
			</label>
			<input type="number" min="0" step="10" bind:value={c.targetDailyLessons.weight} disabled={!c.targetDailyLessons.enabled} class="weight" />
		</div>

		<!-- Phase 18: Bevorzugt-Nachmittag Gewicht -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.afternoonPreferred.enabled} />
				<span>
					"Bevorzugt nachmittags" Gewicht
					<span class="hint" title="Wirkt für Lerneinheiten mit afternoonAllowed='preferred' (Dropdown 'Bevorzugt' in der Lehreinheiten-Liste). Penalty pro Vormittag-Slot. Höher = drückt stärker auf Nachmittag. Default 250. Bei 0 wirkungslos.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="25" bind:value={c.afternoonPreferred.weight} disabled={!c.afternoonPreferred.enabled} class="weight" />
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

		<!-- R3-S5: Max in Folge PRO FACH (Limit steht in der Fächer-Tabelle) -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.subjectMaxConsecutive.enabled} />
				<span>
					Max. gleiches Fach in Folge (Limit pro Fach)
					<span class="hint" title="Nutzt das Feld ‚Max in Folge' aus der Fächer-Tabelle: mehr als N Stunden DESSELBEN Fachs hintereinander werden pro Zusatz-Stunde bestraft. Ergänzt das globale Hauptfach-Limit oben (das über verschiedene Hauptfächer hinweg zählt).">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.subjectMaxConsecutive.weight} disabled={!c.subjectMaxConsecutive.enabled} class="weight" />
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

		<!-- Solver-Opt Schritt 3: Springstunden-Fairness -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.teacherGapFairness.enabled} />
				<span>
					Springstunden fair verteilen
					<span class="hint" title="Wochen-Springstunden pro Lehrer, QUADRATISCH: 1 Lehrer mit 5 Lücken kostet 25, fünf Lehrer mit je 1 Lücke nur 5. Verhindert dass die Lücken bei einem Lehrer klumpen. Ergänzt 'Lehrer-Tage kompakt' (das pro Tag wirkt) um die Wochen-Sicht.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="5" bind:value={c.teacherGapFairness.weight} disabled={!c.teacherGapFairness.enabled} class="weight" />
		</div>

		<!-- Solver-Opt Schritt 3: Anwesenheitstage minimieren -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.teacherDaysPresent.enabled} />
				<span>
					Anwesenheitstage minimieren (Teilzeit)
					<span class="hint" title="Ein Lehrer mit 8 Wochenstunden soll idealerweise an 2 Tagen kommen (ceil(Stunden/6)), nicht an 5. Jeder Tag über dem Ideal kostet. Vollzeit-Lehrer sind faktisch nicht betroffen (Ideal 5 Tage).">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="10" bind:value={c.teacherDaysPresent.weight} disabled={!c.teacherDaysPresent.enabled} class="weight" />
		</div>

		<!-- Solver-Opt Schritt 3: Mittagspause (Default aus) -->
		<div class="rule">
			<label class="lbl">
				<input type="checkbox" bind:checked={c.teacherMiddayBreak.enabled} />
				<span>
					Mittagspause bei langen Tagen
					<span class="hint" title="Wenn ein Lehrer ≥6 Stunden hat und sowohl vormittags (P1–P4) als auch nachmittags (P7–P8) unterrichtet, soll P5 oder P6 frei sein. Standardmäßig deaktiviert — bei Bedarf aktivieren.">ℹ</span>
				</span>
			</label>
			<input type="number" min="0" step="10" bind:value={c.teacherMiddayBreak.weight} disabled={!c.teacherMiddayBreak.enabled} class="weight" />
		</div>

	</div>
</section>

<!-- ============================================================
	  Hinweis: weitere Regeln auf Lerneinheits-Ebene
	  ============================================================ -->
<p class="muted footer">
	<strong>Pro Lerneinheit:</strong> Tageszeit-Präferenz (Früh/Spät), Block-Pattern, Wochenrhythmus
	und Kopplungen werden im Reiter <em>Lerneinheiten</em> gesetzt. <br />
	<strong>Pro Lehrer:</strong> Verfügbarkeit (Sperrstunden) wird im Reiter <em>Lehrer</em> gesetzt.
</p>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
		flex-wrap: wrap;
		gap: 8px;
	}
	.head-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
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
