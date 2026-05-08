# ADR-0010: groupLabel vs. couplingId — Trennung Stufen-Bezeichnung und Solver-Kopplung

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Bis Phase 8 v2 hatte `LessonSpec` ein einziges Feld `groupKey?: string`, das
**zwei semantisch unterschiedliche Konzepte** vermischte:

1. **Sokrates-„Gruppe"-Spalte** als deskriptive Stufenbezeichnung — z. B.
   `DGB 1/2` (= Stufen 5+6), `PG_REL_RRK_1` (= Religion-Gruppe 6+7),
   `Bewegung und Sport Mädchen` (= Mädchen-Sport-Gruppe). Beim Sokrates-
   Export ist diese Spalte ein **rein beschreibendes Label**.
2. **Echte parallele Lehrer-Kopplung** — z. B. wenn Knaben-BSP (Lehrer A) und
   Mädchen-BSP (Lehrer B) zwingend zur gleichen Zeit unterrichtet werden,
   damit die Klasse aufgeteilt werden kann.

Der Solver behandelte aber **jeden** `groupKey` als Kopplung (`encode.ts`
Constraint: alle Specs mit gleichem groupKey teilen sich `(day, period)`).
Das war nur dann unkritisch, weil in der echten Sokrates-CSV jede Gruppen-
Bezeichnung **eindeutig** ist (jede `groupKey`-Zeichenkette taucht in genau
einer Spec auf). Sobald der User aber zwei Specs mit dem gleichen Sokrates-
Label hatte, hätte der Solver fälschlich gekoppelt.

In der UI führte das zur Verwechslung: Eine Spec mit `groupKey="DGB 3/4"`
zeigte den Pastell-„Kopplung"-Tag, obwohl es gar keine Kopplung war,
sondern nur eine Stufen-Beschreibung.

## Entschieden

`LessonSpec.groupKey` in **zwei separate Felder** aufspalten:

```ts
interface LessonSpec {
  // ... vorhandene Felder
  groupLabel?: string;   // Sokrates "Gruppe" — display only, no solver effect
  couplingId?: string;   // hard solver constraint — same slot, parallel teaching
}
```

**Zuordnung:**

- **CSV-Import** schreibt das Sokrates-„Gruppe"-Feld nur in `groupLabel`,
  niemals in `couplingId`.
- **`couplingId`** wird ausschließlich vom User gesetzt — typisch über die
  Bulk-Action „Koppeln" in der Lehreinheiten-Tabelle.
- **Solver (`encode.ts`)** liest nur `couplingId`. `groupLabel` ist im Solver
  unsichtbar.
- **Konflikt-Check (`schedule-helpers.checkPlacementConflict`)** behandelt
  Specs als „same group" nur wenn `couplingId` übereinstimmt.

**UI-Trennung:**

- `groupLabel` erscheint als kleines kursives, dashed-border-Badge in der
  Klassen-Spalte der Lehreinheiten-Tabelle. Kein Pastell-Hintergrund.
- `couplingId` erscheint in der Kopplungs-Spalte mit Pastell-Hintergrund
  (`groupColor()`) und Hover-×. Filter-Dropdown listet nur Kopplungen, nicht
  alle Sokrates-Labels.
- Auch im `ScheduleCell.svelte` wird der Coupling-Pastell-Hintergrund nur
  bei gemeinsamer `couplingId` aktiviert.

## Verworfen

- **Beide Konzepte zusammenlassen + Heuristik im Solver:** „Wenn ≥ 2 Specs
  mit gleichem `groupKey` → koppeln, sonst nur Label." Mehrdeutig, zu
  magisch, schwer im UI kommunizierbar.
- **Migration mit Auto-Heuristik (Option B):** „Gruppen-Werte, die in ≥ 2
  Specs mit verschiedenen Lehrern vorkommen, automatisch als `couplingId`
  übernehmen." Riskiert Fehlmigrationen und wäre für den Default-Sokrates-
  Datenstand sowieso wirkungslos (jede Gruppe ist dort eindeutig). Wir
  haben bewusst **Option A** gewählt: alles → `groupLabel`, keine Auto-
  Kopplungen. User legt echte Kopplungen explizit nach Migration neu an.
- **Sokrates-Spalte ganz ignorieren:** Geht nicht — User sieht
  `DGB 1/2` als hilfreichen Hinweis was eine Spec umfasst, gerade bei vielen
  ähnlich aussehenden Lehreinheiten. Wir wollen den Wert behalten, nur
  semantisch korrekt einordnen.

## Konsequenzen

**Pro:**
- Klare Datenmodell-Semantik. „Was ist Solver-relevant, was ist nur Doku?"
  ist nun strukturell beantwortet, nicht mehr im Code zu erraten.
- Sokrates-Import ist **konservativ**: er fügt **niemals** Solver-Constraints
  hinzu, die der User nicht aktiv gesetzt hat. Vorhersagbarer.
- UI kann beide Konzepte unterschiedlich visualisieren (graues Badge vs.
  Pastell-Tag). Das vom User adressierte Verwechslungsrisiko ist weg.
- Phase-7B-Auto-Lockerung & Diagnose nutzen `couplingId` statt `groupKey` —
  Fehlermeldungen werden präziser („Pinning-Konflikt: nicht in derselben
  Kopplung" statt unklarer „Gruppe").

**Kontra:**
- Schema-Migration v2→v3 nötig. Bestehende User mit selbst gesetzten
  `groupKey`-Werten verlieren nach dem Upgrade die Solver-Kopplungs-
  Wirkung; sie müssen über Bulk-Action „Koppeln" neu setzen. Rein praktisch
  für Geo betrifft das aber nur die wenigen handgemachten Kopplungen
  (z. B. BSP-Knaben + BSP-Mädchen) — Sokrates-Defaults bleiben unbehelligt.
- Code-Duplikation: zwei Felder statt einem, an mehreren Stellen müssen
  beide gepflegt werden. Akzeptabel für die Klarheit.

**Folge-Entscheidungen:**
- Phase 8 könnte eine **Auto-Vorschlag-Heuristik** anbieten: „Diese 2 Specs
  haben gleiches `groupLabel` und unterschiedliche Lehrer — als Kopplung
  vorschlagen?" Komfort-Feature, nicht zwingend notwendig.
- Die alte `pairedWith?: string[]`-Property in `LessonSpec` ist jetzt
  redundant zu `couplingId`. Sollte in einer späteren Phase entfernt werden
  (siehe Audit Phase-7B-Backlog).
