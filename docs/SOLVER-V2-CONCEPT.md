# Solver v2 — Konzept-Dokument

> **Status:** geplant • **Datum:** 2026-05-09 • **Vorgänger:** [ADR-0002 (MiniZinc-WASM)](decisions/0002-minizinc-wasm-solver.md)

Dieses Dokument beschreibt **was** der neue Solver tut, **warum** er anders gebaut
ist als der alte, und **wie** er konkret arbeitet. Es ist die Grundlage für
ADR-0013 und die Implementierung. Kein Code — nur Konzept und Spezifikation.

---

## 1. Warum ein neuer Solver

### Befund nach Phasen 5–10

Wir haben den MiniZinc-WASM-Solver in zehn Phasen iteriert. Status nach 4
Stunden Tuning auf der echten `Liste.csv` (52 Specs, 128 Lesson-Instanzen):

| Konfiguration                               | Status   | Lösungen | Zeit  |
|---------------------------------------------|----------|----------|-------|
| `min_daily=4` + `must_start_p1=true`        | TIMEOUT  | 0        | 5 min |
| `min_daily=0` + `must_start_p1=false`       | OPTIMAL  | 9        | 60 s  |
| Nur eine Hard-Constraint dazu → kollabiert  | TIMEOUT  | 0        | 60 s  |

Das ist **kein Tuning-Problem** mehr. Das ist ein **Algorithmus-Mismatch**.

### Diagnose

MiniZinc/Gecode ist ein **generischer Constraint-Solver** mit
Backtracking-Suche und Constraint-Propagation. Drei strukturelle Probleme
machen ihn für Schulstundenpläne ungeeignet:

1. **Soft-Constraints sind ein Nachgedanke.** Bei `solve minimize` muss der
   Solver mathematisch beweisen dass keine bessere Lösung existiert. Bei
   Stundenplänen interessiert dieser Beweis niemanden — „gut genug" reicht.
   Untis liefert keine Optimum-Garantien, niemand reklamiert.

2. **Lokale Verbesserungen sind nicht möglich.** Wenn der Solver Mathe von
   Mo P5 nach Do P3 schieben will, muss er den ganzen Backtracking-Baum
   neu durchqueren. Bei 128 Lessons sind das Millionen Knoten. Eine
   menschliche Stundenplanerin tauscht Slots in Sekunden.

3. **Plateau-Verhalten bei dichten Modellen.** Sobald der Suchraum durch
   `must_start_p1` stark eingeengt ist, findet Gecode keine Lösung mehr —
   der Suchbaum hat zu viele tote Äste, die Heuristik kommt nicht durch.
   Stundenpläne sind aber **immer** dicht.

### Was Untis und FET stattdessen machen

Aus den Recherche-Quellen (siehe ADR-0013 Sources):

- **Untis** (Industriestandard, ~30 Jahre Schul-Markt):
  Gewichtetes-Heuristik-Verfahren. Generiert mehrere Pläne nacheinander
  mit unterschiedlichen Strategien, User wählt den besten. Keine
  Optimum-Garantie. Algorithmus proprietär, aber Performance: Plan in
  Minuten, nicht Stunden.

- **FET** (Open Source, school-timetabling-Standard seit 2002):
  Recursive Swapping. Aktivitäten nach Schwierigkeit sortiert,
  greedy platziert. Bei Konflikt: Ejection Chain — verschiebe blockierende
  Aktivität auf einen anderen Slot, rekursiv bis Tiefe 14.
  ([Generation Algorithm Doc](https://lalescu.ro/liviu/fet/doc/en/generation-algorithm-description.html))

- **Akademischer State-of-the-Art** (XHSTT-Benchmarks):
  Zwei-Phasen — **Construction** (greedy + repair) gefolgt von
  **Improvement** (Local Search mit Tabu-Liste oder Simulated Annealing).
  Iterated Local Search ist 15–338× schneller als Constraint Programming
  bei nur 3.5–7.7 % Abweichung vom Optimum.
  ([SciELO ILS Paper](https://www.scielo.br/j/gp/a/WQ44xXhtpwPQ6SMG3JnQvdf/?lang=en))

**Gemeinsamkeit:** keine generischen CSP-Solver. Alle nutzen
problemspezifische Heuristiken mit lokaler Verbesserung.

---

## 2. Was Solver v2 ist

**Ein TypeScript-eigener Construct + Local-Search Solver, spezialisiert
auf das MS-SiG-Datenmodell.**

Drei Kern-Phasen:

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: CONSTRUCTION                                          │
│  Greedy-Platzierung mit Slot-Scoring, Ejection-Chain-Repair     │
│  Ziel: erste valide Lösung in 1–3 Sekunden                      │
├─────────────────────────────────────────────────────────────────┤
│  Phase 2: LOCAL SEARCH (Hill-Climbing + Simulated Annealing)    │
│  Swap-Moves, Move-Moves, Kempe-Chains; Score-Delta evaluieren   │
│  Ziel: 10.000 Iterationen/Sek; 1–5 Min iterieren                │
├─────────────────────────────────────────────────────────────────┤
│  Phase 3: RESTART + DIVERSIFICATION                             │
│  Bei Plateau: Großflächiges Perturbieren + neues Climb          │
│  Ziel: aus lokalen Minima entkommen                             │
└─────────────────────────────────────────────────────────────────┘
```

Alle drei Phasen laufen **direkt in TypeScript im Browser**. Kein
WASM-Compile, kein Worker-Roundtrip, **keine 6-Sekunden-FlatZinc-Kompilierung
vor jedem Lauf**. Jeder Move kostet Mikrosekunden.

### Was bleibt, was geht

| Komponente                               | bleibt | wird ersetzt |
|------------------------------------------|--------|--------------|
| `src/lib/types.ts` (Domain-Modell)       | ✅     |              |
| `src/lib/store.svelte.ts`                | ✅     |              |
| `src/lib/persistence.ts` + Migrationen   | ✅     |              |
| `src/lib/import/csv.ts` (Sokrates)       | ✅     |              |
| `src/lib/diagnose.ts` (Pre-Flight)       | ✅     |              |
| `src/lib/blocks.ts`                      | ✅     |              |
| `src/components/*` (UI inkl. SolveDialog) | ✅     |              |
| **`src/lib/solver/encode.ts`**           |        | ❌ entfällt  |
| **`src/lib/solver/decode.ts`**           |        | ❌ entfällt  |
| **`src/lib/solver/model.mzn`**           |        | ❌ entfällt  |
| **`src/lib/solver/service.ts` (Logic)**  |        | ❌ neu       |
| **`minizinc` npm-Dep + 17 MB WASM**      |        | ❌ entfernt  |

`startSolve()`-Signatur bleibt **identisch** — gleiche Events
(`phase`, `progress`, `solution`, `relaxation`, `done`, `log`),
gleicher `abort()`. Das UI merkt vom Wechsel nichts außer dass es
schneller wird.

---

## 3. Datenmodell-Anker

Solver v2 arbeitet auf dem **bestehenden** Domain-Modell (`types.ts`).
Hier die Kernabstraktionen die der Solver kennen muss:

### Slot

`(day: Mo|Di|Mi|Do|Fr, period: 1..8, grade: 5|6|7|8)` →
**Slot-ID 1..160** via dem bestehenden `slotFromDPG()`-Helper.

### Lesson-Instance

Eine `LessonSpec` mit `count=4, grades=[5]` produziert **4 Instanzen**.
Eine mit `count=2, grades=[5,6]` produziert **4 Instanzen** (2 occurrences ×
2 grades), wobei die 2 grade-Geschwister einer Occurrence ein Tupel
bilden, das **immer denselben (day, period)** belegen muss
(Mehrstufenklasse-Semantik).

### Coupling

Specs mit gleichem `couplingId` müssen **denselben Slot** teilen — z.B.
BSP-Knaben + BSP-Mädchen parallel. Im Solver v2 werden sie als
**zusammengezogene Lesson-Gruppe** geführt; im Score-Delta-Update wird
die Gruppe als Einheit verschoben.

### Pinned Lessons

User kann eine Lesson manuell festsetzen (`pinned: true`). Solver
respektiert das — diese Lessons sind **invariant** über alle Phasen,
werden weder in Construction platziert noch in Local Search verschoben.

---

## 4. Hard-Constraints (in Solver v2)

Hard-Constraints sind **invariante Regeln**: keine Lösung darf sie
verletzen. Der Solver baut den Plan so dass sie immer erfüllt sind —
gar nicht erst durch Penalty-Bestrafung.

| #  | Constraint                                       | Realisierung                                          |
|----|--------------------------------------------------|-------------------------------------------------------|
| H1 | Pin-Slots fix                                    | Slot wird vor Construction belegt, nie verschoben     |
| H2 | Lehrer-Verfügbarkeit (`teacher.unavailable`)     | Slot-Filter beim Move-Generator                       |
| H3 | Kein Lehrer-Doppel (gleicher Lehrer, gleicher Slot, kein Coupling) | Slot-Filter                          |
| H4 | Kein Stufen-Doppel (gleiche Stufe, gleicher Slot, kein Coupling)   | Slot-Filter                          |
| H5 | Coupling-Cohesion (gleicher couplingId → gleicher Slot) | Coupling-Gruppe wird als Einheit verschoben      |
| H6 | Multi-Grade-Cohesion (Geschwister gleicher Occurrence → gleicher (day,period)) | Tupel werden zusammen verschoben |
| H7 | Wochenpattern (G/U) kompatibel                   | Slot-Filter                                           |
| H8 | Verschiedene Occurrences derselben Spec ≠ gleicher Slot | Slot-Filter                                    |
| H9 | Block-Pattern (`blocks=[2,1]` etc.)              | Block wird als Einheit konstruiert + gemoved          |

### Was *nicht* mehr Hard-Constraint ist

**`min_daily_slots ≥ 4` und `must_start_p1`** waren in v1 hart und haben
den Solver in lokale Minima getrieben. In v2 sind sie **Soft-Constraints
mit hohem Gewicht**:

- Solver findet immer eine Lösung (auch bei knapper Lehrer-Verfügbarkeit)
- Verletzungen sind **sichtbar** im Score-Breakdown, User sieht sie
- Local Search optimiert sie systematisch wenn möglich
- Bei strukturell unerfüllbaren Daten (z.B. zu wenig Stunden für ≥4/Tag)
  bekommt der Solver keinen UNSAT-Schock, sondern liefert die beste
  erreichbare Verteilung mit klarem Hinweis im Banner

---

## 5. Soft-Constraints und Score

Score = Summe gewichteter Penalty-Komponenten. Niedriger ist besser.

| Komponente              | Was sie misst                                    | Standard-Gewicht |
|-------------------------|--------------------------------------------------|------------------|
| `pen_min_daily`         | Anzahl (Tag, Stufe) mit < 4 Slots               | 500              |
| `pen_no_p1_start`       | (Tag, Stufe) aktiv aber P1 leer                 | 300              |
| `pen_main_aft`          | Hauptfächer in P7/P8                             | 200              |
| `pen_any_aft`           | Alle Fächer in P7/P8                             | 50               |
| `pen_no_free`           | Sandwich-Lücken pro (Tag, Stufe)                 | 200              |
| `pen_uneven_days`       | Variance der Slots/Tag pro Stufe                 | 150              |
| `pen_main_run`          | Hauptfach-Run > maxConsecutive                   | 100              |
| `pen_compact_teacher`   | Sandwich-Lücken pro (Tag, Lehrer)                | 30               |
| `pen_main_early`        | (Hauptfach-Periode−1) summiert                  | 2                |

**Begründung der neuen Gewichts-Hierarchie:**

In v1 dominierte `pen_main_early × 10 = 1680` den Gesamt-Score —
die Verteilungs-Penalties sind aber **wichtiger**. v2-Defaults stellen
das in die richtige Reihenfolge. Wichtigste Beobachtung: **`main_early`
soll ein Tie-Breaker sein, nicht der Haupt-Driver.** Standard-Gewicht 2
ist genug.

### Inkrementelle Score-Berechnung

**Kritisch für Performance.** Bei jedem Move müssen wir den Delta-Score
in O(1) oder O(log n) berechnen, nicht durch Vollscan aller Lessons.
Konkret: pro Soft-Constraint-Komponente eine Delta-Update-Formel.

Beispiel `pen_main_aft`:
```
move(lesson L from slot A to slot B):
  delta = 0
  if L.subject.isMain:
    if periodOf(A) >= afternoon_start: delta -= weight_main_aft
    if periodOf(B) >= afternoon_start: delta += weight_main_aft
  return delta
```

Pro Komponente eine ähnliche Funktion. Diese **Delta-Funktionen sind
das Herzstück** der Performance — ohne sie ist Local Search sinnlos.

---

## 6. Phase 1: Construction

**Ziel: erste valide Lösung in <5 Sekunden.**

### 6.1 Vorbereitung

- Pin-Slots aus `doc.placed[].pinned` laden, sind invariant
- Alle Lesson-Instances expandieren (count × grades × blocks)
- Lessons gruppieren in **Construction-Units**:
  - Solo-Lesson (1 Instance)
  - Block-Group (z.B. 2 Instances mit gemeinsamem block_id, müssen
    konsekutiv sein)
  - Multi-Grade-Tupel (Instances mit gleicher occurrence, verschiedenen
    grades, müssen denselben (day, period) belegen)
  - Coupling-Group (verschiedene Specs mit gleichem couplingId)
- **Eine Construction-Unit** = ein atomarer Platzierungs-Schritt

### 6.2 Sortierung nach Schwierigkeit

```
Score-Funktion difficulty(unit):
  +1000  pro gepinntem Sibling (sehr eingeschränkt)
  +500   wenn couplingId gesetzt (mehrere Lehrer parallel)
  +200   pro Multi-Grade-Sibling
  +100   wenn block_size > 1
  +30 × (40 − verfügbareSlotsForTeacher(unit.teacher))
       (eng-verfügbare Lehrer zuerst)
  +20    pro count beim Spec (vielbeschäftigte Specs zuerst)

Sortierung: difficulty absteigend
```

Begründung: Industriestandard "most-constrained-first". Wenn der
schwierigste Spec keinen Platz findet, müssen wir früh backtracken.

### 6.3 Slot-Auswahl pro Unit

Für jede Construction-Unit in der sortierten Reihenfolge:

```
1. Sammle alle (day, period)-Kombinationen die NULL Hard-Constraint
   verletzen (Slot-Filter durch H1–H9 oben)
2. Wenn leer → Ejection Chain (siehe 6.4)
3. Wenn nicht leer → Score jede Option mit Soft-Penalty-Delta
4. Wähle die beste mit kleinem Random-Tiebreaker (für Diversifikation)
5. Platziere die Unit, update Slot-Belegungs-Indizes
```

**Slot-Score in Construction:**
```
score_slot(unit, day, period) =
  − pen_main_aft_delta
  − pen_no_p1_start_delta   ← stark belohnt: P1 belegen
  − pen_min_daily_delta     ← stark belohnt: leerer Tag bekommt Stunden
  + small_random_tiebreaker
```

### 6.4 Ejection Chain (Konflikt-Repair)

Wenn keine Slot-Option ohne Konflikt existiert, lehne den Konflikt nicht
ab — versuche, die **blockierende(n) Unit(en)** zu verschieben:

```
ejectionChain(unit, depth=0, maxDepth=10):
  if depth > maxDepth: return false
  for each conflicting unit B at unit's preferred slot:
    if B is pinned: skip
    save B's current slot
    remove B from current slot
    try to find a non-conflicting slot for B (recursive call)
    if success:
      place unit at preferred slot
      return true
    else:
      restore B
  return false
```

Wenn Ejection nach maxDepth=10 nicht funktioniert: Restart der ganzen
Construction mit anderem Seed (Phase 1 retry).

### 6.5 Construction-Output

Wenn alle Units platziert: gültige Initiallösung mit Score X.
Wenn nach 5 Restarts kein Erfolg: liefere **partielle Lösung** zurück
(was platziert ist) plus Liste der **unplaced Specs**. UI zeigt das als
roten Fehler-Banner.

---

## 7. Phase 2: Local Search (Improvement)

**Ziel: Score sinken lassen so weit es geht. 10.000+ Iterationen/Sekunde.**

### 7.1 Move-Operatoren

Drei Operatoren werden zufällig (mit Wahrscheinlichkeiten) gewählt:

| Operator           | Wahrscheinlichkeit | Was passiert                          |
|--------------------|--------------------|---------------------------------------|
| **Slot-Move**      | 60 %               | Eine Unit zieht auf einen anderen Slot |
| **Slot-Swap**      | 35 %               | Zwei Units tauschen Slots             |
| **Kempe-Chain**    | 5 %                | Block-Tausch zwischen zwei Tagen      |

#### Slot-Move

Wähle zufällig eine Unit U und einen anderen Slot S.
Wenn S leer (nach H-Filter) → bewege U dorthin.
Wenn S belegt durch andere Unit V → Slot-Swap (siehe nächster Operator).
Wenn S Hard-Constraint-blockiert → verwerfe Move (kein Versuch zu repairen).

#### Slot-Swap

Wähle zwei Units U₁ und U₂. Tausche ihre Slots.
Vorab Hard-Constraint-Check: nach dem Swap müssen beide gültig sein.
Wenn ja → führe aus, evaluiere Score-Delta.

#### Kempe-Chain (Block-Tausch)

Speziell für Stundenplan-Diversifikation:
Wähle zwei Tage D₁, D₂ und eine Stufe G.
Tausche **alle** Lessons der Stufe G zwischen D₁ und D₂.
Hard-Constraint-Check nach dem Tausch. Wenn ungültig: revertieren.

Kempe-Chains entkommen lokalen Minima die Move/Swap nicht erreichen.

### 7.2 Acceptance: Hill-Climbing + Simulated Annealing

```
T = 100  (Start-Temperatur)
T_min = 0.1
cooling = 0.9995

iteration:
  move = generate_move()
  delta = evaluate_score_delta(move)
  if delta < 0:
    accept (Score sinkt)
  else if random() < exp(-delta / T):
    accept (Simulated Annealing — manchmal höher gehen)
  else:
    revert
  T *= cooling
  if T < T_min: T = T_min
```

Standardparameter aus Hertz et al. (Tabu Search Metaheuristik):
T_start=100, T_min=0.1, cooling=0.9995, ~50.000 Iterationen für eine
Konvergenz auf unserer Größe.

### 7.3 Tabu-Liste (verhindert Oszillation)

Nach jedem akzeptierten Move: füge `(unit_id, old_slot)` zur Tabu-Liste
für die nächsten 50 Iterationen. Solange in Tabu, kann diese Unit nicht
zurück zu old_slot.

### 7.4 Best-Solution-Tracking

Solver merkt sich die **beste je gesehene Lösung** (nicht nur die
aktuelle). Bei `abort()` oder Phase-Ende wird die beste zurückgegeben,
nicht die zuletzt akzeptierte.

---

## 8. Phase 3: Restart + Diversification

**Wenn der Score 30 Sekunden lang nicht mehr sinkt:**

```
1. Speichere aktuelle beste Lösung
2. Perturbation: 20 % aller (nicht-pinned) Units zufällig neu platzieren
3. Mini-Construction-Repair für die neu-platzierten
4. Restart Local Search von dort
5. Wenn neue beste Lösung gefunden → übernehmen
6. Wenn nicht → behalte alte beste, weiter perturben
```

Iterated Local Search ist der Industriestandard. SciELO-Paper berichtet
15–338× Speedup gegenüber exakten Methoden, 3.5–7.7 % vom Optimum.

---

## 9. Streaming-Architektur

Solver v2 läuft **direkt im Main Thread** des Browsers (kein Worker
nötig — TypeScript-Code in Sekundenbruchteilen pro Iteration).

Aber: bei 10.000 Iterationen/Sekunde will man die UI nicht blockieren.
Lösung:

```
loop:
  do 100 iterations
  await microtask (yields to UI)
  if best score changed: emit('solution', { placed, score, ...})
  if abort signal: break
```

Damit:
- UI bleibt responsive
- Live-Score-Updates alle ~10 ms
- Abbrechen ist sofortig (next microtask)

### Optional: Web Worker

Für große Schulen (500+ Lessons) würde ein Web Worker Sinn machen,
um den Main Thread komplett freizuhalten. Bei MS-SiG-Größe (128 Lessons)
ist das nicht nötig.

**Entscheidung Phase 1:** kein Worker, Microtask-Yield reicht.

---

## 10. Performance-Erwartungen

Auf der echten `Liste.csv` (52 Specs, 128 Instanzen, 4 Stufen):

| Phase                | Zeit            | Output                                    |
|----------------------|-----------------|-------------------------------------------|
| Construction         | < 1 s           | Valide Initiallösung mit Score ~5000      |
| Local Search 30 s    | 300.000 Iter    | Score auf ~2000 (60 % Reduktion)          |
| Local Search 5 min   | 3.000.000 Iter  | Score auf ~1500 (Plateau bei guten Daten)  |
| Local Search 30 min  | (kaum besser)   | < 5 % weitere Verbesserung                 |

Vergleich zum jetzigen Stand mit MiniZinc: erste Lösung in **14 s**,
Score-Reduktion in 5 min: minimale 4925 → 4765 (3 %).

**Erwarteter Speedup**: 50–100× in „Score-Verbesserungs-Rate pro Sekunde".

---

## 11. Validation und Tests

### 11.1 Unit-Tests

Pro Modul:

- `score.ts` → Score-Komponenten korrekt; Delta-Funktionen liefern
  dasselbe wie Vollscan auf 100 random Konfigurationen
- `moves.ts` → Move-Generator liefert nur Hard-Constraint-konforme Moves
- `construct.ts` → 100 random Specs-Konfigs → Construction findet eine
  Lösung in < 5 s
- `localsearch.ts` → 1000 Iterationen senken Score deterministisch (mit
  fixiertem Seed)

### 11.2 Integration-Tests gegen Liste.csv

- Lade Sokrates-Fixture, run Construction → muss Lösung mit Score < 6000
  liefern
- Run Local Search 30 s → Score muss < 2500 sinken
- 100 verschiedene Seeds → 95 % davon erreichen Score < 3000

### 11.3 Regression-Tests gegen MiniZinc-Lösung

Wir behalten die bisherige Liste-DZN als Vergleich. Jede neue Lösung
des v2-Solvers muss in den **Hard-Constraints** mit der MiniZinc-Lösung
strukturell übereinstimmen (gleiche Slot-Belegung möglich).

### 11.4 Vergleichs-Benchmark

Skript `benchmark.ts`:
- Lädt Liste.csv
- Run v2-Solver für 60 s
- Output: Score-Trajektorie als CSV → für Vergleich gegen MiniZinc

---

## 12. UI-Integration

Bestehende UI bleibt **unverändert**. SolveDialog.svelte zeigt:

- Phase-Indicator: "Construction" (1/3), "Optimieren" (2/3), "Diversifizieren" (3/3)
- Score-Verlauf mit Mini-Sparkline
- Score-Aufschlüsselung nach Komponenten
- Abbrechen-Button (sofortig)
- DZN-Export wird zu **JSON-Dump-Export** (Solver-Snapshot für Debug)
- Solver-Log bleibt — wir loggen Phase-Transitions, Konvergenz-Events,
  Restart-Events

`startSolve(doc, opts)` API bleibt. Aufrufer merkt nichts vom Backend-Wechsel.

---

## 13. Migration und Rollout

### 13.1 Implementierungs-Reihenfolge

1. **Skelett**: Module anlegen, Type-Stubs schreiben — Tests rot
2. **Score & Delta-Funktionen**: Vollscan + Delta-Update + Tests grün
3. **Move-Generator**: 3 Operatoren mit Hard-Constraint-Check + Tests
4. **Construction**: Greedy mit Sortierung + Ejection Chain + Tests
5. **Local Search**: Hill-Climbing + SA + Tabu + Tests
6. **Restart-Logik**: Diversifikation + Tests
7. **Service-Wrapper**: gleiche `startSolve()`-API wie v1
8. **UI-Integration**: SolveDialog mit neuem Service
9. **MiniZinc entfernen**: npm-Dep raus, WASM-Files raus, alte Files löschen
10. **CHANGELOG + Phasen-Status update**

### 13.2 Rückfall-Strategie

**Während Implementierung:** beide Solver parallel hinterlegen, Toggle
in dev-mode. Nicht in der UI sichtbar — nur via `localStorage.solverV2 = '0'`.

**Nach Migration:** alte v1-Files in `_attic/`-Branch entfernen, nicht
löschen. Falls v2 unerwartet kollabiert, kann v1 in einer Stunde
zurückgeholt werden.

### 13.3 Nicht-Ziele für Phase 11 (v2 erste Version)

Diese Features bleiben **explizit out-of-scope** der ersten v2-Version:

- **Variantenmodus** (mehrere Pläne nebeneinander) — kommt in Phase 12
- **Per-Stufen-Constraints** (Stufe 5 max bis P5) — Phase 12
- **Print-Layout** — separater Track
- **Hot-Start** mit existierender Lösung als Initial — Phase 12
- **Multi-Worker-Parallelismus** — Phase 13 (nur falls > 500 Lessons)

---

## 14. Risiken und Annahmen

### Risiko 1: Score-Modellierung treibt schlechte Pläne

**Symptom:** Solver erreicht Score 1500, aber Plan sieht für Geo
schlecht aus (z.B. Hauptfach am Nachmittag bei einer Stufe).

**Mitigation:** Score-Komponenten + Gewichte sind **konfigurierbar** über
das bestehende `RulesPanel`. User kann live justieren. Score-Breakdown
zeigt welche Komponente den Score treibt.

### Risiko 2: Local Search bleibt in Plateau hängen

**Symptom:** Score sinkt 30 s lang nicht mehr, aber visuell offensichtlich
suboptimal.

**Mitigation:** Phase 3 (Restart + Diversification). Zusätzlich:
"Mehr-Iterationen"-Button im UI lässt User explizit weitersuchen.

### Risiko 3: Performance-Erwartung verfehlt

**Symptom:** Statt 10.000 Iter/sec nur 1.000.

**Mitigation:** Profiling während Phase-2-Implementierung. Hot-Path
muss inkrementelles Score-Update sein — wenn das nicht O(1) bleibt,
neu modellieren.

### Annahme 1: TypeScript ist schnell genug

Auf 4-Kern-CPU mit V8 erreicht typische TS-Code 100M ops/sec.
Inkrementelles Score-Update mit ~20 ops pro Move = 5M Moves/sec
theoretisch. Realistisch mit GC und Cache-Misses: 50.000–500.000
Moves/sec. Mehr als genug.

### Annahme 2: Datenmodell skaliert

Phase 8/9-Schemas (PlacedLesson.grade, couplingId) sind kompatibel
mit v2. Keine Schema-Migration nötig.

---

## 15. Erfolgskriterien

Solver v2 ist erfolgreich wenn:

1. ✅ Auf der `Liste.csv` findet er in **< 5 s** eine valide Erstlösung
2. ✅ In **30 s** Local Search erreicht er Score < 2500 (vs MiniZinc 4765
   nach 5 min)
3. ✅ Bei `min_daily=4` und `must_start_p1=true` findet er trotzdem
   gültige Lösungen (kein Plateau-Tod)
4. ✅ Plan ist **pädagogisch vernünftig**: Mo–Fr ausgewogen, kaum
   Hauptfach Nachmittag, kaum Klassen-Freistunden
5. ✅ User abbricht in 1 s + sieht beste bisherige Lösung
6. ✅ Bundle-Size schrumpft um ~17 MB (kein WASM mehr)
7. ✅ Tests grün (Construction, Local Search, Score, Moves, E2E)

Wenn Punkte 3–4 nicht erreicht werden, **rollback zu MiniZinc**. v1 bleibt
in `_attic/` als Sicherheits-Branch.

---

## 16. Glossar

| Begriff               | Bedeutung                                                |
|-----------------------|----------------------------------------------------------|
| Construction-Unit     | Atomarer Platzierungs-Schritt (Lesson, Block, Tupel, Coupling-Group) |
| Hard-Constraint       | Invariante Regel — niemals verletzbar                    |
| Soft-Constraint       | Penalty-Komponente — Verletzung zählt im Score           |
| Score                 | Summe gewichteter Penalty-Komponenten (niedriger besser) |
| Score-Delta           | Score-Änderung durch einen einzigen Move                 |
| Hill-Climbing         | Akzeptiere Move nur wenn Score sinkt                     |
| Simulated Annealing   | Akzeptiere Score-Anstieg mit T-abhängiger Wahrscheinlichkeit |
| Tabu-Liste            | Verbiete kürzlich gemachte Moves rückgängig zu machen    |
| Ejection Chain        | Rekursives Verschieben blockierender Units (FET-Begriff) |
| Kempe-Chain           | Block-Tausch zwischen zwei Tagen für eine Stufe          |
| Iterated Local Search | Hill-Climbing → Plateau → Perturbation → Hill-Climbing → … |
