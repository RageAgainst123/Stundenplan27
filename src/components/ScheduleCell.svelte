<script lang="ts">
	import { useStore } from '../lib/store.svelte';
	import { placementsAt } from '../lib/schedule-helpers';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DragDropState } from '@thisux/sveltednd';
	import type { Day, GradeLevel, LessonSpec, Period, Teacher } from '../lib/types';
	import type { DragPayload } from '../lib/types-ui';
	import { checkPlacementConflict, couplingBackground } from '../lib/schedule-helpers';
	import LessonCell from './LessonCell.svelte';

	const store = useStore();

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

	// If all placements in this cell share a non-empty couplingId → coupling background.
	// Phase 8 v3: only solver couplings (couplingId) get the visual highlight,
	// not descriptive Sokrates labels (groupLabel). Audit A5: gemeinsamer
	// Helper (identische Logik lebte auch im WeekView).
	const couplingBg = $derived(couplingBackground(cellPlacements.map(cp => cp.spec)));

	function handleDrop(state: DragDropState<DragPayload>) {
		const { specId, fromCell } = state.draggedItem;
		const spec = store.doc.specs.find(s => s.id === specId);
		if (!spec) return;
		const conflict = checkPlacementConflict(
			store.doc, spec, day, period,
			fromCell ? { specId, day: fromCell.day, period: fromCell.period } : undefined
		);
		if (conflict.hasConflict) {
			alert('Kann hier nicht platziert werden:\n' + conflict.reasons.join('\n'));
			return;
		}
		// Audit M-4 (Mai-Audit, 2026-07 umgesetzt): Specs landen IMMER auf
		// ihren EIGENEN Stufen — ein Drop in eine fremde Stufen-Spalte
		// wechselt nur die Zeit. Vorher passierte das still und der User
		// wunderte sich, warum die gewählte Spalte leer blieb.
		if (spec.grades.length > 0 && !spec.grades.includes(grade)) {
			const ok = confirm(
				`„${spec.subject}" gehört zur ${spec.grades.join('.+')}. Stufe.\n\n` +
				`Die Stunde wird auf ${day} P${period} verschoben, erscheint aber in ihrer eigenen Stufen-Spalte — nicht in der ${grade}er-Spalte, auf der du sie abgelegt hast.\n\nTrotzdem verschieben?`
			);
			if (!ok) return;
		}
		// Audit-Fix A1c: Segment-Team der bewegten Stunde retten. Team-
		// Teaching-Lessons tragen ihr effektives Slot-Team in `teachers` —
		// ohne Übernahme würde die Stunde nach dem Move das VOLLE Spec-Team
		// zeigen (Datenverlust, falsche Konflikt-Prüfung).
		let movedTeachers: string[] | undefined;
		if (fromCell) {
			const source = store.doc.placed.find(
				p => p.specId === specId && p.day === fromCell.day && p.period === fromCell.period
			);
			movedTeachers = source?.teachers ? [...source.teachers] : undefined;
			store.doc.placed = store.doc.placed.filter(
				p => !(p.specId === specId && p.day === fromCell.day && p.period === fromCell.period)
			);
		}
		// Phase 8 v2: one placement per grade-column the spec covers.
		const grades = spec.grades.length > 0 ? spec.grades : [grade];
		for (const g of grades) {
			store.doc.placed.push({
				specId, day, period, grade: g, pinned: true,
				...(movedTeachers ? { teachers: movedTeachers } : {})
			});
		}
	}

	function togglePin(specId: string) {
		const matching = store.doc.placed.filter(
			x => x.specId === specId && x.day === day && x.period === period
		);
		if (matching.length === 0) return;
		const newPinned = !matching[0].pinned;
		for (const p of matching) p.pinned = newPinned;
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
	class:coupled={couplingBg !== ''}
	style:background={couplingBg || undefined}
	use:droppable={{
		container: `cell-${day}-${period}`,
		callbacks: {
			onDrop: state => handleDrop(state as DragDropState<DragPayload>)
		}
	}}
>
	<div class="row" class:team={couplingBg !== ''}>
		{#each cellPlacements as cp, idx (cp.placed.specId + '|' + cp.placed.day + '|' + cp.placed.period + '|' + cp.placed.grade + '|' + idx)}
			{@const effectiveTeacherIds = cp.placed.teachers ?? cp.spec.teachers}
		{@const cpTeachers = effectiveTeacherIds.map(tid => teacherById(tid)).filter((t): t is NonNullable<typeof t> => !!t)}
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
					teachers={cpTeachers}
					pinned={cp.placed.pinned}
					weekParity={weekParity}
					onTogglePin={() => togglePin(cp.spec.id)}
					onRemove={() => removePlacement(cp.spec.id)}
				/>
			</div>
		{/each}
	</div>
</td>

<style>
	td.cell {
		min-height: 44px;
		height: 44px;
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
	td.cell.coupled {
		box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.25);
	}
	/* Default: stack vertically (multiple non-coupled placements). */
	.row {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.row > .placed + .placed {
		border-top: 1px dashed rgba(0, 0, 0, 0.25);
	}
	/* Coupling: render side-by-side as a team-teaching block. The cell
	   visually stays one block; specs are split horizontally with a
	   vertical divider between them. */
	.row.team {
		flex-direction: row;
	}
	.row.team > .placed {
		flex: 1 1 0;
		min-width: 0;
	}
	.row.team > .placed + .placed {
		border-top: none;
		border-left: 1px dashed rgba(0, 0, 0, 0.45);
	}
	.placed {
		min-height: 24px;
		cursor: grab;
	}
	.placed:active {
		cursor: grabbing;
	}
	.placed.filtered {
		opacity: 0.18;
	}
</style>
