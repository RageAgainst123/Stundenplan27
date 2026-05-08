# ADR-0008: Flexible Block-Patterns (Auto-Modus)

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Bis Phase 7A wurde jede `LessonSpec` mit einem **expliziten** Block-Pattern
aus dem CSV-Import befüllt: bei `count=3` automatisch `[1,1,1]`, bei `count=4`
`[1,1,1,1]`. Das war funktional — aber zu **strikt**. Real-pädagogisch ist
oft eine Mischform optimal: bei 3 Stunden Mathe etwa 1 Doppel + 1 Einzel,
bei 4 Stunden 1 Doppel + 2 Einzel. Der User musste vorher entscheiden, und
ein „falsches" Pattern führte schnell in UNSAT.

Recherche bestätigte den Industrie-Standard:

- **Untis** verwendet `min-max`-Range pro Spec (z. B. „1–2 Doppelstunden"),
  der Solver entscheidet die finale Aufteilung.
- **FET** trennt Activity-Tags (logische Gruppen) von Soft-Constraints und
  empfiehlt: „Soft preferences should be the objective function, not hard
  constraints."
- Akademische CSP-Best-Practice: minimal nötige harte Regeln, alles weitere
  per gewichteter Zielfunktion.

User-Maßgabe für die MS SiG: Default-Pattern leer, Solver wählt zwischen
**0 oder 1 Doppelstunde** pro Spec, niemals 3er-Blöcke (Schul-Konvention).
Explizites Override per UI bleibt möglich.

## Entschieden

`LessonSpec.blocks` semantisch tri-state machen:

- `undefined` / `[]` → **Auto-Modus**: `count` einzelne Lesson-Instanzen,
  Solver darf max. 1 Paar zu einem Doppel binden, niemals 3er-Run.
- `[1,1,1]` etc. → **strikter Modus**: exakt diese Aufteilung, alter Code-Pfad.
- Migration alter Pläne: Pattern wie `[1,1,…count]` (= alter Default) wird
  zu `undefined`. Pattern wie `[2,1]` bleibt strikt.

CSV-Import setzt frische Specs auf `blocks: undefined`.

UI: Dropdown bekommt **„Automatisch"** als Top-Option, kursiv-grau dargestellt.
ℹ-Tooltip erklärt das Verhalten. Bulk-Action setzt mehrere Specs gleichzeitig
auf Auto.

## Verworfen

- **Min-Max-Range pro Spec** (Untis-Stil): mächtiger, aber 90 % der Schul-Fälle
  sind „flexibel oder strikt", keine Range-Bedingungen. Auto deckt das ab.
- **Subject-Level-Präferenz** (z. B. „BSP bevorzugt Doppelstunden"):
  zusätzlich verkomplizierte das Modell, der User kann das Override pro Spec
  setzen wenn nötig.
- **Hartes Verbot von 3er-Blöcken im Solver**: zu rigide; wenn User das
  expliziet als `[3]` setzt, soll das gehen.

## Konsequenzen

**Pro:**
- Default-Pläne werden flexibler und realistischer.
- UNSAT-Risiko durch unnötige Strenge verschwindet weitgehend.
- Auto-Lockerung (ADR-0009-Vorbote) ist die Backstop-Falls strikte Specs
  doch kollidieren.

**Kontra:**
- Modell hat zwei Pfade (Auto + strikt) und damit mehr Komplexität in
  `model.mzn` und `encode.ts`.
- Tests müssen beide Modi separat abdecken (siehe `encode.test.ts` Phase
  7B-Tests).
- Migration in `persistence.ts` musste das Default-Pattern aus alten
  localStorage-Inhalten zurückerkennen.

**Folge-Entscheidungen:**
- Auto-Lockerung bei UNSAT-Strict-Conflict baut auf diesem ADR auf
  (= ADR-0009 oder als eigene Phase).
- Zukünftiger Min-Max-Range wäre eine 3. Mode-Variante — bisher OOS.
