<script lang="ts">
	import { DAYS, PERIODS, type Day, type Period, type AvailabilityCell } from '../lib/types';

	interface Props {
		cells: AvailabilityCell[];
		has: (day: Day, period: Period) => boolean;
		onToggle: (day: Day, period: Period) => void;
	}
	let { cells, has, onToggle }: Props = $props();
</script>

<div class="grid" data-cells={cells.length}>
	<div class="cell head"></div>
	{#each DAYS as d}
		<div class="cell head">{d}</div>
	{/each}

	{#each PERIODS as p}
		<div class="cell head period-label">{p}.</div>
		{#each DAYS as d}
			<button
				type="button"
				class="cell slot"
				class:blocked={has(d, p)}
				onclick={() => onToggle(d, p)}
				aria-label={`${d}, ${p}. Stunde`}
			>
				{#if has(d, p)}✗{/if}
			</button>
		{/each}
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: 28px repeat(5, 1fr);
		gap: 2px;
		max-width: 360px;
	}
	.cell {
		font-size: 11px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
	}
	.cell.head {
		background: transparent;
		border: 0;
		color: var(--text-muted);
		font-weight: 600;
	}
	button.slot {
		cursor: pointer;
		padding: 0;
	}
	button.slot:hover {
		background: var(--accent-bg);
	}
	button.slot.blocked {
		background: #fee2e2;
		border-color: #fca5a5;
		color: var(--err);
		font-weight: 700;
	}
</style>
