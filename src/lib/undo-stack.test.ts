import { describe, it, expect } from 'vitest';
import { pushUndo, popUndo, UNDO_CAP, type UndoEntry } from './undo-stack';
import type { PlacedLesson } from './types';

const lesson = (period: number): PlacedLesson =>
	({ specId: 's1', day: 'Mo', period: period as PlacedLesson['period'], grade: 5, pinned: false });

describe('undo-stack (F2-S4)', () => {
	it('Roundtrip: push → pop stellt den Stand byte-gleich wieder her', () => {
		const original = [lesson(1), lesson(3)];
		let stack: UndoEntry[] = [];
		stack = pushUndo(stack, 'Zug 1', original);
		// Original danach mutieren — der Stapel darf davon nichts merken.
		original[0].period = 8 as PlacedLesson['period'];
		const { entry, rest } = popUndo(stack);
		expect(rest).toHaveLength(0);
		expect(entry!.label).toBe('Zug 1');
		expect(entry!.placedBefore).toEqual([lesson(1), lesson(3)]);
		// Auch der zurückgegebene Stand ist eine Kopie (Mutation isoliert).
		entry!.placedBefore[0].period = 7 as PlacedLesson['period'];
		const again = popUndo(pushUndo([], 'x', [lesson(1)]));
		expect(again.entry!.placedBefore[0].period).toBe(1);
	});

	it('LIFO-Reihenfolge über mehrere Züge', () => {
		let stack: UndoEntry[] = [];
		stack = pushUndo(stack, 'A', [lesson(1)]);
		stack = pushUndo(stack, 'B', [lesson(2)]);
		stack = pushUndo(stack, 'C', [lesson(3)]);
		const p1 = popUndo(stack);
		expect(p1.entry!.label).toBe('C');
		const p2 = popUndo(p1.rest);
		expect(p2.entry!.label).toBe('B');
		expect(p2.rest.map(e => e.label)).toEqual(['A']);
	});

	it('Cap: älteste Einträge fallen raus, leerer Pop ist harmlos', () => {
		let stack: UndoEntry[] = [];
		for (let i = 0; i < UNDO_CAP + 5; i++) {
			stack = pushUndo(stack, `Zug ${i}`, [lesson(1)]);
		}
		expect(stack).toHaveLength(UNDO_CAP);
		expect(stack[0].label).toBe('Zug 5'); // 0-4 verdrängt
		expect(popUndo([]).entry).toBeNull();
	});
});
