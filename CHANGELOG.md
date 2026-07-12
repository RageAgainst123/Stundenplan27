# Changelog

Alle erwähnenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased] — Solver-Optimierung: bessere Pläne für Lehrer

User-Anlass: Komplettes Generator-Audit mit dem Ziel messbar besserer
Lehrer-Pläne. Hauptpriorität: **wenige Springstunden**. Klassen-Qualität
(no_free=0, min_daily=0) ist Pflicht-Invariante und blieb in allen
Bench-Läufen erhalten.

### Ergebnis (Bench Liste.csv, Sync-Mediane Baseline → Schritt 4)
- Springstunden gesamt: **14 → 10 (−29%)**
- Max. Lücken pro Lehrer: **5 → 2 (−60%)**
- Anwesenheitstage gesamt: 39 → 35
- Mini-Tage (1 Stunde): 4 → 3 · Späteinstiege: 89 → 79
- Async-Produktionspfad: **5/5 Läufe erreichen no_free=0** (vorher 3/5)

### Fixed
- **KRITISCH: SA-Kaltstart im Produktionspfad** — `iteratedLocalSearchAsync`
  zerhackte die innere LS in 250ms-Chunks und startete Simulated Annealing
  jedes Mal bei T=100 mit leerer Tabu-Liste (120 Kaltstarts pro 30s-Zyklus).
  Fix: Resumable Local Search (`LsResumeState`) — Temperatur, Tabu-Map,
  Iterationszähler, RNG-Zustand und Best-Tracking überleben Chunk-Grenzen.
  Äquivalenz bewiesen: 3 Resume-Chunks à 1000 Iterationen == 1 Lauf à 3000.
- **Auto-Snapshot-Trigger war tot** — `preRunScore` wurde nach `reset()`
  gelesen (immer null), Auto-Snapshots bei ≥5% Improvement feuerten nie.

### Added
- **Bench-Harness** (`npm run bench`): 5 feste Seeds × 10s ILS auf der
  echten Liste.csv, Median-Report über gewichtsunabhängige Rohzähler,
  harte Invarianten-Assertions. Baseline in `docs/bench-baseline.json`.
- **3 neue Lehrer-Score-Komponenten** (jetzt 21 gesamt):
  - `teacher_gap_fairness` (Gewicht 15, an): Wochen-Lücken pro Lehrer
    QUADRIERT — 1 Lehrer mit 5 Lücken kostet 25, 5 Lehrer mit je 1 nur 5.
  - `teacher_days_present` (Gewicht 120, an): Anwesenheitstage über dem
    Teilzeit-Ideal (`ceil(Wochenstunden/6)`).
  - `teacher_lunch` (Gewicht 100, **aus** per Default): lange Tage ohne
    freie 5./6. Stunde. Config-Feld `teacherMiddayBreak`.
  - RulesPanel-Slider für alle drei, additive Config-Migration.
- **3 zielgerichtete Repair-Move-Generatoren** in `moves.ts` (30% des
  Move-Mixes): `teacher-gap-repair` (Lücke mit eigener Randstunde füllen),
  `day-eliminator` (Mini-Tag auf Anker-Tag verschieben), `class-gap-repair`
  (Klassen-Lücke schließen — reparierte den letzten Steck-Seed).
  +50% Iterationen/s im Async-Pfad.
- **🎯 Autopilot „Gründlich optimieren"** (`autopilot.ts` +
  GenerateButton): Ein Klick, Budget-Slider 1–15 min (Default 10).
  Plant Generieren (40% Budget) + bis zu 4 Diversify-Zyklen mit fallender
  Fraction (30/20/15/10%), wartet Sessions sequentiell ab, Phasen-Anzeige,
  Abbruch stoppt die ganze Kette. Best-Tracking → Plan wird nie schlechter.
- **👩‍🏫 Lehrer-Qualitäts-Report** (`teacher-quality.ts` +
  `TeacherQualityPanel.svelte`): aufklappbares Panel unter dem Generator.
  Pro Lehrer: Wochenstunden, Anwesenheitstage vs. Ideal, Springstunden
  (Ampel-Chip), schlechtester Tag, Späteinstiege, Mini-Tage, Mittagspause.
  Sortiert schlechtester zuerst, Zeile aufklappbar für Tagesdetails.
  Team-Teaching-aware, rein aus `doc.placed` — funktioniert auch für
  manuelle Pläne.

### Tuning-Experimente (alle verworfen, dokumentiert)
Tabu-Tenure 100, Slot-Sampling 20, `teacher_late_start` quadratisch —
alle verschlechterten die Ziel-Metrik Springstunden. Details mit Zahlen
in `docs/bench-baseline.json`.

### Runde 2, Schritt 2+3 — Solver-Durchsatz +30 %
- **Schritt 2:** `computeScore` alloziert nichts mehr pro Aufruf
  (Scratch-Puffer + Integer-Indizes statt Maps mit String-Keys, statische
  Per-Unit-Caches). Verhaltensidentisch (alle Score-Tests + Property-Test).
- **Schritt 3:** `wouldViolate` prüft nur noch die Kandidaten-Union
  (Lehrer ∪ Stufen ∪ Coupling-Partner, 10–40 statt ~130 Units) mit
  Generation-Marker-Dedup; `movableUnits` wird einmal pro LS-Lauf berechnet
  statt bei jeder Move-Generierung. Äquivalenz per Referenz-Vergleich auf
  500 Random-States bewiesen (`hardCheck.test.ts`).
- **Ergebnis:** Sync 4500 → 5891 iter/s, Async 4200 → 5373 (Median);
  Springstunden-Median 10 → 9 im selben Zeitbudget, no_free=0 in 10/10.
- Slot-Sampling 12→20 erneut gemessen und erneut verworfen (verschlechtert
  Move-Diversität, nicht Kosten-Frage). Diversify-Strategien-Wiedervorlage:
  Varianz dominiert, bleibt random (Details bench-baseline.json).

### Runde 3, Schritt 1 — Scoped Score-Delta (Bewertung beschleunigen)
- `computeScore` in wiederverwendbare Zeilen-Beiträge zerlegt: 9
  Komponenten pro (Tag × Stufe), 6 pro Lehrer-Woche, 5 pro Unit, plus
  `spec_spread`/`unplaced` global — Voll-Scan und Move-Bewertung teilen
  jetzt EXAKT dieselben Scan-Funktionen.
- `evaluateDelta` bewertet Moves über Rescans nur der berührten Zeilen
  (persistente Footprint-Zähler statt Komplett-Neubau pro Move);
  `commitMove` führt den Cache im Accept-Pfad mit. Der Full-Scan bleibt
  als Referenzpfad erhalten (Fallback ohne Cache).
- **Korrektheit bewiesen:** Property-Test — 500 Random-States × 8 Moves
  (Kopplungen, Blöcke, Multi-Grade, G/U, unplaced-insert, Kempe):
  Breakdown feldgenau identisch zum Voll-Scan, kein Drift über
  Accept-Ketten. Alle 76 bestehenden Score-Tests unverändert grün.
- Mikro-Optimierungen im heißesten Loop: numerische Tabu-Keys statt
  Template-Strings, Uhr-Lesen nur alle 32 Iterationen (Abort-Check
  bleibt pro Iteration).
- **Ehrliches Ergebnis:** ×1,35–1,4 Durchsatz (Median ~6300→~10000
  bzw. ~9100→~12000 Iterationen/s) — das ×2-Ziel wurde NICHT erreicht;
  der Loop wird jetzt von der Move-Generierung dominiert (Ansatzpunkt
  in bench-baseline.json notiert). Qualitäts-Metriken byte-gleich,
  alle Bench-Gates grün.

### Audit-Paket A1–A3 — Korrektheit, Datenintegrität, Halbstunden
Komplett-Audit der Codebase (3 parallele Tiefen-Audits, alle Befunde mit
Datei:Zeile). Rückfall-Anker: Tag `savepoint-pre-audit-fixes`.

**A1 — Kritische Fixes:**
- Zwei `snapshots-changed`-Listener-Leaks (GenerateButton, WeekView):
  Registrierung jetzt im `$effect` mit Cleanup — vorher blieb pro
  Tab-Besuch ein toter Listener auf zerstörten Instanzen zurück.
- Auto-Relax (Phase 3) verglich Scores über zwei Gewichts-Frames und
  übernahm das relaxed-Ergebnis bedingungslos. Jetzt expliziter
  Best-Guard im selben Frame (sonst Revert auf den Phase-2-Stand) und
  Auto-Snapshot-Trigger setzt bei `noFreeRelaxed` aus (kein spurious
  Snapshot durch Frame-Sprung).
- Drag&Drop-Konfliktprüfung auf Solver-Parität gebracht: Doppellage
  (zweite Wochenstunde derselben Einheit am selben Slot) ist jetzt auch
  per Hand verboten — inkl. beim Move (quellgenauer Exclude via
  `MoveSource` statt pauschalem Same-Spec-Skip). Team-Teaching zählt die
  EFFEKTIVEN Segment-Lehrer statt des vollen Spec-Teams (keine
  False-Positives mehr). Dabei entdeckt & gefixt: beim Verschieben einer
  Segment-Stunde gingen ihre `teachers` verloren (ScheduleCell rettet
  sie jetzt beim Move).

**A2 — Datenintegrität:**
- JSON-Backup-Import validiert jetzt die Struktur VOR der Migration
  (`validateDocStructure`) — teil-kaputte Dateien brechen mit klarer
  Meldung ab statt den Store zu überschreiben; Alt-Backups (v1/v3)
  bleiben ladbar.
- Auto-Save meldet Fehlschläge: rotes Banner „Speichern fehlgeschlagen"
  mit Retry-Button statt stillen Quota-Schluckens (`saveFailed`-Flag im
  Store; der `$effect.root`-Mechanismus selbst blieb unangetastet).
- Still verworfene Pins/Hot-Start-Placements (Spec gelöscht, count
  gesunken, kein Unit-Match) landen jetzt mit Begründung in der
  `droppedPins`-Meldung im Solver-Log.
- Migrations-Reihenfolge (`teacherMiddayBreak` vs. Legacy-Delete) und
  Smart-Merge-Teleskop-Invariante (Σ Segment-Stunden === count) per
  Tests abgesichert.

**A4 — Plan-Import-Verfeinerung:**
- Die Zuordnung Export-Eintrag → Spec läuft jetzt in ZWEI Pässen:
  erst alle Lehrer-belegten Matches (greedy pro Slot — eine bereits
  vergebene Spec steht am selben Slot nicht mehr zur Wahl), dann der
  Eindeutigkeits-Fallback über die verbleibenden freien Kandidaten.
  Vorher entschied jeder Eintrag unabhängig per argmax: bei
  Kopplungs-Slots konnte zweimal dieselbe Spec gewinnen und der zweite
  Eintrag ging still verloren (Dedup zählte ihn trotzdem als
  „zugeordnet"); der Fallback blieb fälschlich ambig, obwohl nach den
  sicheren Zuordnungen nur ein Kandidat übrig war. Das Ergebnis ist
  jetzt unabhängig von der Reihenfolge in der Export-Datei.
- Fallback-Guard: ein even↔odd-Widerspruch beim Wochen-Muster
  disqualifiziert den letzten Kandidaten — der Eintrag eines gelöschten
  G/U-Zwillings wird nicht mehr dem falschen Zwilling zugeordnet
  (hätte eine Doppellage gebaut), sondern transparent gemeldet.
- `matched` zählt nur noch echte Platzierungen.

**A7 — Print-Layout (Phase 18, sichtbarer Abschluss):**
- Neuer Druckmodus im Wochenplan-Reiter: drei Buttons **„🖨 Alle
  Lehrer"** (eine A4-Querformat-Seite pro Lehrer mit Stunden),
  **„🖨 Alle Stufen"** (eine Seite pro Schulstufe, mit L#-Legende) und
  **„🖨 Gesamtplan"** (alle 4 Stufen auf einer Seite). Quelle ist
  Slot 1 der Vergleichsansicht — Snapshots sind damit auch druckbar.
- Neue Komponente `PrintSheets.svelte`: Bildschirm-Druckvorschau
  (weiße A4-Karten) mit Toolbar „Drucken/Schließen"; `window.print()`
  druckt über `@page { size: A4 landscape }` + `page-break-after`
  genau ein Blatt pro Seite. `@media print` blendet App-Chrome
  (Header, Tabs, Banner, Toolbar) aus.
- Blatt-Inhalt: Kopfzeile „Name — Schuljahr — Wochenstunden — Datum",
  Wochenmatrix 8 Perioden × 5 Tage. Toner-schonend: schwarzer Text,
  Lehrerfarbe nur als schmaler linker Rand. Multi-Grade-Stunden werden
  pro Lehrer zu EINEM Eintrag zusammengeführt („5+6. SSt."), Team-/
  Kopplungs-Partner als „+ L2"-Badge, G/U-Stunden mit [G]/[U]-Badge.
  Datenbasis: der in A5 konsolidierte `buildSlotOccupancy`-Helper.
- Browser-E2E: Lehrer-Blätter (Stundenzahl, Multi-Grade-Merge,
  Co-Badge, G/U), Stufen-Blätter (leere Stufe wird übersprungen,
  Legende), Gesamtplan (alle Placements), Druck-CSS-Regeln verifiziert.

**A6 — Doku-Sync:**
- MODEL.md: Hard-Constraint-Tabelle um **H11** ergänzt (Titel „H1–H11",
  `afternoonAllowed='must'` muss ab P7 liegen), §1-Box auf
  `schemaVersion: 5` und den `'must'`-Wert nachgezogen,
  `Subject.maxConsecutive` ehrlich annotiert (im Solver v2 nicht
  angebunden — nur das globale Regeln-Limit wirkt; verifiziert:
  score.ts nutzt ausschließlich `ConstraintConfig.maxConsecutiveMain`).
- CLAUDE.md-Stolperfalle ergänzt: localStorage hängt am Origin
  INKLUSIVE Port (strictPort-Kontext, Ursache des Snapshot-Verlusts).
- SubjectList: Tooltip von „Max in Folge" sagt jetzt klar, dass das
  Feld derzeit NICHT im Generator wirkt (Pro-Fach-Anbindung = Backlog).

**A5 — Code-Gesundheit:**
- Toter Code entfernt: fünf verwaiste Handler in ScheduleGrid
  (Zellen-Interaktion lebt seit Phase 8 komplett in ScheduleCell),
  `applySmartMerge`/`RawMergeRow` (exportierter No-Op — der echte Pfad
  ist `buildSpecsWithSmartMerge`), `formatCellText` in excel-export.
- Duplikate konsolidiert: EINE Slot-Map (`buildSlotOccupancy` in
  schedule-helpers — vorher dreifach in ExportPanel/excel-export/
  WeekView), EIN Kopplungs-Hintergrund (`couplingBackground` — vorher
  byte-identisch in ScheduleCell + WeekView), EIN Lehrerfarb-Tint
  (`teacherTint`/`teacherStripeBackground` in teacher-helpers).
  **Sichtbare Änderung:** der Tint ist jetzt überall 40 % — vorher
  Grid 35 %, Wochenplan 45 %, Export-Vorschau ≙35 %. Per Browser-E2E
  verifiziert (Grid, Wochenplan, Export-Vorschau, Kopplungs-Pastell).
- Snapshot-Namen: `window.prompt()` durch Inline-Input ersetzt
  (Enter = speichern, Escape = abbrechen, leer = „Plan #N"); „Auto #N"/
  „Plan #N" nutzen einen persistenten Zähler (eigener localStorage-Key)
  statt der Galerie-Länge — nach dem FIFO-Cleanup kollidierten Nummern.
- Kleinkram: 🔬 Solver-Snapshot-Button ist während eines Worker-Laufs
  disabled (getDzn liefert mid-run leer); später poolBest-Event nach
  Abort wird nicht mehr als 'solution' gespiegelt (done-Guard);
  kaputter title-Ternär im Wochenplan-Vergleichs-Umschalter repariert.
- Bewusst NICHT angefasst (jetzt im Code dokumentiert): die
  Doppel-Serialisierung im Store-Auto-Save — der `JSON.stringify`-
  Deep-Tracker ist der Preis für zuverlässiges Deep-Tracking
  (CLAUDE.md-Reactivity-Falle), Kosten ~1-2 ms pro Mutation.

**A3 — Halbzahlige Stunden (0.5/1.5) konsistent:**
- Neuer kanonischer Helper `effectiveSlotCount(spec)` =
  `max(1, round(count))` in `schedule-helpers.ts` — exakt die
  Solver-Formel aus `units.ts`, jetzt von Sidebar (`unplacedSpecs`),
  Diagnose und Legacy-blocks-Migration gemeinsam genutzt. Vorher zeigte
  die Sidebar für BBO/EH ewig „×0.5 ungeplant" bzw. ließ halb platzierte
  Specs verschwinden, und die Diagnose unterschätzte Lasten.
- Diagnose-Fixes: Lehrer-Last dedupliziert Kopplungen jetzt wie die
  Stufen-Last (gekoppelte Specs desselben Lehrers zählen einmal);
  3 neue Warnungen: halbzahliger count ohne G/U-Wochen-Muster,
  Kopplung mit ungleichen Stundenzahlen (Überhang läuft ungekoppelt),
  Kopplung mischt `afternoonAllowed` never+must (unplatzierbar).
- Neuer Bench-Fall **coupled-solvable** (Liste.csv + BSP/REL-Kopplungen,
  strukturell lösbar): Median-Gate `unplaced=0` UND `no_free=0` UND
  `min_daily=0` — bestanden (3/5 Seeds vollständig platziert in 10 s,
  Details `docs/bench-baseline.json`). Aufrundungs-Verhalten in
  MODEL.md §1 dokumentiert.
- 370 Tests grün (vorher 347).

### Plan-Import + Absturz-Härtung
User-Anlass: Preview-Server abgestürzt, nach Neustart waren die
Snapshots weg — einziges Überbleibsel war eine Plan-Export-Datei.
- **„📥 Plan importieren"** im Stundenplan-Reiter (`schedule-import.ts`):
  liest Plan-Export-Dateien wieder ein. Kaskadiertes Matching pro
  Eintrag: Lehrer-ID → Lehrer-Name → eindeutiger (Fach, Stufe)-Kandidat.
  Funktioniert damit auch nach frisch importierten Stammdaten mit neuen
  UUIDs (der Rettungsfall). Nicht zuordenbare Einträge werden VOR dem
  Import aufgelistet statt still verworfen; der aktuelle Plan wird
  vorher automatisch als Backup-Snapshot gesichert. E2E mit der echten
  Verlust-Datei: 120/128 Stunden in ein frisch aufgesetztes Doc gerettet
  (Rest = echte Strukturunterschiede, transparent gemeldet).
- **Snapshot-Härtung** (`snapshots.ts`): Korrupter localStorage-Eintrag
  (z. B. Browser-Crash mitten im Write) wird jetzt in den Rettungs-Key
  `stundenplan27.snapshots.corrupt` kopiert — vorher überschrieb der
  nächste Auto-Snapshot den rettbaren Inhalt endgültig. Bei vollem
  Speicher (Quota) werden die ältesten AUTO-Snapshots geopfert und der
  Save wiederholt, statt still verloren zu gehen.
- **`strictPort`** für Dev- und Preview-Server: localStorage hängt am
  Origin INKLUSIVE Port. Vorher wich Vite bei belegtem Port still auf
  4174/5174 aus — die App startete mit leerem Speicher und die Daten
  wirkten „weg". Jetzt scheitert der Start laut. (Wahrscheinlichste
  Erklärung für den erlebten Snapshot-Verlust.)

### Runde 2 — „Ungeplante Stunden": drei Fixes + Regeln-Audit
User-Befund: Der Solver meldete Lösungen, obwohl Stunden ungeplant blieben.
Analyse ergab drei zusammenhängende Defekte:
- **Neue Score-Komponente `unplaced`** (22. Komponente, RulesPanel „Alle
  Stunden müssen platziert werden", Default-Gewicht 100000 = dominant):
  Vorher kostete eine weggelassene Stunde im Score NICHTS — sie konnte ihn
  sogar verbessern (gesparte Nachmittags-/Pensum-Penalties), wodurch
  Best-Tracking und Diversify unvollständige Pläne bevorzugen konnten.
  100000 statt intuitiver 20000, weil eine einzelne Platzierung im
  strict-Modus bis ~85000 an weichen Strafen auslösen kann (führende
  Klassen-Lücken à 10000) — die Dominanz muss auch das überbieten.
- **Neuer `unplaced-insert`-Move**: Die Local Search hatte keinerlei
  Operator, um ungeplante Stunden einzusetzen (nur Construction/Restarts
  versuchten es). Jetzt scannt ein Insertion-Generator (10 % des Move-Mix,
  mit Fallback) alle Slots für eine ungeplante Unit.
- **H8-Doppellage-Bug (die eigentliche Wurzel):** Der Same-Spec-Hard-Check
  hatte eine zu breite Kopplungs-Ausnahme — zwei *verschiedene
  Wochenstunden* derselben Kopplungsgruppe durften auf demselben
  (Tag, Periode) landen. Im Grid als übereinanderliegende Zellen sichtbar,
  in der Sidebar als „ungeplant" gezählt, im Score unsichtbar. Ausnahme
  entfernt (in diesen Check kommen nur Units, die eine Spec teilen — immer
  verschiedene Unterrichtsstunden).
- `done.final.unplaced` wird jetzt aus dem finalen Placement berechnet
  (vorher: veraltete Liste aus der Initial-Construction).
- **Regeln-Audit:** alle 18 bisherigen Regler greifen (geprüft gegen
  defaultWeights/score/hardCheck). Footer-Text korrigiert („maximale
  Tageslast" existiert seit Phase 12 nicht mehr). Bekannt & offen:
  `Subject.maxConsecutive` aus der Fächer-Tabelle wird vom Solver v2
  ignoriert (nur das globale Regeln-Limit wirkt).
- E2E (gekoppelte Fixture): vorher konstant 3-4 „ungeplante" Stunden,
  jetzt 0 (nur die absichtlich kaputte VS-NaSt-Fixture-Spec bleibt),
  0 Doppellagen. 7 neue Tests (Score-Dominanz, LS-Insertion, Doppellage,
  Hot-Start-Roundtrip, Decode-Konsistenz).

### Runde 2, Schritt 6 — Parallel-Pool über N Worker
- Die Pool-Phase läuft jetzt über `k = min(4, Kerne − 2)` Worker
  **gleichzeitig** (Orchestrierung in `worker-bridge.ts`, neue
  `pool`-Betriebsart in `solve.worker.ts`). Die Bridge sammelt das global
  beste Ergebnis (Kriterium wie bisher: weniger unplatziert, dann Score)
  und startet damit die Haupt-Session als Hot-Start.
- E2E auf 8 Kernen: 4 Worker, ~44 Pool-Versuche/s statt ~10–20 (~4×);
  Score nach 5 s Pool + 3 s Optimieren: 8836 — vorher ~10230 nach 20 s.
- Pool-Zeit zählt weiter gegen das Gesamtbudget (Autopilot-kompatibel);
  Abort während des Pools übernimmt die beste Pool-Lösung; fatale
  Diagnose überspringt den Pool (saubere Fehlermeldung); mit <3 nutzbaren
  Kernen bleibt der Pool wie bisher in der Session.
- 4 neue Bridge-Tests (Seed-Verteilung, Best-Aggregation, Pool→Haupt-
  Session-Übergang, Pool-Abort, Fatal-Bypass, 1-Kern-Fallback).

### Runde 2, Schritt 5 — Solver läuft im Web Worker
- **`startSolveSession`** (`worker-bridge.ts`) ersetzt `startSolve` als
  UI-Einstieg: gleiche Session-API, aber der Solver rechnet in einem
  Web Worker (`solve.worker.ts`) — der UI-Thread bleibt während des
  gesamten Laufs frei (kein Jank, Tab-Wechsel und Grid-Updates flüssig).
- Abort läuft über eine Worker-Message (greift beim nächsten Chunk,
  gemessen ~260 ms); antwortet der Worker nicht binnen 3 s, wird er hart
  terminiert und die letzte bekannte Lösung übernommen.
- DZN-Debug-Snapshot kommt huckepack mit dem done-Event (getDzn ist
  synchron — während des Laufs nicht verfügbar).
- Fallback ohne Worker-Support (jsdom/Tests): Inline-startSolve wie bisher.
- 5 neue Bridge-Tests (Fallback, Event-Spiegelung, Doppel-done-Schutz,
  Abort-Protokoll, Terminate-Fallback mit Fake-Worker).
- Bundle: +1 Worker-Chunk (~50 KB raw, dupliziert den Solver-Code) —
  bewusster Trade-off für den freien UI-Thread.
- E2E verifiziert: Worker-Chunk lädt unter dem GitHub-Pages-Base-Pfad,
  Live-Score-Streaming, Abort übernimmt Best-Lösung.

### Runde 2, Schritt 4 — SA-Experimente (alle verworfen, dokumentiert)
T₀-Kalibrierung aus der Delta-Verteilung, budget-adaptive Kühlung,
Seitwärts-Akzeptanz bei toter Temperatur — alle drei (und die Kombination
A+B) verschlechterten die Springstunden-Metrik konsistent. Befund: das
bestehende Regime (kurze SA-Phase → Tabu-Hill-Climbing → ILS-Reheat bei
Stagnation) ist für dieses Problem empirisch optimal; die Temperatur
länger am Leben zu halten kostet Konvergenz. Zahlen in
`docs/bench-baseline.json` (r2-schritt-4).

### Runde 2, Schritt 1 — Reproduzierbarkeit + LNS-Destroy-Hook
- **`StartSolveOptions.seed`**: kompletter Solver-Lauf (Construction, Pool,
  ILS, Diversify-Reset) läuft über EINEN Session-Rng — mit Seed
  reproduzierbar (Bench, Bug-Reports), ohne Seed wie bisher zufällig.
  Vorher: 6 unabhängige `Date.now()`-Seed-Stellen.
- **`diversify.strategy`** (`'random' | 'worst-teacher' | 'related-day'`,
  neues Modul `lnsDestroy.ts`): zielgerichtete Destroy-Auswahl nach
  LNS-Literatur (Shaw). **Bench-Befund: kein belastbarer Vorteil** von
  worst-teacher auf der Ziel-Metrik (3 Messrunden, Details in
  bench-baseline.json) → Autopilot bleibt auf `random`; die Strategien
  bleiben als getesteter Hook mit Wiedervorlage nach den
  Durchsatz-Schritten. Neuer Bench-Fall „Diversify-Strategien" für
  künftige Re-Evaluierung.

### Tests
- 315 Tests grün (vorher 289): Bench-Metriken, Resume-Äquivalenz,
  Tabu-Expiry über Chunk-Grenzen, Repair-Move-Properties (500 Random-
  States ohne Hard-Violations), 3×Score-Komponenten, `computeTeacherQuality`
  (Multi-Grade-Dedup, Team-Teaching, Mittagspause), `planAutopilot`.

## [Unreleased] — Phase 17: Team-Teaching mit Segmenten

User-Anlass: Eine andere Schule liefert CSV-Exporte mit Team-Teaching —
Hauptlehrer 4h + Stütz-Lehrer mit 2-3h Erg-Stunden in derselben Klasse.
Bisheriges Modell hätte 4+2+3 = 9 Slots aus 4 echten Mathestunden gemacht.

### Added
- **CSV Smart-Merge** als Opt-in (Checkbox „🔬 Team-Teaching erkennen"
  im Import-Card). Erkennt 3 Sokrates-Muster:
  - Team-Teaching: 1 Hauptlehrer + N Stütz-Lehrer mit Erg-Stunden
    → eine Spec, `count = HauptlehrerStunden`, `teachingSegments`
    mit Best-Guess-Aufteilung (nested coverage)
  - Same-Teacher-Mehrfachzeilen → summieren zu einer Spec
  - Leistungsgruppen (Stand+AHS) → automatischer `couplingId`
  - Edge-Case 2 Hauptlehrer ohne Gruppe → Warning, keine Merge
- **`LessonSpec.teachingSegments?: TeachingSegment[]`** — strukturelle
  Aufteilung einer Lehreinheit in Sub-Stunden mit eigenen Lehrer-Teams.
  Beispiel `count=4`:
  ```
  segments: [
    { hours: 2, teachers: [Lindner, Nagel, Titze] },
    { hours: 1, teachers: [Lindner, Titze] },
    { hours: 1, teachers: [Lindner] }
  ]
  ```
- **`validateTeachingSegments()`** in `types.ts` — prüft
  `sum(hours) === count`, jeder Segment-Lehrer in `spec.teachers`,
  Segmente nicht leer (Toleranz 0.05 für halbzahlige Stunden).
- **`TeamTeachingEditor.svelte`** — neue Komponente. Inline ausklappbar
  per Spec-Zeile, Checkbox-Matrix Segment × Lehrer, Live-Validierung,
  Summen-Anzeige. Skaliert für beliebig viele Lehrer (2, 3, 5+).
- **SpecList Multi-Lehrer-Chips** — statt nur 1+2-Lehrer-Dropdown jetzt
  Chips für N Lehrer mit „×"-Remove und „+ Lehrer"-Select.
- **Bulk-Aktion „🤝 Als Team-Teaching zusammenführen"** — aktiviert
  bei 2+ Specs mit gleichem Subject + Klasse + Stufe. Heuristik wählt
  Hauptlehrer (meiste Stunden) und generiert nested-coverage-Vorschlag.
  Confirm-Dialog mit Detail-Anzeige, dann öffnet sich der Editor.

### Solver-Integration
- `expandSegmentedSpecs()` in `solver-v2/units.ts` — Pre-Processing vor
  Unit-Expansion. Specs mit Segmenten werden in N Pseudo-Specs gesplittet
  (gleiche `spec.id`, eigenes Team, `count = segment.hours`). Restlicher
  Solver-Code unverändert. Defensiv: kaputter Split → Fallback auf Spec
  wie pre-Phase-17.

### Persistence
- Migration: alte `teamComposition`-Felder werden weggeworfen
  (Vorgänger-Konzept, nie produktiv).
- `teachingSegments` defensiv normalisiert beim Load: kaputte Einträge
  (leere Teams, hours≤0) werden entfernt, Spec verhält sich dann
  wie pre-Phase-17 ohne Crash.

### Tests
- **15 neue Tests** in `teaching-segments.test.ts`:
  - `validateTeachingSegments`: 7 Tests (Summe, Lehrer-Match,
    Halbzahlen, 3-Lehrer-Teams)
  - `buildState` Solver-Integration: 8 Tests inklusive
    Default-Pfad-Kompatibilität und Fallback bei kaputtem Split
- **3 angepasste Tests** in `smart-merge.test.ts` für die
  `teachingSegments`-Ausgabe statt der alten `teamComposition`
- Total: **234 Tests grün** (vorher 219)

### Doku
- `MODEL.md` §1 erweitert um `teachingSegments` und §"Multi-Grade & Coupling"
  hat neue Sektion "Team-Teaching mit Segmenten"
- `CLAUDE.md` Phasen-Status: Phase 17 (✅), Phase 18 als nächstes
- Architektur-Sektion ergänzt: `TeamTeachingEditor.svelte`

### Bundle
68.76 KB gz (+3.5 KB für Editor-Komponente + Smart-Merge + Multi-Lehrer-UI).
Über ursprünglicher 60-KB-Empfehlung, aber akzeptabel für die Funktionalität.

### Geplant (Phase 18)
- Print-Layout (A4 pro Lehrer / pro Schulstufe), `@media print` CSS
- Diff-View zwischen zwei Snapshots
- Echte zweite Engine (LNS, Backtracking-Verifier)
- Web Worker, falls Solver auf größeren Schulen langsam wird

## [1.0.0] - 2026-05-10 — Erste stabile Version 🎉

**Die App funktioniert.** Nach 16 Phasen Entwicklung erstellt der
Stundenplan-Generator MS SiG zuverlässig brauchbare Pläne aus dem
Sokrates-CSV-Import. Alle wichtigen Features sind implementiert,
207 Tests sind grün, Build ist clean (62.7 KB gz).

### Was funktioniert
- **CSV-Import** aus Sokrates mit Vorschau-Diff (Phase 1-3)
- **Stammdaten-Editor** für Lehrer, Fächer, Lehreinheiten mit
  Bulk-Toolbar und Verfügbarkeits-Raster (Phase 4-5)
- **Solver v2** (TypeScript Construct + Local Search): Pool-Phase,
  Hot-Start, Diversify (LNS), automatische Constraint-Lockerung
  (Phase 11-15)
- **18 Score-Komponenten** mit Untis-Style RulesPanel,
  10 Hard-Constraints inkl. H10 (Hauptfach Nachmittag verboten)
- **Drag&Drop-Editor** mit Live-Konflikterkennung, Pinning,
  Multi-Grade-Visualisierung (Phase 5b-5d)
- **Wochenplan-View** als read-only Vergleichsansicht mit bis zu
  4 Plänen nebeneinander (Phase 16)
- **Snapshot-Galerie** mit Auto-Snapshot bei großen Verbesserungen,
  Restore und Diversify-from-Snapshot (Phase 15)
- **JSON-Export/Import** als Backup, Schema-Migration v1→v5
- **GitHub-Pages-Deploy** unter https://rageagainst123.github.io/Stundenplan27/

### Fixed (Audit-Pass 2026-05-10)
- **`uneven_days`**-Score zählt jetzt nur noch **aktive Tage** (Tage mit
  ≥1 Stunde) und nicht mehr komplett leere Tage. Komplett-freie Tage
  werden bereits durch `min_daily` und `target_daily` abgedeckt — sonst
  würde der Solver Stunden zu Klassen-freien Tagen verschieben. Bench:
  künstliche Penalty 80 (leerer Doc) → 0.
- **Diversify überspringt Phase-3 Auto-Relax**: Pre-/Post-Score wurden
  vorher mit unterschiedlichen Gewichten verglichen (strict no_free vs.
  weich gelockert), was Best-Tracking inkonsistent machen konnte.
  Diversify ist ein lokaler LNS-Stoß und braucht keine Constraint-
  Lockerung; daher wird Phase 3 in Diversify-Mode geskippt.
- **ScheduleGrid-Filter**: Multi-Grade-Specs wurden bei Filter auf eine
  ihrer Stufen nicht angezeigt (z.B. REL für [5,6] verschwand bei Filter
  „6. SSt."). Gleicher Fix wie WeekView Phase 16.5 — Filter prüft jetzt
  ob EINE der Spec-Stufen im Filter ist statt nur die Rendering-Stufe.
- **Score-Aufschlüsselung im Result-Block** zeigt jetzt alle 17 sichtbaren
  Komponenten an (vorher fehlten `uneven_days`, `target_daily`,
  `afternoon_preferred`, `main_twice`, `main_block_split`). Total bleibt
  unverändert berechnet, nur die Anzeige war unvollständig.
- **Doku-Kommentar `score.ts`** sprach noch von „14 Score-Komponenten" —
  aktualisiert auf 18 (Stand Phase 13.3).

### Geplant (Post-1.0 / Phase 17)
- Print-Layout (A4 pro Lehrer / pro Schulstufe), `@media print` CSS
- Diff-View zwischen zwei Snapshots
- Echte zweite Engine (LNS, Backtracking-Verifier)
- Web Worker, falls Solver auf größeren Schulen langsam wird

## [0.16.0] - 2026-05-10 — Phase 16: Wochenplan-View

User-Wunsch: Snapshots oder aktuellen Plan in einer **schönen,
übersichtlichen Anzeige** ansehen — nicht im Editor-Chrome, ohne
Drag&Drop, optimiert für Lesbarkeit. Filterbar nach Lehrer / Stufe / Fach.

### Added
- **Neuer Tab „Wochenplan 📋"** in `App.svelte`. Read-only-Anzeige
  des Plans.
- **`src/components/WeekView.svelte`** (neue Komponente, ~480 Zeilen):
  - **Plan-Quelle-Dropdown** oben: „Aktueller Plan" oder beliebiger
    Snapshot aus der Galerie
  - **Filter-Bar** mit Lehrer-Chips (mit Lehrer-Farbe als Border-Akzent),
    Stufen-Chips, Fach-Dropdown
  - Filter-Modus: **Highlight** (Treffer normal, Rest mit `opacity: 0.18`
    gedimpft)
  - **Grid-Layout** wie Editor (5 Tage × 4 Stufen × 8 Periods), aber
    größere Zellen, ruhigere Typografie, kein Drag&Drop, keine Pin-Toggles
  - **Multi-Grade- und Coupling-Visualisierung** identisch zum Editor
    (gleiche Subject-Farben, Coupling-Hintergrund, Team-Teaching-Split)
  - **Aktuelle-Stunde-Highlight** (gold) und KW/G-U-Wochen-Anzeige im Header
  - **Stats** im Header: Anzahl Stunden + Lerneinheiten

### Architektur-Hinweis
WeekView reagiert reaktiv auf `snapshots-changed` Window-Event aus
GenerateButton — neue Snapshots erscheinen sofort im Dropdown ohne
Reload. Die View ändert NIE `store.doc` — Editor-Stand bleibt
unangetastet egal welcher Snapshot angezeigt wird.

Bundle: 61.97 KB gz (+2 KB für neue Komponente). Über ursprünglicher
60-KB-Empfehlung, aber im akzeptablen Bereich für die Funktionalität.

## [0.15.0] - 2026-05-10 — Phase 15: Diversify-Button + Plan-Snapshot-Galerie

User-Beobachtung: Score sinkt auf z.B. 4604, dann findet der Solver nichts
mehr. Hot-Start („Weiter optimieren") iteriert in derselben Nachbarschaft
und kommt nicht aus dem Plateau raus. Phase 15 ergänzt zwei Werkzeuge:

### Added
- **Diversify-Modus (LNS-Pattern)**: dritter Action-Button neben „Plan
  generieren" und „Weiter optimieren". Wirft 10-50% (Slider) der
  nicht-pinned Units zurück und re-platziert sie via Construction +
  Local Search. **Best-Tracking absolut**: wenn Diversify-Lauf KEINE
  Verbesserung findet, wird der Pre-Snapshot wiederhergestellt — Plan
  kann nie verschlechtert werden.
- **Diversify-Sliders**:
  - Anteil 10-50% (Default 25%)
  - Dauer 10-120s (Default 30s)
- **Snapshot-Galerie** (`src/lib/snapshots.ts`): bis zu 10 Plan-Stände
  in localStorage (`stundenplan27.snapshots`). Pro Snapshot:
  `{ id, name, score, placed[], scoreBreakdown, createdAt, source }`.
- **Auto-Snapshot bei ≥5% Score-Improvement** nach jedem Solver-Lauf.
  Plus manueller „💾 Aktuellen Plan speichern"-Button.
- **Snapshot-Galerie-UI**: sortiert nach Score (bester ⭐ oben),
  Wiederherstellen-Button, „🌀 Diversify"-Button (restore + sofort
  diversifizieren), einzelner Lösch-Button und „Alle löschen"-Aktion.
- **Auto-Backup vor Restore**: bevor ein Snapshot wiederhergestellt
  wird, wird der aktuelle Stand automatisch als Backup-Snapshot
  gespeichert (für Undo-Sicherheit).
- **MAX_SNAPSHOTS = 10** mit FIFO-Cleanup ältester.

### Solver-API-Änderungen
- `StartSolveOptions.diversify?: { fraction, durationMs }` —
  Diversify-Modus
- Diversify impliziert `hotStart=true` (aktueller Plan ist Basis)
- Diversify überschreibt `totalBudgetMs` mit `durationMs`
- Pool-Phase wird übersprungen wenn `diversify` gesetzt
- Revert-Logik: nach Phase 2 + Phase 3 wird `bestBreakdown.total` mit
  Pre-Snapshot-Score verglichen. Bei keiner Verbesserung →
  `state.placement.set(diversifyPreSnapshot)` und Score neu berechnet.

### Tests
- 3 neue Diversify-Tests in `index.test.ts`:
  - Diversify resetet Fraction und führt LS aus
  - Diversify ohne Verbesserung → Pre-Snapshot wiederhergestellt
  - Diversify überspringt Pool auch bei `poolBudgetMs > 0`
- 9 neue Snapshot-Tests in `snapshots.test.ts` (Roundtrip, MAX-Cleanup,
  Storage-Key-Isolation, malformed-localStorage-Defensive)
- 207 Tests gesamt grün (vorher 195)

### Architektur-Hinweis
Snapshots leben in einem **separaten** localStorage-Key — sie werden
NICHT im Plan-JSON-Export aufgenommen. Das hält Plan-Backup-Dateien
schlank und Snapshots bleiben pro Browser/Gerät.

Bundle: 59.91 KB gz (war 57.46, +2.5 KB für Snapshot-Modul + UI).

## [0.14.x] - Phase 14 (Internal): Pool-Phase + Hot-Start

Pool-Construction-Phase (Multi-Start-Construction mit konfigurierbarer
Laufzeit) und Hot-Start „Weiter optimieren" wurden eingebaut. Engine-1-
stable Tag auf b555673 als Reproducibility-Anchor.

## [0.13.0] - 2026-05-10 — Phase 13: Constraint-Modell-Erweiterung

User-Befund: heute generierte Pläne haben Hauptfächer am Nachmittag
und Tagespensum-Schwankung 4–8 Stunden je Stufe statt ~6. Das war
kein Algorithmus-Problem (mehr Move-Operatoren hätten nichts gebracht),
sondern eine Modell-Lücke. Phase 13 erweitert das Constraint-Modell.

### Added
- **Hard-Constraint H10: Hauptfach am Nachmittag verboten.** Specs mit
  `afternoonAllowed='never'` dürfen niemals in P7-P8 (auch nicht durch
  Block-Reichweite). Per Auto-Migration v4→v5 für alle Specs deren
  Subject `isMain=true`. Coupling-Units übernehmen den restriktivsten
  Wert aller mit-gekoppelten Specs.
- **Score-Komponente `target_daily`.** Quadratische Penalty pro
  (Tag, Stufe) für Abweichung vom Zieltagespensum. Default-Ziel 6,
  Default-Gewicht 80. Wirkt nach OBEN und unten — verhindert
  „Mo: 4 Stunden, Fr: 8 Stunden". Inaktive Tage (0 Stunden) sind
  ausgenommen, sonst würde der Solver künstlich Stunden erzeugen.
- **Score-Komponente `afternoon_preferred`.** Inverse zu `any_aft`:
  Specs mit `afternoonAllowed='preferred'` zahlen Penalty wenn sie
  morgens (P<7) liegen. Geeignet z. B. für BBO, EH, GZ. Default-
  Gewicht 15, manuell pro Spec aktivierbar.
- **`LessonSpec.afternoonAllowed`** als neues schema-v5 Feld
  (`'never' | 'allowed' | 'preferred'`). UI-Dropdown pro Spec in
  SpecList plus Bulk-Toolbar-Aktion.
- **`ConstraintConfig.targetDailyLessons`** (`{ enabled, weight, target }`)
  als neues schema-v5 Feld. RulesPanel-Slider für Zieltagespensum.
- **Pre-Flight Diagnose erweitert** (3 neue Checks):
  - 6b: pro Lehrer Vormittag-Slot-Kapazität vs. zugewiesene
    'never'-Stunden. Vorhersage von UNSAT durch H10 plus konkrete
    Begründung („nur 12 P1-P6-Slots aber 14 Hauptfach-Stunden").
  - 6c: pro Stufe Gesamt-'never'-Stunden vs. 30 verfügbare
    Vormittag-Slots (5 × 6).
  - 6d: Warnung wenn Pin auf P7-P8 + Spec ist 'never' (Pin wird
    beim Solver-Lauf verworfen).
- **Schema v4 → v5 Migration**: setzt `afternoonAllowed` aus
  `Subject.isMain` (true→never, false→allowed) und ergänzt
  `targetDailyLessons` mit Default-Werten. Idempotent — User-
  Overrides bleiben erhalten.

### Changed
- `wouldViolate` und `findHardViolations` prüfen jetzt H10. Folge:
  bestehende Pin-Validierungs-Logik in `units.ts` filtert auch
  H10-Verletzer als `droppedPins` mit klarer Begründung.
- SpecList `newSpec()` defaultet `afternoonAllowed` basierend auf
  Subject.isMain — kein „every new spec ist allowed" mehr.

### Bench (Liste.csv, 10 s ILS)
- Vor Phase 13: ~3500-4000 Score, ~5-15 main_aft Verletzungen.
- Nach Phase 13: ~11600 Score (höher wegen neuer Komponenten),
  **`main_aft = 0`** (H10 wirkt strikt), `target_daily = 52`
  Residual nach 10 s. Strukturell vernünftig — andere Constraints
  setzen Druck der target_daily nicht ganz auf 0 fallen lässt.

## [0.12.0] - 2026-05-10 — Phase 12: Aufräumen, Härten, Testen

### Removed
- **Alter MiniZinc-WASM-Solver komplett entfernt.** `src/lib/solver/`
  Verzeichnis (model.mzn, encode.ts, decode.ts, service.ts, diagnose.ts
  und Tests, plus `__perf__/`-Harness) ist weg. `minizinc` keine
  Dependency mehr — entspart 143 MB in node_modules.
- `LessonSpec.pairedWith` Legacy-Feld entfernt. `couplingId` ist seit
  Phase 8 v3 die einzige Coupling-Quelle. Migration entfernt das Feld
  beim nächsten Save aus alten Docs.
- Toter `{#if false}`-Block in `RulesPanel.svelte` (Slider-Helpers
  ohne Aufrufer) entfernt.

### Added
- `src/lib/solver-v2/diagnose.ts` — Pre-Flight-Diagnose ist jetzt
  team-teaching-aware: prüft jeden Lehrer einer Coupling, jeden
  Eintrag in `spec.teachers` einzeln auf Existenz/Verfügbarkeit.
- `src/lib/types-ui.ts` — zentraler Ort für UI-Typen (`DragPayload`).
  Vorher in `ScheduleGrid` und `ScheduleCell` doppelt definiert.
- `src/lib/teacher-helpers.ts` — `teacherById/teacherColor/teacherName`
  als pure Helper. Ersetzt 2-3 inline-Kopien in den Komponenten.
- Score-Komponenten-Tests vervollständigt: `min_daily`, `uneven_days`,
  `compact_teacher` haben nun dedizierte Unit-Tests. Insgesamt 14 von
  14 Komponenten getestet (vorher 7).

### Fixed
- **Tabu-Asymmetrie in Local Search.** `pushTabu` schrieb den Ziel-Slot
  ins Tabu, `isTabu` prüfte den Quell-Slot — die Tabu blockierte das
  Falsche. Korrekt: nach Move U: s_old → s_new wird U:s_old für
  `tabuTenure` Iterationen tabu (Reverse-Move-Schutz). Bench-Effekt
  auf Liste.csv (10 s ILS): Score 4094 → 3492 (-15 %).
- **`tStartLS` Reheat-Cap.** Bei vielen erfolglosen Restarts wuchs die
  SA-Starttemperatur unbegrenzt (200 + 50×N). Bei T>1000 akzeptiert SA
  praktisch jeden Move → Random-Walk-Drift, aktive Verschlechterung
  des Best-Scores. Cap auf 500 (~5× Normaltemperatur) eingebaut.
- **ILS-DRY-Refactor mit Drift-Bug-Fix nebenbei.** Sync und Async
  ILS-Variante hatten ~150 Zeilen identische Logik dupliziert. Beim
  letzten KempeBoost-Patch wurde der Async-Variant vergessen, sodass
  sie ihn nicht durchreichte. Jetzt teilen sich beide einen
  gemeinsamen Algorithmus-Kern; nur die Loop-Strategy unterscheidet.

### Changed
- `solver-v2/index.ts` importiert `diagnose` jetzt aus dem eigenen
  Verzeichnis statt aus dem v1-Tree.
- `mustStartFirstPeriod` hat jetzt `weight` (vorher hartcodiert 300).
- `scripts.test` und `scripts.test:watch` in `package.json` ohne
  `--exclude src/lib/solver/__perf__/**` (das Verzeichnis existiert
  nicht mehr).

### Documentation
- ADR-0013 (TypeScript Construct + Local Search) Status: proposed → accepted.
- `CLAUDE.md` Architektur-Block, Solver-Sektion, Phasen-Status auf
  aktuellen Stand gebracht. Verbotene-Aktionen-Liste ohne MiniZinc.
- `README.md` Stack-Zeile, Verzeichnisbaum, Status-Liste, „Was
  funktioniert vollständig"-Block aktualisiert. Phase-5b-Bug-Notiz
  entfernt (historisch).
- `docs/CONTEXT.md` Technische-Stützpunkte ohne MiniZinc-WASM.
- `docs/REQUIREMENTS.md` Phase 11 + 12 als abgeschlossen markiert,
  Phase 13 als Ausblick.

### Stats
- Tests: 151 grün (vorher 206; -55 v1-Tests sind physisch entfernt,
  +6 neue Score-Tests)
- TypeScript: 0 Errors, 0 Warnings
- Bundle: 53.52 KB gz JS / 4.64 KB gz CSS (~57 KB total)
- node_modules: ~143 MB kleiner ohne minizinc

## [0.11.0] - 2026-05-09 — Phase 11: Solver-Architektur-Wechsel

### Added
- **TypeScript-eigener Solver** in `src/lib/solver-v2/` (Construct +
  Iterated Local Search). Ersetzt den MiniZinc-WASM-Solver. Auf der
  echten Liste.csv: Score in 10 s von ~28 000 auf ~3500, alle harten
  Constraints erfüllt, no_free=0.
- **14 Score-Komponenten** (Untis-Style) konfigurierbar im RulesPanel:
  `min_daily`, `no_p1_start`, `main_aft`, `any_aft`, `no_free`,
  `uneven_days`, `main_run`, `compact_teacher`, `main_early`,
  `time_pref`, `subject_twice`, `spec_spread`, `teacher_overload`,
  `teacher_no_lunch`.
- **Tageszeit-Präferenz pro Lerneinheit** (`LessonSpec.timePref`:
  `'early'` | `'late'`). Neue Spalte „Zeit" in der Lerneinheiten-Liste
  + Bulk-Toolbar. Specs ohne Wert verhalten sich wie bisher.
- **Team-Teaching pro Lerneinheit** (`LessonSpec.teachers: TeacherId[]`,
  Schema v3 → v4). Eine Spec kann zwei Lehrer parallel haben (z. B. BSP
  Knaben + Mädchen). Stundenplan-Zelle zeigt zwei Lehrer-Badges
  nebeneinander, geteilten Hintergrund. Solver-Hardcheck respektiert
  alle Team-Lehrer.
- **Auto-Lockerung „keine Hohlstunden"** (`noFreePeriodsForClass.strict`):
  Phase 1 mit massivem Gewicht (×50), Phase 3 mit normalem Gewicht
  falls Lücken nicht vermeidbar. UI zeigt RelaxationInfo-Banner.
- **Lehrer-Tageslast-Limit** (`Teacher.maxLessonsPerDay`).
- **Mittagspause-Constraint** (`teacherLunchBreak`) mit konfigurierbarem
  Mittagsfenster.
- **Adaptive Iterated Local Search**: Reheat + KempeBoost +
  Perturbations-Stärke wachsen mit erfolglosen Restarts.
- **Untis-Style RulesPanel** in 3 Sektionen (Klassen & Stufen / Pädagogik
  / Lehrer), Tooltips an jeder Regel, alle Gewichte sichtbar editierbar.
- **`findHardViolations`** als defensives Safety-Net in Construction
  und am Decode-Boundary — verhindert dass alte localStorage-Pläne mit
  Doppelbelegungen ans UI durchschlagen.

### Fixed
- Coupling-Block-Stunden: Doppelstunden in Couplings produzieren
  jetzt korrekte Instances pro Block-Position.
- Ejection-Chain mit vollem Snapshot-Revert (verhindert inkonsistente
  Zwischenzustände bei Teil-Erfolg).
- Coupling-Aggregation in der Diagnose: gekoppelte Specs zählen einmal
  pro Stufe, nicht pro Spec.

### Architecture
- ADR-0013 (TypeScript Construct + Local Search) ersetzt ADR-0002
  (MiniZinc-WASM).
- Schema v3 → v4: `LessonSpec.teachers[]` statt `teacher`.

## [0.10.0] - 2026-05-08 — Phase 10: Anytime-Solver + Streaming-UI

### Added
- **Hartes Constraint „Beginn in P1"**: wenn eine Stufe an einem Tag
  überhaupt unterrichtet wird, muss P1 belegt sein. Verhindert „Schule
  beginnt erst in der 4. Stunde". Konfigurierbar via
  `ConstraintConfig.mustStartFirstPeriod.enabled`.
- **Streaming `SolveSession`** (`startSolve(doc, opts)` neben dem
  bestehenden `solve()`): liefert Live-Events für Phasen, Fortschritt,
  jede gefundene Zwischenlösung, Lockerungen, Fertigstellung. Mit
  `abort()` jederzeit unterbrechbar — die letzte gestreamte Lösung
  wird übernommen.
- **Live-Streaming-UI im GenerateButton**:
  - Progress-Bar mit Restzeit
  - aktueller bester Score und SVG-Sparkline der Score-History
  - Convergence-Hint („letzte Verbesserung vor X s")
  - Abbrechen-Button — beste bisher gefundene Lösung bleibt im Plan
  - Plan im Grid wird **live** mit jeder besseren Lösung aktualisiert
- **Strukturierte `RelaxationInfo`** in `SolverOutput`. UI zeigt Banner
  zuverlässig bei JEDER aktiven Lockerung (vorher nur bei Block-
  Lockerung — Tagespensum-Reduktion war unsichtbar).
- **5-stufige Auto-Lockerung** (war 3-stufig in Phase 9):
  Blocks → minDaily 3 → minDaily 0 → mustStartP1 off → final UNSAT.
- ADR-0012 dokumentiert die Designentscheidungen.

### Fixed
- **UI-Bug**: Tagespensum-Lockerung war im Banner nicht sichtbar.
  Jetzt strukturiert über `RelaxationInfo` und mit klarer Liste der
  aktiven Lockerungen.

### Changed
- `GenerateButton.svelte` verwandelt vom Single-Click-Button zum
  Live-Dashboard mit Progress, Score-History und Abbrechen-Knopf.
- Bestehender `solve(doc, opts)` bleibt für Tests, Logik unverändert
  außer 5-stufiger Lockerung statt 3-stufiger.

### Tests
- 3 neue Tests (Constraint 12 emission, mustStartFirstPeriod migration,
  startSolve pre-flight short-circuits). Total: 109 grün.

## [0.9.0] - 2026-05-08 — Phase 9: Tagesverteilung + Doppel/Einzel-Cohesion

### Added
- **Hartes Tagespensum**: jede Schulstufe braucht an jedem Wochentag mindestens
  N Stunden (Default 4). `ConstraintConfig.minDailySlotsPerGrade`. UI-Feld in
  `RulesPanel`. Verhindert dass der Solver Tage komplett auslässt.
- **Hartes „Doppel ⇒ kein Einzel"** (Constraint 11 in `model.mzn`): zwei
  Lesson-Instanzen derselben Spec am gleichen Tag müssen konsekutiv sein. Damit
  ist eine Doppelstunde automatisch die einzige Belegung des Tages für die Spec.
- **Soft-Constraint „Auch Nebenfächer am Nachmittag vermeiden"** mit eigenem
  Gewicht (Default 15). Sub-Toggle unter „Hauptfach nicht am Nachmittag" im
  RulesPanel.
- **Dreistufige Auto-Lockerung**: bei UNSAT lockert `service.ts` automatisch
  zuerst die Block-Patterns, dann das Tagespensum von 4 auf 3, dann auf 0.
  UI meldet welche Lockerung aktiv war.
- **Diagnose-Erweiterungen**: Pre-Flight warnt wenn Stufe weniger als
  D × min_daily Wochenstunden hat oder wenn eine Spec count > D mit strikten
  Singles hat.
- ADR-0011 dokumentiert die Designentscheidungen.

### Changed
- `decode.SolverOutput.penalties` erweitert um `any_aft`.
- `GenerateButton` Score-Breakdown zeigt zusätzlich „Stunden am Nachmittag
  (alle Fächer)".
- Phase-9-Migration in `persistence.ts` setzt für bestehende Pläne sinnvolle
  Defaults (`minDailySlotsPerGrade: 4`, `applyToAllSubjects: true`,
  `weightAllSubjects: 15`).

### Tests
- 8 neue Tests (DZN-Parameter-Emission + Diagnose-Erweiterungen + Penalty-
  Decoding). Total: 102 grün.

## [0.8.0] - 2026-05-08 — Phase 8: Schema-Migrationen v1→v2→v3

### Added (v3)
- **Trennung Stufen-Bezeichnung und Kopplung**: `LessonSpec.groupKey` aufgespalten in
  - `groupLabel` — beschreibend, aus CSV-Spalte „Gruppe", **kein Solver-Effekt**
  - `couplingId` — harte Solver-Kopplung (zeitgleicher Slot), nur manuell vom User gesetzt
  Siehe [ADR-0010](docs/decisions/0010-grouplabel-vs-couplingid.md).
- UI: `groupLabel` als kursives, dashed-border-Badge in der Klassen-Spalte.
  Kopplungs-Spalte und ScheduleCell-Pastell-Hintergrund nutzen jetzt nur `couplingId`.
- Migration v2→v3 (Option A — konservativ): alte `groupKey`-Werte werden zu
  `groupLabel`. Keine Auto-Kopplung — User legt echte Kopplungen explizit neu an.
- CSV-Import setzt nur `groupLabel`, niemals `couplingId`.

### Fixed (v2)
- **`PlacedLesson.grade`-Feld** + Schema-Migration v1→v2. Multi-Grade-Specs
  (`grades=[5,6]`) werden jetzt als eine `PlacedLesson` pro Stufenspalte
  gespeichert statt einmal mit Render-Fan-Out — User-Bug „Solver platziert
  mehr Lehreinheiten als definiert" war ein Render-Bug, kein Solver-Bug.
- `placedCountForSpec()` zählt jetzt eindeutige `(day, period)`-Slots
  statt Roheinträge, damit Multi-Grade-Specs nicht mehrfach gezählt werden.
- `checkPlacementConflict()` ist grade-aware.
- Solver-Encoder pinning nutzt `p.grade` direkt (statt aus `spec.grades` zu expandieren).

### Tests
- 11 neue v2-Tests + 4 neue v3-Tests. Total: 92 Tests grün.

## [0.7.0] - 2026-05-08 — Phase 7B: Flexible Block-Patterns + Soft-Constraints

### Added
- **Auto-Modus für Block-Pattern** (`LessonSpec.blocks` jetzt optional):
  Bei leerem Pattern entscheidet der Solver — max. 1 Doppelstunde pro Spec,
  niemals 3er-Run. Strikte Patterns wie `[2,1]` bleiben harte Vorgabe.
  Siehe [ADR-0008](docs/decisions/0008-flexible-block-patterns.md).
- **„Automatisch"-Option** in der Block-Pattern-Dropdown (oberster Eintrag,
  kursiv-grau). Tooltip erklärt das Verhalten. Bulk-Action „Block-Pattern Auto"
  setzt mehrere Specs gleichzeitig auf Auto.
- **Soft-Constraints aus `RulesPanel`** fließen jetzt als gewichtete
  Penalty-Zielfunktion in den Solver: `solve minimize total_penalty` statt
  `solve satisfy`. Toggle aus = Gewicht 0 = Term entfällt zur Compile-Zeit.
  Siehe [ADR-0009](docs/decisions/0009-soft-constraints-as-penalties.md).
- **Score-Breakdown** in `GenerateButton`: ausklappbares `<details>` zeigt
  jeden aktiven Penalty-Wert + Total nach erfolgreichem Run.
- **Auto-Lockerung bei UNSAT**: Wenn der erste Solver-Lauf mit den
  konfigurierten strikten Block-Patterns UNSAT liefert, läuft der Solver
  automatisch ein zweites Mal mit allen Patterns auf Auto. UI zeigt eine
  gelbe Warnung mit den betroffenen Specs.
- MiniZinc-Suche jetzt mit Most-Constrained-Variable-Heuristik
  (`first_fail + indomain_min`) — schneller bei großen Modellen.

### Changed
- CSV-Import setzt frische Specs nicht mehr auf `[1,1,…count]`, sondern auf
  `blocks: undefined` (= Auto-Modus).
- `persistence.ts`-Migration konvertiert das alte Default-Pattern aus
  bestehenden localStorage-Plänen automatisch zu `undefined`. Vom User
  explizit gesetzte Patterns wie `[2,1]` bleiben strikt erhalten.
- `decode.ts` erweitert `SolverOutput` um `penalties`-Aufschlüsselung und
  `relaxedSpecIds` für die Auto-Lockerungs-Anzeige.

### Tests
- 6 neue Tests für Auto-Mode-Encoding (auto / strict / mixed in einer Doc).
- 2 neue Tests für Penalty-Decoding aus dem Solver-Output.
- Total: 77 Tests (von 69 in 7A).

## [0.5.0] - 2026-05-08 — Phase 5d: Lehreinheiten-Kopplung

### Added
- Bulk-Toolbar in `SpecList`: **Koppeln**- und **Entkoppeln**-Buttons mit Soft-Validierung bei unterschiedlichen Stundenzahlen.
- Group-Tag mit Hover-× zum gezielten Entfernen einer einzelnen Spec aus einer Gruppe.
- Visuelle Coupling im Stundenplan-Grid: gestapelte Lessons mit gemeinsamem deterministischen Pastell-Hintergrund + dünner dashed Trennlinie zwischen den parallelen Stunden.

## [0.4.0] - 2026-05-08 — Phase 5c: Block-Pattern + Solver-Ignore

### Added
- `BlockPattern` auf `LessonSpec` (z. B. `[2,2]` = 2 Doppelstunden, `[1,1,1,1]` = 4 Einzelstunden).
- Block-Pattern-Dropdown in der Lehreinheiten-Tabelle, mit auto-generierten Vorschlägen abhängig von `count`.
- `includeInSolver`-Flag pro Spec (Förderunterricht etc. ausnehmen, weiterhin manuell platzierbar).
- `maxConsecutive` pro Subject (max 3 Mathe in Folge verboten).
- Bulk-Toolbar mit Mehrfach-Auswahl: Duplizieren, Solver-Toggle, Wochen-Pattern, Bulk-Delete.
- Group-Coloring (deterministische Pastell-Farbe pro `groupKey`) als Streifen + Pill-Tag.
- "Planung verwerfen"-Button in `ScheduleGrid` (löscht nur Placements, Stammdaten bleiben).

### Fixed
- Auto-Save (`initStore`-`$effect.root`) für `bind:value`-Mutations — Bind-Änderungen wurden vorher nicht persistiert.

## [0.3.0] - 2026-05-08 — Phase 5b: Solver- + Reactivity-Fixes

### Fixed
- Solver-Modell auf 3D-Slots umgestellt (`day, period, grade` statt nur `day, period`).
- Spec-Expansion erzeugt 1 Lesson-Instanz pro `(occurrence × grade)`, via synthetischem `groupId` an dieselbe `(day,period)` gebunden.
- `ScheduleCell`-Subkomponente extrahiert mit defensivem `each`-Key gegen duplicate placements.
- Migration auf `setContext`/`getContext`-Pattern für stabile Cross-Component-Reactivity.

## [0.2.0] - 2026-05-08 — Phase 1–5: MVP

### Added
- Vite + Svelte 5 (Runes) + TypeScript Skelett mit vitest.
- Datenmodell: `Teacher`, `Subject`, `LessonSpec`, `PlacedLesson`, `ScheduleDoc`, `ConstraintConfig`.
- Sokrates-CSV-Importer mit 21 Tests gegen echte `Liste.csv`.
- Editor: `TeacherList` (mit 5×8-Verfügbarkeits-Mini-Raster), `SubjectList`, `SpecList`, `RulesPanel`.
- `ScheduleGrid` mit Drag&Drop via `@thisux/sveltednd`, 4 Schulstufen-Spalten pro Tag, Live-Konflikt-Erkennung.
- MiniZinc-WASM-Solver mit harten Constraints (Lehrer-/Klasse-Doppelbelegung, Verfügbarkeit, Pinning, G/U-Wochen-Pattern).
- localStorage-Persistierung + JSON-Export/Import als Backup.
- "Aktuelle Stunde"-Highlight + ISO-KW-Anzeige (G/U).

## [0.1.0] - 2026-05-07 — Initial scaffold

### Added
- Vite + Svelte 5 + TypeScript Projekt-Init.
- npm-Pakete `@thisux/sveltednd` und `minizinc` installiert.
- Lokales Git-Repo initialisiert.
