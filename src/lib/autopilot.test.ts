import { describe, it, expect } from 'vitest';
import { planAutopilot, describeAutopilotPlan } from './autopilot';

describe('planAutopilot', () => {
	it('10 Minuten (Default): Generate 40% + 4 Diversify-Zyklen', () => {
		const plan = planAutopilot(600_000);
		expect(plan.phases[0]).toEqual({ kind: 'generate', poolBudgetMs: 5000, totalBudgetMs: 240_000 });
		const divs = plan.phases.slice(1);
		expect(divs).toHaveLength(4);
		expect(divs.map(d => d.kind === 'diversify' ? d.fraction : 0)).toEqual([0.3, 0.2, 0.15, 0.1]);
		// Runde 2 Schritt 1: Strategie pro Zyklus gesetzt — nach Bench-Befund
		// vorerst überall 'random' (siehe DIVERSIFY_STRATEGIES-Kommentar).
		expect(divs.map(d => d.kind === 'diversify' ? d.strategy : '')).toEqual(
			['random', 'random', 'random', 'random']
		);
		// Rest 360s / 4 = 90s pro Zyklus
		for (const d of divs) {
			expect(d.kind).toBe('diversify');
			if (d.kind === 'diversify') expect(d.durationMs).toBe(90_000);
		}
	});

	it('Budget-Summe wird nicht überschritten', () => {
		for (const budget of [60_000, 180_000, 600_000, 900_000]) {
			const plan = planAutopilot(budget);
			const sum = plan.phases.reduce((s, p) =>
				s + (p.kind === 'generate' ? p.totalBudgetMs : p.durationMs), 0);
			expect(sum).toBeLessThanOrEqual(budget);
		}
	});

	it('1 Minute: Generate min. 20s + wenige kurze Zyklen', () => {
		const plan = planAutopilot(60_000);
		const gen = plan.phases[0];
		expect(gen.kind).toBe('generate');
		if (gen.kind === 'generate') {
			expect(gen.totalBudgetMs).toBeGreaterThanOrEqual(20_000);
		}
		// Rest 36s → 4 Zyklen à 9s wären < MIN_CYCLE_MS → max 4 Zyklen mit >= 8s
		const divs = plan.phases.slice(1);
		for (const d of divs) {
			if (d.kind === 'diversify') expect(d.durationMs).toBeGreaterThanOrEqual(8_000);
		}
	});

	it('sehr kleines Budget wird auf 30s angehoben, mindestens Generate-Phase', () => {
		const plan = planAutopilot(5_000);
		expect(plan.totalBudgetMs).toBe(30_000);
		expect(plan.phases[0].kind).toBe('generate');
	});

	it('describeAutopilotPlan liefert lesbaren Text', () => {
		const text = describeAutopilotPlan(planAutopilot(600_000));
		expect(text).toContain('Generieren 240s');
		expect(text).toContain('4× Diversify');
		expect(text).toContain('30%/20%/15%/10%');
	});
});
