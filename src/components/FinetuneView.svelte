<script lang="ts">
	// R3-S7: Feinschliff-Reiter — gezielt nachbessern statt alles neu
	// generieren. Drei Werkzeuge, alle auf demselben Mechanismus:
	//
	//   „DAS da ändern, den Rest festhalten": die gewählten Stunden werden
	//   freigegeben, ALLE anderen temporär gepinnt, dann läuft ein kurzer
	//   Solver-Lauf (Hot-Start; die Mini-Construction platziert die freien
	//   Stunden neu, die Local Search poliert). Das Ergebnis wird als
	//   Vorher/Nachher-Diff angezeigt — übernommen wird erst auf Klick,
	//   Verwerfen lässt den Plan unangetastet (der Lauf arbeitet auf einer
	//   Kopie). Vor dem Übernehmen wird ein Backup-Snapshot gespeichert.
	//
	//   1. Stunden anklicken → „Neu setzen lassen"
	//   2. „Lehrer entlasten" (Ein-Klick-Auswahl aller Stunden eines Lehrers)
	//   3. „Diese Stunde DAHIN": 1 Stunde wählen → Ziel-Zelle klicken —
	//      die Stunde wird dort FIXIERT, Kollidierendes wird freigegeben
	//      und vom Solver automatisch neu untergebracht.
	import { useStore } from '../lib/store.svelte';
	import {
		DAYS, GRADES, PERIODS, DEFAULT_PERIOD_TIMES,
		type Day, type GradeLevel, type Period, type PlacedLesson, type ScheduleDoc,
	} from '../lib/types';
	import { buildSlotOccupancy, slotKeyOf, type SlotOccupant } from '../lib/schedule-helpers';
	import { teacherTint } from '../lib/teacher-helpers';
	import { computeTeacherQuality } from '../lib/teacher-quality';
	import { qualityPercent, scorePlacedPlan } from '../lib/quality';
	import { saveSnapshot } from '../lib/snapshots';
	import { startSolveSession } from '../lib/solver-v2/worker-bridge';
	import type { SolveSession, SolverOutput } from '../lib/solver-v2/index';

	const store = useStore();

	// ---- Auswahl-Zustand ----
	// Eine „Stunde" = (specId, Tag, Periode) — ein Klick wählt alle
	// Grade-Zeilen dieser Unterrichtsstunde.
	const lessonKey = (p: Pick<PlacedLesson, 'specId' | 'day' | 'period'>) =>
		`${p.specId}|${p.day}|${p.period}`;

	let selected = $state<Set<string>>(new Set());
	let moveTargetMode = $state(false);

	// ---- Mini-Solve-Zustand ----
	let phase = $state<'idle' | 'running' | 'review'>('idle');
	let session: SolveSession | null = null;
	let runLabel = $state('');
	let liveScore = $state<number | null>(null);
	let candidate = $state<PlacedLesson[] | null>(null);
	let candidateResult = $state<SolverOutput | null>(null);
	let runSeconds = $state(20);
	let errorMsg = $state('');

	const occupancy = $derived.by(() => {
		void store.doc.placed.length;
		void store.doc.specs.length;
		return buildSlotOccupancy(store.doc);
	});

	const teacherRows = $derived.by(() => {
		void store.doc.placed.length;
		return computeTeacherQuality(store.doc).filter(r => r.weekLessons > 0);
	});

	const hasPlan = $derived(store.doc.placed.length > 0);

	function toggleLesson(occ: SlotOccupant): void {
		if (occ.placed.pinned) return; // gepinnte Stunden sind Vorgaben — nicht anfassen
		const key = lessonKey(occ.placed);
		const next = new Set(selected);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selected = next;
		if (selected.size !== 1) moveTargetMode = false;
	}

	function clearSelection(): void {
		selected = new Set();
		moveTargetMode = false;
	}

	function selectTeacher(teacherId: string): void {
		const next = new Set<string>();
		const specById = new Map(store.doc.specs.map(s => [s.id, s]));
		for (const p of store.doc.placed) {
			if (p.pinned) continue;
			const spec = specById.get(p.specId);
			if (!spec) continue;
			const effective = p.teachers ?? spec.teachers;
			if (effective.includes(teacherId)) next.add(lessonKey(p));
		}
		selected = next;
		moveTargetMode = false;
	}

	// ---- Mini-Solve ----

	/** Doc-Kopie: gewählte Stunden freigeben, Rest temporär pinnen. */
	function buildSolverDoc(freeKeys: Set<string>, extraPlaced: PlacedLesson[] = []): ScheduleDoc {
		const snap = $state.snapshot(store.doc) as ScheduleDoc;
		snap.placed = snap.placed
			.filter(p => !freeKeys.has(lessonKey(p)))
			.map(p => ({ ...p, pinned: true }))
			.concat(extraPlaced);
		return snap;
	}

	/** Original-Pins (vor dem Temp-Pinnen) — zum Zurückschreiben der Flags. */
	function originalPinKeys(): Set<string> {
		return new Set(store.doc.placed.filter(p => p.pinned).map(lessonKey));
	}

	function startMiniSolve(
		doc: ScheduleDoc,
		keepPinned: Set<string>,
		label: string,
		expectKey?: string
	): void {
		phase = 'running';
		runLabel = label;
		liveScore = null;
		errorMsg = '';
		candidate = null;
		candidateResult = null;
		const s = startSolveSession(doc, {
			totalBudgetMs: runSeconds * 1000,
			innerBudgetMs: Math.min(10_000, runSeconds * 1000),
			poolBudgetMs: 0,
			hotStart: true,
		});
		session = s;
		s.on('solution', sol => {
			if (sol.score !== null) liveScore = Math.round(sol.score);
		});
		s.on('done', d => {
			session = null;
			if (d.final.status === 'ERROR' || d.final.status === 'UNSAT') {
				phase = 'idle';
				errorMsg = d.final.message ?? 'Der Feinschliff-Lauf ist gescheitert.';
				return;
			}
			// „Dahin verschieben": wenn der Ziel-Pin nicht gehalten hat
			// (z. B. Lehrer-Sperre am Ziel — der Solver verwirft unhaltbare
			// Pins), ehrlich melden statt einen leeren Vorschlag zu zeigen.
			if (expectKey && !d.final.placed.some(p => lessonKey(p) === expectKey)) {
				phase = 'idle';
				errorMsg = 'Das Ziel ist für diese Stunde nicht möglich (z. B. Lehrer-Sperre oder harte Kollision) — es wurde nichts geändert.';
				return;
			}
			// Temp-Pins zurückdrehen: gepinnt bleibt nur, was vorher gepinnt
			// war (plus explizit gewünschte neue Pins, z. B. das Zieh-Ziel).
			candidate = d.final.placed.map(p => ({
				...p,
				pinned: keepPinned.has(lessonKey(p)),
			}));
			candidateResult = d.final;
			phase = 'review';
		});
		s.on('error', err => {
			session = null;
			phase = 'idle';
			errorMsg = err.message;
		});
	}

	function resolveSelected(): void {
		if (selected.size === 0) return;
		const doc = buildSolverDoc(selected);
		startMiniSolve(doc, originalPinKeys(), `${selected.size} Stunde${selected.size === 1 ? '' : 'n'} neu setzen`);
	}

	function relieveTeacher(teacherId: string, name: string): void {
		selectTeacher(teacherId);
		if (selected.size === 0) {
			errorMsg = `${name} hat keine beweglichen (nicht gepinnten) Stunden.`;
			return;
		}
		const doc = buildSolverDoc(selected);
		startMiniSolve(doc, originalPinKeys(), `${name} entlasten (${selected.size} Stunden)`);
	}

	/** „Diese Stunde DAHIN": gewählte Stunde ans Ziel pinnen, Kollisionen freigeben. */
	function moveSelectedTo(day: Day, period: Period): void {
		if (selected.size !== 1) return;
		const key = [...selected][0];
		const [specId] = key.split('|');
		const spec = store.doc.specs.find(s => s.id === specId);
		const source = store.doc.placed.find(p => lessonKey(p) === key);
		if (!spec || !source) return;

		const specById = new Map(store.doc.specs.map(s => [s.id, s]));
		// Bei Kopplungen wandert die GANZE Gruppe (im Solver eine Unit) —
		// Kollisionen am Ziel müssen deshalb gegen die VEREINIGUNG aller
		// Gruppen-Stufen und -Lehrer geprüft/freigeräumt werden.
		const groupSpecs = spec.couplingId
			? store.doc.specs.filter(s => s.couplingId === spec.couplingId)
			: [spec];
		const movingTeachers = [...new Set([
			...(source.teachers ?? spec.teachers),
			...groupSpecs.filter(s => s.id !== spec.id).flatMap(s => s.teachers),
		])];
		const targetGrades = new Set(groupSpecs.flatMap(s => s.grades));
		const groupIds = new Set(groupSpecs.map(s => s.id));

		// H8-Guard: liegt am Ziel bereits eine ANDERE Wochenstunde derselben
		// Lehreinheit oder eines Kopplungs-Partners, ist der Zug unmöglich
		// (Doppellage).
		const sameSpecAtTarget = store.doc.placed.some(
			p => groupIds.has(p.specId) && p.day === day && p.period === period
				&& !(p.day === source.day && p.period === source.period)
		);
		if (sameSpecAtTarget) {
			errorMsg = `Am Ziel liegt bereits eine andere Wochenstunde von ${spec.subject} (oder eines Kopplungs-Partners) — Doppellage nicht erlaubt.`;
			return;
		}

		// Kollisionen am Ziel: gleiche Stufe belegt ODER gemeinsamer Lehrer
		// (Kopplungs-Partner derselben couplingId dürfen liegen bleiben) —
		// dieselben Regeln wie checkPlacementConflict, nur dass wir hier
		// FREIGEBEN statt zu verbieten.
		const freeKeys = new Set<string>([key]);
		for (const p of store.doc.placed) {
			if (p.day !== day || p.period !== period) continue;
			const other = specById.get(p.specId);
			if (!other || groupIds.has(other.id)) continue;
			const otherTeachers = p.teachers ?? other.teachers;
			const clash = targetGrades.has(p.grade)
				|| movingTeachers.some(t => otherTeachers.includes(t));
			if (clash) {
				if (p.pinned) {
					errorMsg = `Am Ziel liegt eine GEPINNTE Stunde (${other.subject}) im Weg — Pin zuerst lösen.`;
					return;
				}
				freeKeys.add(lessonKey(p));
			}
		}

		// Kopplungs-Partner wandern MIT: ihre Stunden am QUELL-Slot werden
		// freigegeben — im Solver sind gekoppelte Specs EINE Unit, die dem
		// Ziel-Pin der bewegten Spec folgt. Blieben die Partner-Stunden
		// temporär gepinnt, bekäme die Unit widersprüchliche Pins und der
		// Ziel-Pin würde verworfen (droppedPins).
		if (spec.couplingId) {
			for (const p of store.doc.placed) {
				if (p.day !== source.day || p.period !== source.period) continue;
				const other = specById.get(p.specId);
				if (!other || other.id === spec.id) continue;
				if (other.couplingId !== spec.couplingId) continue;
				if (p.pinned) {
					errorMsg = `Der Kopplungs-Partner ${other.subject} am Quell-Slot ist GEPINNT — Pin zuerst lösen (die Kopplung wandert gemeinsam).`;
					return;
				}
				freeKeys.add(lessonKey(p));
			}
		}

		// Die Stunde selbst FIXIERT ans Ziel (alle Grade-Zeilen, Segment-Team
		// wandert mit) — der Solver darf sie nicht zurückschieben.
		const grades = spec.grades.length > 0 ? spec.grades : ([5] as GradeLevel[]);
		const moved: PlacedLesson[] = grades.map(g => ({
			specId: spec.id,
			day,
			period,
			grade: g,
			pinned: true,
			...(source.teachers ? { teachers: [...source.teachers] } : {}),
		}));

		const doc = buildSolverDoc(freeKeys, moved);
		// Ziel-Pin bleibt auch im Ergebnis gepinnt (bewusste User-Vorgabe).
		const keep = originalPinKeys();
		const targetKey = `${spec.id}|${day}|${period}`;
		keep.add(targetKey);
		moveTargetMode = false;
		startMiniSolve(doc, keep, `${spec.subject} → ${day} P${period} (Rest repariert)`, targetKey);
	}

	function abortRun(): void {
		session?.abort();
	}

	// ---- Review: Vorher/Nachher-Diff ----
	interface DiffEntry {
		subject: string;
		from: string;
		to: string;
	}
	const diff = $derived.by((): { moves: DiffEntry[]; unplacedCount: number } => {
		if (!candidate) return { moves: [], unplacedCount: 0 };
		const specById = new Map(store.doc.specs.map(s => [s.id, s]));
		// Pro Spec: Slot-Multimengen vorher/nachher vergleichen.
		const slots = (list: PlacedLesson[]) => {
			const m = new Map<string, Map<string, number>>();
			for (const p of list) {
				const inner = m.get(p.specId) ?? new Map<string, number>();
				const slot = `${p.day} P${p.period}`;
				inner.set(slot, (inner.get(slot) ?? 0) + 1);
				m.set(p.specId, inner);
			}
			return m;
		};
		const before = slots(store.doc.placed);
		const after = slots(candidate);
		const moves: DiffEntry[] = [];
		const specIds = new Set([...before.keys(), ...after.keys()]);
		for (const sid of specIds) {
			const b = before.get(sid) ?? new Map();
			const a = after.get(sid) ?? new Map();
			const gone: string[] = [];
			const added: string[] = [];
			for (const [slot, n] of b) {
				const diffN = n - (a.get(slot) ?? 0);
				for (let i = 0; i < diffN; i++) gone.push(slot);
			}
			for (const [slot, n] of a) {
				const diffN = n - (b.get(slot) ?? 0);
				for (let i = 0; i < diffN; i++) added.push(slot);
			}
			const subject = specById.get(sid)?.subject ?? '?';
			const len = Math.max(gone.length, added.length);
			for (let i = 0; i < len; i++) {
				moves.push({ subject, from: gone[i] ?? '— (neu)', to: added[i] ?? '— (entfällt!)' });
			}
		}
		return { moves, unplacedCount: candidateResult?.unplaced.length ?? 0 };
	});

	// ---- F2-S1: ehrlicher Vorher/Nachher-Vergleich ----
	// Beide Stände werden LOKAL mit denselben Gewichten gescort — der
	// Score aus dem Solver-done kann im relaxed-Gewichts-Frame gemessen
	// sein und wäre nicht mit dem Ist-Stand vergleichbar. Dazu die
	// „Wer ist betroffen?"-Tabelle: pro Lehrer mit Änderung die Kennzahlen
	// vorher → nachher (2× computeTeacherQuality).
	interface TeacherDelta {
		teacherId: string;
		name: string;
		color: string;
		gapsBefore: number; gapsAfter: number;
		daysBefore: number; daysAfter: number;
		miniBefore: number; miniAfter: number;
	}
	const reviewStats = $derived.by(() => {
		if (!candidate) return null;
		const snap = $state.snapshot(store.doc) as ScheduleDoc;
		const before = scorePlacedPlan(snap);
		const after = scorePlacedPlan(snap, candidate);
		const beforeQ = computeTeacherQuality(snap);
		const afterQ = computeTeacherQuality({ ...snap, placed: candidate });
		const afterById = new Map(afterQ.map(r => [r.teacherId, r]));
		const deltas: TeacherDelta[] = [];
		const seen = new Set<string>();
		for (const b of beforeQ) {
			seen.add(b.teacherId);
			const a = afterById.get(b.teacherId);
			const gapsAfter = a?.gaps ?? 0;
			const daysAfter = a?.daysPresent ?? 0;
			const miniAfter = a?.miniDays ?? 0;
			if (b.gaps !== gapsAfter || b.daysPresent !== daysAfter || b.miniDays !== miniAfter) {
				deltas.push({
					teacherId: b.teacherId, name: b.name, color: b.color,
					gapsBefore: b.gaps, gapsAfter,
					daysBefore: b.daysPresent, daysAfter,
					miniBefore: b.miniDays, miniAfter,
				});
			}
		}
		// Lehrer, die vorher gar keine Stunden hatten (Report-exempt), nachher schon.
		for (const a of afterQ) {
			if (seen.has(a.teacherId)) continue;
			deltas.push({
				teacherId: a.teacherId, name: a.name, color: a.color,
				gapsBefore: 0, gapsAfter: a.gaps,
				daysBefore: 0, daysAfter: a.daysPresent,
				miniBefore: 0, miniAfter: a.miniDays,
			});
		}
		// Größte Springstunden-Änderung zuerst — das ist die Ziel-Metrik.
		deltas.sort((x, y) =>
			Math.abs(y.gapsAfter - y.gapsBefore) - Math.abs(x.gapsAfter - x.gapsBefore));
		return { before, after, deltas };
	});

	function acceptCandidate(): void {
		if (!candidate) return;
		// Sicherheitsnetz: aktuellen Stand als Backup-Snapshot sichern.
		saveSnapshot({
			name: `Backup vor Feinschliff ${new Date().toLocaleTimeString('de-AT')}`,
			score: 0,
			placed: store.doc.placed.map(p => ({ ...p })),
			source: 'auto',
		});
		if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snapshots-changed'));
		store.doc.placed = candidate;
		store.persistNow();
		candidate = null;
		candidateResult = null;
		phase = 'idle';
		clearSelection();
	}

	function rejectCandidate(): void {
		// Kein Rollback nötig — der Lauf arbeitete auf einer Kopie.
		candidate = null;
		candidateResult = null;
		phase = 'idle';
	}

</script>

<div class="finetune">
	{#if !hasPlan}
		<div class="empty-hint">
			<p>Noch kein Plan vorhanden — erst im Reiter „Stundenplan" generieren.</p>
		</div>
	{:else}
		<!-- Werkzeugleiste -->
		<section class="ft-toolbar">
			<div class="ft-row">
				<strong>🔧 Feinschliff:</strong>
				<span class="muted small">
					Stunden anklicken (gepinnte 🔒 sind fix), dann gezielt nachbessern — alles andere bleibt stehen.
				</span>
			</div>
			<div class="ft-row">
				<button
					class="btn primary"
					disabled={selected.size === 0 || phase !== 'idle'}
					onclick={resolveSelected}
					title="Die markierten Stunden werden freigegeben und vom Solver neu gesetzt; ALLE anderen Stunden sind währenddessen fixiert."
				>
					🔄 Ausgewählte neu setzen ({selected.size})
				</button>
				<button
					class="btn"
					disabled={selected.size !== 1 || phase !== 'idle'}
					class:active={moveTargetMode}
					onclick={() => (moveTargetMode = !moveTargetMode)}
					title="Genau EINE Stunde wählen, dann eine Ziel-Zelle anklicken: die Stunde wird dort fixiert, kollidierende Stunden werden automatisch neu untergebracht."
				>
					🎯 Dahin verschieben…
				</button>
				<button class="btn small" disabled={selected.size === 0} onclick={clearSelection}>Auswahl leeren</button>
				<span class="sep"></span>
				<label class="muted small">
					Feinschliff-Dauer:
					<input type="range" min="10" max="60" step="5" bind:value={runSeconds} />
					{runSeconds} s
				</label>
			</div>
			{#if moveTargetMode}
				<div class="ft-hint">🎯 Ziel-Zelle im Plan anklicken — die gewählte Stunde wird dorthin fixiert, der Solver räumt Kollisionen weg.</div>
			{/if}
			{#if errorMsg}
				<div class="ft-error">⚠ {errorMsg} <button class="btn small" onclick={() => (errorMsg = '')}>OK</button></div>
			{/if}
		</section>

		<!-- Lehrer entlasten -->
		<section class="ft-teachers">
			<span class="muted small">Lehrer entlasten (wählt alle beweglichen Stunden des Lehrers und setzt sie neu):</span>
			<div class="ft-teacher-chips">
				{#each teacherRows as t (t.teacherId)}
					<button
						class="chip"
						style:--c={t.color}
						disabled={phase !== 'idle'}
						onclick={() => relieveTeacher(t.teacherId, t.name)}
						title={`${t.name}: ${t.gaps} Springstunden · ${t.daysPresent} Tage (Ideal ${t.idealDays}) · ${t.miniDays} Mini-Tage`}
					>
						{t.name.split(' ')[0]}
						<span class="gapbadge" class:bad={t.gaps >= 3}>{t.gaps}✂</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- Lauf-Status -->
		{#if phase === 'running'}
			<section class="ft-running">
				<span class="spinner"></span>
				Feinschliff läuft: <strong>{runLabel}</strong>
				{#if liveScore !== null}· Score {liveScore}{/if}
				<button class="btn small" onclick={abortRun}>⏹ Fertig — Stand übernehmen</button>
			</section>
		{/if}

		<!-- Review: Vorher/Nachher -->
		{#if phase === 'review' && candidate}
			<section class="ft-review">
				<div class="ft-row">
					<strong>Vorschlag fertig:</strong>
					{#if diff.unplacedCount > 0}
						<span class="ft-warn">⚠ {diff.unplacedCount} Stunde{diff.unplacedCount === 1 ? '' : 'n'} konnte{diff.unplacedCount === 1 ? '' : 'n'} NICHT platziert werden</span>
					{/if}
				</div>
				{#if reviewStats}
					{@const delta = reviewStats.after.total - reviewStats.before.total}
					<!-- F2-S1: Vorher/Nachher mit denselben Gewichten gescort -->
					<div class="ft-compare">
						<div class="ft-card">
							<span class="ft-card-label">Vorher</span>
							<span class="ft-card-score">{Math.round(reviewStats.before.total)}</span>
							<span class="ft-card-quality">Qualität {qualityPercent(reviewStats.before.total)} %</span>
						</div>
						<div class="ft-card ft-card-delta" class:better={delta < 0} class:worse={delta > 0}>
							<span class="ft-card-label">{delta < 0 ? '✓ besser' : delta > 0 ? '⚠ schlechter' : '± unverändert'}</span>
							<span class="ft-card-score">{delta > 0 ? '+' : ''}{Math.round(delta)}</span>
						</div>
						<div class="ft-card">
							<span class="ft-card-label">Nachher</span>
							<span class="ft-card-score">{Math.round(reviewStats.after.total)}</span>
							<span class="ft-card-quality">Qualität {qualityPercent(reviewStats.after.total)} %</span>
						</div>
					</div>
					{#if reviewStats.deltas.length > 0}
						<!-- Wer ist betroffen? Kennzahlen vorher → nachher, grün/rot -->
						<table class="ft-affected">
							<thead>
								<tr>
									<th>Betroffener Lehrer</th>
									<th title="Springstunden (innere Lücken) pro Woche">Springstunden</th>
									<th title="Anwesenheitstage">Tage</th>
									<th title="Tage mit nur 1 Stunde">Mini-Tage</th>
								</tr>
							</thead>
							<tbody>
								{#each reviewStats.deltas as t (t.teacherId)}
									<tr>
										<td><span class="dot" style:background={t.color}></span>{t.name}</td>
										<td class:good={t.gapsAfter < t.gapsBefore} class:bad={t.gapsAfter > t.gapsBefore}>
											{t.gapsBefore} → {t.gapsAfter}
										</td>
										<td class:good={t.daysAfter < t.daysBefore} class:bad={t.daysAfter > t.daysBefore}>
											{t.daysBefore} → {t.daysAfter}
										</td>
										<td class:good={t.miniAfter < t.miniBefore} class:bad={t.miniAfter > t.miniBefore}>
											{t.miniBefore} → {t.miniAfter}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="muted small">Keine Lehrer-Kennzahl ändert sich (nur Umstellungen ohne Effekt auf Springstunden/Tage).</p>
					{/if}
				{/if}
				{#if diff.moves.length === 0}
					<p class="muted small">Keine Änderung — der Solver hat keine bessere Anordnung gefunden. Verwerfen lässt alles wie es war.</p>
				{:else}
					<ul class="ft-diff">
						{#each diff.moves.slice(0, 20) as m, i (i)}
							<li><strong>{m.subject}</strong>: {m.from} → {m.to}</li>
						{/each}
						{#if diff.moves.length > 20}
							<li class="muted small">… und {diff.moves.length - 20} weitere Änderungen</li>
						{/if}
					</ul>
				{/if}
				<div class="ft-row">
					<button class="btn primary" onclick={acceptCandidate} disabled={diff.moves.length === 0}>
						✓ Übernehmen (Backup-Snapshot wird gespeichert)
					</button>
					<button class="btn" onclick={rejectCandidate}>↩ Verwerfen</button>
				</div>
			</section>
		{/if}

		<!-- Plan-Matrix mit anklickbaren Stunden -->
		<div class="ft-grid-wrap">
			<table class="ft-grid">
				<thead>
					<tr>
						<th class="time-col"></th>
						{#each DAYS as d, di (d)}
							<th colspan="4" class="day-head">{d}</th>
							{#if di < DAYS.length - 1}<th class="gap"></th>{/if}
						{/each}
					</tr>
					<tr>
						<th class="time-col"></th>
						{#each DAYS as d, di (d)}
							{#each GRADES as g (d + g)}<th class="grade-head">{g}.</th>{/each}
							{#if di < DAYS.length - 1}<th class="gap"></th>{/if}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each PERIODS as period, pIdx (period)}
						<tr>
							<th class="time-col">
								<span class="pnum">{period}.</span>
								<span class="ptime">{DEFAULT_PERIOD_TIMES[pIdx]}</span>
							</th>
							{#each DAYS as day, di (day)}
								{#each GRADES as grade (day + grade)}
									{@const occs = occupancy.get(slotKeyOf(day, period, grade)) ?? []}
									{#if occs.length > 0}
										<td class="cell">
											{#each occs as occ, idx (occ.placed.specId + '|' + idx)}
												<button
													type="button"
													class="lesson"
													class:selected={selected.has(lessonKey(occ.placed))}
													class:pinned={occ.placed.pinned}
													style:background={teacherTint(occ.teachers[0]?.color ?? '#9ca3af')}
													onclick={() => toggleLesson(occ)}
													title={occ.placed.pinned
														? `${occ.spec.subject} (gepinnt — im Feinschliff fix)`
														: `${occ.spec.subject} · ${occ.teachers.map(t => t.name).join(' + ')} — klicken zum Aus-/Abwählen`}
												>
													{occ.spec.subject}{#if occ.placed.pinned}&nbsp;🔒{/if}
												</button>
											{/each}
										</td>
									{:else}
										<td
											class="cell empty"
											class:target={moveTargetMode}
											onclick={() => moveTargetMode && moveSelectedTo(day, period)}
										></td>
									{/if}
								{/each}
								{#if di < DAYS.length - 1}<td class="gap"></td>{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.finetune {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.empty-hint {
		padding: 24px;
		text-align: center;
		background: var(--bg-panel);
		border: 1px dashed var(--border);
		border-radius: 8px;
	}
	.ft-toolbar, .ft-teachers, .ft-running, .ft-review {
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px 12px;
	}
	.ft-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.ft-row + .ft-row {
		margin-top: 8px;
	}
	.sep {
		width: 1px;
		height: 22px;
		background: var(--border);
	}
	.btn.active {
		outline: 2px solid var(--accent);
	}
	.ft-hint {
		margin-top: 8px;
		padding: 6px 10px;
		background: var(--accent-bg, #eef4ff);
		border-radius: 6px;
		font-size: 13px;
	}
	.ft-error {
		margin-top: 8px;
		padding: 6px 10px;
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 6px;
		font-size: 13px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ft-teachers {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ft-teacher-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		border: 1px solid var(--border-strong);
		background: color-mix(in srgb, var(--c, #888) 25%, white);
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.gapbadge {
		font-size: 11px;
		opacity: 0.8;
		margin-left: 4px;
	}
	.gapbadge.bad {
		color: #b91c1c;
		font-weight: 700;
	}
	.ft-running {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.ft-review {
		border-color: var(--accent);
	}
	/* F2-S1: Vorher/Nachher-Karten + Betroffenen-Tabelle */
	.ft-compare {
		display: flex;
		gap: 10px;
		margin: 8px 0;
		flex-wrap: wrap;
	}
	.ft-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px 16px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 8px;
		min-width: 110px;
	}
	.ft-card-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.ft-card-score {
		font-size: 20px;
		font-weight: 800;
		font-family: var(--mono);
	}
	.ft-card-quality {
		font-size: 11px;
		color: var(--text-muted);
	}
	.ft-card-delta.better {
		border-color: #16a34a;
		background: #f0fdf4;
	}
	.ft-card-delta.better .ft-card-score { color: #16a34a; }
	.ft-card-delta.worse {
		border-color: #dc2626;
		background: #fef2f2;
	}
	.ft-card-delta.worse .ft-card-score { color: #dc2626; }
	.ft-affected {
		border-collapse: collapse;
		font-size: 12px;
		margin: 4px 0 8px;
	}
	.ft-affected th, .ft-affected td {
		border: 1px solid var(--border);
		padding: 3px 10px;
		text-align: left;
	}
	.ft-affected thead th {
		background: var(--bg-soft);
		font-weight: 600;
	}
	.ft-affected td.good { color: #16a34a; font-weight: 700; }
	.ft-affected td.bad { color: #dc2626; font-weight: 700; }
	.ft-affected .dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 6px;
	}
	.ft-warn {
		color: #b91c1c;
		font-weight: 700;
	}
	.ft-diff {
		margin: 8px 0;
		padding-left: 18px;
		font-size: 13px;
		columns: 2;
	}
	.ft-grid-wrap {
		overflow: auto;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px;
	}
	table.ft-grid {
		border-collapse: collapse;
		width: 100%;
	}
	.ft-grid th, .ft-grid td {
		border: 1px solid var(--border);
		font-size: 11px;
	}
	.ft-grid .time-col {
		width: 52px;
		background: var(--bg-soft);
		text-align: center;
		padding: 3px;
	}
	.ft-grid .pnum { display: block; font-weight: 700; }
	.ft-grid .ptime { display: block; font-size: 9px; color: var(--text-muted); }
	.ft-grid .day-head {
		text-align: center;
		padding: 5px;
		background: var(--bg-soft);
		font-weight: 700;
	}
	.ft-grid .grade-head {
		text-align: center;
		padding: 2px 0;
		background: var(--bg-soft);
		font-size: 11px;
		color: var(--text-muted);
		min-width: 52px;
	}
	.ft-grid .gap {
		width: 4px;
		background: var(--border);
		border: 0;
		padding: 0;
	}
	.ft-grid .cell {
		padding: 1px;
		vertical-align: top;
		min-width: 52px;
	}
	.ft-grid .cell.empty {
		height: 30px;
	}
	.ft-grid .cell.empty.target {
		cursor: crosshair;
		background: var(--accent-bg, #eef4ff);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.lesson {
		display: block;
		width: 100%;
		border: 0;
		border-left: 3px solid transparent;
		border-radius: 3px;
		padding: 3px 4px;
		font-size: 11px;
		font-weight: 700;
		text-align: left;
		cursor: pointer;
		margin-bottom: 1px;
	}
	.lesson.selected {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.lesson.pinned {
		cursor: not-allowed;
		opacity: 0.75;
	}
</style>
