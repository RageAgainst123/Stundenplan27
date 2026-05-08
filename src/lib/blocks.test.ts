import { describe, it, expect } from 'vitest';
import { blockPresets, blockLabel, blockKey, parseBlockKey, isValidBlock, groupColor, DEFAULT_BLOCK } from './blocks';

describe('blockPresets', () => {
	it('returns single block for count=1', () => {
		const p = blockPresets(1);
		expect(p).toContainEqual([1]);
	});

	it('returns sensible options for count=4', () => {
		const p = blockPresets(4);
		// Should include 4 singles, 2 doubles, and 2+1+1
		const keys = p.map(blockKey);
		expect(keys).toContain('1+1+1+1');
		expect(keys).toContain('2+2');
		expect(keys).toContain('2+1+1');
		expect(keys).toContain('3+1');
	});

	it('returns triples option for count=6', () => {
		const p = blockPresets(6);
		const keys = p.map(blockKey);
		expect(keys).toContain('1+1+1+1+1+1');
		expect(keys).toContain('2+2+2');
		expect(keys).toContain('3+3');
		expect(keys).toContain('3+2+1');
	});

	it('dedupes patterns with different orderings', () => {
		const p = blockPresets(4);
		const seen = new Set<string>();
		for (const b of p) {
			const k = blockKey(b);
			expect(seen.has(k)).toBe(false);
			seen.add(k);
		}
	});

	it('handles count=0.5 → 1', () => {
		const p = blockPresets(0.5);
		expect(p.length).toBeGreaterThan(0);
	});
});

describe('blockLabel', () => {
	it('formats simple patterns', () => {
		expect(blockLabel([1, 1, 1, 1])).toBe('4×1er');
		expect(blockLabel([2, 2])).toBe('2×2er');
		expect(blockLabel([2, 1, 1])).toBe('1×2er + 2×1er');
	});

	it('returns dash for empty pattern', () => {
		expect(blockLabel([])).toBe('–');
	});

	it('orders descending by block-length', () => {
		expect(blockLabel([1, 3, 1, 2])).toBe('1×3er + 1×2er + 2×1er');
	});
});

describe('blockKey + parseBlockKey', () => {
	it('round-trips', () => {
		const b: number[] = [2, 1, 1];
		const k = blockKey(b);
		const back = parseBlockKey(k);
		// Both sorted descending
		expect(back).toEqual([2, 1, 1]);
	});

	it('parses empty as []', () => {
		expect(parseBlockKey('')).toEqual([]);
	});
});

describe('isValidBlock', () => {
	it('accepts valid patterns', () => {
		expect(isValidBlock([1, 1, 1, 1], 4)).toBe(true);
		expect(isValidBlock([2, 2], 4)).toBe(true);
		expect(isValidBlock([3, 1], 4)).toBe(true);
	});

	it('rejects sum mismatch', () => {
		expect(isValidBlock([2, 2], 5)).toBe(false);
	});

	it('rejects empty pattern', () => {
		expect(isValidBlock([], 4)).toBe(false);
	});

	it('rejects non-integer or zero blocks', () => {
		expect(isValidBlock([0, 4], 4)).toBe(false);
		expect(isValidBlock([2.5, 1.5], 4)).toBe(false);
	});
});

describe('groupColor', () => {
	it('is deterministic', () => {
		expect(groupColor('Bewegung und Sport Knaben 1/2')).toBe(groupColor('Bewegung und Sport Knaben 1/2'));
	});

	it('returns different colors for different keys (best effort)', () => {
		// Not guaranteed by hash, but very likely for these inputs
		expect(groupColor('A')).not.toBe(groupColor('Z'));
	});

	it('returns a valid hsl string', () => {
		expect(groupColor('test')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
	});
});

describe('DEFAULT_BLOCK', () => {
	it('returns count singles', () => {
		expect(DEFAULT_BLOCK(4)).toEqual([1, 1, 1, 1]);
		expect(DEFAULT_BLOCK(1)).toEqual([1]);
	});

	it('rounds half-counts up to at least 1', () => {
		expect(DEFAULT_BLOCK(0.5)).toEqual([1]);
	});
});
