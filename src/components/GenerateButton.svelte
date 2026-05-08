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
				const additions = r.placed
					.filter(p => !pinnedKeys.has(`${p.specId}|${p.day}|${p.period}`))
					.map(p => ({ ...p, pinned: false }));
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
			<span class="ok">✓ Plan gefunden ({result.placed.length} Stunden platziert{#if result.unplaced.length}, {result.unplaced.length} nicht{/if})</span>
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
		align-items: center;
		gap: 12px;
	}
	.ok {
		color: var(--ok);
		font-size: 13px;
	}
	.err {
		color: var(--err);
		font-size: 13px;
	}
</style>
