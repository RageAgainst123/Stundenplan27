# ADR-0011: Tagespensum + „Doppel ⇒ kein Einzel am gleichen Tag"

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Erster echter Smoke-Test mit dem Phase-8-Solver auf der vollen Sokrates-
`Liste.csv` zeigte zwei pädagogisch falsche Verhaltensweisen, die das
Modell bisher nicht abdeckte:

1. **Mo–Mi voll bis P8, Do/Fr fast leer.** Der Solver packte alle Stunden
   in die ersten drei Wochentage, weil das aus seiner Sicht kostenlos
   war. Die einzige existierende Verteilungs-Penalty (`pen_no_free`)
   bestrafte nur Sandwich-Freistunden, nicht ganze leere Tage.

2. **Doppelstunde + zusätzliche Einzelstunde am selben Tag derselben
   Spec.** Z. B. D Stufe 5 Mo P5+P6 (Doppel) UND Mo P8 (Einzel). Das
   widerspricht der MS-SiG-Konvention „eine Doppelstunde bedeutet die
   andere(n) Stunde(n) sind an anderen Tagen".

Zusätzlich war der Nachmittag (P7+P8) nur für Hauptfächer „teuer" — für
Nebenfächer kostete er nichts, also füllte der Solver dort gerne die
Vormittags-Lücken.

## Entschieden

Drei Modell-Erweiterungen, alle mit User-Approval (Recommended-Variante):

### 1. Hartes Tagespensum (Constraint 10)

```minizinc
constraint forall (d in 1..D, g in 1..G) (
  sum(l in LESSON) (
    bool2int(dayOf(assign[l]) = d /\ gradeOf(assign[l]) = g)
  ) >= min_daily_slots
);
```

Default `min_daily_slots = 4`. Konfigurierbar in `ConstraintConfig.minDailySlotsPerGrade`.
Bei UNSAT lockert die Auto-Relaxation auf 3 oder 0 (siehe unten).

### 2. Hartes „Doppel ⇒ kein Einzel" (Constraint 11)

```minizinc
constraint forall (l1, l2 in LESSON where l1 < l2 /\
                  lesson_spec_id[l1] = lesson_spec_id[l2] /\
                  lesson_occ_idx[l1] != lesson_occ_idx[l2] /\
                  gradeOf(assign[l1]) = gradeOf(assign[l2])) (
  dayOf(assign[l1]) = dayOf(assign[l2])
    -> abs(periodOf(assign[l1]) - periodOf(assign[l2])) = 1
);
```

Lesart: „Wenn zwei Lesson-Instanzen derselben Spec UND der selben
Grade-Spalte aus VERSCHIEDENEN Occurrences am gleichen Tag landen, müssen
sie konsekutive Perioden sein (= eine zusammenhängende Doppelstunde)."

Dadurch wird ein Doppel-Pattern automatisch zur einzigen Spec-Belegung
des Tages — keine zweite Einzelstunde dazu möglich. Multi-Grade-
Geschwister derselben Occurrence sind über `occ_idx`-Filter ausgespart
(sie sind EINE pädagogische Stunde).

### 3. Soft-Constraint „auch Nebenfächer am Nachmittag vermeiden"

Neuer Penalty-Term `pen_any_aft` mit Default-Gewicht 15 (deutlich unter
Hauptfächer-Gewicht 50). Macht den Nachmittag generell „teuer", sodass
der Solver die Nebenfächer auch am Vormittag verteilt. UI-Toggle als
Sub-Eintrag unter „Hauptfach nicht am Nachmittag".

### 4. Dreistufige Auto-Lockerung in `service.ts`

Bei UNSAT versucht der Solver der Reihe nach:

1. Lauf 1: alles wie konfiguriert
2. Lauf 2: strikte Block-Patterns auf Auto
3. Lauf 3: zusätzlich `min_daily_slots = 3`
4. Lauf 4: zusätzlich `min_daily_slots = 0`

UI meldet welche Lockerung aktiv war.

## Verworfen

- **Soft-Constraint statt hart fürs Tagespensum:** der User wollte
  ausdrücklich „hart, ≥4 Stunden". Eine reine Penalty hätte zu unzuverlässig
  gegriffen (Solver hätte gegen einzelne Tage Penalty „bezahlt" um andere
  Constraints zu erfüllen).

- **„Höchstens 1 Slot pro Spec pro Tag":** zu rigide. Eine Spec mit count=4
  und Auto-Modus muss eine Doppelstunde bilden dürfen, das wären dann 2
  Slots am gleichen Tag. Variante (b) aus der Recherche („gleicher Tag ⇒
  konsekutiv") generalisiert sauber sowohl auf Auto-Modus (Doppel oder
  zwei separate Tage) als auch auf strikte Patterns (`[2,1]` → Doppel an
  Tag X + Einzel an Tag Y).

- **Block-Erkennung über `lesson_block_id`:** wäre Constraint-11-Variante
  (a) gewesen. Komplexer zu formulieren weil Block-IDs nur im Strikt-Modus
  belegt sind. Variante (b) braucht den Block-Status nicht.

## Konsequenzen

**Pro:**
- Generierte Pläne sind pädagogisch realistisch verteilt: jeder Tag aktiv,
  keine Doppel+Einzel-Splits.
- Nachmittag wird nur in Ausnahmefällen befüllt (wie gewünscht).
- Auto-Lockerung greift bei zu strenger Konfig automatisch — kein
  „UNSAT-Schock" für den User.

**Kontra:**
- Constraint 10 ist O(D × G × L) — bei L=155 noch handhabbar, aber bei
  größerer Schule beobachten.
- Constraint 11 ist O(L²) und feuert bidirektional über Lesson-Pairs der
  gleichen Spec. Bei L=155 und vielen Multi-Stundenern (z. B. D mit
  count=4) entstehen viele Pairs. Solver-Zeit könnte steigen — wenn > 60s
  auf voller Liste, müssen wir P3/P4/P5 (Soft-Constraints) im Gegenzug
  vereinfachen.
- Edge case: strikte `blocks=[1,1,1,1,1,1]` mit 6 Singles bei nur 5
  Wochentagen wird unmöglich. `diagnose.ts` warnt.

**Folge-Entscheidungen:**
- Phase 9b könnte ein UI für stufen-spezifische Tagesgrenzen anbieten
  („Stufe 5 max bis P5, Stufe 8 bis P8"). Vorerst out of scope.
- Wenn die O(L²)-Komplexität von Constraint 11 zum Bottleneck wird:
  Aggregate über `count_per_(spec, day)`-Hilfsvariable einführen. Heute
  pragmatisch belassen.
