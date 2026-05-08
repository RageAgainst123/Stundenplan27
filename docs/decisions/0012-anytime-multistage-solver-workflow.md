# ADR-0012: Anytime Multi-Stage Solver Workflow

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Bis Phase 9 lief der Solver in einem einzigen `solve minimize`-Call mit
30s Timeout. Der User sah nur „Solver läuft…" und am Ende einen Plan.
Probleme:

1. **Black Box.** User wusste nicht, ob der Plan optimal ist oder ob der
   Timeout zu früh greift. Bei großem Score-Gap zwischen erster und
   bester Lösung gab es keine Sichtbarkeit.

2. **Keine Abbruchmöglichkeit.** Wenn nach 5 s ein „guter genug"-Plan da
   war, musste der User trotzdem 25 s warten. Bei 60 s+ Wartezeit für
   ein Multi-Objective-Problem mit 5 weichen Constraints wäre das
   inakzeptabel.

3. **UI-Bug bei Auto-Lockerung.** Die in Phase 7B/9 eingeführte
   3-stufige UNSAT-Lockerung wurde nur bei Block-Pattern-Lockerung im
   Banner angezeigt — Tagespensum-Reduktion auf 3 oder 0 lief still
   durch, der User sah einen Plan der seine eigenen Regeln verletzte und
   konnte nicht erkennen warum.

4. **Constraint-Lücke „Beginn in P1".** Phase 9 forderte zwar ≥4 Slots
   pro Tag, aber nichts darüber wo die liegen — der Solver konnte einer
   Stufe Mo P3-P6 geben und P1-P2 frei lassen.

User-Wunsch: **mehrstufiger Workflow** mit Anytime-Optimierung,
Fortschritts-Anzeige, Prognose, sauberem Abbruch.

## Entschieden

### A) Hartes Constraint 12: „Beginn in P1"

```minizinc
constraint must_start_p1 ->
  forall (d in 1..D, g in 1..G) (
    (exists(l in LESSON) (dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g))
    -> (exists(l in LESSON) (
      dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g /\ periodOf(assign[l]) = 1
    ))
  );
```

`must_start_p1` als DZN-Bool durchgereicht aus `ConstraintConfig.mustStartFirstPeriod.enabled`.

### B) Strukturierte `RelaxationInfo`

Statt Stringly-typed Banner-Trigger:

```ts
export interface RelaxationInfo {
  blocksRelaxed: string[];
  minDailyReducedTo: number | null;
  startInP1Disabled: boolean;
}
```

UI zeigt einen klar strukturierten Banner sobald **irgendeine** der
drei Lockerungen greift. Der bisher übersehene Tagespensum-Pfad ist
endlich sichtbar.

### C) Auto-Lockerung von 3 auf 5 Stufen erweitert

1. Blocks auf Auto
2. Plus `min_daily=3`
3. Plus `min_daily=0`
4. Plus `must_start_p1=false`
5. Final UNSAT mit Diagnose-Hint

### D) Streaming `SolveSession` mit Event-API

Neuer `startSolve(doc, opts)` ergänzt den bestehenden `solve(doc, opts)`.
Liefert eine Session-API:

```ts
const s = startSolve(doc, { satisfyTimeoutMs: 15_000, optimizeTimeoutMs: 60_000 });
s.on('phase', p => ...);
s.on('progress', p => ...);
s.on('solution', sol => updateUI(sol));   // anytime: jede bessere Lösung
s.on('relaxation', r => showBanner(r));
s.on('done', d => finish(d));
s.abort();   // jederzeit
```

Intern:
- **Phase A — Satisfy** (15 s Default): `solve satisfy` → erste valide Lösung
- **UNSAT-Pfad:** Lockerungs-Kette wie oben, jeder Schritt streamed
- **Phase B — Optimize** (60 s Default): `solve minimize` mit
  `'all-solutions': true` → MiniZinc emittiert via `on('solution', cb)`
  jede gefundene **bessere** Lösung
- Bei `abort()` ruft die Session `solve.cancel()` auf den aktuellen Job;
  die letzte über Streaming gemeldete Lösung wird als finales Ergebnis
  übernommen.

`queueMicrotask`-Defer beim Session-Start damit der Caller noch Zeit hat
Listener zu registrieren bevor der erste Event feuert.

### E) UI: SolveDialog im GenerateButton

`GenerateButton.svelte` zeigt während eines Laufs:
- Phasen-Label und Progress-Bar mit Restzeit (`tElapsed`/`tLimit`)
- aktuelle beste Score und Anzahl gefundener Lösungen
- SVG-Sparkline-Verlauf der Score-Historie
- Convergence-Hint („Letzte Verbesserung vor X s — Abbrechen lohnt
  sich evtl.") nach 8 s ohne Verbesserung
- Abbrechen-Button (sammelt aktuellen Stand, kein UNSAT-Fallback)

Der Store wird **live** mit jeder besseren Lösung aktualisiert — der
User sieht den Plan im Grid sich verbessern, nicht erst am Ende.

## Verworfen

- **OR-Tools / CP-SAT statt Gecode:** kein Browser-WASM-Build verfügbar.
  Alternative wäre Backend (Cloudflare Worker o. Ä.), out of scope.
- **Echte Large-Neighborhood-Search (LNS):** für 155 Lessons Overkill,
  Engineering-Aufwand zu hoch. Anytime + Heuristik-Diversifikation
  (Phase 10-4) liefert vergleichbaren UX-Gewinn ohne LNS-Komplexität.
- **Hot-Start zwischen Phase A und B:** wäre über `solve_search` mit
  Initial-Werten möglich, aber MiniZinc-WASM-Doku dazu dünn. Vorerst
  beide Phasen kalt starten.
- **Multi-Worker-Parallelismus:** MiniZinc-WASM unterstützt das
  eingeschränkt; bei unserer Größe (155 Lessons, ~25 s pro Lauf) lohnt
  der Aufwand nicht.

## Konsequenzen

**Pro:**
- Solver ist nicht mehr Black Box. User sieht Score 850 → 720 → 580 live.
- Abbruch jederzeit möglich; aktueller Bestpunkt bleibt erhalten.
- Lockerungen sind **immer** im UI sichtbar — keine stillen Verletzungen
  der eigenen Regeln mehr.
- „Beginn in P1"-Regel deckt die letzte fehlende Geschäftsregel ab.

**Kontra:**
- `'all-solutions': true` erzeugt bei großen Modellen viele Solution-
  Events. Bei > 100 Events/Sekunde könnte UI-Update zur Bremse werden.
  Vorerst keine Drosselung implementiert — wenn Performance-Problem,
  per `requestAnimationFrame`-Throttling nachrüsten.
- Migration `mustStartFirstPeriod`-Feld: bestehende Pläne kriegen den
  Default `enabled: true` automatisch via `persistence.migrateDoc`.
- Service-Layer ist nun zwei-gleisig: `solve()` für Tests/Legacy,
  `startSolve()` fürs UI. Etwas Code-Duplikation in der Lockerungs-
  Logik (`solve` hat seinen eigenen Pfad, `startSolve` nutzt
  `relaxationChain`). Akzeptabel für die Klarheit der Streaming-Variante.
- Tests können MiniZinc-WASM nicht in vitest aufrufen. Streaming-API
  ist nur indirekt getestet (Pre-Flight-Pfade); E2E-Validation läuft
  per User-Smoke-Test im Browser.

**Folge-Entscheidungen:**
- Phase 10-4 (Variantenmodus): zwei zusätzliche Solver-Läufe mit anderen
  Such-Heuristiken (`dom_w_deg`, `input_order` mit Random-Seed) und
  3-Plan-Vergleich im UI. Verschoben auf nächste Session.
- Falls Performance-Probleme: requestAnimationFrame-Throttling im
  Solution-Event-Forwarder.
- LNS / OR-Tools-Wechsel falls je > 500 Lessons unterstützt werden müssen.
