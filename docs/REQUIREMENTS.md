# Anforderungen & Vision

> Diese Datei ist das **„Was muss die App können?"-Dokument**, sortiert nach
> Status. Jede neue Session sollte hier nachsehen bevor sie etwas baut, das
> bereits Out-of-Scope-erklärt wurde.

## ✅ Done (verifiziert in Phasen 1–5d)

### Stammdaten
- **CSV-Import** des Sokrates-Exports „Liste" mit Vorschau-Diff (idempotent
  per Personalnummer / Subject-Code).
- **Lehrer-Tabelle** mit Inline-Edit, Farbpicker, Personalnummer-Badge,
  Leitung/Platzhalter-Markierung, Multi-Select für Fächer-Zuweisung,
  5×8-Verfügbarkeits-Mini-Raster (harte Constraint im Solver).
- **Fächer-Tabelle** mit Code, Name, Kategorie (PG/VÜ/FÖ/KU), Hauptfach-Flag,
  Stunden pro Stufe, **maxConsecutive** (max gleiche Fächer in Folge).
- **Lehreinheiten-Tabelle** mit Block-Pattern-Dropdown, Solver-Toggle,
  Wochen-Pattern, **Bulk-Toolbar** (Duplizieren, Solver an/aus, Wochen-Pattern,
  Koppeln, Entkoppeln, Bulk-Delete), Group-Tag mit Hover-× zum gezielten
  Entkoppeln, deterministische Pastell-Farbe pro `groupKey`, Filter +
  Gruppierung.

### Solver
- **MiniZinc-WASM** im Browser, harte Constraints:
  - Lehrer/Klasse nicht doppelt (außer in Kopplung)
  - Lehrer-Verfügbarkeit
  - Pinning unverschiebbar
  - Wochen-Pattern (G/U) konsistent
  - Distinct-Slots für Spec-Occurrences
  - Block-Pattern (z. B. `[2,2]` = Doppelstunden-Kontiguität)
  - Subject `maxConsecutive` (max 2 Hauptfächer in Folge)
  - Specs mit `includeInSolver=false` werden übersprungen
- 3D-Slot-Modell: `(day, period, grade)` = 5×8×4 = 160 Slots
- Performance: ~25s auf der echten `Liste.csv` (52 Specs, 155 Lessons)

### Anzeige & Editor
- **Wochenraster** mit 5 Tag-Spalten × 4 Stufen-Sub-Spalten × 8 Stunden-Zeilen
- **Drag & Drop** via `@thisux/sveltednd` (Specs aus Sidebar in Slots ziehen,
  Live-Konflikt-Erkennung, Pin-Toggle)
- **Filter-Bar** mit Lehrer-Chips (farbig), Stufen-Toggles, Fach-Dropdown
- „**Aktuelle Stunde**"-Highlight und ISO-KW-Anzeige (G/U)
- **Coupling-Visualisierung:** Zellen mit Specs gleichen `groupKey` bekommen
  Pastell-Hintergrund + dünne Trennlinien zwischen den Stunden
- „**Planung verwerfen**" (löscht nur Placements, Stammdaten bleiben)
- **JSON-Export/Import** als Backup (Schema-versioniert)

### Infrastruktur
- 77 Unit-Tests (vitest) — Block-Pattern, CSV-Parser, Encode/Decode, Diagnose, Soft-Constraints
- TypeScript strict, svelte-check sauber
- GitHub Actions CI: test → build → deploy → live
- MIT-Lizenz, Public-Repo

### Phase 7A — Solver-Robustheit
- Pre-Flight-Diagnose mit `Hint[]`-Liste vor dem Solver-Lauf (Lehrer-Überlast,
  Pinning-Konflikte, ungültige Specs).
- Multi-Grade-Pinning per `pinsBySpecGrade`-Map korrekt expandiert.
- Constraint 7 entkoppelt von `gradeOf`-Equality (Multi-Grade-Blocks SAT-bar).

### Phase 7B — Flexible Block-Patterns + Soft-Constraints
- **Auto-Modus** für `LessonSpec.blocks`: leer = Solver entscheidet (max 1
  Doppelstunde, keine 3er). Explizites Pattern = strikter Override.
- **Soft-Constraints** aus `RulesPanel` als gewichtete Penalty-Funktion;
  `solve minimize total_penalty` mit `first_fail`-Suche.
- **Auto-Lockerung**: bei UNSAT zweiter Lauf mit allen Patterns auf Auto.
- **Score-Breakdown** im UI nach SAT-Run.
- Migration alter localStorage-Pläne von `[1,1,…]` → `undefined`.

## ⚙️ Phase 11 — Aktuelle Arbeit: Solver-Architektur-Wechsel

**Stand:** Konzept fertig (siehe `docs/SOLVER-V2-CONCEPT.md`), ADR-0013 dokumentiert,
Implementierung in 11 Schritten geplant (`~/.claude/plans/`).

**Begründung:** 4h Tuning der MiniZinc-Engine in Phasen 5–10 → Plateau-Verhalten,
Score plateau'd bei ~4700 trotz 5 min Optimierung. Constraint Programming ist
strukturell ungeeignet für Schul-Stundenpläne mit Soft-Constraints. Untis und
FET nutzen seit 30 Jahren Construct + Local Search.

**Implementierung:** TypeScript-eigener Solver in `src/lib/solver-v2/` mit drei
Phasen (Construction → Local Search → Iterated LS). API-kompatibel mit dem
bestehenden `startSolve()`. UI ändert sich nicht.

**Erwartetes Ergebnis:** Score-Reduktion 50–100× schneller als MiniZinc, Plan
auf Liste.csv mit Score < 2500 in 30 s (statt 4765 nach 5 min).

## 🔜 Phase 12 — Nach Solver v2

### High-Prio (post-Solver)
1. **`PlacedLesson.grade`-Feld + Schema-Migration v1→v2.**
   ✅ ERLEDIGT in Phase 8. Drag & Drop ist grade-aware.

2. **Print-Layout.**
   `@media print` für:
   - A4 pro Lehrer (eine Seite, nur dessen Stunden farbig hervorgehoben)
   - A4 pro Schulstufe
   - „Nur Plan ohne Editor-Chrome"-Modus

### Medium-Prio
4. **Schuljahr-Wechsel im UI.** Aktuell ist `schoolYear` einfach ein
   String — UI zum Klonen eines vorhandenen Plans als Basis für das nächste
   Jahr (heutiger Workaround: JSON-Export, Datei umbenennen, importieren).

5. **Lehrer-Verfügbarkeit pro Wochentag-Block.** Aktuell muss man jede einzelne
   Slot anklicken; bei einem Teilzeit-Lehrer der Mo–Mi arbeitet sind das viele
   Klicks. Schnell-Action „ganzer Tag".

6. **Konflikt-Liste in der Sidebar.** Wenn nach Drag & Drop oder Edit ein
   Konflikt entsteht, sollte er prominent angezeigt werden (nicht nur im
   Drop-Alert).

## 🔭 Vision (langfristig, nicht in nächster Phase)

- **Multi-Schuljahr in einer App:** Mehrere `ScheduleDoc` parallel, Wechsel via
  Dropdown. Heute: ein Doc pro localStorage-Key.
- **Schul-agnostisch werden:** Mehrstufenklassen-Modell konfigurierbar machen
  (Anzahl Klassen, Stufen-Mapping). Wäre eine Voraussetzung für andere kleine
  Schulen.
- **Backend (optional):** Cloudflare Worker + D1 für Multi-User-Read-Zugriff
  ohne Login (URL-Token-Sharing). Nur falls echtes Bedürfnis entsteht.
- **Untis-Import.** Manche Schulen haben Untis-Exporte; ein zweiter Importer
  würde die Reichweite erhöhen.
- **PDF-Export** statt nur Browser-Druck.

## ❌ Out of Scope (bewusst ausgeschlossen)

- **SUP-Modul** (Supplierungsplaner). War im alten Vorbild dabei, ist eine
  eigene App-Klasse, würde dieses Projekt aufblähen.
- **Räume.** Die Schule hat ein Mehrstufen-Modell ohne Raumkonflikte als
  Hauptproblem. `LessonSpec` hat absichtlich kein `room`-Feld.
- **Parallel-Klassen pro Stufe (5a/5b).** Die MS SiG hat das nicht. Sollte ein
  späterer Schul-Adapter es brauchen, ist das eine Vision-Phase mit eigenem
  Daten-Modell.
- **Klassenbuch-Funktionen** (Anwesenheit, Noten). Das macht Sokrates / WebUntis.
- **Echtzeit-Kollaboration.** Solo-Tool. Wer zeitgleich am Plan arbeitet, soll
  vorher reden.
- **Stundenplan-Versionierung in der App.** Nutze Git oder mehrere
  JSON-Backup-Dateien.

## Akzeptanzkriterien für „Phase 7 fertig"

Phase 7 ist erfolgreich abgeschlossen wenn:
1. Drag & Drop funktioniert grade-bewusst (Mehrstufen-Lesson in **einer**
   Stufen-Spalte angezeigt, nicht in allen)
2. Mindestens 2 weiche Constraints (z. B. „kein Hauptfach nachmittags" + „keine
   Freistunden") fließen in den Solver ein und beeinflussen das Ergebnis
   nachweisbar
3. Drucken eines Lehrer-Wochenplans ergibt eine **lesbare** A4-Seite ohne
   manuelles CSS-Tweaken
4. Tests alle grün, CI grün, Live-URL aktualisiert

## Glossar (für AI-Sessions)

| Begriff             | Bedeutung                                                                            |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Lehreinheit / Spec** | Datenmodell `LessonSpec`. Eine „Was, Wer, Wie viele Stunden, Welche Stufen, Welche Kopplung". |
| **PlacedLesson**    | Eine in einen Slot platzierte Spec. `(specId, day, period, pinned)`.                 |
| **Slot**            | (day, period, grade) = 5×8×4 = 160 Stück.                                             |
| **Block (Pattern)** | Stundenaufteilung: `[2,2]` = 2 Doppelstunden, `[1,1,1,1]` = 4 Einzeln.               |
| **groupKey**        | String der mehrere Specs in denselben Slot zwingt (Parallel-Unterricht).            |
| **Mehrstufenklasse**| Klasse mit Schüler:innen aus mehreren Schulstufen. 1a=5./6., 2a=7./8.                  |
| **Sokrates**        | Österreichisches Schul-Verwaltungsprogramm; liefert die CSV-Datenquelle.            |
| **G/U-Woche**       | Gerade/ungerade ISO-Kalenderwoche; manche Fächer wechseln wochenweise.              |
| **Pinning**         | Manuelle Fixierung einer Stunde, Solver darf sie nicht verschieben.                 |
| **SUP**             | „Supplierung" — Vertretungsstunde. **Bewusst nicht** Teil dieser App.               |
| **Hauptfach**       | `Subject.isMain = true` (D, E, M). Spielt Rolle für `maxConsecutive` & Soft-Constraints. |
