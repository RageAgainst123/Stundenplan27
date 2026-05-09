# ADR-0002: Solver — MiniZinc-WASM im Browser

**Status:** ⚠ **superseded** by [ADR-0013](0013-typescript-construct-local-search.md) (2026-05-09)
**Datum:** 2026-05-07

> **Rückblick (2026-05-09):** Die Wahl von MiniZinc als Solver-Engine war
> in Phase 5 die richtige für ein deklaratives Hard-Constraint-Modell.
> Phasen 5–10 haben aber gezeigt, dass Constraint Programming mit
> Soft-Optimierung für Stundenpläne strukturell ungeeignet ist (Plateau-
> Verhalten, Backtracking-Suche kann nicht lokal verbessern). Phase 11
> ersetzt MiniZinc durch einen TypeScript Construct + Local Search Solver
> (siehe ADR-0013). Dieses ADR bleibt im Repo als historisches Dokument.

## Kontext

Stundenplan-Erstellung ist ein klassisches Constraint-Satisfaction-Problem
mit harten und weichen Regeln. Manuell platziert man 100+ Lehreinheiten in
160 Slots — aussichtslos ohne automatischen Solver. Wir brauchen einen
Solver, der **im Browser** läuft (keine Backend-Phase erlaubt, siehe ADR-0003)
und **deklarativ** beschriebene Constraints akzeptiert (damit pädagogische
Regeln wie „kein Hauptfach am Nachmittag" leicht ergänzt werden können).

## Entschieden

**MiniZinc-WASM** (npm `minizinc@4.4`) als Solver-Engine, eigenes
Schulmodell als `.mzn`-Datei, Aufruf aus einem Web Worker via die offizielle
MiniZinc-JS-API.

## Verworfen

- **OR-Tools (Google):** Kein offizieller WASM-Build, nur experimenteller
  Community-Fork. Risikoreich.
- **Timefold / OptaPlanner:** Java-basiert, kein Browser-Build möglich.
- **FET (Free Educational Timetabling):** Etablierter Desktop-Solver, kein
  Web-Frontend. Wäre nur als externer Service nutzbar.
- **Eigener Backtracking-Solver in TypeScript:** Wäre nur ~200 Zeilen, aber
  weiche Constraints (Penalty-Funktionen) würden mühsam händisch zu
  implementieren. MiniZinc löst das deklarativ.
- **csp.js & ähnliche generische CSP-JS-Libs:** Nicht timetabling-getestet,
  Performance unklar.

## Konsequenzen

**Vorteile:**
- Constraints sind in `model.mzn` deklarativ und einzeln verständlich.
- MiniZinc löst auch große Modelle (160-Variablen-CSP) in <30 s.
- Wenn weiche Constraints kommen (Phase 7), können wir `solve minimize <penalty>`
  einfach aufschalten.

**Kosten:**
- WASM-Bundle ist ~17 MB. First-Load ist langsam, danach gecached.
- Erste Solver-Initialisierung ~10 s; jede Solver-Instanz benötigt einen
  internen Sub-Worker, was anfangs zu Reactivity-Problemen mit Svelte führte
  (siehe ADR-0005).
- Wenn UNSAT (was vorkommt — siehe Phase 5b), gibt MiniZinc keinen guten
  „warum"-Erklärungs-Output. Manchmal müssen wir Constraints einzeln
  ausschalten um den Übeltäter zu finden.

## Folge-Entscheidungen

- Solver läuft via service.ts ohne extra-Module-Worker (MiniZinc-WASM hat
  bereits internen Worker-Pool, doppeltes Worker-Wrapping bricht).
- Slot-Modell: 3D `(day, period, grade)` — ADR-0004.
- DZN-Encoding (statt JSON), weil MiniZinc-JSON-Encoding bei Set-of-Set
  unzuverlässig ist.
