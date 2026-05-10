<script lang="ts">
	import type { LessonSpec, Teacher, WeekPattern } from '../lib/types';

	interface Props {
		spec: LessonSpec;
		/** Primary teacher (spec.teachers[0]). Used for the left-border color
		 *  and the first L-badge. */
		teacher?: Teacher;
		/** Optional second teacher for team-teaching (spec.teachers[1]). When
		 *  set, a second L-badge is rendered next to the first one and the
		 *  background is split 50/50. */
		teacher2?: Teacher;
		pinned: boolean;
		weekParity: 'even' | 'odd';
		onTogglePin: () => void;
		onRemove: () => void;
	}
	let { spec, teacher, teacher2, pinned, weekParity, onTogglePin, onRemove }: Props = $props();

	const color = $derived(teacher?.color ?? '#9ca3af');
	const color2 = $derived(teacher2?.color);
	const dimmedByWeek = $derived(spec.weekPattern !== 'every' && spec.weekPattern !== weekParity);

	/** When two teachers are present, paint the cell as a horizontal split
	 *  (50% left teacher tint, 50% right teacher tint) so the team is
	 *  immediately recognizable without growing the cell. */
	const background = $derived.by(() => {
		const tint = (c: string) => `color-mix(in srgb, ${c} 35%, white)`;
		if (color2) {
			return `linear-gradient(to right, ${tint(color)} 0 50%, ${tint(color2)} 50% 100%)`;
		}
		return tint(color);
	});
</script>

<div
	class="lesson"
	class:dimmed={dimmedByWeek}
	class:team={!!teacher2}
	style:--c={color}
	style:--c2={color2 ?? color}
	style:background={background}
>
	<div class="row top">
		<span class="subj">{spec.subject}</span>
		<span class="teachers">
			<span class="teach" title={teacher?.name}>L{teacher?.shortNumber ?? '?'}</span>
			{#if teacher2}
				<span class="teach two" title={teacher2.name}>L{teacher2.shortNumber ?? '?'}</span>
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
