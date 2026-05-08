# Architecture Decision Records (ADRs)

Kurze Notizen zu wichtigen Architektur-Entscheidungen — pro Entscheidung
eine eigene Markdown-Datei. Format inspiriert von Michael Nygard's ADR-Template.

## Zweck

Wenn in einer späteren Session jemand fragt „**Warum** haben wir das so
gebaut?" — diese Dateien sollen die Antwort sein, ohne dass man die ganze
Recherche-Arbeit nochmal machen muss.

## Format pro Datei

```markdown
# ADR-XXXX: <Kurzer Titel>

**Status:** accepted | superseded | proposed
**Datum:** YYYY-MM-DD

## Kontext
Was war das Problem? Welche Constraints standen im Raum?

## Entschieden
Welche Option haben wir gewählt? In einem Satz.

## Verworfen
Welche Alternativen haben wir geprüft? Pro Alternative ein Satz warum nicht.

## Konsequenzen
Was kostet uns die Entscheidung? Was bringt sie? Welche Folge-Entscheidungen
hängen daran?
```

## Liste

| Nr      | Titel                                                       | Datum      |
| ------- | ----------------------------------------------------------- | ---------- |
| [0001](0001-stack-vite-svelte5.md) | Stack: Vite + Svelte 5 + TypeScript      | 2026-05-07 |
| [0002](0002-minizinc-wasm-solver.md) | Solver: MiniZinc-WASM im Browser     | 2026-05-07 |
| [0003](0003-no-backend.md) | Persistenz: localStorage, kein Backend        | 2026-05-07 |
| [0004](0004-3d-slot-modeling.md) | Solver-Modell: 3D-Slot (day, period, grade) | 2026-05-08 |
| [0005](0005-context-pattern-store.md) | State: setContext/getContext-Store     | 2026-05-08 |
| [0006](0006-block-pattern-presets.md) | UI: Block-Pattern als Preset-Dropdown  | 2026-05-08 |
| [0007](0007-csv-as-seed-not-sync.md) | CSV-Import als Seeder, nicht als Sync   | 2026-05-08 |
| [0008](0008-flexible-block-patterns.md) | Flexible Block-Patterns (Auto-Modus) | 2026-05-08 |
| [0009](0009-soft-constraints-as-penalties.md) | Soft-Constraints als gewichtete Penalty-Zielfunktion | 2026-05-08 |
| [0010](0010-grouplabel-vs-couplingid.md) | groupLabel vs. couplingId — Trennung Stufen-Bezeichnung und Solver-Kopplung | 2026-05-08 |
| [0011](0011-tagespensum-und-doppel-einzel.md) | Tagespensum + „Doppel ⇒ kein Einzel am gleichen Tag" | 2026-05-08 |
| [0012](0012-anytime-multistage-solver-workflow.md) | Anytime Multi-Stage Solver Workflow | 2026-05-08 |
