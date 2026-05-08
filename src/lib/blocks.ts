// Block-Pattern helpers for lesson scheduling.
// A block pattern is an array of integers, each representing a contiguous
// chunk of periods. E.g. [2,2] = two double-periods, [1,1,1,1] = four singles,
// [3,1] = one triple + one single. sum(pattern) must equal the spec's count.

import type { BlockPattern } from './types';

export const DEFAULT_BLOCK = (count: number): BlockPattern =>
	Array(Math.max(1, Math.round(count))).fill(1);

/** Generate sensible block-pattern presets for a given count. */
export function blockPresets(count: number): BlockPattern[] {
	const c = Math.max(1, Math.round(count));
	const out: BlockPattern[] = [];

	// All singles
	out.push(Array(c).fill(1));

	// All doubles (only if even)
	if (c >= 2 && c % 2 === 0) out.push(Array(c / 2).fill(2));

	// All triples (only if divisible by 3 and >= 3)
	if (c >= 3 && c % 3 === 0) out.push(Array(c / 3).fill(3));

	// 1 double + rest singles
	if (c >= 3) out.push([2, ...Array(c - 2).fill(1)]);

	// 1 triple + rest singles (for c >= 4)
	if (c >= 4) out.push([3, ...Array(c - 3).fill(1)]);

	// 2 doubles + rest singles
	if (c >= 5) out.push([2, 2, ...Array(c - 4).fill(1)]);

	// Specific common patterns
	if (c === 5) out.push([2, 2, 1]);
	if (c === 6) {
		out.push([3, 2, 1]);
		out.push([2, 2, 2]);
	}

	// Dedupe via canonical form (sorted descending)
	const seen = new Set<string>();
	const result: BlockPattern[] = [];
	for (const b of out) {
		const key = [...b].sort((x, y) => y - x).join('+');
		if (seen.has(key)) continue;
		seen.add(key);
		result.push([...b].sort((x, y) => y - x));
	}
	return result;
}

/** Human-readable label for a block pattern, e.g. [2,1,1] → "1×2er + 2×1er". */
export function blockLabel(b: BlockPattern): string {
	if (b.length === 0) return '–';
	const counts = new Map<number, number>();
	for (const n of b) counts.set(n, (counts.get(n) ?? 0) + 1);
	return Array.from(counts.entries())
		.sort((a, c) => c[0] - a[0])
		.map(([len, k]) => `${k}×${len}er`)
		.join(' + ');
}

/** Canonical key for a block pattern, useful as <option> value or Map key. */
export function blockKey(b: BlockPattern): string {
	return [...b].sort((a, c) => c - a).join('+');
}

/** Parse a block-key string back into a BlockPattern. */
export function parseBlockKey(key: string): BlockPattern {
	if (!key) return [];
	return key.split('+').map(Number).filter(n => Number.isFinite(n) && n > 0);
}

/** Validate that a block pattern is consistent with a count. */
export function isValidBlock(b: BlockPattern, count: number): boolean {
	if (!Array.isArray(b) || b.length === 0) return false;
	const sum = b.reduce((a, c) => a + c, 0);
	return Math.abs(sum - count) < 1e-9 && b.every(n => n >= 1 && Number.isInteger(n));
}

/** Deterministic pastel color for a group key. */
export function groupColor(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
	return `hsl(${h}, 35%, 78%)`;
}
