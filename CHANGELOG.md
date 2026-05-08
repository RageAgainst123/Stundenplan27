# Changelog

Alle erwähnenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geplant
- GitHub-Pages-Deploy via CI
- Soft-Constraints im MiniZinc-Modell (Penalty-Funktion aus RulesPanel)
- Print-Layout (A4 pro Lehrer / pro Schulstufe)
- `PlacedLesson.grade`-Feld + Schema-Migration v1→v2

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
