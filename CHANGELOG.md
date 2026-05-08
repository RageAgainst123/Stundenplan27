# Changelog

Alle erwähnenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geplant
- Phase 10-4: Variantenmodus (3 Pläne mit verschiedenen Heuristiken
  generieren und vergleichen)
- Print-Layout (A4 pro Lehrer / pro Schulstufe)
- Performance-Tuning der Soft-Constraint-Penalties bei großer Liste
- `pairedWith`-Feld entfernen (redundant zu `couplingId`)

## [0.10.0] - 2026-05-08 — Phase 10: Anytime-Solver + Streaming-UI

### Added
- **Hartes Constraint „Beginn in P1"**: wenn eine Stufe an einem Tag
  überhaupt unterrichtet wird, muss P1 belegt sein. Verhindert „Schule
  beginnt erst in der 4. Stunde". Konfigurierbar via
  `ConstraintConfig.mustStartFirstPeriod.enabled`.
- **Streaming `SolveSession`** (`startSolve(doc, opts)` neben dem
  bestehenden `solve()`): liefert Live-Events für Phasen, Fortschritt,
  jede gefundene Zwischenlösung, Lockerungen, Fertigstellung. Mit
  `abort()` jederzeit unterbrechbar — die letzte gestreamte Lösung
  wird übernommen.
- **Live-Streaming-UI im GenerateButton**:
  - Progress-Bar mit Restzeit
  - aktueller bester Score und SVG-Sparkline der Score-History
  - Convergence-Hint („letzte Verbesserung vor X s")
  - Abbrechen-Button — beste bisher gefundene Lösung bleibt im Plan
  - Plan im Grid wird **live** mit jeder besseren Lösung aktualisiert
- **Strukturierte `RelaxationInfo`** in `SolverOutput`. UI zeigt Banner
  zuverlässig bei JEDER aktiven Lockerung (vorher nur bei Block-
  Lockerung — Tagespensum-Reduktion war unsichtbar).
- **5-stufige Auto-Lockerung** (war 3-stufig in Phase 9):
  Blocks → minDaily 3 → minDaily 0 → mustStartP1 off → final UNSAT.
- ADR-0012 dokumentiert die Designentscheidungen.

### Fixed
- **UI-Bug**: Tagespensum-Lockerung war im Banner nicht sichtbar.
  Jetzt strukturiert über `RelaxationInfo` und mit klarer Liste der
  aktiven Lockerungen.

### Changed
- `GenerateButton.svelte` verwandelt vom Single-Click-Button zum
  Live-Dashboard mit Progress, Score-History und Abbrechen-Knopf.
- Bestehender `solve(doc, opts)` bleibt für Tests, Logik unverändert
  außer 5-stufiger Lockerung statt 3-stufiger.

### Tests
- 3 neue Tests (Constraint 12 emission, mustStartFirstPeriod migration,
  startSolve pre-flight short-circuits). Total: 109 grün.

## [0.9.0] - 2026-05-08 — Phase 9: Tagesverteilung + Doppel/Einzel-Cohesion

### Added
- **Hartes Tagespensum**: jede Schulstufe braucht an jedem Wochentag mindestens
  N Stunden (Default 4). `ConstraintConfig.minDailySlotsPerGrade`. UI-Feld in
  `RulesPanel`. Verhindert dass der Solver Tage komplett auslässt.
- **Hartes „Doppel ⇒ kein Einzel"** (Constraint 11 in `model.mzn`): zwei
  Lesson-Instanzen derselben Spec am gleichen Tag müssen konsekutiv sein. Damit
  ist eine Doppelstunde automatisch die einzige Belegung des Tages für die Spec.
- **Soft-Constraint „Auch Nebenfächer am Nachmittag vermeiden"** mit eigenem
  Gewicht (Default 15). Sub-Toggle unter „Hauptfach nicht am Nachmittag" im
  RulesPanel.
- **Dreistufige Auto-Lockerung**: bei UNSAT lockert `service.ts` automatisch
  zuerst die Block-Patterns, dann das Tagespensum von 4 auf 3, dann auf 0.
  UI meldet welche Lockerung aktiv war.
- **Diagnose-Erweiterungen**: Pre-Flight warnt wenn Stufe weniger als
  D × min_daily Wochenstunden hat oder wenn eine Spec count > D mit strikten
  Singles hat.
- ADR-0011 dokumentiert die Designentscheidungen.

### Changed
- `decode.SolverOutput.penalties` erweitert um `any_aft`.
- `GenerateButton` Score-Breakdown zeigt zusätzlich „Stunden am Nachmittag
  (alle Fächer)".
- Phase-9-Migration in `persistence.ts` setzt für bestehende Pläne sinnvolle
  Defaults (`minDailySlotsPerGrade: 4`, `applyToAllSubjects: true`,
  `weightAllSubjects: 15`).

### Tests
- 8 neue Tests (DZN-Parameter-Emission + Diagnose-Erweiterungen + Penalty-
  Decoding). Total: 102 grün.

## [0.8.0] - 2026-05-08 — Phase 8: Schema-Migrationen v1→v2→v3

### Added (v3)
- **Trennung Stufen-Bezeichnung und Kopplung**: `LessonSpec.groupKey` aufgespalten in
  - `groupLabel` — beschreibend, aus CSV-Spalte „Gruppe", **kein Solver-Effekt**
  - `couplingId` — harte Solver-Kopplung (zeitgleicher Slot), nur manuell vom User gesetzt
  Siehe [ADR-0010](docs/decisions/0010-grouplabel-vs-couplingid.md).
- UI: `groupLabel` als kursives, dashed-border-Badge in der Klassen-Spalte.
  Kopplungs-Spalte und ScheduleCell-Pastell-Hintergrund nutzen jetzt nur `couplingId`.
- Migration v2→v3 (Option A — konservativ): alte `groupKey`-Werte werden zu
  `groupLabel`. Keine Auto-Kopplung — User legt echte Kopplungen explizit neu an.
- CSV-Import setzt nur `groupLabel`, niemals `couplingId`.

### Fixed (v2)
- **`PlacedLesson.grade`-Feld** + Schema-Migration v1→v2. Multi-Grade-Specs
  (`grades=[5,6]`) werden jetzt als eine `PlacedLesson` pro Stufenspalte
  gespeichert statt einmal mit Render-Fan-Out — User-Bug „Solver platziert
  mehr Lehreinheiten als definiert" war ein Render-Bug, kein Solver-Bug.
- `placedCountForSpec()` zählt jetzt eindeutige `(day, period)`-Slots
  statt Roheinträge, damit Multi-Grade-Specs nicht mehrfach gezählt werden.
- `checkPlacementConflict()` ist grade-aware.
- Solver-Encoder pinning nutzt `p.grade` direkt (statt aus `spec.grades` zu expandieren).

### Tests
- 11 neue v2-Tests + 4 neue v3-Tests. Total: 92 Tests grün.

## [0.7.0] - 2026-05-08 — Phase 7B: Flexible Block-Patterns + Soft-Constraints

### Added
- **Auto-Modus für Block-Pattern** (`LessonSpec.blocks` jetzt optional):
  Bei leerem Pattern entscheidet der Solver — max. 1 Doppelstunde pro Spec,
  niemals 3er-Run. Strikte Patterns wie `[2,1]` bleiben harte Vorgabe.
  Siehe [ADR-0008](docs/decisions/0008-flexible-block-patterns.md).
- **„Automatisch"-Option** in der Block-Pattern-Dropdown (oberster Eintrag,
  kursiv-grau). Tooltip erklärt das Verhalten. Bulk-Action „Block-Pattern Auto"
  setzt mehrere Specs gleichzeitig auf Auto.
- **Soft-Constraints aus `RulesPanel`** fließen jetzt als gewichtete
  Penalty-Zielfunktion in den Solver: `solve minimize total_penalty` statt
  `solve satisfy`. Toggle aus = Gewicht 0 = Term entfällt zur Compile-Zeit.
  Siehe [ADR-0009](docs/decisions/0009-soft-constraints-as-penalties.md).
- **Score-Breakdown** in `GenerateButton`: ausklappbares `<details>` zeigt
  jeden aktiven Penalty-Wert + Total nach erfolgreichem Run.
- **Auto-Lockerung bei UNSAT**: Wenn der erste Solver-Lauf mit den
  konfigurierten strikten Block-Patterns UNSAT liefert, läuft der Solver
  automatisch ein zweites Mal mit allen Patterns auf Auto. UI zeigt eine
  gelbe Warnung mit den betroffenen Specs.
- MiniZinc-Suche jetzt mit Most-Constrained-Variable-Heuristik
  (`first_fail + indomain_min`) — schneller bei großen Modellen.

### Changed
- CSV-Import setzt frische Specs nicht mehr auf `[1,1,…count]`, sondern auf
  `blocks: undefined` (= Auto-Modus).
- `persistence.ts`-Migration konvertiert das alte Default-Pattern aus
  bestehenden localStorage-Plänen automatisch zu `undefined`. Vom User
  explizit gesetzte Patterns wie `[2,1]` bleiben strikt erhalten.
- `decode.ts` erweitert `SolverOutput` um `penalties`-Aufschlüsselung und
  `relaxedSpecIds` für die Auto-Lockerungs-Anzeige.

### Tests
- 6 neue Tests für Auto-Mode-Encoding (auto / strict / mixed in einer Doc).
- 2 neue Tests für Penalty-Decoding aus dem Solver-Output.
- Total: 77 Tests (von 69 in 7A).

## [0.5.0] - 2026-05-08 — Phase 5d: Lehreinheiten-Kopplung

### Added
- Bulk-Toolbar in `SpecList`: **Koppeln**- und **Entkoppeln**-Buttons mit Soft-Validierung bei unterschiedlichen Stundenzahlen.
- Group-Tag mit Hover-× zum gezielten Entfernen einer einzelnen Spec aus einer Gruppe.
- Visuelle Coupling im Stundenplan-Grid: gestapelte Lessons mit gemeinsamem deterministischen Pastell-Hintergrund + dünner dashed Trennlinie zwischen den parallelen Stunden.

## [0.4.0] - 2026-05-08 — Phase 5c: Block-Pattern + Solver-Ignore

### Added
- `BlockPattern` auf `LessonSpec` (z. B. `[2,2]` = 2 Doppelstunden, `[1,1,1,1]` = 4 Einzelstunden).
- Block-Pattern-Dropdown in der Lehreinheiten-Tabelle, mit auto-generierten Vorschlägen abhängig von `count`.
- `includeInSolver`-Flag pro Spec (Förderunterricht etc. ausnehmen, weiterhin manuell platzierbar).
- `maxConsecutive` pro Subject (max 3 Mathe in Folge verboten).
- Bulk-Toolbar mit Mehrfach-Auswahl: Duplizieren, Solver-Toggle, Wochen-Pattern, Bulk-Delete.
- Group-Coloring (deterministische Pastell-Farbe pro `groupKey`) als Streifen + Pill-Tag.
- "Planung verwerfen"-Button in `ScheduleGrid` (löscht nur Placements, Stammdaten bleiben).

### Fixed
- Auto-Save (`initStore`-`$effect.root`) für `bind:value`-Mutations — Bind-Änderungen wurden vorher nicht persistiert.

## [0.3.0] - 2026-05-08 — Phase 5b: Solver- + Reactivity-Fixes

### Fixed
- Solver-Modell auf 3D-Slots umgestellt (`day, period, grade` statt nur `day, period`).
- Spec-Expansion erzeugt 1 Lesson-Instanz pro `(occurrence × grade)`, via synthetischem `groupId` an dieselbe `(day,period)` gebunden.
- `ScheduleCell`-Subkomponente extrahiert mit defensivem `each`-Key gegen duplicate placements.
- Migration auf `setContext`/`getContext`-Pattern für stabile Cross-Component-Reactivity.

## [0.2.0] - 2026-05-08 — Phase 1–5: MVP

### Added
- Vite + Svelte 5 (Runes) + TypeScript Skelett mit vitest.
- Datenmodell: `Teacher`, `Subject`, `LessonSpec`, `PlacedLesson`, `ScheduleDoc`, `ConstraintConfig`.
- Sokrates-CSV-Importer mit 21 Tests gegen echte `Liste.csv`.
- Editor: `TeacherList` (mit 5×8-Verfügbarkeits-Mini-Raster), `SubjectList`, `SpecList`, `RulesPanel`.
- `ScheduleGrid` mit Drag&Drop via `@thisux/sveltednd`, 4 Schulstufen-Spalten pro Tag, Live-Konflikt-Erkennung.
- MiniZinc-WASM-Solver mit harten Constraints (Lehrer-/Klasse-Doppelbelegung, Verfügbarkeit, Pinning, G/U-Wochen-Pattern).
- localStorage-Persistierung + JSON-Export/Import als Backup.
- "Aktuelle Stunde"-Highlight + ISO-KW-Anzeige (G/U).

## [0.1.0] - 2026-05-07 — Initial scaffold

### Added
- Vite + Svelte 5 + TypeScript Projekt-Init.
- npm-Pakete `@thisux/sveltednd` und `minizinc` installiert.
- Lokales Git-Repo initialisiert.
