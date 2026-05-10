# Changelog

Alle erwähnenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geplant (Phase 13)
- Print-Layout (A4 pro Lehrer / pro Schulstufe), `@media print` CSS
- Variantenmodus: mehrere Pläne mit verschiedenen Seeds generieren,
  vergleichen, manuell den besten wählen
- Hot-Start: Solver beginnt vom letzten Plan statt Greedy von Null
- Web Worker, falls Solver auf größeren Schulen langsam wird

## [0.12.0] - 2026-05-10 — Phase 12: Aufräumen, Härten, Testen

### Removed
- **Alter MiniZinc-WASM-Solver komplett entfernt.** `src/lib/solver/`
  Verzeichnis (model.mzn, encode.ts, decode.ts, service.ts, diagnose.ts
  und Tests, plus `__perf__/`-Harness) ist weg. `minizinc` keine
  Dependency mehr — entspart 143 MB in node_modules.
- `LessonSpec.pairedWith` Legacy-Feld entfernt. `couplingId` ist seit
  Phase 8 v3 die einzige Coupling-Quelle. Migration entfernt das Feld
  beim nächsten Save aus alten Docs.
- Toter `{#if false}`-Block in `RulesPanel.svelte` (Slider-Helpers
  ohne Aufrufer) entfernt.

### Added
- `src/lib/solver-v2/diagnose.ts` — Pre-Flight-Diagnose ist jetzt
  team-teaching-aware: prüft jeden Lehrer einer Coupling, jeden
  Eintrag in `spec.teachers` einzeln auf Existenz/Verfügbarkeit.
- `src/lib/types-ui.ts` — zentraler Ort für UI-Typen (`DragPayload`).
  Vorher in `ScheduleGrid` und `ScheduleCell` doppelt definiert.
- `src/lib/teacher-helpers.ts` — `teacherById/teacherColor/teacherName`
  als pure Helper. Ersetzt 2-3 inline-Kopien in den Komponenten.
- Score-Komponenten-Tests vervollständigt: `min_daily`, `uneven_days`,
  `compact_teacher` haben nun dedizierte Unit-Tests. Insgesamt 14 von
  14 Komponenten getestet (vorher 7).

### Fixed
- **Tabu-Asymmetrie in Local Search.** `pushTabu` schrieb den Ziel-Slot
  ins Tabu, `isTabu` prüfte den Quell-Slot — die Tabu blockierte das
  Falsche. Korrekt: nach Move U: s_old → s_new wird U:s_old für
  `tabuTenure` Iterationen tabu (Reverse-Move-Schutz). Bench-Effekt
  auf Liste.csv (10 s ILS): Score 4094 → 3492 (-15 %).
- **`tStartLS` Reheat-Cap.** Bei vielen erfolglosen Restarts wuchs die
  SA-Starttemperatur unbegrenzt (200 + 50×N). Bei T>1000 akzeptiert SA
  praktisch jeden Move → Random-Walk-Drift, aktive Verschlechterung
  des Best-Scores. Cap auf 500 (~5× Normaltemperatur) eingebaut.
- **ILS-DRY-Refactor mit Drift-Bug-Fix nebenbei.** Sync und Async
  ILS-Variante hatten ~150 Zeilen identische Logik dupliziert. Beim
  letzten KempeBoost-Patch wurde der Async-Variant vergessen, sodass
  sie ihn nicht durchreichte. Jetzt teilen sich beide einen
  gemeinsamen Algorithmus-Kern; nur die Loop-Strategy unterscheidet.

### Changed
- `solver-v2/index.ts` importiert `diagnose` jetzt aus dem eigenen
  Verzeichnis statt aus dem v1-Tree.
- `mustStartFirstPeriod` hat jetzt `weight` (vorher hartcodiert 300).
- `scripts.test` und `scripts.test:watch` in `package.json` ohne
  `--exclude src/lib/solver/__perf__/**` (das Verzeichnis existiert
  nicht mehr).

### Documentation
- ADR-0013 (TypeScript Construct + Local Search) Status: proposed → accepted.
- `CLAUDE.md` Architektur-Block, Solver-Sektion, Phasen-Status auf
  aktuellen Stand gebracht. Verbotene-Aktionen-Liste ohne MiniZinc.
- `README.md` Stack-Zeile, Verzeichnisbaum, Status-Liste, „Was
  funktioniert vollständig"-Block aktualisiert. Phase-5b-Bug-Notiz
  entfernt (historisch).
- `docs/CONTEXT.md` Technische-Stützpunkte ohne MiniZinc-WASM.
- `docs/REQUIREMENTS.md` Phase 11 + 12 als abgeschlossen markiert,
  Phase 13 als Ausblick.

### Stats
- Tests: 151 grün (vorher 206; -55 v1-Tests sind physisch entfernt,
  +6 neue Score-Tests)
- TypeScript: 0 Errors, 0 Warnings
- Bundle: 53.52 KB gz JS / 4.64 KB gz CSS (~57 KB total)
- node_modules: ~143 MB kleiner ohne minizinc

## [0.11.0] - 2026-05-09 — Phase 11: Solver-Architektur-Wechsel

### Added
- **TypeScript-eigener Solver** in `src/lib/solver-v2/` (Construct +
  Iterated Local Search). Ersetzt den MiniZinc-WASM-Solver. Auf der
  echten Liste.csv: Score in 10 s von ~28 000 auf ~3500, alle harten
  Constraints erfüllt, no_free=0.
- **14 Score-Komponenten** (Untis-Style) konfigurierbar im RulesPanel:
  `min_daily`, `no_p1_start`, `main_aft`, `any_aft`, `no_free`,
  `uneven_days`, `main_run`, `compact_teacher`, `main_early`,
  `time_pref`, `subject_twice`, `spec_spread`, `teacher_overload`,
  `teacher_no_lunch`.
- **Tageszeit-Präferenz pro Lerneinheit** (`LessonSpec.timePref`:
  `'early'` | `'late'`). Neue Spalte „Zeit" in der Lerneinheiten-Liste
  + Bulk-Toolbar. Specs ohne Wert verhalten sich wie bisher.
- **Team-Teaching pro Lerneinheit** (`LessonSpec.teachers: TeacherId[]`,
  Schema v3 → v4). Eine Spec kann zwei Lehrer parallel haben (z. B. BSP
  Knaben + Mädchen). Stundenplan-Zelle zeigt zwei Lehrer-Badges
  nebeneinander, geteilten Hintergrund. Solver-Hardcheck respektiert
  alle Team-Lehrer.
- **Auto-Lockerung „keine Hohlstunden"** (`noFreePeriodsForClass.strict`):
  Phase 1 mit massivem Gewicht (×50), Phase 3 mit normalem Gewicht
  falls Lücken nicht vermeidbar. UI zeigt RelaxationInfo-Banner.
- **Lehrer-Tageslast-Limit** (`Teacher.maxLessonsPerDay`).
- **Mittagspause-Constraint** (`teacherLunchBreak`) mit konfigurierbarem
  Mittagsfenster.
- **Adaptive Iterated Local Search**: Reheat + KempeBoost +
  Perturbations-Stärke wachsen mit erfolglosen Restarts.
- **Untis-Style RulesPanel** in 3 Sektionen (Klassen & Stufen / Pädagogik
  / Lehrer), Tooltips an jeder Regel, alle Gewichte sichtbar editierbar.
- **`findHardViolations`** als defensives Safety-Net in Construction
  und am Decode-Boundary — verhindert dass alte localStorage-Pläne mit
  Doppelbelegungen ans UI durchschlagen.

### Fixed
- Coupling-Block-Stunden: Doppelstunden in Couplings produzieren
  jetzt korrekte Instances pro Block-Position.
- Ejection-Chain mit vollem Snapshot-Revert (verhindert inkonsistente
  Zwischenzustände bei Teil-Erfolg).
- Coupling-Aggregation in der Diagnose: gekoppelte Specs zählen einmal
  pro Stufe, nicht pro Spec.

### Architecture
- ADR-0013 (TypeScript Construct + Local Search) ersetzt ADR-0002
  (MiniZinc-WASM).
- Schema v3 → v4: `LessonSpec.teachers[]` statt `teacher`.

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
