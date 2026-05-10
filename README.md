# Stundenplan MS SiG

Eine Browser-App für Stundenplan-Erstellung an einer kleinen Mittelschule mit Mehrstufenklassen, mit eigenem TypeScript-Solver (Construct + Local Search) und Drag-&-Drop-Editor.

**Live-Demo:** [rageagainst123.github.io/Stundenplan27](https://rageagainst123.github.io/Stundenplan27/)

**Stack:** Vite · TypeScript · Svelte 5 · sveltednd

## Features

- **CSV-Import** des Sokrates-Exports „Liste" als Startbasis (Lehrer, Fächer, ~50 Lehreinheiten in einem Klick)
- **Editor** für Lehrer (mit Farb-Picker und Verfügbarkeits-Mini-Raster), Fächer und Lehreinheiten — alles im Browser, alles änderbar
- **Mehrstufen-Modell:** Schulstufen 5–8 als Stundenplan-Spalten, Mehrstufen-Kopplungen (5+6, 7+8) und klassenübergreifende Gruppen werden korrekt abgebildet
- **Solver** (TypeScript, im Browser, kein WASM): Construction (greedy + ejection chain) + Iterated Local Search mit Simulated Annealing und Tabu. Harte Regeln (Lehrer-Doppel, Verfügbarkeit, Pinning, Wochen-Pattern, Coupling-Cohesion) sind unverletzlich; weiche Regeln werden als Score-Penalty optimiert.
- **Untis-Style Regeln**: 14 Score-Komponenten (Hohlstunden, Mittagspause, Hauptfach-Vormittag, Tagesausgleich, Lehrer-Tageslast …), alle einzeln gewichtbar im RulesPanel
- **Team-Teaching**: Lerneinheiten können mehrere Lehrer haben (z. B. BSP K + BSP M parallel)
- **Drag-&-Drop**: Lehreinheiten von Sidebar in Slots ziehen, Live-Konfliktwarnungen, Pin-Toggle
- **Filter:** farbige Lehrer-Chips, Schulstufen-Toggles, Fach-Dropdown
- **Wochen-G/U-Logik** für 2-wöchige Fächer (BBO, EH)
- **JSON-Backup**: Export & Import des kompletten Plans als Datei
- **Lokal-only**: kein Backend, alles im Browser (localStorage). JS-Bundle ~50 KB gz.

## Schnellstart

```bash
npm install
npm run dev          # Dev-Server auf Port 5173
npm test             # Vitest (CSV-Parser, encode/decode)
npm run build        # Production-Build nach dist/
```

## Schul-Modellierung (zentral)

An der MS SiG gibt es organisatorisch zwei Klassen:
- **1a** = Schulstufen 5 + 6
- **2a** = Schulstufen 7 + 8

Beide sind Mehrstufenklassen, werden aber meist getrennt unterrichtet. Der Stundenplan zeigt deshalb 4 Spalten (5./6./7./8. SSt.). Die Achse für Solver und Anzeige ist die **Schulstufe**, die Klasse(n)-Information aus der CSV ist Metadaten.

Spec-Beispiele aus der CSV:

| CSV-Zeile | grades | Belegt im Raster |
|---|---|---|
| `PG_M;1a;;4;0;05;Hackl Simone…` | `[5]` | nur Spalte 5. SSt. |
| `PG_BSP;1a;Knaben 1/2;3;0;05,06;…` | `[5,6]` | Spalten 5+6 zusammengezogen |
| `PG_BSP;1a+2a;Mädchen;3;0;05,06,07,08;…` | `[5,6,7,8]` | alle 4 Spalten |
| `PG_REL;1a;PG_REL_RRK_1;2;0;06,07;…` | `[6,7]` | klassenübergreifend |

`Stunden` und `ErgStunden` werden für den Generator als gleichwertig behandelt (`count = Stunden + ErgStunden`). Die G/U-Wochen-Logik wird **manuell im Editor** gesetzt (Feld `weekPattern`), nicht aus der CSV abgeleitet.

## Workflow

1. **Setup** (Tab „Import / Export"): CSV hochladen → Vorschau-Diff bestätigen.
2. **Stammdaten verfeinern:** Tab „Lehrer" (Farben, Verfügbarkeiten), „Fächer" (Hauptfach-Flag), „Lehreinheiten" (Wochen-Pattern für BBO/EH manuell setzen).
3. **Plan bauen** (Tab „Stundenplan"): fixe Stunden per Drag&Drop in Slots ziehen → „Plan generieren" → Solver platziert den Rest.
4. **Feinjustierung:** Stunden verschieben, pinnen, regenerieren.
5. **Backup** als JSON speichern.

## Architektur

```
src/
├── App.svelte                       # Tab-Navigation
├── lib/
│   ├── types.ts                     # Datenmodell (Teacher, Subject, LessonSpec, …)
│   ├── store.svelte.ts              # Reactive Store mit localStorage-Persistierung
│   ├── persistence.ts               # localStorage + JSON Im-/Export
│   ├── now.ts                       # Period/Week-Helpers (KW, G/U)
│   ├── schedule-helpers.ts          # placementsAt, conflictCheck, unplacedSpecs
│   ├── import/
│   │   ├── csv.ts                   # Sokrates-Liste-Parser
│   │   ├── csv.test.ts              # 21 Tests gegen echte Liste.csv
│   │   ├── subject-names.ts         # Code → Klartext + Hauptfach-Default
│   │   └── __fixtures__/sokrates-liste.csv
│   ├── teacher-helpers.ts          # teacherById/Color/Name lookups
│   ├── types-ui.ts                 # UI-Typen (DragPayload)
│   └── solver-v2/
│       ├── types.ts                # Unit/SolverState/ScoreBreakdown
│       ├── units.ts                # buildState — Specs zu Units expandieren
│       ├── score.ts                # 14 Score-Komponenten (computeScore)
│       ├── scoreDelta.ts           # Score-Delta für Local Search
│       ├── moves.ts                # slot-move / slot-swap / kempe-chain
│       ├── hardCheck.ts            # H1–H9 wouldViolate + findHardViolations
│       ├── construct.ts            # Greedy + ejection chain Construction
│       ├── localSearch.ts          # Hill-Climbing + SA + Tabu
│       ├── iteratedLS.ts           # ILS mit adaptivem Restart + Reheat
│       ├── diagnose.ts             # Pre-Flight-Diagnose
│       └── index.ts                # startSolve() Public API
└── components/
    ├── ImportExport.svelte
    ├── TeacherList.svelte
    ├── AvailabilityGrid.svelte
    ├── SubjectList.svelte
    ├── SpecList.svelte
    ├── ScheduleGrid.svelte
    ├── LessonCell.svelte
    ├── GenerateButton.svelte
    └── RulesPanel.svelte
```

## Status

- ✅ **Phase 1–10:** Datenmodell, CSV-Import, Editor, Anzeige, MiniZinc-Solver mit Soft-Constraints, Schema-v3-Migration, Anytime-Modus.
- ✅ **Phase 11:** Solver-Architektur-Wechsel von MiniZinc-WASM (CSP) zu TypeScript Construct + Local Search. Bessere Score-Resultate, Bundle ohne 17 MB WASM. Untis-Style RulesPanel mit allen Gewichten sichtbar. 14 Score-Komponenten inklusive subject_twice, spec_spread, teacher_overload, teacher_no_lunch.
- ✅ **Phase 12:** Aufräumen — alter MiniZinc-Solver vollständig entfernt (Verzeichnis `src/lib/solver/` weg, `minizinc` aus Dependencies). Tabu-Asymmetrie im Local Search gefixt, ILS-Sync/Async DRY-refactor, Score-Test-Lücken geschlossen, `pairedWith`-Legacy-Feld aus Datenmodell entfernt.
- 🔜 **Phase 13:** Print-Layout (A4 pro Lehrer / pro Stufe), Variantenmodus, Hot-Start aus letztem Plan.

## Was funktioniert vollständig

- CSV-Import: Liste.csv aus Sokrates → 10 Lehrer (mit Personalnummer, Leitung-Badge, Platzhalter), 19 Fächer (mit Kategorie, Hauptfach-Default), ca. 50 LessonSpecs (mit Kopplungen, korrekten Schulstufen, klassenübergreifend).
- Editor: Lehrer-Tabelle mit Farbpicker, 5×8-Verfügbarkeits-Mini-Raster und optionalem Tageslast-Limit; Fächer-Liste mit `maxConsecutive`; Lehreinheiten-Liste mit Filtern, Bulk-Toolbar (Koppeln/Entkoppeln/Solver-Toggle/Wochen-Muster), Tageszeit-Präferenz pro Spec, Drag-&-Drop ins Wochenraster.
- Solver: TypeScript Construct + Iterated Local Search. Auf der echten Liste.csv reduziert er den Score in 10 s typischerweise von ~28 000 auf ~3500 (no_free=0, alle harten Constraints erfüllt). Anytime-Modus, jederzeit abbrechbar.
- Regeln: 14 Score-Komponenten (Untis-Style) im RulesPanel, alle Gewichte editierbar. Strict-Modus für „keine Hohlstunden" mit Auto-Lockerung bei UNSAT. Mittagspause-Fenster konfigurierbar.
- Anzeige: Wochenraster 5×4 Tag/Stufen-Spalten × 8 Stunden, farbige Lehrer-Cells, Team-Teaching mit zwei Lehrer-Badges, gekoppelte Lerneinheiten nebeneinander statt gestapelt, Filter-Bar.
- JSON-Export/Import als Backup, automatische Schema-Migration v1→v2→v3→v4.

## Tests laufen lassen

```bash
npm test
```

~150 Unit-Tests: Block-Pattern-Helpers, CSV-Parser, Solver-Score (alle 14 Komponenten), Solver-Hardcheck, Move-Operatoren, Construction, Local Search, Iterated LS, Service-Wrapper, Persistenz-Migrationen.

Mit der echten Liste.csv als Stress-Test:
```bash
CONSTRUCT_REAL_LISTE=1 npm test
```

## Dokumentation

- [CLAUDE.md](./CLAUDE.md) — Stolperfallen, Konventionen, Befehle für AI-Sessions
- [CHANGELOG.md](./CHANGELOG.md) — Versions-Historie
- [docs/CONTEXT.md](./docs/CONTEXT.md) — Schul-Kontext (MS SiG, Mehrstufen-Modell, Erfolgsmaßstab)
- [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md) — Done / Phase 7 / Vision / Out-of-Scope + Glossar
- [docs/decisions/](./docs/decisions/) — Architektur-Entscheidungen (ADRs)

## Lizenz

[MIT](./LICENSE) — Copyright © 2026 Geo Schlegel.

## Mitwirken

Solo-Projekt. Bei Interesse: GitHub-Issues mit konkreten Beobachtungen sind willkommen,
keine PR-Garantie. Einstiegspunkt für Folge-Sessions ist [`CLAUDE.md`](./CLAUDE.md).
