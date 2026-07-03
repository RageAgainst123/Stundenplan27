# Datenmodell + Solver-Struktur

> **Zweck dieser Datei:** *Quelle der Wahrheit* für die Struktur. Wenn du wissen
> willst, *wie* der Solver arbeitet, lies `docs/SOLVER-V2-CONCEPT.md`. Wenn du
> wissen willst, *was* er an Daten hat, lies hier.
>
> **Update-Anlass:** Änderungen an `src/lib/types.ts` (`LessonSpec`,
> `ConstraintConfig`, Schema-Version), an `src/lib/solver-v2/types.ts`
> (`Unit`, `ScoreBreakdown`, `ScoreWeights`), oder an den 10 Hard-Constraints in
> `src/lib/solver-v2/hardCheck.ts`. Bei jeder solchen Änderung: prüfe ob die
> Tabellen unten noch stimmen. Drift hier ist teuer (Bug-Quelle), Drift in
> SOLVER-V2-CONCEPT ist akzeptabler (Konzept ≠ Implementation).

---

## 1. Domänenmodell (UI/Persistenz-Schicht)

```
ScheduleDoc                         ← localStorage / JSON-Backup
├── schoolYear: string
├── teachers: Teacher[]
│   └── unavailable: AvailabilityCell[]      (hart: Solver darf nicht hin)
├── subjects: Subject[]
│   └── maxConsecutive: number              (für main_run-Score)
├── specs: LessonSpec[]                      ← die "Lerneinheiten"
│   ├── teachers: TeacherId[]               (1, 2, 3+ — Team-Teaching)
│   ├── grades: GradeLevel[]                (1 oder mehrere — Multi-Grade)
│   ├── couplingId?: string                 (≥2 Specs same id = parallel, GETRENNTE Gruppen)
│   ├── teachingSegments?: TeachingSegment[](Phase 17: Team-Teaching Aufteilung
│   │     pro Lehrer-Subset, gemeinsamer Unterricht)
│   ├── timePref?: 'early' | 'late'         (Soft, optional)
│   ├── afternoonAllowed?: 'never'|'allowed'|'preferred' (Phase 13)
│   ├── blocks?: BlockPattern               ([2,2] = 2 Doppelstunden)
│   ├── count: number                       (Wochenstunden total)
│   └── weekPattern: 'every'|'even'|'odd'   (G/U-Wochen)
├── placed: PlacedLesson[]                   ← der eigentliche Plan
│   ├── (specId, day, period, grade)        (eindeutig pro Pinned)
│   └── pinned: boolean                     (true = Solver darf nicht bewegen)
├── constraints: ConstraintConfig            ← Soft-Constraint-Gewichte
└── meta: { schemaVersion: 4, lastModified }

Beziehungen:
LessonSpec.teachers[i]  → Teacher.id     (Mehrfach-Beziehung)
LessonSpec.subject       → Subject.code   (1:1)
PlacedLesson.specId     → LessonSpec.id  (1:n — eine Spec hat count×grades Placements)
```

**Wichtig:** `PlacedLesson` ist die "flache" Ansicht für UI/Drag-Drop. Der Solver
arbeitet intern mit `Unit`s (siehe §2), eine Unit kann mehrere `PlacedLesson`s
erzeugen.

### Multi-Grade & Coupling — wie aus 1 Spec mehrere Placements werden

Eine `LessonSpec` mit `count=4, grades=[5,6], blocks=[2,2]` ergibt:
- 2 Block-Units (1 Doppelstunde × 2 Stufen-Slots = je eine Unit pro Doppelstunde)
- jede Unit hält **2 Instances pro Block-Position × Grade** = 4 Instances pro Unit
- Decode → 8 `PlacedLesson` (4 Stunden × 2 Stufen)

Eine **Coupling** aus zwei Specs S1+S2 (`couplingId: 'X'`, je `count=1, grades=[7,8]`):
- 1 Coupling-Unit hält Instances aus **beiden** Specs
- Decode → 4 `PlacedLesson` (2 Specs × 2 Stufen, alle im selben Slot)

### Team-Teaching mit Segmenten (Phase 17)

Eine `LessonSpec` mit `teachingSegments` wird **vor** der Unit-Expansion in N
Pseudo-Specs aufgesplittet (eine pro Segment), jede mit eigenem `teachers[]` und
`count = segment.hours`. Beispiel `M Stufe 5, count=4, teachers=[A,B,C]`:

```ts
teachingSegments: [
  { hours: 2, teachers: [A, B, C] },  // alle drei
  { hours: 1, teachers: [A, C] },      // C zusätzlich
  { hours: 1, teachers: [A] }          // allein
]
```

Wird im Solver zu **3 separaten Pseudo-Specs** mit gleicher `spec.id` aber
unterschiedlichen Teams. Hard-Constraints H2/H3 greifen über `Unit.teacherIds`
unverändert. Die Original-`spec.teachers` (alle Lehrer) bleibt für UI-Anzeige.

**Abgrenzung zu Coupling:**
- **Coupling** = parallele Stunden in **getrennten Räumen** (BSP K/M)
- **Team-Teaching** = gemeinsamer Unterricht in **einem Raum** (Hauptlehrer +
  Stütz-Lehrer in einigen Stunden)
- Beide können kombiniert werden: zwei Team-Teaching-Specs können koppeln

**Solver-Effekt:** transparent — `expandSegmentedSpecs()` in `units.ts` macht
die Aufteilung, restlicher Code unverändert. `teachingSegments=undefined` =
Verhalten wie vor Phase 17.

**Validation:** `validateTeachingSegments()` in `types.ts` prüft:
`sum(segments.hours) === count`, jeder Segment-Lehrer in `spec.teachers`,
Segmente nicht leer.

---

## 2. Solver-internes Modell (`solver-v2/types.ts`)

```
SolverState                            ← built fresh per solve, not persisted
├── doc: ScheduleDoc                  (read-only Backreferenz)
├── nUnits: number                    (atomare Platzierungs-Einheiten)
├── units: Unit[]                     (indexiert via Unit.idx)
├── placement: Int32Array             (placement[unit.idx] = packed slot id, -1=unplaced)
├── unitsBySpec:    Map<specId,    Unit[]>   (für H8 Same-Spec-Check)
├── unitsByTeacher: Map<teacherId, Unit[]>   (für H3, compact_teacher)
├── specsById:      Map<specId,    LessonSpec>
├── subjectsByCode: Map<code,      Subject>
├── teachersById:   Map<teacherId, Teacher>
└── scoreScratch?:  ScoreScratch   (lazy, R2-Schritt 2: wiederverwendete
                                    Score-Puffer + statische Per-Unit-Caches;
                                    von ensureScratch() in score.ts befüllt —
                                    computeScore alloziert seitdem nichts mehr
                                    außer dem Breakdown-Objekt)

Slot-Encoding: slot = dayIndex * 8 + (period - 1).      Range 0..39.
slotFromDP(d, p), dpFromSlot(s) in solver-v2/types.ts.

Unit.kind ∈ {'solo', 'multigrade', 'block', 'coupling'}
- solo:       1 Instance, 1 Grade, blockSize=1
- multigrade: ≥2 Instances mit demselben occurrenceIndex, verschiedene Grades
- block:      ≥2 Instances mit demselben blockId, konsekutive blockPos 0..N-1
- coupling:   ≥2 Instances aus verschiedenen Specs (gleiche couplingId)
```

### `Unit.teacherIds` vs. `Unit.teacherId`

- `teacherId` (singular) — **primärer** Lehrer, für UI-Labels und Stable-Cache-Keys
- `teacherIds` (Array) — **alle** Lehrer der Unit (Coupling kann mehrere haben)
- **Hard-Constraints H2/H3 iterieren über `teacherIds`** (nicht nur teacherId!)
  damit Coupling-Lehrer korrekt geblockt werden

---

## 3. Score-Komponenten (alle 21)

Alle in `src/lib/solver-v2/score.ts` berechnet, Final-Sum als Summe gewichtet.
**Default-Gewichte stammen aus `DEFAULT_CONSTRAINTS` in `src/lib/types.ts`**;
`defaultWeights(doc)` in `solver-v2/types.ts` mappt sie auf `ScoreWeights`.

| Komponente         | Was sie zählt                                                              | Default | Quelle in `ConstraintConfig`                       | Wann 0       |
|--------------------|----------------------------------------------------------------------------|---------|---------------------------------------------------|--------------|
| `min_daily`        | (day,grade) mit weniger als minDailySlots Stunden — fehlende Slots         | 500     | `minDailyWeight` (Top-Level)                      | minDaily=0   |
| `no_p1_start`      | (day,grade) aktiv aber P1 leer                                             | 300 (×50 strict) | `mustStartFirstPeriod.{enabled, weight}`   | enabled=false|
| `main_aft`         | Hauptfach-Lesson in P ≥ afternoonStart                                     | 200     | `noMainSubjectAfternoon.{enabled, weight}`        | enabled=false|
| `any_aft`          | irgendeine Lesson in P ≥ afternoonStart                                    | 50      | `noMainSubjectAfternoon.{applyToAllSubjects, weightAllSubjects}` | applyToAll=false |
| `no_free`          | Sandwich-Lücken + führende Lücken pro (day,grade)                          | 200×50  | `noFreePeriodsForClass.{enabled, weight, strict}` | enabled=false|
| `uneven_days`      | AKTIVE (day,grade) unter Tagespensum-Ziel — fehlende Slots. Leere Tage exempt (Audit-Fix). | 150 | `unevenDaysWeight` (Top-Level)          | enabled via Gewicht 0 |
| `main_run`         | Hauptfach-Folge länger als `maxConsecutiveMain.max`                        | 40      | `maxConsecutiveMain.{enabled, weight, max}`       | enabled=false|
| `compact_teacher`  | Sandwich-Lücken pro (teacher,day) — **quadratisch**: N Lücken/Tag = N². 1=1, 2=4, 3=9 | 80 | `compactTeacherDays.{enabled, weight}`            | enabled=false|
| `main_early`       | Hauptfach: sum(period-1) — Tie-Breaker für früher                          | 2       | `preferMainEarly.{enabled, weight}`               | enabled=false|
| `time_pref`        | Spec mit `timePref`: lin. Distanz zum Wunsch-Pol (P1 oder P8)              | 100     | `timePrefWeight` (Top-Level)                      | keine timePref-Specs |
| `subject_twice`    | (day,grade,subject) mit Count > 1                                          | 60      | `subjectMaxOncePerDay.{enabled, weight}`          | enabled=false|
| `spec_spread`      | (specId,day) mit ≥2 Occurrences — Lerneinheit-Spread über Wochentage       | 30      | `preferDoubleLessonsContiguous.{enabled, weight}` (Feldname Legacy) | enabled=false|
| `teacher_late_start` | sum(firstP-Index) über alle (Lehrer, Tag) — Lehrer in P1 gesperrt sind exempt | 30 | `teacherEarlyStartBalance.{enabled, weight}`     | enabled=false|
| `teacher_under_min` | sum(min - lessons) für (Lehrer, Tag) wo `0 < lessons < min`. Freie Tage (0 lessons) sind exempt. | 150 | `teacherMinLessonsPerDay.{enabled, weight, min}` | enabled=false oder Lehrer hat ≥min an jedem aktiven Tag |
| `target_daily`     | (day,grade) `(actual - target)²` — quadratische Abweichung vom Zieltagespensum. Inaktive Tage (0 lessons) exempt. | 80 | `targetDailyLessons.{enabled, weight, target}` | enabled=false |
| `afternoon_preferred` | Spec mit `afternoonAllowed='preferred'` liegt im Vormittag (P<7) — Penalty pro Vormittag-Slot. Inverse zu any_aft. | 250 | `afternoonPreferred.{enabled, weight}` (Phase 18) | enabled=false oder keine 'preferred'-Specs |
| `main_twice`       | (day,grade,Hauptfach) mit ≥3 Vorkommen — je Vorkommen über 2 hinaus +1     | 800 (fix) | — (hardcoded in defaultWeights)                  | keine 3×-Häufung |
| `main_block_split` | Hauptfach genau 2× am (day,grade): Anzahl Leerslots zwischen den Blöcken  | 60 (fix)  | — (hardcoded in defaultWeights)                  | konsekutiv oder ≠2 Vorkommen |
| `teacher_gap_fairness` | Σ pro Lehrer (Wochen-Springstunden)² — Lücken sollen nicht bei einem Lehrer klumpen. 1×5 Lücken = 25 vs 5×1 = 5. | 15 | `teacherGapFairness.{enabled, weight}` (Solver-Opt S3) | enabled=false oder keine Lücken |
| `teacher_days_present` | Σ pro Lehrer max(0, Anwesenheitstage − ceil(Wochenstunden/6)) — Teilzeit-Konzentration | 120 | `teacherDaysPresent.{enabled, weight}` (Solver-Opt S3) | enabled=false oder alle im Ideal |
| `teacher_lunch`    | (teacher,day) mit ≥6h, Vormittag+Nachmittag-Unterricht UND P5+P6 beide belegt | 100, **Default AUS** | `teacherMiddayBreak.{enabled, weight}` (Solver-Opt S3) | enabled=false (Default!) |
**Ausnahmen / Spezialfälle:**
- `time_pref='late'`-Specs sind exempt von `main_aft`, `any_aft`, `main_early`
  (User hat explizit Nachmittag gewünscht — kein Widerspruch). Gleiches gilt
  für `afternoonAllowed='preferred'` und `'must'`.
- `no_free` kennt einen **strict-Modus**: Gewicht wird ×50 multipliziert in
  Phase 1 des 2-Phase-Solve. Phase 3 läuft mit normalem Gewicht falls Lücken
  unvermeidbar (`RelaxationInfo.noFreeRelaxed=true`).
- `teacherMiddayBreak` heißt bewusst NICHT `teacherLunchBreak` — Letzteres ist
  ein Phase-12-Legacy-Feld, das die Migration in persistence.ts LÖSCHT.

### Wenn du eine neue Score-Komponente hinzufügst

1. Feld zu `ScoreBreakdown` und `ScoreWeights` in `solver-v2/types.ts`.
2. Berechnung in `score.ts` `computeScore()`, Final-Sum-Zeile mit erweitern.
3. Default-Gewicht in `defaultWeights()` mappen, idealerweise aus
   `ConstraintConfig` (nicht hartcodiert).
4. Migration in `persistence.ts` falls neues Feld in `ConstraintConfig`.
5. UI in `RulesPanel.svelte` (Toggle + Gewicht-Input) **und** in
   `GenerateButton.svelte` (Score-Aufschlüsselung).
6. Mindestens 1 Unit-Test in `score.test.ts`.
7. **Diese Tabelle erweitern.**

---

## 4. Hard-Constraints (H1–H10)

Alle in `src/lib/solver-v2/hardCheck.ts` zentral geprüft. `wouldViolate(state, unit, slot)`
gibt `null` zurück wenn ok, sonst Reason-String.

| ID  | Name                       | Wo geprüft                                | Wo getestet                                          |
|-----|----------------------------|-------------------------------------------|------------------------------------------------------|
| H1  | Pinned: Unit ist nicht movable | `wouldViolate` ZL ~40                  | `moves.test.ts > pinned`                            |
| H2  | Lehrer-Verfügbarkeit (alle teacherIds) | `wouldViolate` ZL ~54-62          | `moves.test.ts > teacher availability`              |
| H3  | Lehrer-Doppel (Schnittmenge teacherIds, kein sameCoupling) | `wouldViolate` ZL ~88-94 | `moves.test.ts > teacher and grade collisions`     |
| H4  | Stufen-Doppel (Schnittmenge grades, kein sameCoupling) | `wouldViolate` ZL ~97-101  | `moves.test.ts > teacher and grade collisions`     |
| H5  | Coupling-Cohesion (Specs same couplingId teilen Slot) | **implizit** in `units.ts` `buildState` (eine Coupling-Unit für alle gekoppelten Specs) | `moves.test.ts > coupling team teachers` |
| H6  | Multi-Grade-Cohesion (selbe occurrence, verschiedene grades, gleicher Slot) | **implizit** in `units.ts` (eine Multigrade-Unit pro Occurrence) | `score.test.ts` Multi-Grade-Tests |
| H7  | Wochenpattern-Kompatibilität (even ↔ odd nur in Coupling) | `wouldViolate` ZL ~106-113 | (indirekt in coupling-Tests)                       |
| H8  | Distinct-Occurrences (gleiche Spec, verschiedene Occurrences ≠ gleicher Slot) | `wouldViolate` ZL ~118-136 | `moves.test.ts > same-spec collision`         |
| H9  | Block-Pattern (blockSize > 1 = konsekutive Periods) | **implizit** in `units.ts` (Block-Unit hat blockSize, `wouldViolate` prüft dass period+blockSize-1 ≤ P) | (implizit in vielen Tests)               |
| H10 | Hauptfach Nachmittag verboten: `unit.afternoonAllowed='never'` darf nicht in P7-P8 (auch Block-Reichweite) | `wouldViolate` ZL ~55-62 | `moves.test.ts > H10 afternoonAllowed=never` |

**"Implizit"** bedeutet: Der Constraint wird durch die Datenstruktur erzwungen,
nicht durch eine eigene Prüfung. Eine Coupling-Unit existiert nur als **eine**
Unit mit allen Coupling-Specs als `specIds[]` — kein Code muss "überprüfen",
dass die gekoppelten Specs gemeinsam bewegen, denn sie sind dieselbe Unit.

### Defensives Safety-Net: `findHardViolations`

`hardCheck.ts` hat zusätzlich `findHardViolations(state)` — scannt alle
platzierten Units gegen alle anderen, gibt Indices der Verletzer zurück.
Wird aufgerufen:
- am Ende von `construct()` (Construction-Bug-Catch)
- in `placementToPlacedLessons()` (Decode-Boundary, filtert Verletzer raus)

So gelangt **nie** ein Plan mit Hard-Constraint-Verletzung zur UI.

---

## 5. Schema-Versionen

Migration in `src/lib/persistence.ts` `migrateDoc()`. Akzeptiert v1, v2, v3, v4, v5
und upgrade idempotent zur aktuellen `SCHEMA_VERSION`.

| Schema | Phase | Was sich änderte                                                                                |
|--------|-------|------------------------------------------------------------------------------------------------|
| v1     | 1–7   | `PlacedLesson` ohne `grade`. Multi-Grade-Specs wurden in alle Stufen gleichzeitig gerendert.   |
| v2     | 8     | `PlacedLesson.grade` hinzugefügt. Multi-Grade-Specs emittieren jetzt 1 PlacedLesson pro Grade. |
| v3     | 8     | `LessonSpec.groupKey` aufgespalten in `groupLabel` (Display-only) + `couplingId` (Solver-Hard).|
| v4     | 11    | `LessonSpec.teacher: TeacherId` ersetzt durch `LessonSpec.teachers: TeacherId[]` (Team-Teaching). Plus diverse `ConstraintConfig`-Erweiterungen aus Phase 12. |
| v4 (revisited) | 12 | `Teacher.maxLessonsPerDay` plus `ConstraintConfig.teacherDailyLoad` und `ConstraintConfig.teacherLunchBreak` wieder entfernt. Kein Schema-Bump — die Migration strippt alte Felder beim Laden. |
| v5     | 13    | `LessonSpec.afternoonAllowed: 'never' \| 'allowed' \| 'preferred'` hinzugefügt (Hard-Constraint H10 für 'never', Score-Komponente afternoon_preferred für 'preferred'). Migration leitet aus `Subject.isMain` ab. Plus `ConstraintConfig.targetDailyLessons` für Zieltagespensum (Score-Komponente target_daily). |

**Beim nächsten Schema-Bump:**
1. `SCHEMA_VERSION` in `types.ts` erhöhen.
2. `meta.schemaVersion` Type-Annotation in `ScheduleDoc` mit-erhöhen.
3. Migration in `persistence.ts` ergänzen — idempotent (mehrfaches Aufrufen ändert nichts).
4. JSON-Import-Akzeptanz-Check in `readJsonFile` erweitern.
5. Test in `persistence.test.ts` für die neue Migration.
6. **Diese Tabelle erweitern.**

---

## 6. Lebenszyklus eines Plans

```
1. CSV-Import (csv.ts)              → ScheduleDoc {teachers, subjects, specs}
2. UI-Editor                         → User passt Specs, Lehrer-Verfügbarkeit etc. an
3. Click "Generieren" (GenerateButton.svelte)
   → startSolve(doc)                 (solver-v2/index.ts)
4. Pre-Flight Diagnose (diagnose.ts)
   → Fatal-Hints? → 'ERROR'
5. buildState(doc)                   (units.ts)
   → SolverState mit Units, Maps, leerem placement
6. construct(state)                  (construct.ts)
   → Greedy-Place + Ejection Chain
   → findHardViolations cleanup
7. iteratedLocalSearchAsync(state)   (iteratedLS.ts)
   → mehrere Runden localSearch (Hill-Climbing + SA + Tabu)
   → Plateau-Detection, Reheat, Perturbation, Restart
8. (Falls strict-no-free + Lücken übrig)
   → Phase 3: zweiter ILS-Lauf mit normalem Gewicht
   → RelaxationInfo emittieren
9. placementToPlacedLessons(state)   (index.ts)
   → Decode Units → PlacedLesson[]
   → findHardViolations Last-Mile-Filter
10. emit('done', {placed, score, ...})
11. UI applyPlacements              → store.doc.placed = ... (Auto-Save)
```

---

## 7. Wo finde ich was

| Frage                              | Datei                                 |
|------------------------------------|---------------------------------------|
| Was ist ein Teacher/Subject/Spec?  | `src/lib/types.ts`                   |
| Wie wird der Plan persistiert?     | `src/lib/persistence.ts`             |
| Welche Felder hat eine Unit?       | `src/lib/solver-v2/types.ts`         |
| Wie funktioniert ein Move?         | `src/lib/solver-v2/moves.ts`         |
| Wie wird der Score berechnet?      | `src/lib/solver-v2/score.ts`         |
| Welche Slots sind feasible?        | `src/lib/solver-v2/hardCheck.ts`     |
| Wie startet ein Solve?             | `src/lib/solver-v2/index.ts`         |
| Was tut der Construction-Algorithmus? | `src/lib/solver-v2/construct.ts`  |
| Wie funktioniert ILS?              | `src/lib/solver-v2/iteratedLS.ts`    |
| Wie funktioniert die Pre-Flight?   | `src/lib/solver-v2/diagnose.ts`      |
| Wie geht Drag&Drop?                | `src/components/ScheduleCell.svelte` + `src/lib/schedule-helpers.ts` |
| Welche Regeln gibt es?             | `src/components/RulesPanel.svelte` (UI) + diese Datei §3 (kanonisch) |
