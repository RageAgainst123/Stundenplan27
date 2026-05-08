# Stundenplan MS SiG

Eine Browser-App für Stundenplan-Erstellung an einer kleinen Mittelschule mit Mehrstufenklassen, mit eigenem Constraint-Solver auf WebAssembly-Basis und Drag-&-Drop-Editor.

**Stack:** Vite · TypeScript · Svelte 5 · MiniZinc-JS (WASM Solver) · sveltednd

## Features

- **CSV-Import** des Sokrates-Exports „Liste" als Startbasis (Lehrer, Fächer, ~50 Lehreinheiten in einem Klick)
- **Editor** für Lehrer (mit Farb-Picker und Verfügbarkeits-Mini-Raster), Fächer und Lehreinheiten — alles im Browser, alles änderbar
- **Mehrstufen-Modell:** Schulstufen 5–8 als Stundenplan-Spalten, Mehrstufen-Kopplungen (5+6, 7+8) und klassenübergreifende Gruppen werden korrekt abgebildet
- **Constraint-Solver** im Browser via MiniZinc-WASM: harte Regeln (Lehrer/Klasse nicht doppelt, Verfügbarkeit, Pinning, Wochen-Pattern) werden erfüllt
- **Drag-&-Drop**: Lehreinheiten von Sidebar in Slots ziehen, Live-Konfliktwarnungen, Pin-Toggle
- **Filter:** farbige Lehrer-Chips, Schulstufen-Toggles, Fach-Dropdown — wie das alte Vorbild
- **Wochen-G/U-Logik** für 2-wöchige Fächer (BBO, EH)
- **JSON-Backup**: Export & Import des kompletten Plans als Datei

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
│   └── solver/
│       ├── model.mzn                # MiniZinc-Schulmodell (harte Constraints)
│       ├── encode.ts                # ScheduleDoc → DZN
│       ├── decode.ts                # Solver-Output → PlacedLesson[]
│       ├── encode.test.ts           # 14 Tests
│       └── service.ts               # Browser-seitiger Solver-Aufruf
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

- ✅ **Phase 1–4** (Datenmodell, CSV-Import, Editor, Anzeige) — vollständig, 35 Tests grün, `npm run build` sauber.
- ✅ **Phase 5** (Solver) — MiniZinc-WASM-Toolchain verifiziert, harte Constraints abgedeckt; weiche Constraints (Score-Funktion) als nächste Iteration.
- ⚠️ **Phase 5b (Reactivity-Bug)** — UNGELÖST. Trotz mehrerer Lösungsansätze (Top-Level-Reassign, splice, plain $state-Object, Context-Pattern via setContext/getContext, Cell-Subkomponente) zeigt das Wochenraster nach dem Solver-Run weiterhin nur 4 statt 116 platzierte Stunden, obwohl localStorage und persistierte State korrekt 116 enthalten. Sidebar `unplaced` bleibt auf 52. Tab-Switch nach mehreren Wechseln rendert die Komponente nicht neu.
- 🔜 **Phase 6** (Print-Layout, GitHub-Pages-Deploy, Polish) — ausstehend.

## Bekannte Punkte zum Vertiefen

1. **Reactivity-Bug nach Solver-Run** — Store enthält 116 placed, DOM rendert nur 4. Versuchte Fixes ohne Erfolg:
   - `store.doc.placed = [...]` Reassignment
   - `store.doc.placed.splice(0, len, ...newArr)`
   - Top-Level Reassign `store.doc = { ...snap, placed: [...] }`
   - Plain `$state({doc: …})` Modul-Export statt Class
   - `setContext`/`getContext` Pattern
   - Eigene Cell-Subkomponente (`ScheduleCell.svelte`) mit per-instance `$derived(placementsAt(...))`

   **Hypothese:** Möglicherweise spezifisches Svelte-5.55-Problem mit deeply-nested $state in Production-Build, oder ein Konflikt mit dem MiniZinc-WASM-Worker, der den Reactivity-Scheduler blockt. Empfehlung für nächste Iteration: Migration auf klassisches `svelte/store` (writable) statt Runes für `placed`-Array. Oder direkt einen Force-Re-Mount via `{#key store.doc.placed.length}` um den Grid-Block.

2. **Tab-Switch-Render** — Nach mehreren Tab-Wechseln (besonders nach Solver-Run) zeigt der `{#if active === 'schedule'}`-Block weiterhin den ImportExport-Inhalt, obwohl `class:active` den richtigen Tab markiert. Auf einem **frischen** Reload-Tab funktioniert der erste Tab-Switch korrekt.

3. **Weiche Constraints** — `model.mzn` enthält bisher nur harte Regeln. RulesPanel-Werte sind UI-fertig, müssen noch in MiniZinc-Penalty-Variablen übersetzt werden.

## Was funktioniert vollständig

- CSV-Import: Liste.csv aus Sokrates → 10 Lehrer (mit Personalnummer, Leitung-Badge, Platzhalter), 19 Fächer (mit Kategorie, Hauptfach-Default), 52 LessonSpecs (mit Kopplungen via groupKey, korrekte Schulstufen, klassenübergreifend) — alle 21 Tests grün.
- Editor: Lehrer-Tabelle mit Farbpicker und 5×8-Verfügbarkeits-Mini-Raster, Fächer-Liste, Lehreinheiten-Liste mit Filtern.
- Solver: MiniZinc-WASM in <2s findet 116-Lehreinheiten-Plan, alle harten Constraints (Lehrer-Konflikte, Verfügbarkeit, Pinning, Wochen-Pattern) erfüllt. Status korrekt angezeigt, localStorage korrekt persistiert.
- JSON-Export/Import als Backup.

## Tests laufen lassen

```bash
npm test
```

35 Unit-Tests gegen den CSV-Parser (echte Liste.csv) und Solver-Encode/Decode-Pipeline.
