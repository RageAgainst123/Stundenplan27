<script lang="ts">
	import type { LessonSpec, Teacher, WeekPattern } from '../lib/types';

	interface Props {
		spec: LessonSpec;
		/**
		 * Phase 17: ALLE Lehrer der Spec (1, 2, 3+). teachers[0] = Primary
		 * (linke Border-Farbe). Hintergrund wird als N-teiliger Gradient
		 * gerendert. Bis 3 Lehrer alle als L-Badge; ab 4 nur die ersten 2
		 * + "+N" Indikator.
		 */
		teachers: Teacher[];
		pinned: boolean;
		weekParity: 'even' | 'odd';
		onTogglePin: () => void;
		onRemove: () => void;
	}
	let { spec, teachers, pinned, weekParity, onTogglePin, onRemove }: Props = $props();

	const validTeachers = $derived(teachers.filter((t): t is Teacher => !!t));
	const color = $derived(validTeachers[0]?.color ?? '#9ca3af');
	const colorLast = $derived(validTeachers.length > 1 ? validTeachers[validTeachers.length - 1].color : color);
	const dimmedByWeek = $derived(spec.weekPattern !== 'every' && spec.weekPattern !== weekParity);

	/**
	 * Phase 17: N-Streifen-Gradient für beliebig viele Lehrer. Jeder Lehrer
	 * bekommt einen vertikalen Streifen gleicher Breite mit seiner Lehrerfarbe
	 * als 35%-Tint. Bei 1 Lehrer: einfacher Tint ohne Gradient. Bei 2: 50/50.
	 * Bei 3: 33/33/33. Bei N: je 100/N.
	 */
	const background = $derived.by(() => {
		const tint = (c: string) => `color-mix(in srgb, ${c} 35%, white)`;
		if (validTeachers.length === 0) return tint('#9ca3af');
		if (validTeachers.length === 1) return tint(validTeachers[0].color);
		const stops = validTeachers.map((t, i) => {
			const from = ((i / validTeachers.length) * 100).toFixed(2);
			const to = (((i + 1) / validTeachers.length) * 100).toFixed(2);
			return `${tint(t.color)} ${from}% ${to}%`;
		}).join(', ');
		return `linear-gradient(to right, ${stops})`;
	});

	// Bis 3 Lehrer alle als L-Badge anzeigen. Ab 4: erste 2 + "+N"-Indikator.
	const visibleTeachers = $derived(validTeachers.length <= 3 ? validTeachers : validTeachers.slice(0, 2));
	const hiddenCount = $derived(validTeachers.length > 3 ? validTeachers.length - 2 : 0);
	const hiddenTooltip = $derived(
		validTeachers.length > 3
			? '+ ' + validTeachers.slice(2).map(t => t.name).join(', ')
			: ''
	);
</script>

<div
	class="lesson"
	class:dimmed={dimmedByWeek}
	class:team={validTeachers.length > 1}
	style:--c={color}
	style:--c2={colorLast}
	style:background={background}
>
	<div class="row top">
		<span class="subj">{spec.subject}</span>
		<span class="teachers">
			{#each visibleTeachers as t, i (t.id)}
				<span class="teach" class:two={i > 0} title={t.name}>L{t.shortNumber ?? '?'}</span>
			{/each}
			{#if hiddenCount > 0}
				<span class="teach more" title={hiddenTooltip}>+{hiddenCount}</span>
			{/if}
		</span>
	</div>
	<div class="row bottom">
		<span class="grades">{spec.grades.join('+')}</span>
		{#if spec.weekPattern !== 'every'}
			<span class="week">{spec.weekPattern === 'even' ? 'G' : 'U'}</span>
		{/if}
	</div>
	<div class="actions" onclick={e => e.stopPropagation()} role="presentation">
		<button class="ic" class:on={pinned} onclick={onTogglePin} title={pinned ? 'Pin entfernen' : 'Pinnen'}>
			{pinned ? '🔒' : '🔓'}
		</button>
		<button class="ic" onclick={onRemove} title="Entfernen">×</button>
	</div>
</div>

<style>
	.lesson {
		position: relative;
		height: 100%;
		min-height: 44px;
		padding: 2px 4px;
		font-size: 11px;
		line-height: 1.15;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		border-left: 3px solid var(--c);
	}
	/* Two-teacher cells get a thin right-border in the second teacher's color
	   so the team is recognizable from both sides. The lesson keeps its fixed
	   height — only colors change, no extra rows. */
	.lesson.team {
		border-right: 3px solid var(--c2);
	}
	.lesson.dimmed {
		opacity: 0.5;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.subj {
		font-weight: 700;
		font-size: 11px;
	}
	.teachers {
		display: inline-flex;
		gap: 3px;
		align-items: center;
	}
	.teach {
		font-family: var(--mono);
		font-weight: 700;
		opacity: 0.85;
	}
	.teach.two {
		padding: 0 3px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.5);
	}
	/* Phase 17: bei 4+ Lehrern zeigen wir nur die ersten beiden + "+N" */
	.teach.more {
		padding: 0 4px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.55);
		color: white;
		font-weight: 700;
	}
	.grades {
		font-family: var(--mono);
		font-size: 10px;
		opacity: 0.85;
	}
	.week {
		background: rgba(0, 0, 0, 0.6);
		color: white;
		font-size: 9px;
		padding: 0 4px;
		border-radius: 3px;
		font-weight: 700;
	}
	.actions {
		position: absolute;
		top: 1px;
		right: 1px;
		display: none;
		gap: 1px;
	}
	.lesson:hover .actions {
		display: flex;
	}
	.ic {
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 3px;
		padding: 0 3px;
		font-size: 10px;
		cursor: pointer;
		line-height: 1;
	}
	.ic.on {
		background: var(--accent);
	}
</style>
