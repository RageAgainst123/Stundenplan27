# Stundenplan MS SiG

Eine Browser-App für Stundenplan-Erstellung an einer kleinen Mittelschule mit Mehrstufenklassen, mit eigenem Constraint-Solver auf WebAssembly-Basis und Drag-&-Drop-Editor.

**Live-Demo:** [rageagainst123.github.io/Stundenplan27](https://rageagainst123.github.io/Stundenplan27/)

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

- ✅ **Phase 1–4** (Datenmodell, CSV-Import, Editor, Anzeige) — vollständig, 54 Tests grün, `npm run build` sauber.
- ✅ **Phase 5** (Solver) — MiniZinc-WASM-Toolchain verifiziert, harte Constraints abgedeckt.
- ✅ **Phase 5b** (Reactivity & Solver 3D-Slots) — Solver findet auf echter Liste.csv (52 Specs) Plan in ~25 s mit 155 Lessons.
- ✅ **Phase 5c** (Block-Pattern, Solver-Ignore, Bulk-Edit, maxConsecutive, Reset) — siehe CHANGELOG.
- ✅ **Phase 5d** (Lehreinheiten-Kopplung-UX: Bulk Koppeln/Entkoppeln, Hover-×, gestapelte Cells).
- ⚙️ **Phase 6** (Projekt-Hygiene: CLAUDE.md, LICENSE, CHANGELOG, GitHub-Pages-Deploy).
- 🔜 **Phase 7** (Soft-Constraints, Print-Layout, `PlacedLesson.grade`-Bugfix).

## Was Phase 5b geändert hat

**Bug-Klasse 1 (eigentlicher Render-Bug):** Der each-block in ScheduleCell warf `each_key_duplicate`, weil der Solver mehrere Lesson-Instanzen derselben Spec auf denselben Slot legte (kein alldifferent-Constraint im MiniZinc-Modell). Das brach Svelte's Reactivity ab → DOM zeigte nur 4 alte Cells.

**Fixes:**
1. **Slot ist jetzt 3D** — `(day, period, grade)` statt nur `(day, period)`. Das Modell hat `NSLOTS = D*P*G = 160` Slots, jede grade-Spalte ist ein eigener Slot. Verhindert dass eine Spec mit grades=[5] alle Mathe-Stunden auf dieselben (day,period)-Slots zwingen würde wo auch andere Stufen Mathe haben.
2. **Spec-Expansion erzeugt jetzt 1 Instanz pro (occurrence × grade)** — Mehrstufen-Lessons (z. B. PG_BSP grades=[5,6] count=3) ergeben 6 Instanzen, die per synthetischem `groupId` an dieselbe `(day,period)` gebunden werden, aber unterschiedliche grade-Spalten belegen.
3. **Constraint 6 fordert: zwei Instanzen derselben Spec aus verschiedenen Occurrences müssen verschiedene `(day,period)` haben** — verhindert dass alle 4 Mathe-Stunden auf Mo Stunde 1 landen.
4. **Defensiver each-Key in ScheduleCell.svelte:** `cp.placed.specId + '|' + day + '|' + period + '|' + idx` — auch bei Solver-Bugs niemals duplicate keys.
5. **GenerateButton dedupliziert das Solver-Output** vor der Mutation, sodass der Render-Block nicht mehr brechen kann.

**Bug-Klasse 2 (Modul-State):** Ich hatte den Reactivity-Verlust ursprünglich auf `export const store = $state(...)` zurückgeführt und auf `setContext`/`getContext` migriert. Das war eine korrekte Hardening-Maßnahme, aber nicht die eigentliche Ursache. Wir behalten das Context-Pattern, weil es Best-Practice für Cross-Component-Reactivity ist.

## Bekannte Punkte / Polish

1. **Solver-Performance** — bei 52 Specs ~25s. Eingrenzung der Constraints und/oder Heuristik-Hint via `solve` annotations könnte das verbessern.
2. **Pinning ist grade-naiv:** `PlacedLesson` hat nur `(day, period)`, der Solver pickt sich beim Pinnen die erste grade. Reicht für jetzt, weil die UI nur eine grade-Spalte beim Drag-Drop sichtbar macht.
3. **Weiche Constraints** — `model.mzn` enthält bisher nur harte Regeln. RulesPanel-Werte sind UI-fertig, müssen noch in MiniZinc-Penalty-Variablen übersetzt werden.

## Was funktioniert vollständig

- CSV-Import: Liste.csv aus Sokrates → 10 Lehrer (mit Personalnummer, Leitung-Badge, Platzhalter), 19 Fächer (mit Kategorie, Hauptfach-Default), 52 LessonSpecs (mit Kopplungen via groupKey, korrekte Schulstufen, klassenübergreifend) — alle 21 Tests grün.
- Editor: Lehrer-Tabelle mit Farbpicker und 5×8-Verfügbarkeits-Mini-Raster, Fächer-Liste, Lehreinheiten-Liste mit Filtern.
- Solver: MiniZinc-WASM findet auf der echten Liste.csv (52 Specs) eine Lösung in ~25s, 155 Lehreinheiten platziert. Alle harten Constraints (Lehrer-Konflikte, Verfügbarkeit, Pinning, Wochen-Pattern, Spec-Replay-Vermeidung, Mehrstufen-Kopplung) erfüllt.
- Anzeige: Wochenraster mit 5×4 Tag/Stufen-Spalten × 8 Stunden, farbige Lehrer-Cells, Mehrstufen-Kopplungen (z. B. „DGB L2 5+6"), Filter-Bar mit Lehrer-Chips/Stufen-Toggles/Fach-Dropdown, Sidebar mit ungeplanten Lessons.
- JSON-Export/Import als Backup.

## Tests laufen lassen

```bash
npm test
```

54 Unit-Tests: Block-Pattern-Helpers, CSV-Parser (echte Liste.csv), Solver-Encode/Decode-Pipeline.

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
