# ADR-0009: Soft-Constraints als gewichtete Penalty-Zielfunktion

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Das `RulesPanel` hat seit Phase 5 sechs Toggle/Gewicht-Paare:

1. Keine Freistunden für Klassen
2. Hauptfach nicht am Nachmittag (mit konfigurierbarem Start-Period)
3. Max N Hauptfächer in Folge
4. Hauptfach bevorzugt früh am Tag
5. Doppelstunden zusammen halten
6. Lehrer-Tage kompakt

Bis Phase 7A waren diese Werte rein UI — sie flossen nicht in den Solver.
`solve satisfy` lieferte irgendeine zulässige Lösung; der User hatte keinen
Hebel auf die pädagogische Qualität.

## Entschieden

Alle Toggles als **gewichtete Penalty-Terme** in eine MiniZinc-Zielfunktion
fassen und `solve satisfy` durch `solve minimize total_penalty` ersetzen.

Pattern pro Toggle:

```minizinc
var int: pen_X = if w_X > 0 then <indicator-sum> else 0 endif;
var int: total_penalty = w_a * pen_a + w_b * pen_b + ...;
solve :: int_search([assign[l] | l in LESSON], first_fail, indomain_min, complete)
       minimize total_penalty;
```

Die `if w > 0`-Wache ist wichtig: deaktivierte Toggles reduzieren das
zugehörige `pen_X` zur Compile-Zeit auf `0`, der Solver muss die
(potenziell teuren) reified Constraints nicht aufstellen.

`int_search`-Heuristik mit `first_fail + indomain_min` ist die aus der
Literatur bewährte Default-Wahl für Stundenplan-CSPs (most-constrained
variable first).

`encode.ts` emittiert die Gewichte (`w_no_free`, `w_main_aft`,
`afternoon_start`, `w_main_run`, `max_consec_main`, `w_main_early`,
`w_compact`) sowie `subject_is_main[]` ins DZN.

`decode.ts` parst zusätzlich ein `penalties` JSON-Objekt aus dem Solver-
Output und reicht es als `SolverOutput.penalties` weiter.

`GenerateButton.svelte` zeigt die Aufschlüsselung als ausklappbares
`<details>` an: Total + die Einzelwerte je aktiver Penalty.

## Verworfen

- **Lexikographische Optimierung** (mehrere `solve minimize`-Runden je
  Priorität): theoretisch sauberer, in MiniZinc-WASM aber schwer praktikabel
  und für die Schul-Größenordnung Overkill.
- **Hartes Encoden der Toggles als Constraints**: würde UNSAT-Anfälligkeit
  verschärfen. Soft-Penalty bleibt immer SAT-bar (Penalty kann ≥ 0 sein).
- **Externe Score-Normalisierung** (z. B. „Punkte 0–100"): unnötige
  Komplexität — User sieht die Roh-Werte mit den von ihm selbst gesetzten
  Gewichten und entwickelt ein Gefühl dafür.

## Konsequenzen

**Pro:**
- User kann Plan-Qualität gezielt steuern (Slider hochziehen → Solver
  optimiert das stärker).
- Kein UNSAT durch Soft-Wünsche — der Solver liefert immer das Beste was
  er findet.
- Score-Breakdown im UI zeigt, welche Regel wieviel kostet — pädagogisch
  reflektierbar.

**Kontra:**
- `solve minimize` ist langsamer als `solve satisfy`. Bei der echten
  `Liste.csv` (155 Lesson-Instanzen) muss ein Performance-Re-Check her.
  Falls > 30 s, müssen wir einzelne Penalties (insb. P4 / P5 mit den
  3-fach-`exists`-Termen) vereinfachen oder durch Aggregat-Variablen
  ersetzen.
- Penalty P3 („max N in Folge") ist eine Pair-Approximation, kein exaktes
  Run-Length-Counting. Das überschätzt 3+-Runs; akzeptabel weil der Score
  lediglich Prioritäten zwischen Plänen sortiert, keine harte Bedingung
  ist.

**Folge-Entscheidungen:**
- Wenn Performance auf der Schul-Liste leidet: aggregierte
  `count_per_(d,g,p)`-Variable mit `global_cardinality` einführen, dann
  Penalty als reine `int`-Funktion daraus. Out of Scope für 7B.
- „Doppelstunden zusammenhängend bevorzugen" ist mit dem Auto-Modus
  (ADR-0008) implizit erfüllt — der Toggle ist daher nicht in der MZN
  verdrahtet (UI bleibt für künftige Erweiterung sichtbar).
