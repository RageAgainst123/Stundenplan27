# ADR-0013: TypeScript Construct + Local Search Solver

**Status:** accepted
**Datum:** 2026-05-09 (proposed) · 2026-05-10 (accepted)
**Supersedes:** [ADR-0002](0002-minizinc-wasm-solver.md) (MiniZinc-WASM)

## Kontext

Phasen 5–10 haben einen MiniZinc-WASM-Solver implementiert und schrittweise
verbessert (Hard-Constraints, Soft-Constraints, Anytime-Modus, UI-
Streaming, fünf-stufige Auto-Lockerung, Heuristik-Tuning, Constraint-
Reformulierung mit static-grade-filter). **Stand nach 4 h direkter
Diagnose mit der nativen MiniZinc-CLI auf der echten `Liste.csv`:**

| Konfiguration                              | Status   | Lösungen | Zeit  |
|--------------------------------------------|----------|----------|-------|
| `min_daily=4` + `must_start_p1=true`       | TIMEOUT  | 0        | 5 min |
| `min_daily=0` + `must_start_p1=false`      | OPTIMAL  | 9        | 60 s  |
| 5 min Optimierung mit Soft-Penalties aktiv | n/a      | n/a      | n/a   |

Score-Reduktion in 5 min: **3 % (4925 → 4765).** Plan zeigt strukturelle
Probleme (Mo–Mi voll, Do/Fr leer, Hauptfach am Nachmittag, Klassen-
Freistunden) trotz hoher Penalty-Gewichte für genau diese Probleme.

### Diagnose

Drei strukturelle Probleme von MiniZinc/Gecode für Stundenpläne:

1. **Soft-Constraints sind ein Nachgedanke.** `solve minimize` muss
   beweisbar optimal sein. Bei Stundenplänen interessiert das niemanden —
   „gut genug" reicht. Untis liefert keine Optimum-Garantie und hat
   30 Jahre Schul-Markt.

2. **Lokale Verbesserungen sind nicht möglich.** Wenn der Solver eine
   Lesson von Mo P5 nach Do P3 schieben will, muss er den Backtracking-
   Baum komplett neu durchqueren. Bei 128 Lessons sind das Millionen
   Knoten. Eine menschliche Stundenplanerin tauscht Slots in Sekunden.

3. **Plateau-Verhalten bei dichten Modellen.** `must_start_p1` engt den
   Suchraum so ein, dass Gecode keine Lösung mehr findet. Stundenpläne
   sind aber **immer** dicht.

### Was Untis und FET stattdessen machen

- **Untis** (Industriestandard): proprietäres gewichtetes-Heuristik-Verfahren,
  liefert mehrere Plan-Varianten in Minuten. Keine Optimum-Garantie.
- **FET** (Open Source seit 2002): Recursive Swapping. Aktivitäten nach
  Schwierigkeit sortiert, greedy platziert, Ejection-Chain bei Konflikt
  bis Tiefe 14.
- **Akademisch (XHSTT-Benchmarks):** Construction + Iterated Local Search,
  15–338× schneller als CP bei 3.5–7.7 % vom Optimum.

**Gemeinsamkeit:** keine generischen CSP-Solver. Alle nutzen
problemspezifische Heuristiken mit lokaler Verbesserung.

## Entschieden

**Solver v1 (MiniZinc-WASM) wird abgelöst durch Solver v2:** ein
TypeScript-eigener **Construct + Local Search**-Solver, spezialisiert auf
das MS-SiG-Datenmodell.

Drei Phasen:

1. **Construction** — Greedy mit Schwierigkeits-Sortierung der
   Construction-Units, Ejection Chain bei Konflikt. Liefert valide
   Erstlösung in <5 s.
2. **Local Search** — Hill-Climbing + Simulated Annealing + Tabu-Liste.
   Drei Move-Operatoren (slot-move, slot-swap, kempe-chain). Inkrementelles
   Score-Delta in O(1) pro Move. Ziel: 50.000+ Iterationen/Sekunde.
3. **Iterated LS** — Bei Plateau (30 s ohne Score-Verbesserung):
   großflächiges Perturbieren (20 % der Units neu) + Construction-Repair +
   Restart Local Search.

Architektur und Implementierungsplan sind in
[docs/SOLVER-V2-CONCEPT.md](../SOLVER-V2-CONCEPT.md) (16 Sektionen) und
[Phase 11-Plan](~/.claude/plans/https-rageagainst123-github-io-std-stund-temporal-oasis.md)
detailliert.

API bleibt **identisch** — `startSolve(doc, opts)` mit gleichen Events
(`phase`, `progress`, `solution`, `relaxation`, `done`, `log`). UI ändert
sich nicht. Auch `min_daily` und `must_start_p1` werden in v2 zu
**Soft-Constraints mit hohem Gewicht**, damit der Solver immer eine
Lösung liefert (kein UNSAT-Schock mehr).

## Verworfen

- **MiniZinc weiter tunen** — nach 10 Phasen Tuning-Versuchen keinen
  Durchbruch erreicht. Score plateau'd bei ~4700 trotz aktiver Soft-
  Penalties mit Gewichten 200/100/50. Diagnose mit nativer CLI bestätigt:
  ist kein Time-Limit-Problem, sondern struktureller Plateau.

- **OR-Tools / CP-SAT** — kein offizieller Browser-WASM-Build. Wäre
  Backend-Wechsel, widerspricht ADR-0003 (no-backend).

- **MiniZinc behalten + LNS-Layer in TypeScript** — komplex, MiniZinc-
  Roundtrips kosten 6 s pro Iteration (FlatZinc-Compile). Bringt kaum
  Verbesserung.

- **Hybrid: MiniZinc für Hard-Constraints + lokales Polish** — wenn die
  initiale MiniZinc-Lösung im Plateau liegt (was der Fall ist), hilft
  auch der Polish nur begrenzt.

- **Eigene Constraint-Programming-Library** — wir würden in TypeScript
  reimplementieren was MiniZinc schon kann, aber die fundamentalen
  Probleme (kein Local-Search-Pfad) blieben.

## Konsequenzen

### Pro

- **Performance**: ~50–100× Speedup in „Score-Verbesserung pro Sekunde"
  (Schätzung basierend auf XHSTT-Benchmarks).
- **Bundle-Size**: −17 MB (kein WASM mehr). dist/ schrumpft von 17.8 MB
  auf ~1.5 MB.
- **Kein Compile-Tax**: jeder Move kostet Mikrosekunden statt 6-Sekunden-
  FlatZinc-Compile.
- **Live-Updates trivial**: Score-Updates direkt im Main Thread, alle
  ~10 ms. Abbrechen ist sofortig.
- **Kein UNSAT-Schock**: `min_daily=4` und `must_start_p1` werden zu
  Soft-Constraints — Solver findet immer eine Lösung, Verletzungen sind
  im Score sichtbar.
- **Volle Kontrolle**: Heuristiken, Score-Funktionen, Tabu-Listen sind
  alle in TypeScript — auditierbar, debugbar, verständlich.

### Kontra

- **Implementierungsaufwand**: ~25 h Engineering (3 Tage konzentriert)
  für sauberen Solver mit Tests.
- **Wir verlieren MiniZinc-Investment**: Phasen 5–10 hatten Solver-Code
  (encode.ts, decode.ts, model.mzn, service.ts ~2200 Zeilen). Davon
  bleibt das Domain-Modell und die Diagnose-Logik. Der reine Solver-
  Code (~1500 Zeilen) wandert in `_attic/`-Branch.
- **Keine mathematische Optimum-Garantie mehr** — bei Stundenplänen
  irrelevant (Untis hat auch keine), aber theoretisch ein Verlust.
- **Eigene Heuristiken müssen wir warten** — wenn neue Soft-Constraints
  kommen, müssen wir die Score-Delta-Funktion anpassen, nicht nur eine
  MiniZinc-Constraint dazu schreiben.
- **Risiko Plateau-Verhalten** — Local Search kann auch in lokalen
  Minima hängen bleiben. Mitigation: Iterated Local Search mit
  Diversifikations-Restarts.

### Risiko-Mitigation

- **Rückfall auf v1**: alter Solver-Code wandert in `_attic/`-Branch
  (nicht gelöscht). Bei kritischen Problemen kann v1 in 1 h zurückgeholt
  werden.
- **Inkrementelle Migration**: 11 Schritte (siehe Phase-11-Plan), jeder
  Schritt funktionsfähig + grüne Tests. UI-Switch erst in Schritt 11-8,
  bis dahin läuft v1 weiter.
- **Vergleichs-Benchmark**: Score-Trajektorien von v1 und v2 auf der
  echten Liste.csv werden gespeichert, lassen sich nebeneinander stellen.

## Folge-Entscheidungen

- **ADR-0002 wird superseded.** Bleibt im Repo als historisches Dokument.
- **`docs/decisions/README.md` Index** wird aktualisiert mit ADR-0013
  und Hinweis dass ADR-0002 superseded ist.
- **CHANGELOG 0.11.0** dokumentiert den Solver-Wechsel als Breaking
  Change im Solver-Backend (User merkt das nicht, aber für Maintenance-
  Klarheit wichtig).
- **Phase 12+** kann auf der v2-Architektur Variantenmodus, Hot-Start,
  Per-Stufen-Constraints und Web-Worker-Parallelismus ergänzen — alle
  diese Features waren mit MiniZinc schwer umsetzbar.

## Sources

Recherche-Quellen für die Architektur-Entscheidung:

- [Untis — Timetable Scheduling Algorithm Overview](https://www.untis.at/en/products/untis-timetable-scheduling)
- [Modeling and Methods in Untis (PATAT 2022)](https://patatconference.org/patat2022/proceedings/PATAT_2022_paper_25.pdf)
- [FET — Timetable Generation Algorithm Description](https://lalescu.ro/liviu/fet/doc/en/generation-algorithm-description.html)
- [SciELO — Iterated Local Search for School Timetabling (15–338× speedup vs CP)](https://www.scielo.br/j/gp/a/WQ44xXhtpwPQ6SMG3JnQvdf/?lang=en)
- [Hertz et al. — Tabu Search for Large Scale Timetabling](https://link.springer.com/chapter/10.1007/978-3-642-12090-9_26)
- [XHSTT — High School Timetabling Project Benchmarks](https://www.utwente.nl/en/eemcs/dmmp/hstt/)
- [Improving a Heuristic Repair Method for Large-Scale School Timetabling (Springer)](https://link.springer.com/chapter/10.1007/978-3-540-48085-3_20)
- [Diversification Strategy for High School Timetabling](https://arxiv.org/pdf/1309.3285)
