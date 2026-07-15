# Stundenplan MS SiG — Claude-Session-Notizen

> **Bevor du arbeitest:** Lies kurz `docs/CONTEXT.md` (wer & wo) und `docs/REQUIREMENTS.md`
> (was als nächstes & was Out-of-Scope). Bei Architektur-Fragen: `docs/decisions/`.

## Auto-Imports

Folgende Dateien werden mit dieser CLAUDE.md geladen:

- @docs/CONTEXT.md
- @docs/REQUIREMENTS.md
- @docs/decisions/README.md

## Doku-Hygiene (kurz)

`docs/MODEL.md` ist die kanonische Quelle für Datenstruktur (Domänenmodell,
Solver-Internals, alle 24 Score-Komponenten, alle 11 Hard-Constraints,
Schema-Versionen). Drei Update-Anlässe:

1. **`src/lib/types.ts`** geändert (`LessonSpec`, `ConstraintConfig`,
   `SCHEMA_VERSION`) → MODEL.md §1 oder §5 prüfen.
2. **`src/lib/solver-v2/types.ts`** geändert (`Unit`, `ScoreBreakdown`,
   `ScoreWeights`) oder neue Score-Komponente in `score.ts` → MODEL.md §2/§3.
3. **`src/lib/solver-v2/hardCheck.ts`** geändert oder neue Hard-Constraint
   irgendwo → MODEL.md §4.

`docs/SOLVER-V2-CONCEPT.md` beschreibt den **Algorithmus** (Construction,
LS, ILS); MODEL.md beschreibt die **Struktur**. Bei Algorithmus-Änderungen:
SOLVER-V2-CONCEPT prüfen, nicht MODEL.

## Wichtigster Kontext-Hinweis (Stand Phase 11)

**Solver wird gerade umgebaut von MiniZinc-WASM auf TypeScript Construct + Local Search.**

- **Konzept-Dokument:** `docs/SOLVER-V2-CONCEPT.md` — gründlich lesen bevor du am Solver arbeitest
- **Architektur-Entscheidung:** `docs/decisions/0013-typescript-construct-local-search.md` (supersedes ADR-0002)
- **Implementierungsplan:** `~/.claude/plans/https-rageagainst123-github-io-std-stund-temporal-oasis.md` (Phase 11, 11 Schritte)

Begründung des Wechsels: 4 Stunden Tuning mit MiniZinc-CLI auf der echten Liste.csv haben gezeigt dass Constraint Programming für Schul-Stundenpläne strukturell ungeeignet ist (Plateau-Verhalten, Soft-Constraints als Nachgedanke, keine lokalen Verbesserungen). Untis und FET nutzen seit 30 Jahren Construct + Local Search. Solver v2 folgt diesem bewährten Ansatz.

## Was diese App tut (1 Satz)

Browser-Stundenplan-Generator für eine kleine Mittelschule mit Mehrstufenklassen (5./6./7./8. SSt.), lokal-only, Sokrates-CSV-Import, Drag&Drop-Editor, **TypeScript Construct + Local Search Solver** (in Phase 11 von MiniZinc-WASM migriert).

## Befehle

| Befehl                | Was es tut                                               |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Vite Dev-Server, Port 5173 (HMR — Reactivity-Fallen!)    |
| `npm run build`       | Production-Build → `dist/`                               |
| `npm run preview`     | Preview-Server, Port 4173 (für E2E-Smoke-Tests)          |
| `npm test`            | vitest run, alle Tests einmalig (~434, Stand 2026-07)    |
| `npm run test:watch`  | vitest watch                                             |
| `npm run check`       | svelte-check + tsc                                       |

## Stack-Kurz

Vite 8 · TypeScript 6 · Svelte 5 (Runes) · @thisux/sveltednd · TypeScript-eigener Solver (`src/lib/solver-v2/`)

**Phase 12 abgeschlossen:** der alte MiniZinc-WASM-Solver ist komplett entfernt. Solver-Code lebt nur noch in `src/lib/solver-v2/` (Construct + Local Search). `minizinc` ist keine Dependency mehr.

## Architektur (eine Zeile pro Modul)

- **`src/lib/types.ts`** — Domänenmodell (Teacher, Subject, LessonSpec, PlacedLesson, ScheduleDoc, ConstraintConfig). Schema v5.
- **`src/lib/types-ui.ts`** — UI-spezifische Typen (DragPayload).
- **`src/lib/teacher-helpers.ts`** — kleine Pure-Helpers für Teacher-Lookups (id → Teacher / color / name).
- **`src/lib/store.svelte.ts`** — Singleton-Store via `setContext`/`getContext`, `$state` für ScheduleDoc, Auto-Save in localStorage via `$effect.root`.
- **`src/lib/persistence.ts`** — localStorage save/load + JSON-Im/Export, Migrationen v1→v2→v3→v4.
- **`src/lib/import/csv.ts`** — Sokrates-Liste-Parser (PG_/VÜ_/FÖ_/KU_, Klassen-Kopplungen `1a+2a`, Mehrstufen, Wochen-Pattern). Phase 17: Opt-in `smartMerge`-Option.
- **`src/lib/import/smart-merge.ts`** — Phase 17: Smart-Merge für Sokrates-CSV. Erkennt Team-Teaching, Same-Teacher-Mehrfachzeilen, Leistungsgruppen-Kopplung. Produziert `teachingSegments` mit Best-Guess-Aufteilung (nested coverage). Default-Pfad bit-identisch zu pre-Phase-17.
- **`src/lib/blocks.ts`** — Block-Pattern-Helpers (`blockPresets`, `blockLabel`, `groupColor`).
- **`src/lib/schedule-helpers.ts`** — `placementsAt`, `unplacedSpecs`, `checkPlacementConflict` für Drag/Drop.
- **`src/lib/snapshots.ts`** — Phase 15 + SN2 (2026-07): Plan-Snapshot-Galerie (`localStorage`-Key `stundenplan27.snapshots`). SN2: getrennte Gruppen — Pläne (manual/auto, MAX_PLANS=30) vs. Backups (source `'backup'`, MAX_BACKUPS=5, eigener Ring, verdrängt nie Pläne); 📌-Pin schützt vor jedem Auto-Cleanup; `importSnapshots`/`samePlacements` für JSON-Backup-Merge und „= aktuell"-Badge; Alt-Bestände („Backup vor …" mit source auto) migrieren beim Laden. Auto-Snapshot bei ≥5% Score-Improvement, Restore, Diversify-from-Snapshot, „⤴ Aktivieren" aus der WeekView. Snapshots optional im JSON-Export (Checkbox in ImportExport; `readJsonFile` → `{doc, snapshots}`).
- **`src/lib/solver-v2/`** — TypeScript Construct + Local Search Solver. Module: types, units (Phase 17: `expandSegmentedSpecs` für Team-Teaching), score, scoreDelta, moves, hardCheck, construct, localSearch, iteratedLS, lnsDestroy (R2: Diversify-Destroy-Strategien), diagnose, index, worker-bridge + solve.worker (R2: Solver läuft im Web Worker; `startSolveSession` ist der UI-Einstieg mit Inline-Fallback für jsdom; Audit D-3 2026-07: Diversify fährt k parallele Versuche mit abgeleiteten Seeds, bester gewinnt). Siehe `docs/SOLVER-V2-CONCEPT.md`. Phase 14 Pool-Phase + Hot-Start, Phase 15 Diversify-Modus, R2: `StartSolveOptions.seed` macht Sessions reproduzierbar.
- **`src/components/`** — UI: ImportExport (Phase 17: Smart-Merge Checkbox, Sokrates-Export-Anleitung, rote Reset-Aktion), TeacherList (mit AvailabilityGrid), SubjectList, SpecList (Bulk-Toolbar + Coupling + Phase 17 Multi-Lehrer-Chips + „🤝 Als Team-Teaching"-Aktion), TeamTeachingEditor (Phase 17: inline Segment-Editor mit Checkbox-Matrix), ScheduleGrid (mit ScheduleCell + GenerateButton), FinetuneView (R3-S7 + Feinschliff 2.0: Stunden markieren/Lehrer entlasten/Dahin-verschieben mit Mini-Solve + 💡 Tauschvorschläge [`lib/finetune-suggest.ts`, Untis-Prinzip: exakt bewertete Einzel-Züge], ehrlicher Vorher/Nachher-Vergleich [`lib/quality.ts`], Diff-Grid mit Geistern, ↩ Undo-Stack [`lib/undo-stack.ts`]), RulesPanel (R3-S6: Gewichts-Presets), WeekView (Phase 16: read-only Anzeige mit Snapshot-Wahl + Highlight-Filter; Audit A7: Druck-Buttons; SN2: „⤴ Aktivieren" macht den Vergleichs-Snapshot zum aktuellen Plan), PrintSheets (Audit A7/Phase 18: A4-Druckblätter pro Lehrer/Stufe/Gesamt, @media print), ExportPanel (Excel + 🌐 Single-File-HTML-Wochenplan [`lib/html-export.ts`]: mobile-first, Lehrer-Filter-Chips, Tabs Mo–Fr+FULL, vorgerechnete Lehrerfarb-Tints, self-contained).

## Stolperfallen (CRITICAL — bitte erst lesen, bevor du Bugs jagst)

### Svelte 5 Reactivity

- **NIEMALS** den Store via `export const store = $state(...)` exportieren. Wir benutzen `setContext`/`getContext` (siehe `store.svelte.ts`). Cross-Component-Reactivity bricht sonst nach mehreren Tab-Switches.
- **NIEMALS** Plain-Objects als Array-Items in einen `$state`-Proxy spreaden ohne deduplicate. Der `each`-Block in `ScheduleCell.svelte` hat einen defensiven Key `cp.placed.specId + '|' + day + '|' + period + '|' + idx` weil der Solver in einem früheren Bug duplicate placements lieferte. Auch `GenerateButton.svelte` dedupliziert vor dem Schreiben in den Store.
- **Auto-Save:** Mutations via `bind:value` werden nicht persistiert ohne den `$effect.root` in `initStore()`. Wenn du den Store anfasst, achte darauf, dass dieser Effect bestehen bleibt.

### Vite/Browser

- Im Dev-Mode (`npm run dev`) akkumulieren mehrere onclick-Listener bei HMR — beim Bug-Hunting **immer** mit `npm run build && npm run preview` arbeiten, nicht im Dev-Server.
- Bei Cache-Problemen: `rm -rf node_modules/.vite dist && npm run build`.
- **localStorage hängt am Origin INKLUSIVE Port.** Weicht Vite bei belegtem
  Port still auf 5174/4174 aus, startet die App mit leerem Speicher und die
  Daten wirken „weg" (so ist Geos Snapshot-Verlust entstanden). Deshalb steht
  `strictPort: true` in `vite.config.ts` für Dev UND Preview — Ports nie
  ändern, ausweichende Server nie akzeptieren.

### Solver (TypeScript Construct + Local Search, Phase 11/12)

**Slot-Modell:**
- Slot ist 3D: `(day, period, grade)`, NSLOTS = 5×8×4 = 160. Helpers in `solver-v2/types.ts` (`slotFromDP`, `dpFromSlot`).
- LessonSpec mit `count=4, blocks=[2,2]` wird zu Block-Units mit `blockSize=2` — Block-Constraint erzwingt Kontiguität.
- LessonSpec mit `grades=[5,6]` wird zu einer multigrade-Unit, deren Instanzen alle den selben (day, period) belegen.
- Specs mit `includeInSolver=false` werden übersprungen.

**Solver-v2-Algorithmus:**
- Siehe `docs/SOLVER-V2-CONCEPT.md` §6–§9 für Details.
- Phase 1: Construction (greedy + ejection chain) in <5 s.
- Phase 2: Local Search (Hill-Climbing + **LAHC**-Akzeptanz + Tabu; SA als
  Referenz-Arm `acceptance:'sa'`), Scoped Score-Delta, ~10-14k Iter/sec (jsdom).
- Phase 3: Iterated LS mit adaptiver Perturbation, SA-Reheat (Cap 500), Kempe-Boost.
- 2-Phase-Solve: bei `noFreePeriodsForClass.strict=true` läuft nach Phase 2 eine Auto-Lockerung mit normalem Soft-Gewicht falls Lücken übrig.
- 24 Score-Komponenten, alle in `solver-v2/score.ts` (kanonische Liste: MODEL.md §3). Konfigurierbar im `RulesPanel`.

### Bekannte offene Bugs

(Phase 11 keine bekannten offenen Bugs nach Phase-8-Schema-Migrationen.)

## Konventionen

- TypeScript strict (default), kein `any` außer für Drittbibliotheks-Bridges.
- **Tabs** für Indent (siehe bestehender Code).
- Pure-Helpers in `src/lib/`, UI-Logic in `src/components/`.
- Tests: vitest mit jsdom, neue Tests **neben** dem Modul ablegen (`foo.ts` → `foo.test.ts`).
- Commits: Konventionelle Präfixe (`feat:`, `fix:`, `chore:`, `wip:`, `docs:`). `Co-Authored-By: Claude` am Ende.
- localStorage-Key: `stundenplan27.doc`. **Nicht ändern** (Migration sonst nötig).

## Workflow für neue Features

1. Tests ergänzen / Fehlertest schreiben.
2. `npm test` — muss grün sein.
3. `npm run check` — TypeScript & Svelte sauber.
4. `npm run build` — Production-Build OK.
5. `preview_start stundenplan-preview` (über `.claude/launch.json`) + E2E-Smoke-Test.
6. Commit mit konventionellem Präfix.

## Fixture-Daten

- `src/lib/import/__fixtures__/sokrates-liste.csv` — echter Sokrates-Export (52 Specs).
- Im `public/`-Ordner liegt eine Kopie `sokrates-liste.csv` damit Browser-Smoke-Tests sie via `fetch('/sokrates-liste.csv')` laden können.

## Verbotene Aktionen

- Niemals localStorage löschen ohne Bestätigung — der User verliert sonst seinen aktuellen Plan.
- Niemals Bundle-Größe ohne Grund vergrößern. Richtwerte (Audit 2026-07): Haupt-Bundle ~110 KB gz, Solver-Worker ~60 KB, exceljs als Lazy-Chunk ~256 KB gz (lädt nur beim Excel-Export). Deutliche Sprünge ohne neues Feature sind verdächtig.
- Niemals `package.json` Hauptversionen anheben ohne ausdrücklichen Auftrag — wir hatten genug Reactivity-Pannen, lass das Stack-Stack stabil.

## Phasen-Status (Stand 2026-07-15)

- ✅ Phase 1–4: Datenmodell, CSV-Import, Editor, Anzeige
- ✅ Phase 5: MiniZinc-Solver (harte Constraints)
- ✅ Phase 5b: Solver-3D + Reactivity-Fixes
- ✅ Phase 5c: Block-Pattern + Solver-Ignore + Bulk-Edit + Reset
- ✅ Phase 5d: Lehreinheiten-Kopplung-UX
- ✅ Phase 6: Projekt-Hygiene + GitHub-Pages-Deploy
- ✅ Phase 7A: Multi-Grade-UNSAT-Bugs gefixt + Pre-Flight-Diagnose
- ✅ Phase 7B: Flexible Block-Patterns (Auto-Modus) + Soft-Constraints + Auto-Lockerung
- ✅ Phase 8: Schema v1→v2 (PlacedLesson.grade) + v2→v3 (groupLabel/couplingId-Trennung)
- ✅ Phase 9: Tagespensum + Doppel/Einzel-Cohesion + Nachmittag-für-alle + 3-stufige Auto-Lockerung
- ✅ Phase 10: Anytime-Solver + Streaming-UI + „Beginn in P1" + RelaxationInfo
- ✅ Phase 11: Solver-Wechsel MiniZinc → TypeScript Construct + Local Search (`solver-v2/`), 4 neue Constraints (subject_twice, spec_spread, teacher_overload, teacher_no_lunch), Untis-Style RulesPanel
- ✅ Phase 12: Aufräumen — v1-MiniZinc-Solver komplett entfernt, pairedWith aus Datenmodell, Tabu-Asymmetrie gefixt, ILS-DRY-Refactor, Score-Test-Lücken geschlossen
- ✅ Phase 13: Constraint-Modell-Erweiterung — Hard-Constraint H10 (Hauptfach Nachmittag verboten), Score-Komponente `target_daily` (Zieltagespensum), `afternoon_preferred`, Schema v5 mit `LessonSpec.afternoonAllowed`, UI-Dropdown + Bulk + RulesPanel-Slider, Pre-Flight-Diagnose erweitert
- ✅ Phase 14: Pool-Phase (Multi-Start-Construction mit konfigurierbarer Laufzeit) + Hot-Start "Weiter optimieren"-Button + engine-1-stable Tag auf b555673
- ✅ Phase 15: Diversify-Button (LNS-Pattern, Best-Tracking) + Plan-Snapshot-Galerie (max 10 Pläne in localStorage, Auto-Snapshot bei ≥5% Improvement, Restore + Diversify-from-Snapshot)
- ✅ Phase 16: Wochenplan-View — neuer Tab, read-only Anzeige mit Snapshot-Dropdown, Filter (Lehrer/Stufe/Fach) im Highlight-Modus, große Zellen, ruhiges Layout
- ✅ Phase 17: Team-Teaching mit Segmenten — `LessonSpec.teachingSegments` (1 Spec teilbar in N Sub-Stunden mit eigenen Lehrer-Teams), Solver-Auto-Split in Pseudo-Specs, neue `TeamTeachingEditor`-Komponente mit Checkbox-Matrix, Multi-Lehrer-Chips in SpecList, Bulk-Action „🤝 Als Team-Teaching", CSV Smart-Merge als Opt-in mit Best-Guess-Aufteilung
- ✅ Solver-Optimierung R1+R2 (2026-07): Bench-Harness, Resumable LS, Lehrer-Score-Komponenten, Repair-Moves, Autopilot, Lehrer-Report, Web Worker + Parallel-Pool, unplaced-Score + H8-Doppellage-Fix, Plan-Import, Absturz-Härtung
- ✅ Audit-Paket A0–A7 (2026-07-11): Savepoint-Tag `savepoint-pre-audit-fixes`, kritische Fixes (Listener-Leaks, Relax-Frame, DnD-Parität), Datenintegrität (JSON-Guard, Save-Banner, droppedPins), halbzahlige Stunden konsistent (`effectiveSlotCount`), Plan-Import greedy, Code-Gesundheit (Helper-Konsolidierung `buildSlotOccupancy`/`teacherTint`), Doku-Sync, **Print-Layout** (PrintSheets: A4 quer pro Lehrer/Stufe/Gesamt)
- ✅ Solver-Runde 3 (2026-07-12, Tag `savepoint-pre-r3`): Scoped Score-Delta (×1,4 Durchsatz, Property-bewiesen), **Island-Optimierung** (k parallele ILS-Läufe, bester gewinnt), **LAHC statt SA** (5/5 Seeds vollständig platziert vs. 3/5 — erster Bench-Experiment-Gewinn), ALNS-Experiment (verworfen, Hook bleibt), `subject_run` (Max-in-Folge pro Fach wirkt), Gewichts-Presets + Schwierigkeits-Report + Qualitäts-%, **Feinschliff-Reiter** (gezielt nachbessern: markieren/Lehrer entlasten/Dahin-verschieben mit Diff-Review)
- 🔜 Phase 18 Rest: Diff-View zwischen Snapshots, echte zweite Engine

## Plan-Datei für Detail-Recherche

Lokal (gitignored, nur auf Geos Rechner): `~/.claude/plans/https-rageagainst123-github-io-std-stund-temporal-oasis.md` — enthält die ausführliche Phasen-Doku.

Im Repo (für alle Sessions verfügbar):

- `README.md` — User-fassbares Was-und-Warum
- `CHANGELOG.md` — Was wann gebaut wurde
- `docs/CONTEXT.md` — Wer (MS SiG, Geo, Solo-Tool) und Schul-Spezifika
- `docs/REQUIREMENTS.md` — Done / Phase 7 / Vision / Out of Scope + Glossar
- `docs/decisions/` — ADRs zu Stack, Solver-Wahl, State-Pattern, Slot-Modell, …
