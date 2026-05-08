# Changelog

Alle erwähnenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geplant
- Print-Layout (A4 pro Lehrer / pro Schulstufe)
- `PlacedLesson.grade`-Feld + Schema-Migration v1→v2
- Performance-Tuning der Soft-Constraint-Penalties bei großer Liste

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
