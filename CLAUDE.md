# Stundenplan MS SiG — Claude-Session-Notizen

> **Bevor du arbeitest:** Lies kurz `docs/CONTEXT.md` (wer & wo) und `docs/REQUIREMENTS.md`
> (was als nächstes & was Out-of-Scope). Bei Architektur-Fragen: `docs/decisions/`.

## Auto-Imports

Folgende Dateien werden mit dieser CLAUDE.md geladen:

- @docs/CONTEXT.md
- @docs/REQUIREMENTS.md
- @docs/decisions/README.md

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
| `npm test`            | vitest run, alle 54 Tests einmalig                       |
| `npm run test:watch`  | vitest watch                                             |
| `npm run check`       | svelte-check + tsc                                       |

## Stack-Kurz

Vite 8 · TypeScript 6 · Svelte 5 (Runes) · @thisux/sveltednd · TypeScript-eigener Solver (`src/lib/solver-v2/`)

**Phase 11 in progress:** alter Solver `src/lib/solver/` (MiniZinc) wird abgelöst durch `src/lib/solver-v2/` (Construct + Local Search). Während Migration läuft: beide parallel im Repo, UI nutzt erst v2 ab Schritt 11-8.

## Architektur (eine Zeile pro Modul)

- **`src/lib/types.ts`** — Domänenmodell (Teacher, Subject, LessonSpec, PlacedLesson, ScheduleDoc, ConstraintConfig). Schema v3.
- **`src/lib/store.svelte.ts`** — Singleton-Store via `setContext`/`getContext`, `$state` für ScheduleDoc, Auto-Save in localStorage via `$effect.root`.
- **`src/lib/persistence.ts`** — localStorage save/load + JSON-Im/Export, Migrationen v1→v2→v3.
- **`src/lib/import/csv.ts`** — Sokrates-Liste-Parser (PG_/VÜ_/FÖ_/KU_, Klassen-Kopplungen `1a+2a`, Mehrstufen, Wochen-Pattern).
- **`src/lib/blocks.ts`** — Block-Pattern-Helpers (`blockPresets`, `blockLabel`, `groupColor`).
- **`src/lib/diagnose.ts`** — Pre-Flight-Checks (Lehrer-Überlast, fehlende Refs, Wochenstunden-Constraints).
- **`src/lib/solver/{model.mzn, encode.ts, decode.ts, service.ts, diagnose.ts}`** — **alter** MiniZinc-CSP-Solver (Phase 5–10). Wird durch v2 abgelöst.
- **`src/lib/solver-v2/{score, scoreDelta, moves, hardCheck, units, construct, ejectionChain, localSearch, restart, index}.ts`** — **neuer** TypeScript Construct + Local Search Solver. Siehe `docs/SOLVER-V2-CONCEPT.md`.
- **`src/components/`** — UI: ImportExport, TeacherList (mit AvailabilityGrid), SubjectList, SpecList (Bulk-Toolbar + Coupling), ScheduleGrid (mit ScheduleCell + GenerateButton), RulesPanel.

## Stolperfallen (CRITICAL — bitte erst lesen, bevor du Bugs jagst)

### Svelte 5 Reactivity

- **NIEMALS** den Store via `export const store = $state(...)` exportieren. Wir benutzen `setContext`/`getContext` (siehe `store.svelte.ts`). Cross-Component-Reactivity bricht sonst nach mehreren Tab-Switches.
- **NIEMALS** Plain-Objects als Array-Items in einen `$state`-Proxy spreaden ohne deduplicate. Der `each`-Block in `ScheduleCell.svelte` hat einen defensiven Key `cp.placed.specId + '|' + day + '|' + period + '|' + idx` weil der Solver in einem früheren Bug duplicate placements lieferte. Auch `GenerateButton.svelte` dedupliziert vor dem Schreiben in den Store.
- **Auto-Save:** Mutations via `bind:value` werden nicht persistiert ohne den `$effect.root` in `initStore()`. Wenn du den Store anfasst, achte darauf, dass dieser Effect bestehen bleibt.

### Vite/Browser

- Im Dev-Mode (`npm run dev`) akkumulieren mehrere onclick-Listener bei HMR — beim Bug-Hunting **immer** mit `npm run build && npm run preview` arbeiten, nicht im Dev-Server.
- Bei Cache-Problemen: `rm -rf node_modules/.vite dist && npm run build`.
- WASM-Asset für MiniZinc ist 17 MB — der erste Solver-Lauf dauert ~10s länger weil der WASM-Worker initialisiert wird.

### Solver (Architektur-Wechsel in Phase 11)

**Slot-Modell (gilt für v1 und v2):**
- Slot ist 3D: `(day, period, grade)`, NSLOTS = 5×8×4 = 160. `slotFromDPG()` in encode.ts (v1) bzw. units.ts (v2).
- LessonSpec mit `count=4, blocks=[2,2]` wird zu 4 lesson-instances mit zwei block-ids — Block-Constraint erzwingt Kontiguität.
- LessonSpec mit `grades=[5,6]` wird pro grade zu eigenen Instanzen expandiert, occurrence-Tupel müssen denselben (day,period) belegen.
- Specs mit `includeInSolver=false` werden vom Solver übersprungen.

**v1-spezifisch (alter MiniZinc-Solver, wird abgelöst):**
- DZN-Encoding (statt JSON-Encoding wegen Set-of-Set-Bugs).
- `solve minimize total_penalty` mit `:: int_search([assign[l] | l in LESSON], input_order, indomain_min, complete) :: restart_luby(150)`.
- Auf Liste.csv (128 Instanzen): erste Lösung in ~14 s, Score-Plateau bei ~4700 nach 5 min.

**v2-spezifisch (neuer TypeScript-Solver):**
- Siehe `docs/SOLVER-V2-CONCEPT.md` §6–§9 für Algorithmus-Details.
- Construction in <5 s, Local Search 50.000+ Iter/sec, Iterated LS bei Plateau.
- Score-Komponenten + Delta-Update sind das Performance-Herzstück.
- `min_daily=4` und `must_start_p1` werden zu Soft-Constraints (kein UNSAT-Schock).

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
- Niemals `model.mzn` Constraints aggressiv verschärfen ohne UNSAT-Test mit Fixture-Daten.
- Niemals Bundle-Größe ohne Grund vergrößern. MiniZinc-WASM (17 MB) ist die Grenze; alles drüber ist verdächtig.
- Niemals `package.json` Hauptversionen anheben ohne ausdrücklichen Auftrag — wir hatten genug Reactivity-Pannen, lass das Stack-Stack stabil.

## Phasen-Status (Stand 2026-05-08)

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
- ⚙️ Phase 11: **Solver-Wechsel** MiniZinc → TypeScript Construct + Local Search (siehe `docs/SOLVER-V2-CONCEPT.md`)
- 🔜 Phase 12: Variantenmodus, Print-Layout, pairedWith entfernen, Hot-Start

## Plan-Datei für Detail-Recherche

Lokal (gitignored, nur auf Geos Rechner): `~/.claude/plans/https-rageagainst123-github-io-std-stund-temporal-oasis.md` — enthält die ausführliche Phasen-Doku.

Im Repo (für alle Sessions verfügbar):

- `README.md` — User-fassbares Was-und-Warum
- `CHANGELOG.md` — Was wann gebaut wurde
- `docs/CONTEXT.md` — Wer (MS SiG, Geo, Solo-Tool) und Schul-Spezifika
- `docs/REQUIREMENTS.md` — Done / Phase 7 / Vision / Out of Scope + Glossar
- `docs/decisions/` — ADRs zu Stack, Solver-Wahl, State-Pattern, Slot-Modell, …
