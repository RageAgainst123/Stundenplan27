// Solver-Opt Schritt 6: Autopilot — „Ein Klick, bestes Ergebnis".
//
// Bisher musste der User manuell iterieren: Generieren → Weiter optimieren
// → Diversifizieren → vergleichen. Der Autopilot orchestriert das
// automatisch innerhalb eines Gesamt-Budgets:
//
//   Phase 1: Generate (Pool 5s + ILS) — 40% des Budgets
//   Phase 2+: k Diversify-Zyklen mit fallender Fraction (0.3/0.2/0.15/0.1)
//             auf dem Rest-Budget
//
// Diversify hat bereits absolutes Best-Tracking mit Revert (solver-v2/
// index.ts) — der Plan kann über die Zyklen hinweg nie schlechter werden.
//
// Dieses Modul enthält NUR die pure Budget-Planung (testbar ohne Zeit).
// Die Ausführung (startSolve-Sessions sequentiell abwarten, Ergebnisse in
// den Store schreiben) lebt in GenerateButton.svelte, wo Store-Zugriff
// und Event-Verdrahtung bereits existieren.

import type { DiversifyStrategy } from './solver-v2/index';

export type AutopilotPhase =
	| { kind: 'generate'; poolBudgetMs: number; totalBudgetMs: number }
	| { kind: 'diversify'; fraction: number; durationMs: number; strategy: DiversifyStrategy };

export interface AutopilotPlan {
	phases: AutopilotPhase[];
	totalBudgetMs: number;
}

/** Fallende Diversify-Fractions — größere Sprünge zuerst, Feinschliff am Ende. */
const DIVERSIFY_FRACTIONS = [0.3, 0.2, 0.15, 0.1] as const;

/**
 * Solver-Opt Runde 2, Schritt 1: Destroy-Strategie pro Zyklus.
 *
 * BENCH-BEFUND (bench-baseline.json, Eintrag r2-schritt-1): 'worst-teacher'
 * zeigte in 3 Messrunden KEINEN belastbaren Vorteil gegenüber 'random'
 * (Median-Gleichstand, Summen leicht schlechter) — daher bleibt der
 * Autopilot auf 'random'. Die Strategien sind als getesteter Hook in
 * lnsDestroy.ts verfügbar; Wiedervorlage nach Runde-2-Schritt 2+3
 * (mehr Repair-Durchsatz pro Zyklus könnte zielgerichtetes Destroy
 * rentabel machen).
 */
const DIVERSIFY_STRATEGIES: readonly DiversifyStrategy[] =
	['random', 'random', 'random', 'random'] as const;

/** Ein Diversify-Zyklus unter dieser Dauer lohnt nicht (Construction-Anteil frisst ihn auf). */
const MIN_CYCLE_MS = 8_000;

/**
 * Plant die Autopilot-Phasen für ein Gesamt-Budget.
 *
 * Regeln:
 *  - Generate bekommt 40% des Budgets (min. 20s), Pool max. 5s davon.
 *  - Der Rest wird auf bis zu 4 Diversify-Zyklen mit fallender Fraction
 *    verteilt; jeder Zyklus min. MIN_CYCLE_MS, sonst weniger Zyklen.
 *  - Bei sehr kleinen Budgets (< ~30s) gibt es nur die Generate-Phase.
 */
export function planAutopilot(totalBudgetMs: number): AutopilotPlan {
	const budget = Math.max(30_000, Math.round(totalBudgetMs));
	const generateMs = Math.max(20_000, Math.round(budget * 0.4));
	const poolMs = Math.min(5_000, Math.round(generateMs * 0.2));

	const phases: AutopilotPhase[] = [
		{ kind: 'generate', poolBudgetMs: poolMs, totalBudgetMs: generateMs },
	];

	const rest = budget - generateMs;
	if (rest >= MIN_CYCLE_MS) {
		const cycles = Math.min(
			DIVERSIFY_FRACTIONS.length,
			Math.max(1, Math.floor(rest / MIN_CYCLE_MS))
		);
		const perCycle = Math.floor(rest / cycles);
		for (let i = 0; i < cycles; i++) {
			phases.push({
				kind: 'diversify',
				fraction: DIVERSIFY_FRACTIONS[i],
				durationMs: perCycle,
				strategy: DIVERSIFY_STRATEGIES[i],
			});
		}
	}

	return { phases, totalBudgetMs: budget };
}

/** Kurze menschenlesbare Beschreibung eines Plans für UI/Logs. */
export function describeAutopilotPlan(plan: AutopilotPlan): string {
	const gen = plan.phases.find(p => p.kind === 'generate') as Extract<AutopilotPhase, { kind: 'generate' }> | undefined;
	const divs = plan.phases.filter(p => p.kind === 'diversify') as Extract<AutopilotPhase, { kind: 'diversify' }>[];
	const parts: string[] = [];
	if (gen) parts.push(`Generieren ${Math.round(gen.totalBudgetMs / 1000)}s (Pool ${Math.round(gen.poolBudgetMs / 1000)}s)`);
	if (divs.length > 0) {
		const per = Math.round(divs[0].durationMs / 1000);
		parts.push(`${divs.length}× Diversify à ${per}s (${divs.map(d => Math.round(d.fraction * 100) + '%').join('/')})`);
	}
	return parts.join(' → ');
}
