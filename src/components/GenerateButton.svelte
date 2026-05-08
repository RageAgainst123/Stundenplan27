<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { solve } from '../lib/solver/service';
	const store = useStore();
	import type { SolverOutput } from '../lib/solver/decode';

	let busy = $state(false);
	let phase = $state<string>('');
	let result = $state<SolverOutput | null>(null);

	async function generate() {
		busy = true;
		phase = 'starte…';
		result = null;
		try {
			const r = await solve($state.snapshot(store.doc) as any, {
				timeoutMs: 30_000,
				onProgress: p => (phase = p)
			});
			result = r;
			if (r.status === 'SAT') {
				// Replace non-pinned placements with solver result, keep pinned ones intact.
				const pinnedKept = store.doc.placed.filter(p => p.pinned);
				const pinnedKeys = new Set(pinnedKept.map(p => `${p.specId}|${p.day}|${p.period}`));
				// Dedupe by (specId, day, period) defensively. The solver MUST place
				// distinct lesson instances on distinct slots; if it doesn't, the
				// rendering each-block would error out on duplicate keys.
				const seen = new Set<string>(pinnedKeys);
				const additions: typeof r.placed = [];
				for (const p of r.placed) {
					const k = `${p.specId}|${p.day}|${p.period}`;
					if (seen.has(k)) continue;
					seen.add(k);
					additions.push({ ...p, pinned: false });
				}
				store.doc.placed = [...pinnedKept, ...additions];
				store.persistNow();
			}
		} finally {
			busy = false;
			phase = '';
		}
	}
</script>

<div class="gen">
	<button class="btn primary" onclick={generate} disabled={busy}>
		{busy ? `Generiere… (${phase})` : 'Plan generieren'}
	</button>

	{#if result}
		{#if result.status === 'SAT'}
			<div class="result-block">
				<span class="ok">
					✓ Plan gefunden ({result.placed.length} Stunden platziert{#if result.unplaced.length}, {result.unplaced.length} nicht{/if}{#if result.penalties}, Score {result.penalties.total}{/if})
				</span>
				{#if result.relaxedSpecIds && result.relaxedSpecIds.length > 0}
					<span class="warn">⚠ {result.message}</span>
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
							{#if result.penalties.main_run > 0}
								<li>Lange Hauptfach-Folgen: <strong>{result.penalties.main_run}</strong></li>
							{/if}
							{#if result.penalties.main_early > 0}
								<li>Hauptfächer-Spät-Score (niedriger=früher): <strong>{result.penalties.main_early}</strong></li>
							{/if}
							{#if result.penalties.compact > 0}
								<li>Lehrer-Freistunden: <strong>{result.penalties.compact}</strong></li>
							{/if}
							<li class="total">Total (gewichtet): <strong>{result.penalties.total}</strong></li>
						</ul>
					</details>
				{/if}
			</div>
		{:else if result.status === 'UNSAT'}
			<span class="err">✗ Keine Lösung – {result.message}</span>
		{:else}
			<span class="err">✗ {result.status}: {result.message ?? 'Solver-Fehler'}</span>
		{/if}
	{/if}
</div>

<style>
	.gen {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex-wrap: wrap;
	}
	.result-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		max-width: 700px;
	}
	.err {
		white-space: pre-line;
		max-width: 700px;
	}
	.ok {
		color: var(--ok);
		font-size: 13px;
	}
	.err {
		color: var(--err);
		font-size: 13px;
	}
	.warn {
		color: #b45309;
		background: #fef3c7;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 12px;
		white-space: pre-line;
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
</style>
