<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { type SolveSession, type SolvePhase, type SolveLogEvent, type RelaxationInfo, type SolverOutput, type DiversifyStrategy } from '../lib/solver-v2/index';
	// R2 Schritt 5: Solver läuft im Web Worker (UI-Thread bleibt frei);
	// die Bridge hat dieselbe SolveSession-API und fällt ohne
	// Worker-Support auf das bisherige Inline-startSolve zurück.
	import { startSolveSession } from '../lib/solver-v2/worker-bridge';
	import type { PlacedLesson } from '../lib/types';
	import { saveSnapshot, loadSnapshots, deleteSnapshot, clearSnapshots, nextSnapshotNumber, MAX_SNAPSHOTS, type Snapshot } from '../lib/snapshots';
	import { planAutopilot, describeAutopilotPlan } from '../lib/autopilot';
	import TeacherQualityPanel from './TeacherQualityPanel.svelte';
	const store = useStore();

	// Phase 14: Pool-Phase Dauer (Sekunden). 0 = aus (heutiges Verhalten:
	// 1 Construction, sofort LS). >0 = Pool-Construction für N Sekunden,
	// dann beste Lösung als LS-Startpunkt. Im UI als Slider 0-30s.
	let poolDurationSec = $state<number>(5);
	// Pool-Statistik für Live-Anzeige während des Laufs.
	let poolAttempts = $state<number>(0);
	let poolBestScore = $state<number | null>(null);
	let poolPhaseActive = $state<boolean>(false);

	// Phase 15: Diversify-Sliders (Anteil + Dauer).
	let diversifyFractionPct = $state<number>(25);   // 10-50
	let diversifyDurationSec = $state<number>(30);   // 10-120
	let diversifyActive = $state<boolean>(false);
	let preDiversifyScore = $state<number | null>(null);

	// Solver-Opt Schritt 6: Autopilot — sequentielle Generate+Diversify-
	// Phasen innerhalb eines Gesamt-Budgets. Default 10 Minuten.
	let autopilotBudgetMin = $state<number>(10);     // 1-15
	let autopilotActive = $state<boolean>(false);
	let autopilotPhaseIdx = $state<number>(0);
	let autopilotPhaseTotal = $state<number>(0);
	let autopilotPhaseLabel = $state<string>('');
	// Nicht-reaktives Abbruch-Flag: abort() stoppt die Phasen-Schleife,
	// session.abort() beendet nur die LAUFENDE Session.
	let autopilotStop = false;

	// Phase 15: Auto-Snapshot Schwelle (5% Improvement).
	const AUTO_SNAPSHOT_THRESHOLD = 0.05;
	// Score VOR diesem Lauf (für Auto-Snapshot-Trigger nach done).
	let preRunScore = $state<number | null>(null);
	// Reaktive Snapshot-Liste — refresh via 'snapshots-changed' window-event.
	let snapshots = $state<Snapshot[]>(loadSnapshots());

	function refreshSnapshots(): void {
		snapshots = loadSnapshots();
	}

	// Audit-Fix A1a: Listener an den Komponenten-Lifecycle binden. Die alte
	// Setup-Registrierung ohne Cleanup leakte pro Tab-Wechsel einen toten
	// Listener (ScheduleGrid/GenerateButton werden per {#if} unmountet).
	$effect(() => {
		window.addEventListener('snapshots-changed', refreshSnapshots);
		return () => window.removeEventListener('snapshots-changed', refreshSnapshots);
	});

	function notifySnapshotsChanged(): void {
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('snapshots-changed'));
		}
	}

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

	// Autopilot zählt als busy — zwischen zwei Phasen ist session kurz null,
	// die Buttons dürfen dabei nicht aufflackern.
	const busy = $derived(session !== null || autopilotActive);
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
		const blob = new Blob([dzn], { type: 'application/json;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		// Phase 18: .json statt .dzn — Inhalt ist seit Phase 11 immer JSON gewesen,
		// .dzn-Endung war Legacy aus MiniZinc-Zeit. .json macht es für Editoren
		// und Tools direkt nutzbar.
		a.download = `stundenplan-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
		void runSolver({ poolBudgetMs: poolDurationSec * 1000, hotStart: false });
	}

	function continueOptimize(): void {
		// Phase 14: Hot-Start. Aktueller Plan-Stand wird als Startlösung
		// verwendet. Pool-Phase wird übersprungen — User will GENAU diesen
		// Plan weiteroptimieren, nicht eine neue Variante.
		void runSolver({ poolBudgetMs: 0, hotStart: true });
	}

	function diversify(): void {
		// Phase 15: Diversify-Lauf. Solver wirft 25% (oder Slider-Wert) der
		// nicht-pinned Units raus, baut neu, optimiert. Best-Tracking →
		// Plan kann nie schlechter werden.
		void runSolver({
			poolBudgetMs: 0,
			hotStart: true,
			diversify: {
				fraction: diversifyFractionPct / 100,
				durationMs: diversifyDurationSec * 1000
			}
		});
	}

	// Solver-Opt Schritt 6: Autopilot — plant Generate + Diversify-Zyklen
	// im Gesamt-Budget und wartet jede Session sequentiell ab. Diversify
	// hat absolutes Best-Tracking (Revert bei Verschlechterung) — der Plan
	// kann über die Zyklen hinweg nie schlechter werden.
	async function runAutopilot(): Promise<void> {
		const plan = planAutopilot(autopilotBudgetMin * 60_000);
		autopilotActive = true;
		autopilotStop = false;
		autopilotPhaseTotal = plan.phases.length;
		try {
			for (let i = 0; i < plan.phases.length; i++) {
				if (autopilotStop) break;
				const ph = plan.phases[i];
				autopilotPhaseIdx = i + 1;
				if (ph.kind === 'generate') {
					autopilotPhaseLabel = 'Generieren';
					await runSolver({
						poolBudgetMs: ph.poolBudgetMs,
						hotStart: false,
						totalBudgetMs: ph.totalBudgetMs
					});
				} else {
					// Ohne Plan (Generate-Phase fehlgeschlagen) ist Diversify sinnlos.
					if (store.doc.placed.length === 0) break;
					autopilotPhaseLabel = `Diversify ${Math.round(ph.fraction * 100)}% (${ph.strategy})`;
					await runSolver({
						poolBudgetMs: 0,
						hotStart: true,
						diversify: { fraction: ph.fraction, durationMs: ph.durationMs, strategy: ph.strategy }
					});
				}
			}
		} finally {
			autopilotActive = false;
			autopilotPhaseIdx = 0;
			autopilotPhaseTotal = 0;
			autopilotPhaseLabel = '';
		}
	}

	function runSolver(extra: { poolBudgetMs: number; hotStart: boolean; diversify?: { fraction: number; durationMs: number; strategy?: DiversifyStrategy }; totalBudgetMs?: number }): Promise<SolverOutput> {
		// Phase 15: Pre-Run Score merken für Auto-Snapshot-Trigger und
		// Diversify-UI-Anzeige — VOR reset(), das bestScore nullt.
		const scoreBeforeRun = bestScore;
		reset();
		poolAttempts = 0;
		poolBestScore = null;
		poolPhaseActive = !extra.hotStart && extra.poolBudgetMs > 0;
		diversifyActive = !!extra.diversify;
		preRunScore = scoreBeforeRun;
		preDiversifyScore = extra.diversify ? scoreBeforeRun : null;
		startTicker();
		const s = startSolveSession($state.snapshot(store.doc) as any, {
			// User-Intent: Qualität geht über Geschwindigkeit. Solver darf
			// gerne mehrere Minuten laufen — Anytime-Modus heißt der User
			// sieht ständig den aktuellen Stand und kann jederzeit abbrechen.
			// Der Autopilot übergibt pro Phase ein eigenes Budget, damit die
			// Session von selbst endet und die nächste Phase starten kann.
			totalBudgetMs: extra.totalBudgetMs ?? 1_800_000,
			innerBudgetMs: 30_000,    // 30 s pro inner-LS-Restart-Zyklus
			poolBudgetMs: extra.poolBudgetMs,
			hotStart: extra.hotStart,
			diversify: extra.diversify
		});
		session = s;

		// Autopilot wartet auf das Session-Ende. Jeder Pfad in index.ts
		// (SAT, TIMEOUT, ERROR, Abort) emittiert 'done' → resolved immer.
		let resolveDone!: (r: SolverOutput) => void;
		const donePromise = new Promise<SolverOutput>(res => { resolveDone = res; });

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
			if (d.final.status === 'SAT' || d.final.status === 'TIMEOUT') {
				applyPlacements(d.final.placed);
				// Phase 15: Auto-Snapshot bei großem Score-Improvement.
				// Trigger nur wenn Score VOR diesem Lauf bekannt war und neuer
				// Score >= 5% besser. Default-Auto-Naming nach Score.
				// Audit-Fix A1b: NICHT triggern wenn die Auto-Lockerung lief —
				// der finale Score ist dann im relaxed-Gewichts-Frame gemessen
				// (no_free ×1 statt ×50) und der Vergleich mit preRunScore
				// (strict-Frame) würde ein Schein-Improvement melden.
				const frameSwitched = d.final.relaxation?.noFreeRelaxed === true;
				const newScore = d.final.penalties?.total;
				if (!frameSwitched && typeof newScore === 'number' && preRunScore !== null && preRunScore > 0) {
					const improvement = (preRunScore - newScore) / preRunScore;
					if (improvement >= AUTO_SNAPSHOT_THRESHOLD) {
						// Audit A5: persistenter Zähler statt Galerie-Länge —
						// nach dem FIFO-Cleanup kollidierten „Auto #N"-Namen.
						saveSnapshot({
							name: `Auto #${nextSnapshotNumber()}`,
							score: Math.round(newScore),
							placed: d.final.placed.map(p => ({ ...p })),
							scoreBreakdown: d.final.penalties as any,
							source: 'auto'
						});
						notifySnapshotsChanged();
					}
				}
			}
			// Diversify-Lauf beendet → Anzeige zurücksetzen
			diversifyActive = false;
			// Snapshot DZN so the user can still download it after the run ends.
			lastDzn = s.getDzn();
			session = null;
			stopTicker();
			resolveDone(d.final);
		});
		s.on('error', err => {
			console.error('Solver error', err);
		});

		return donePromise;
	}

	function abort(): void {
		// Autopilot: Schleife stoppen, DANN laufende Session beenden —
		// sonst startet nach dem Session-done sofort die nächste Phase.
		autopilotStop = true;
		session?.abort();
	}

	// ---- Phase 15: Snapshot-Manage ----
	// Audit A5: Inline-Input statt window.prompt() (blockiert den ganzen
	// Tab und lässt sich nicht stylen). Leerer Name → Default „Plan #N"
	// aus dem persistenten Zähler (erst BEIM Speichern gezogen, damit
	// Abbrechen keine Nummern verbrennt).
	let snapshotNameOpen = $state(false);
	let snapshotNameDraft = $state('');

	function openSnapshotNameInput(): void {
		if (store.doc.placed.length === 0) {
			alert('Kein Plan vorhanden — erst generieren.');
			return;
		}
		snapshotNameDraft = '';
		snapshotNameOpen = true;
	}

	function confirmSaveSnapshot(): void {
		if (store.doc.placed.length === 0) {
			snapshotNameOpen = false;
			return;
		}
		const score = bestScore ?? result?.penalties?.total ?? 0;
		const name = snapshotNameDraft.trim() || `Plan #${nextSnapshotNumber()}`;
		saveSnapshot({
			name,
			score: Math.round(score),
			placed: store.doc.placed.map(p => ({ ...p })),
			scoreBreakdown: result?.penalties as any,
			source: 'manual'
		});
		snapshotNameOpen = false;
		notifySnapshotsChanged();
	}

	function restoreSnapshot(snap: Snapshot): void {
		const ok = confirm(
			`Snapshot „${snap.name}" (Score ${snap.score}) wiederherstellen?\n\n` +
			`Aktuelle nicht-gepinnten Placements werden überschrieben.\n` +
			`Vor dem Wiederherstellen wird automatisch ein Backup deines aktuellen Plans gespeichert.`
		);
		if (!ok) return;
		// Auto-Backup vor Restore (nur wenn aktueller Plan nicht leer)
		if (store.doc.placed.length > 0) {
			saveSnapshot({
				name: `Backup vor Restore ${new Date().toLocaleTimeString('de-AT')}`,
				score: Math.round(bestScore ?? result?.penalties?.total ?? 0),
				placed: store.doc.placed.map(p => ({ ...p })),
				scoreBreakdown: result?.penalties as any,
				source: 'auto'
			});
		}
		store.doc.placed = snap.placed.map(p => ({ ...p }));
		store.persistNow();
		// Best-Score wieder auf den Snapshot-Score setzen für UI-Konsistenz.
		bestScore = snap.score;
		notifySnapshotsChanged();
	}

	function diversifyFromSnapshot(snap: Snapshot): void {
		// Snapshot wiederherstellen, dann sofort Diversify-Lauf starten.
		const ok = confirm(
			`Snapshot „${snap.name}" als Basis nehmen und sofort diversifizieren?\n\n` +
			`Aktueller Plan wird vor Restore automatisch als Backup gespeichert.`
		);
		if (!ok) return;
		if (store.doc.placed.length > 0) {
			saveSnapshot({
				name: `Backup vor Diversify ${new Date().toLocaleTimeString('de-AT')}`,
				score: Math.round(bestScore ?? result?.penalties?.total ?? 0),
				placed: store.doc.placed.map(p => ({ ...p })),
				scoreBreakdown: result?.penalties as any,
				source: 'auto'
			});
		}
		store.doc.placed = snap.placed.map(p => ({ ...p }));
		store.persistNow();
		bestScore = snap.score;
		notifySnapshotsChanged();
		// Sofort Diversify-Lauf starten
		diversify();
	}

	function deleteSnap(snap: Snapshot): void {
		if (!confirm(`Snapshot „${snap.name}" löschen?`)) return;
		deleteSnapshot(snap.id);
		notifySnapshotsChanged();
	}

	function clearAllSnapshots(): void {
		if (!confirm('Wirklich ALLE Snapshots löschen? Das kann nicht rückgängig gemacht werden.')) return;
		clearSnapshots();
		notifySnapshotsChanged();
	}

	// Sortierte Snapshots (bester zuerst, niedrigster Score = best)
	const sortedSnapshots = $derived([...snapshots].sort((a, b) => a.score - b.score));
	const bestSnapshotId = $derived(sortedSnapshots[0]?.id ?? null);

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

	// Autopilot-Plan-Vorschau für den Hint unter dem Slider.
	const autopilotPlanText = $derived(describeAutopilotPlan(planAutopilot(autopilotBudgetMin * 60_000)));
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

	<div class="autopilot-config" class:disabled={busy}>
		<label class="ap-label">
			<span>Budget:</span>
			<input
				type="range"
				min="1"
				max="15"
				step="1"
				bind:value={autopilotBudgetMin}
				disabled={busy}
				class="ap-slider"
				title="Gesamtzeit für den Autopilot. Er verteilt sie automatisch auf Generieren + mehrere Diversify-Zyklen."
			/>
			<span class="ap-value">{autopilotBudgetMin} min</span>
		</label>
		<div class="ap-hint muted small">{autopilotPlanText}</div>
		<button class="btn primary" onclick={() => void runAutopilot()} disabled={busy} title="Ein Klick, bestes Ergebnis: Plan generieren und danach automatisch mehrere Diversify-Zyklen fahren. Der Plan kann dabei nie schlechter werden (Best-Tracking). Jederzeit abbrechbar — beste bisherige Lösung bleibt erhalten.">
			🎯 Gründlich optimieren
		</button>
	</div>

	<div class="diversify-config" class:disabled={busy}>
		<div class="diversify-row">
			<label class="div-label">
				<span>Anteil:</span>
				<input
					type="range"
					min="10"
					max="50"
					step="5"
					bind:value={diversifyFractionPct}
					disabled={busy}
					class="div-slider"
					title="Wieviel Prozent der nicht-gepinnten Stunden zurückgesetzt und neu platziert werden."
				/>
				<span class="div-value">{diversifyFractionPct} %</span>
			</label>
			<label class="div-label">
				<span>Dauer:</span>
				<input
					type="range"
					min="10"
					max="120"
					step="5"
					bind:value={diversifyDurationSec}
					disabled={busy}
					class="div-slider"
					title="Wie lange Local Search nach dem Reset laufen darf."
				/>
				<span class="div-value">{diversifyDurationSec} s</span>
			</label>
		</div>
		<button class="btn" onclick={diversify} disabled={busy || !hasExistingPlan} title={hasExistingPlan
			? `~${diversifyFractionPct}% der Stunden werden neu platziert, dann ${diversifyDurationSec}s Local Search. Bei keiner Verbesserung bleibt der Plan unverändert (Best-Tracking).`
			: 'Erst einen Plan erzeugen — dann kannst du diversifizieren.'}>
			🌀 Diversifizieren
		</button>
	</div>

	{#if busy}
		<div class="progress-block" role="status" aria-live="polite">
			{#if autopilotActive}
				<div class="ap-live">
					<span class="ap-badge">🎯 Autopilot</span>
					<span class="muted small">Phase {autopilotPhaseIdx}/{autopilotPhaseTotal}: <strong>{autopilotPhaseLabel}</strong></span>
				</div>
			{/if}
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
			<button class="btn small abort" onclick={abort}>⏹ {autopilotActive ? 'Autopilot abbrechen' : 'Abbrechen'} — beste bisherige Lösung übernehmen</button>
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
							{#if result.penalties.unplaced > 0}
								<li>⚠ Nicht platzierte Stunden: <strong>{result.penalties.unplaced}</strong></li>
							{/if}
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
							{#if result.penalties.uneven_days > 0}
								<li>Ungleichmäßige Tagesverteilung: <strong>{result.penalties.uneven_days}</strong></li>
							{/if}
							{#if result.penalties.target_daily > 0}
								<li>Zieltagespensum-Abweichung (quadratisch): <strong>{result.penalties.target_daily}</strong></li>
							{/if}
							{#if result.penalties.afternoon_preferred > 0}
								<li>Bevorzugt-Nachmittag-Fächer im Vormittag: <strong>{result.penalties.afternoon_preferred}</strong></li>
							{/if}
							{#if result.penalties.subject_twice > 0}
								<li>Fach mehrfach am selben Tag: <strong>{result.penalties.subject_twice}</strong></li>
							{/if}
							{#if result.penalties.main_twice > 0}
								<li>Hauptfach 3+ am selben Tag: <strong>{result.penalties.main_twice}</strong></li>
							{/if}
							{#if result.penalties.main_block_split > 0}
								<li>Hauptfach 2× am Tag mit Lücke: <strong>{result.penalties.main_block_split}</strong></li>
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
							{#if result.penalties.teacher_gap_fairness > 0}
								<li>Springstunden-Klumpung (quadratisch pro Lehrer): <strong>{result.penalties.teacher_gap_fairness}</strong></li>
							{/if}
							{#if result.penalties.teacher_days_present > 0}
								<li>Anwesenheitstage über Teilzeit-Ideal: <strong>{result.penalties.teacher_days_present}</strong></li>
							{/if}
							{#if result.penalties.teacher_lunch > 0}
								<li>Fehlende Mittagspausen: <strong>{result.penalties.teacher_lunch}</strong></li>
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
					<!-- Audit A5: disabled={!lastDzn} — während eines Worker-Laufs liefert
					     getDzn() einen leeren String (kommt erst mit dem done-Event),
					     der Button war mid-run klickbar aber wirkungslos. -->
					<button class="btn small" onclick={downloadDzn} disabled={!lastDzn} title="JSON-Snapshot des Solver-Inputs: Stammdaten, Lehreinheiten (inkl. Team-Teaching-Segmente), Constraints, Units, Placements, Score, Lockerungs-Info. Für Debug/Bug-Reports.">🔬 Solver-Snapshot</button>
				</div>
			</div>
			{#if logOpen}
				<pre class="log-view">{#each logEntries as e (e.tElapsedMs + '|' + e.message)}<span class="log-line log-{e.level}">[{fmtMs(e.tElapsedMs).padStart(7)}] {e.level.toUpperCase().padEnd(5)} {e.message}{#if e.data && Object.keys(e.data).length > 0} {Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ')}{/if}</span>
{/each}</pre>
			{/if}
		</div>
	{/if}

	<!-- Phase 15: Snapshot-Galerie -->
	<div class="snapshot-gallery">
		<div class="gallery-header">
			<h4>📸 Plan-Snapshots ({snapshots.length}/{MAX_SNAPSHOTS})</h4>
			<div class="gallery-actions">
				{#if snapshotNameOpen}
					<span class="snap-name-input">
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							bind:value={snapshotNameDraft}
							placeholder="Name (leer = Plan #N)"
							autofocus
							onkeydown={(e) => {
								if (e.key === 'Enter') confirmSaveSnapshot();
								if (e.key === 'Escape') snapshotNameOpen = false;
							}}
						/>
						<button class="btn small primary" onclick={confirmSaveSnapshot}>Speichern</button>
						<button class="btn small" onclick={() => (snapshotNameOpen = false)}>Abbrechen</button>
					</span>
				{:else}
					<button class="btn small" onclick={openSnapshotNameInput} disabled={busy || !hasExistingPlan} title="Aktuellen Plan-Stand als Snapshot speichern">
						💾 Aktuellen Plan speichern
					</button>
				{/if}
				{#if snapshots.length > 0}
					<button class="btn danger small" onclick={clearAllSnapshots} disabled={busy} title="Alle Snapshots löschen">
						🗑 Alle löschen
					</button>
				{/if}
			</div>
		</div>
		{#if snapshots.length === 0}
			<p class="muted small">
				Noch keine Snapshots. Bei großen Score-Verbesserungen (≥5%) werden sie automatisch erstellt — oder klicke „Aktuellen Plan speichern".
			</p>
		{:else}
			<ul class="snap-list">
				{#each sortedSnapshots as s (s.id)}
					<li class:best={s.id === bestSnapshotId}>
						<div class="snap-info">
							<span class="snap-icon">{s.id === bestSnapshotId ? '⭐' : (s.source === 'auto' ? '🔄' : '💾')}</span>
							<span class="snap-name">{s.name}</span>
							<span class="snap-score">Score {s.score}</span>
							<span class="muted small">· {new Date(s.createdAt).toLocaleString('de-AT')}</span>
						</div>
						<div class="snap-actions">
							<button class="btn small" onclick={() => restoreSnapshot(s)} disabled={busy} title="Plan-Placements aus diesem Snapshot wiederherstellen">
								↩ Wiederherstellen
							</button>
							<button class="btn small" onclick={() => diversifyFromSnapshot(s)} disabled={busy || !diversifyDurationSec} title="Snapshot wiederherstellen und sofort diversifizieren">
								🌀 Diversify
							</button>
							<button class="btn danger small" onclick={() => deleteSnap(s)} disabled={busy} title="Diesen Snapshot löschen">×</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Solver-Opt Schritt 6: Lehrer-Qualitäts-Report -->
	<TeacherQualityPanel />
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

	/* Solver-Opt Schritt 6: Autopilot */
	.autopilot-config {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 240px;
		padding: 8px 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: 6px;
	}
	.autopilot-config.disabled {
		opacity: 0.6;
	}
	.ap-label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ap-label > span:first-child {
		font-size: 12px;
		font-weight: 600;
		min-width: 60px;
	}
	.ap-slider {
		flex: 1;
		min-width: 80px;
	}
	.ap-value {
		font-size: 12px;
		font-weight: 600;
		min-width: 46px;
		text-align: right;
		color: var(--accent);
	}
	.ap-hint {
		font-size: 11px;
		line-height: 1.3;
	}
	.ap-live {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		background: rgba(59, 130, 246, 0.08);
		border-left: 3px solid var(--accent);
		border-radius: 4px;
		font-size: 12px;
	}
	.ap-badge {
		font-weight: 600;
		color: var(--accent);
	}

	/* Phase 15: Diversify-Config + Snapshot-Galerie */
	.diversify-config {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 280px;
		padding: 8px 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-left: 3px solid #f4a261;
		border-radius: 6px;
	}
	.diversify-config.disabled {
		opacity: 0.6;
	}
	.diversify-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.div-label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.div-label > span:first-child {
		font-size: 12px;
		font-weight: 600;
		min-width: 60px;
	}
	.div-slider {
		flex: 1;
		min-width: 80px;
	}
	.div-value {
		font-size: 12px;
		font-weight: 600;
		min-width: 36px;
		text-align: right;
		color: #c47e34;
	}

	.snapshot-gallery {
		flex: 0 0 100%;
		max-width: 800px;
		margin-top: 12px;
		padding: 10px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.gallery-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.gallery-header h4 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.gallery-actions {
		display: flex;
		gap: 6px;
	}
	.snap-name-input {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.snap-name-input input {
		padding: 4px 8px;
		font-size: 12px;
		border: 1px solid var(--border-strong);
		border-radius: 4px;
		min-width: 180px;
	}
	.snap-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.snap-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 6px 10px;
		background: var(--bg-soft);
		border-radius: 4px;
		font-size: 13px;
		flex-wrap: wrap;
	}
	.snap-list li.best {
		background: rgba(254, 215, 102, 0.15);
		border-left: 3px solid #f6c344;
	}
	.snap-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 200px;
	}
	.snap-name {
		font-weight: 600;
	}
	.snap-score {
		color: var(--accent);
		font-weight: 600;
	}
	.snap-actions {
		display: flex;
		gap: 4px;
	}
</style>
