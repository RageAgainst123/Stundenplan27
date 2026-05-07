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
- ⚠️ **Browser-Smoke-Test:** Solver findet zuverlässig Lösungen (116 Lehreinheiten in <2s), CSV-Import + Editor + Solver-Pipeline funktionieren bis zum Store. Die Reactivity zwischen Store-Update nach Solve und DOM-Render hat eine Schwachstelle, die im nächsten Iterations-Schritt vertieft werden muss (siehe Code-Kommentar in `ScheduleGrid.svelte` — `placementMap` $derived.by).
- 🔜 **Phase 6** (Print-Layout, GitHub-Pages-Deploy, Polish) — ausstehend.

## Bekannte Punkte zum Vertiefen

1. **Reactivity-Bug nach Solver-Run** — Store enthält 116 placed, DOM rendert nur 4. Vermutlich braucht es entweder eine Restrukturierung von `placementsAt` zu einem reinen $derived oder eine Force-Update-Strategie nach dem Solver-Run.
2. **Tab-Switch-Render im Dev-Server** — HMR im Vite-Dev-Server kann mehrere onclick-Listener akkumulieren. Production-Build (`npm run build && npm run preview`) ist davon nicht betroffen.
3. **Weiche Constraints** — `model.mzn` enthält bisher nur harte Regeln. RulesPanel-Werte sind UI-fertig, müssen noch in MiniZinc-Penalty-Variablen übersetzt werden.

## Tests laufen lassen

```bash
npm test
```

35 Unit-Tests gegen den CSV-Parser (echte Liste.csv) und Solver-Encode/Decode-Pipeline.
