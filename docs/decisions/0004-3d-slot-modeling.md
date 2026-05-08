# ADR-0004: Solver-Slot — 3D `(day, period, grade)`

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

In der initialen Solver-Implementierung (Phase 5a) war ein Slot 2D:
`(day, period)` = 5×8 = 40 Stück. Eine Lesson-Instance bekam einen Slot,
und Constraint 4 sagte: zwei Lessons im selben Slot brauchen denselben
`groupKey`.

Das ist zu strikt fürs Mehrstufen-Modell der MS SiG: An einem Mittwoch in
der 3. Stunde haben **alle 4 Stufen** etwas zu tun (Mathe für 5., Deutsch
für 6., Englisch für 7., Werken für 8.). 4 verschiedene Specs ohne
Kopplung müssen denselben (day,period) belegen — das brach Constraint 4
und führte zu UNSAT bei jedem realen Datensatz.

## Entschieden

**Slot ist 3D**: `(day, period, grade)` = 5×8×4 = **160 Slots**. Jede
Stufen-Spalte ist ein eigener Slot. Constraint 4 verbietet Doppelbelegung
desselben 3D-Slots, was die natürliche Semantik ist.

Helper in `encode.ts`:
- `slotFromDPG(day, period, grade) → 1..160`
- `dpgFromSlot(slot) → {day, period, grade}`

## Verworfen

- **Slot bleibt 2D, gradesSet-Constraint hinzufügen:** Komplexes
  Set-Intersection-Constraint, schwer zu lesen, schlechtere Solver-Performance.
- **4D-Slot mit Wochen-Pattern:** Würde Slots × 2 verdoppeln, der Solver
  würde langsamer. Wochen-Pattern als separater `lesson_week`-Constraint
  macht es einfacher.

## Konsequenzen

**Vorteile:**
- Constraint-Modell wird radikal einfacher (Constraint 4 = 3 Zeilen).
- UNSAT verschwindet bei realistischen Eingaben.
- Mehrstufen-Lessons modellieren wir per `groupKey`: Specs mit `grades=[5,6]`
  und Kopplung erzeugen 2 Lesson-Instanzen, die alle mit gleichem
  occurrence-`groupId` an dieselbe `(day,period)` gebunden werden, aber
  verschiedene `grade`-Spalten belegen.

**Kosten:**
- `PlacedLesson` braucht eigentlich auch ein `grade`-Feld; aktuell hat es das
  nicht (offener Bug, siehe `docs/REQUIREMENTS.md` Phase 7).
- Encoding wird größer: pro Spec mit `count=4, grades=[5,6]` entstehen
  4×2=8 Lesson-Instanzen. Bei 52 Specs der Liste.csv sind es ~250+ Instanzen.
  Solver-Performance ist trotzdem gut (~25 s).

## Folge-Entscheidungen

- DZN-Output wickelt `teacher_blocked` als `array3d(T, D, P)` (auf Tag/Periode-
  Ebene, nicht pro Stufe — Lehrer-Verfügbarkeit ist stufen-agnostisch).
- `lesson_grades` bleibt als Set für historische Kompatibilität, wird aber
  pro Instanz auf 1 Element reduziert (single-grade-Set).
