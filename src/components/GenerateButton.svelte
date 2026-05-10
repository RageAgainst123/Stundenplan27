<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { startSolve, type SolveSession, type SolvePhase, type SolveLogEvent, type RelaxationInfo, type SolverOutput } from '../lib/solver-v2/index';
	import type { PlacedLesson } from '../lib/types';
	const store = useStore();

	// Phase 14: Pool-Phase Dauer (Sekunden). 0 = aus (heutiges Verhalten:
	// 1 Construction, sofort LS). >0 = Pool-Construction für N Sekunden,
	// dann beste Lösung als LS-Startpunkt. Im UI als Slider 0-30s.
	let poolDurationSec = $state<number>(5);
	// Pool-Statistik für Live-Anzeige während des Laufs.
	let poolAttempts = $state<number>(0);
	let poolBestScore = $state<number | null>(null);
	let poolPhaseActive = $state<boolean>(false);

	// ---- Run state ----
	let session = $state<SolveSession | null>(null);
	let phase = $state<SolvePhase | null>(null);
	let phaseLabel = $state<string>('');
	let tElapsed = $state<number>(0);
	let tLimit = $state<number>(0);
	let tickHandle: ReturnType<typeof setInterval> | null = null;
	let scoreHistory = $state<{ t: number; score: number | null }[]>([]);
	let bestScore = $state<number | null>(null);
	let lastImprovementMs = $state<number>(0);
	let result = $state<SolverOutput | null>(null);
	let relaxation = $state<RelaxationInfo | null>(null);
	let plansApplied = $state<number>(0);
	let logEntries = $state<SolveLogEvent[]>([]);
	let logOpen = $state<boolean>(false);
	// Last DZN snapshot (kept after session ends, for debug download)
	let lastDzn = $state<string>('');

	const busy = $derived(session !== null);
	// Phase 14: Hot-Start-Button nur enabled wenn ein Plan existiert
	// (mind. 1 Placement, egal ob pinned oder nicht).
	const hasExistingPlan = $derived(store.doc.placed.length > 0);

	function applyPlacements(placed: PlacedLesson[]): void {
		// Replace non-pinned placements; keep pinned ones intact.
		const pinnedKept = store.doc.placed.filter(p => p.pinned);

		// (1) Block any new placement on a (day, period, grade) that's
		// already occupied by a pinned placement of a DIFFERENT spec —
		// unless both share a couplingId (allowed parallel teaching).
		// Without this check the solver could re-add a clashing lesson
		// even though buildState validated pins; e.g. coupling-aware
		// solver moves can produce overlaps the dedup-by-key wouldn't
		// catch.
		type Key = string; // `${day}|${period}|${grade}`
		const slotKey = (p: PlacedLesson): Key => `${p.day}|${p.period}|${p.grade}`;
		const pinnedBySlot = new Map<Key, PlacedLesson>();
		for (const p of pinnedKept) pinnedBySlot.set(slotKey(p), p);

		// (2) Dedup non-pinned by (specId, day, period, grade) like before.
		const dedupKey = (p: PlacedLesson) => `${p.specId}|${p.day}|${p.period}|${p.grade}`;
		const seen = new Set<string>(pinnedKept.map(dedupKey));

		const additions: PlacedLesson[] = [];
		for (const p of placed) {
			const k = dedupKey(p);
			if (seen.has(k)) continue;
			seen.add(k);
			// Slot-collision check against pinned of different spec.
			const pinnedAtSlot = pinnedBySlot.get(slotKey(p));
			if (pinnedAtSlot && pinnedAtSlot.specId !== p.specId) {
				const newSpec = store.doc.specs.find(s => s.id === p.specId);
				const pinnedSpec = store.doc.specs.find(s => s.id === pinnedAtSlot.specId);
				const sameCoupling = !!(
					newSpec?.couplingId &&
					pinnedSpec?.couplingId &&
					newSpec.couplingId === pinnedSpec.couplingId
				);
				if (!sameCoupling) {
					// Drop the colliding non-pinned addition. The solver
					// shouldn't have produced this; if it did, surfacing a
					// silent drop is safer than a double-booked grid cell.
					continue;
				}
			}
			additions.push({ ...p, pinned: false });
		}
		store.doc.placed = [...pinnedKept, ...additions];
		store.persistNow();
	}

	function reset(): void {
		phase = null;
		phaseLabel = '';
		tElapsed = 0;
		tLimit = 0;
		scoreHistory = [];
		bestScore = null;
		lastImprovementMs = 0;
		result = null;
		relaxation = null;
		plansApplied = 0;
		logEntries = [];
	}

	function fmtMs(ms: number): string {
		const s = Math.floor(ms / 1000);
		const cs = Math.floor((ms % 1000) / 100);
		return `${s.toString().padStart(2, '0')}.${cs}s`;
	}

	/** Format a duration as "Xs" if < 60 s, "Mm Ss" otherwise. */
	function fmtDuration(ms: number): string {
		const totalSec = Math.max(0, Math.round(ms / 1000));
		if (totalSec < 60) return `${totalSec} s`;
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return s === 0 ? `${m} min` : `${m} min ${s} s`;
	}

	function formatLog(entries: SolveLogEvent[]): string {
		const lines = entries.map(e => {
			const lvl = e.level.toUpperCase().padEnd(5);
			const t = fmtMs(e.tElapsedMs).padStart(7);
			const data = e.data && Object.keys(e.data).length > 0
				? ' ' + Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ')
				: '';
			return `[${t}] ${lvl} ${e.message}${data}`;
		});
		return lines.join('\n');
	}

	async function copyLog(): Promise<void> {
		const text = formatLog(logEntries);
		try {
			await navigator.clipboard.writeText(text);
		} catch (e) {
			console.warn('Clipboard write failed', e);
		}
	}

	function downloadDzn(): void {
		const dzn = session?.getDzn() || lastDzn;
		if (!dzn) return;
		const blob = new Blob([dzn], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `stundenplan-${new Date().toISOString().replace(/[:.]/g, '-')}.dzn`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function startTicker(): void {
		if (tickHandle) clearInterval(tickHandle);
		const t0 = Date.now();
		tickHandle = setInterval(() => {
			tElapsed = Date.now() - t0;
		}, 250);
	}
	function stopTicker(): void {
		if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
	}

	function generate(): void {
		runSolver({ poolBudgetMs: poolDurationSec * 1000, hotStart: false });
	}

	function continueOptimize(): void {
		// Phase 14: Hot-Start. Aktueller Plan-Stand wird als Startlösung
		// verwendet. Pool-Phase wird übersprungen — User will GENAU diesen
		// Plan weiteroptimieren, nicht eine neue Variante.
		runSolver({ poolBudgetMs: 0, hotStart: true });
	}

	function runSolver(extra: { poolBudgetMs: number; hotStart: boolean }): void {
		reset();
		poolAttempts = 0;
		poolBestScore = null;
		poolPhaseActive = !extra.hotStart && extra.poolBudgetMs > 0;
		startTicker();
		const s = startSolve($state.snapshot(store.doc) as any, {
			// User-Intent: Qualität geht über Geschwindigkeit. Solver darf
			// gerne mehrere Minuten laufen — Anytime-Modus heißt der User
			// sieht ständig den aktuellen Stand und kann jederzeit abbrechen.
			totalBudgetMs: 1_800_000, // 30 min Gesamtbudget (Construct + ILS)
			innerBudgetMs: 30_000,    // 30 s pro inner-LS-Restart-Zyklus
			poolBudgetMs: extra.poolBudgetMs,
			hotStart: extra.hotStart
		});
		session = s;

		s.on('phase', p => { phase = p; });
		s.on('progress', p => {
			phaseLabel = p.phaseLabel;
			tLimit = p.tLimitMs;
		});
		s.on('relaxation', r => { relaxation = r; });
		s.on('solution', sol => {
			scoreHistory = [...scoreHistory, { t: sol.tElapsedMs, score: sol.score }];
			if (sol.score !== null && (bestScore === null || sol.score < bestScore)) {
				bestScore = sol.score;
				lastImprovementMs = sol.tElapsedMs;
			} else if (bestScore === null) {
				// Phase A satisfy gave us a feasible plan without an objective
				lastImprovementMs = sol.tElapsedMs;
			}
			// Live-update the grid so the user sees progress
			applyPlacements(sol.placed);
			plansApplied++;
		});
		s.on('log', ev => {
			// Pool-Stats aus den stat-Logs ziehen für die UI-Live-Anzeige.
			// Format: "Pool: neuer Best #N, Score X, ..." → wir parsen N + X.
			if (ev.level === 'stat' && ev.message.startsWith('Pool: neuer Best')) {
				const m = ev.message.match(/#(\d+).*Score (\d+(?:\.\d+)?)/);
				if (m) {
					poolAttempts = parseInt(m[1], 10);
					poolBestScore = parseFloat(m[2]);
				}
			}
			if (ev.level === 'phase' && ev.message.startsWith('Pool abgeschlossen')) {
				poolPhaseActive = false;
				const m = ev.message.match(/(\d+) Versuche/);
				if (m) poolAttempts = parseInt(m[1], 10);
			}
			// Cap log to avoid runaway memory; keep first 50 + last 950 if needed.
			if (logEntries.length >= 1000) {
				logEntries = [...logEntries.slice(0, 50), ...logEntries.slice(-949), ev];
			} else {
				logEntries = [...logEntries, ev];
			}
		});
		s.on('done', d => {
			result = d.final;
			if (d.final.relaxation) relaxation = d.final.relaxation;
			if (d.final.status === 'SAT') {
				applyPlacements(d.final.placed);
			}
			// Snapshot DZN so the user can still download it after the run ends.
			lastDzn = s.getDzn();
			session = null;
			stopTicker();
		});
		s.on('error', err => {
			console.error('Solver error', err);
		});
	}

	function abort(): void {
		session?.abort();
	}

	// ---- Convergence status ----
	// Three states based on how long ago the last score improvement was:
	//   active       — improvement in the last few seconds (green, "läuft")
	//   exploring    — between 5s and 20s without improvement (orange, "sucht")
	//   stable       — over 20s no improvement, total runtime > 30s (gray)
	type ConvStatus = 'active' | 'exploring' | 'stable';
	const convergenceStatus = $derived.by((): ConvStatus | '' => {
		if (!session || phase !== 'optimize') return '';
		const idleMs = tElapsed - lastImprovementMs;
		if (idleMs < 5000) return 'active';
		if (idleMs < 20000 || tElapsed < 30000) return 'exploring';
		return 'stable';
	});
	const convergenceText = $derived.by(() => {
		const idleSec = Math.round((tElapsed - lastImprovementMs) / 1000);
		switch (convergenceStatus) {
			case 'active':
				return `🟢 Aktiv — gerade ${bestScore !== null ? `bei Score ${bestScore}` : 'am Suchen'}`;
			case 'exploring':
				return `🟠 Sucht weiter — letzte Verbesserung vor ${idleSec} s`;
			case 'stable':
				return `⚪ Wahrscheinlich fertig — seit ${idleSec} s keine Verbesserung. Du kannst abbrechen.`;
			default:
				return '';
		}
	});

	const progressPercent = $derived(
		tLimit > 0 ? Math.min(100, Math.round((tElapsed / tLimit) * 100)) : 0
	);

	const remainingSec = $derived(
		tLimit > 0 ? Math.max(0, Math.round((tLimit - tElapsed) / 1000)) : 0
	);

	const showRelaxBanner = $derived(
		relaxation !== null && (
			relaxation.blocksRelaxed.length > 0 ||
			relaxation.minDailyReducedTo !== null ||
			relaxation.startInP1Disabled ||
			relaxation.noFreeRelaxed
		)
	);

	// ---- Score-history mini-graph ----
	function buildPath(history: { t: number; score: number | null }[], w: number, h: number): string {
		const pts = history.filter(p => p.score !== null) as { t: number; score: number }[];
		if (pts.length === 0) return '';
		const minScore = Math.min(...pts.map(p => p.score));
		const maxScore = Math.max(...pts.map(p => p.score));
		const range = maxScore - minScore || 1;
		const tMin = pts[0].t;
		const tMax = pts[pts.length - 1].t || 1;
		const tRange = tMax - tMin || 1;
		return pts.map((p, i) => {
			const x = ((p.t - tMin) / tRange) * w;
			const y = h - ((p.score - minScore) / range) * h;
			return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		}).join(' ');
	}
	const sparkPath = $derived(buildPath(scoreHistory, 200, 30));
</script>

<div class="gen">
	<div class="pool-config" class:disabled={busy}>
		<label class="pool-label">
			<span>Pool-Phase:</span>
			<input
				type="range"
				min="0"
				max="30"
				step="1"
				bind:value={poolDurationSec}
				disabled={busy}
				class="pool-slider"
				title="Vor dem Optimieren werden N Sekunden lang verschiedene Random-Pläne erzeugt; der beste wird als Startpunkt verwendet. 0 = aus (1 Construction wie bisher)."
			/>
			<span class="pool-value">{poolDurationSec === 0 ? 'aus' : `${poolDurationSec} s`}</span>
		</label>
		<div class="pool-hint muted small">
			{#if poolDurationSec === 0}
				Direkt 1 Construction → Optimieren (heutiges Verhalten)
			{:else}
				{poolDurationSec} s Pool-Suche (~{Math.round(poolDurationSec * 10)}–{Math.round(poolDurationSec * 20)} Versuche) → bester Plan wird optimiert
			{/if}
		</div>
	</div>

	<button class="btn primary" onclick={generate} disabled={busy} title="Neuen Plan von Grund auf erzeugen (Pool-Phase + Construction + Local Search). Bisherige nicht-gepinnten Placements werden überschrieben.">
		{busy ? 'Solver läuft…' : 'Plan generieren'}
	</button>
	<button class="btn" onclick={continueOptimize} disabled={busy || !hasExistingPlan} title={hasExistingPlan
		? 'Aktuellen Plan als Startpunkt nehmen und weiter optimieren. Kein Pool, keine Random-Phase — Solver baut auf dem bestehenden Score auf.'
		: 'Erst einen Plan erzeugen — dann kann der Solver darauf weiter optimieren.'}>
		Weiter optimieren
	</button>

	{#if busy}
		<div class="progress-block" role="status" aria-live="polite">
			<div class="phase-line">
				<strong>{phaseLabel || 'Initialisierung…'}</strong>
				<span class="muted small">— {fmtDuration(tElapsed)} / {fmtDuration(tLimit)} • Rest ~{fmtDuration(tLimit - tElapsed)}</span>
			</div>
			{#if poolPhaseActive && phase === 'satisfy'}
				<div class="pool-live">
					<span class="pool-badge">🎲 Pool-Phase</span>
					{#if poolBestScore !== null}
						<span class="muted small">{poolAttempts} Versuch{poolAttempts === 1 ? '' : 'e'} · bester Score: <strong>{Math.round(poolBestScore)}</strong></span>
					{:else}
						<span class="muted small">Suche nach erster Lösung…</span>
					{/if}
				</div>
			{/if}
			<div class="bar"><div class="bar-fill" style:width="{progressPercent}%"></div></div>
			{#if scoreHistory.length > 0}
				<div class="live-score">
					Aktueller Score: <strong>{bestScore ?? '–'}</strong>
					<span class="muted small">({scoreHistory.length} Lösung{scoreHistory.length === 1 ? '' : 'en'} gefunden)</span>
					{#if sparkPath}
						<svg width="200" height="30" class="spark" aria-label="Score-Verlauf">
							<path d={sparkPath} fill="none" stroke="var(--accent)" stroke-width="1.5" />
						</svg>
					{/if}
				</div>
			{:else}
				<div class="muted small">Erste Lösung wird gesucht — kann bei großen Plänen einige Minuten dauern.</div>
			{/if}
			{#if convergenceText}
				<div class="status-line" class:status-active={convergenceStatus === 'active'} class:status-exploring={convergenceStatus === 'exploring'} class:status-stable={convergenceStatus === 'stable'}>
					{convergenceText}
				</div>
			{/if}
			<div class="muted small">
				💡 Lass den Solver gerne lange laufen — er liefert kontinuierlich bessere Lösungen.
				Sobald du zufrieden bist, klick auf Abbrechen.
			</div>
			<button class="btn small abort" onclick={abort}>⏹ Abbrechen — beste bisherige Lösung übernehmen</button>
		</div>
	{/if}

	{#if !busy && result}
		{#if result.status === 'SAT'}
			<div class="result-block">
				<span class="ok">
					✓ Plan gefunden ({result.placed.length} Stunden platziert{#if result.unplaced.length}, {result.unplaced.length} nicht{/if}{#if result.penalties}, Score {result.penalties.total}{/if})
				</span>
				{#if showRelaxBanner && relaxation}
					<div class="warn">
						<strong>⚠ Lockerungen aktiv</strong> – die strenge Konfig war unlösbar:
						<ul class="relax-list">
							{#if relaxation.blocksRelaxed.length > 0}
								<li>Block-Pattern für {relaxation.blocksRelaxed.length} Lehreinheit(en) auf „Automatisch" gesetzt</li>
							{/if}
							{#if relaxation.minDailyReducedTo === 0}
								<li>Mindest-Stunden pro Tag pro Stufe deaktiviert</li>
							{:else if relaxation.minDailyReducedTo !== null}
								<li>Mindest-Stunden pro Tag pro Stufe auf {relaxation.minDailyReducedTo} reduziert</li>
							{/if}
							{#if relaxation.startInP1Disabled}
								<li>„Beginn in 1. Stunde"-Regel deaktiviert</li>
							{/if}
							{#if relaxation.noFreeRelaxed}
								<li>„Keine Freistunden in Stufe": von strikt auf weich gelockert — der Plan enthält unvermeidbare Sandwich-Lücken</li>
							{/if}
						</ul>
					</div>
				{/if}
				{#if result.penalties && result.penalties.total > 0}
					<details class="score-breakdown">
						<summary>Score-Aufschlüsselung anzeigen</summary>
						<ul>
							{#if result.penalties.no_free > 0}
								<li>Freistunden für Klassen: <strong>{result.penalties.no_free}</strong></li>
							{/if}
							{#if result.penalties.main_aft > 0}
								<li>Hauptfächer am Nachmittag: <strong>{result.penalties.main_aft}</strong></li>
							{/if}
							{#if result.penalties.any_aft > 0}
								<li>Stunden am Nachmittag (alle Fächer): <strong>{result.penalties.any_aft}</strong></li>
							{/if}
							{#if result.penalties.main_run > 0}
								<li>Lange Hauptfach-Folgen: <strong>{result.penalties.main_run}</strong></li>
							{/if}
							{#if result.penalties.main_early > 0}
								<li>Hauptfächer-Spät-Score (niedriger=früher): <strong>{result.penalties.main_early}</strong></li>
							{/if}
							{#if result.penalties.time_pref > 0}
								<li>Tageszeit-Präferenz-Abweichung: <strong>{result.penalties.time_pref}</strong></li>
							{/if}
							{#if result.penalties.compact > 0}
								<li>Lehrer-Freistunden: <strong>{result.penalties.compact}</strong></li>
							{/if}
							{#if result.penalties.subject_twice > 0}
								<li>Fach mehrfach am selben Tag: <strong>{result.penalties.subject_twice}</strong></li>
							{/if}
							{#if result.penalties.spec_spread > 0}
								<li>Lerneinheit-Spreizung über Wochentage: <strong>{result.penalties.spec_spread}</strong></li>
							{/if}
							{#if result.penalties.teacher_late_start > 0}
								<li>Lehrer-Spätstart (kumuliert): <strong>{result.penalties.teacher_late_start}</strong></li>
							{/if}
							{#if result.penalties.teacher_under_min > 0}
								<li>Lehrer-Tage unter Mindeststunden: <strong>{result.penalties.teacher_under_min}</strong></li>
							{/if}
							<li class="total">Total (gewichtet): <strong>{result.penalties.total}</strong></li>
						</ul>
					</details>
				{/if}
				{#if result.message}
					<span class="muted small">{result.message}</span>
				{/if}
			</div>
		{:else if result.status === 'UNSAT'}
			<span class="err">✗ Keine Lösung – {result.message}</span>
		{:else if result.status === 'TIMEOUT'}
			<div class="warn">
				<strong>⏱ Solver-Zeit erreicht ohne Lösung</strong>
				<div style="margin-top:4px; white-space:pre-line;">{result.message ?? 'Time-Limit erreicht.'}</div>
			</div>
		{:else}
			<span class="err">✗ {result.status}: {result.message ?? 'Solver-Fehler'}</span>
		{/if}
	{/if}

	{#if logEntries.length > 0 || lastDzn}
		<div class="debug-panel">
			<div class="debug-header">
				<button class="debug-toggle" onclick={() => (logOpen = !logOpen)} aria-expanded={logOpen}>
					{logOpen ? '▼' : '▶'} Solver-Log ({logEntries.length})
				</button>
				<div class="debug-actions">
					<button class="btn small" onclick={copyLog} disabled={logEntries.length === 0} title="Log als Text in die Zwischenablage kopieren">📋 Log kopieren</button>
					<button class="btn small" onclick={downloadDzn} disabled={!lastDzn && !session} title="DZN-Datei herunterladen für externe Solver-Analyse">🔬 DZN herunterladen</button>
				</div>
			</div>
			{#if logOpen}
				<pre class="log-view">{#each logEntries as e (e.tElapsedMs + '|' + e.message)}<span class="log-line log-{e.level}">[{fmtMs(e.tElapsedMs).padStart(7)}] {e.level.toUpperCase().padEnd(5)} {e.message}{#if e.data && Object.keys(e.data).length > 0} {Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ')}{/if}</span>
{/each}</pre>
			{/if}
		</div>
	{/if}
</div>

<style>
	.gen {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex-wrap: wrap;
	}
	.pool-config {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 240px;
		padding: 8px 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.pool-config.disabled {
		opacity: 0.6;
	}
	.pool-label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.pool-label > span:first-child {
		font-size: 12px;
		font-weight: 600;
		min-width: 80px;
	}
	.pool-slider {
		flex: 1;
		min-width: 100px;
	}
	.pool-value {
		font-size: 12px;
		font-weight: 600;
		min-width: 36px;
		text-align: right;
		color: var(--accent);
	}
	.pool-hint {
		font-size: 11px;
		line-height: 1.3;
	}
	.pool-live {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		background: rgba(244, 162, 97, 0.1);
		border-left: 3px solid #f4a261;
		border-radius: 4px;
		font-size: 12px;
	}
	.pool-badge {
		font-weight: 600;
		color: #c47e34;
	}
	.result-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		max-width: 700px;
	}
	.progress-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		min-width: 320px;
		max-width: 460px;
		padding: 10px 12px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.phase-line {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}
	.bar {
		width: 100%;
		height: 6px;
		background: var(--bg-panel);
		border-radius: 3px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.25s linear;
	}
	.live-score {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.spark {
		display: block;
	}
	.hint-line {
		color: var(--text-muted);
		font-size: 12px;
		font-style: italic;
	}
	.status-line {
		font-size: 13px;
		padding: 4px 8px;
		border-radius: 4px;
		font-weight: 500;
	}
	.status-active {
		color: #15803d;
		background: #dcfce7;
	}
	.status-exploring {
		color: #b45309;
		background: #fef3c7;
	}
	.status-stable {
		color: #475569;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
	}
	.abort {
		align-self: flex-start;
	}
	.err {
		white-space: pre-line;
		max-width: 700px;
		color: var(--err);
		font-size: 13px;
	}
	.ok {
		color: var(--ok);
		font-size: 13px;
	}
	.muted.small {
		color: var(--text-muted);
		font-size: 12px;
	}
	.warn {
		color: #b45309;
		background: #fef3c7;
		padding: 6px 10px;
		border-radius: 4px;
		font-size: 12px;
		white-space: pre-line;
	}
	.relax-list {
		margin: 4px 0 0 0;
		padding-left: 18px;
		list-style: disc;
	}
	.relax-list li {
		margin: 2px 0;
	}
	.score-breakdown {
		font-size: 12px;
		color: var(--text-muted);
	}
	.score-breakdown summary {
		cursor: pointer;
		user-select: none;
	}
	.score-breakdown ul {
		list-style: none;
		padding: 6px 0 0 12px;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.score-breakdown li.total {
		border-top: 1px solid var(--border);
		padding-top: 4px;
		margin-top: 4px;
		color: var(--text);
	}
	.btn.small {
		padding: 4px 10px;
		font-size: 12px;
	}
	.debug-panel {
		flex-basis: 100%;
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 6px;
		padding: 8px 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 12px;
	}
	.debug-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.debug-toggle {
		background: none;
		border: 0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		padding: 2px 4px;
		color: var(--text);
	}
	.debug-toggle:hover {
		color: var(--accent);
	}
	.debug-actions {
		display: flex;
		gap: 6px;
	}
	.log-view {
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.4;
		max-height: 360px;
		overflow: auto;
		margin: 0;
		padding: 8px;
		background: #1f1f1f;
		color: #ddd;
		border-radius: 4px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.log-line {
		display: block;
	}
	.log-line.log-error {
		color: #ff6b6b;
	}
	.log-line.log-warn {
		color: #ffb84d;
	}
	.log-line.log-stat {
		color: #87ceeb;
	}
	.log-line.log-phase {
		color: #b9f8a0;
		font-weight: 600;
	}
</style>
