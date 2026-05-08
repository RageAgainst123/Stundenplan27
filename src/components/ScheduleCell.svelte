<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { placementsAt } from '../lib/schedule-helpers';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DragDropState } from '@thisux/sveltednd';
	import type { Day, GradeLevel, LessonSpec, Period, Teacher } from '../lib/types';
	import { checkPlacementConflict } from '../lib/schedule-helpers';
	import LessonCell from './LessonCell.svelte';

	const store = useStore();

	interface DragPayload {
		specId: string;
		fromCell?: { day: Day; period: Period };
	}

	interface Props {
		day: Day;
		period: Period;
		grade: GradeLevel;
		isNow: boolean;
		isHighlighted: (spec: LessonSpec, grade: GradeLevel) => boolean;
		weekParity: 'even' | 'odd';
		teacherById: (id: string) => Teacher | undefined;
	}
	let { day, period, grade, isNow, isHighlighted, weekParity, teacherById }: Props = $props();

	// Reactive read of placed array — Svelte 5 tracks this through the prop chain
	// because the component re-evaluates whenever store.doc.placed changes.
	const cellPlacements = $derived(placementsAt(store.doc, day, period, grade));

	function handleDrop(state: DragDropState<DragPayload>) {
		const { specId, fromCell } = state.draggedItem;
		const spec = store.doc.specs.find(s => s.id === specId);
		if (!spec) return;
		const conflict = checkPlacementConflict(store.doc, spec, day, period, fromCell ? specId : undefined);
		if (conflict.hasConflict) {
			alert('Kann hier nicht platziert werden:\n' + conflict.reasons.join('\n'));
			return;
		}
		if (fromCell) {
			store.doc.placed = store.doc.placed.filter(
				p => !(p.specId === specId && p.day === fromCell.day && p.period === fromCell.period)
			);
		}
		store.doc.placed.push({ specId, day, period, pinned: true });
	}

	function togglePin(specId: string) {
		const p = store.doc.placed.find(x => x.specId === specId && x.day === day && x.period === period);
		if (p) p.pinned = !p.pinned;
	}

	function removePlacement(specId: string) {
		store.doc.placed = store.doc.placed.filter(
			p => !(p.specId === specId && p.day === day && p.period === period)
		);
	}
</script>

<td
	class="cell"
	class:now={isNow}
	use:droppable={{
		container: `cell-${day}-${period}`,
		callbacks: {
			onDrop: state => handleDrop(state as DragDropState<DragPayload>)
		}
	}}
>
	{#each cellPlacements as cp (cp.placed.specId + '-' + grade)}
		{@const teacher = teacherById(cp.spec.teacher)}
		{@const visible = isHighlighted(cp.spec, grade)}
		<div
			class="placed"
			class:filtered={!visible}
			use:draggable={{
				container: `cell-${day}-${period}`,
				dragData: { specId: cp.spec.id, fromCell: { day, period } } as DragPayload
			}}
		>
			<LessonCell
				spec={cp.spec}
				teacher={teacher}
				pinned={cp.placed.pinned}
				weekParity={weekParity}
				onTogglePin={() => togglePin(cp.spec.id)}
				onRemove={() => removePlacement(cp.spec.id)}
			/>
		</div>
	{/each}
</td>

<style>
	td.cell {
		min-height: 50px;
		height: 50px;
		vertical-align: top;
		background: white;
		padding: 0;
		font-size: 11px;
		border: 1px solid var(--border);
	}
	td.cell.now {
		background: rgba(255, 215, 0, 0.18);
		box-shadow: inset 0 0 0 2px gold;
	}
	.placed {
		height: 100%;
		min-height: 50px;
		cursor: grab;
	}
	.placed:active {
		cursor: grabbing;
	}
	.placed.filtered {
		opacity: 0.18;
	}
</style>
