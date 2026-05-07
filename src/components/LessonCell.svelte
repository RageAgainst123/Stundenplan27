<script lang="ts">
	import type { LessonSpec, Teacher, WeekPattern } from '../lib/types';

	interface Props {
		spec: LessonSpec;
		teacher?: Teacher;
		pinned: boolean;
		weekParity: 'even' | 'odd';
		onTogglePin: () => void;
		onRemove: () => void;
	}
	let { spec, teacher, pinned, weekParity, onTogglePin, onRemove }: Props = $props();

	const color = $derived(teacher?.color ?? '#9ca3af');
	const dimmedByWeek = $derived(spec.weekPattern !== 'every' && spec.weekPattern !== weekParity);
</script>

<div
	class="lesson"
	class:dimmed={dimmedByWeek}
	style:--c={color}
	style:background={`color-mix(in srgb, ${color} 35%, white)`}
>
	<div class="row top">
		<span class="subj">{spec.subject}</span>
		<span class="teach" title={teacher?.name}>L{teacher?.shortNumber ?? '?'}</span>
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
		min-height: 50px;
		padding: 3px 6px;
		font-size: 11px;
		line-height: 1.2;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		border-left: 3px solid var(--c);
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
		font-size: 12px;
	}
	.teach {
		font-family: var(--mono);
		font-weight: 700;
		opacity: 0.85;
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
