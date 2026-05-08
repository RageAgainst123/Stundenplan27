# ADR-0007: CSV-Import als Seeder, nicht als Sync

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Der Sokrates-CSV-Export („Liste") enthält strukturiert die Lehrer, Fächer
und Lehreinheiten. Frage: Soll die App **synchron** mit Sokrates bleiben
(jede CSV-Änderung wird re-importiert und überschreibt manuelle Anpassungen)
oder ist die CSV nur ein **Startpunkt** (einmal importieren, danach im
Editor frei verändern)?

## Entschieden

**CSV ist Seeder, nicht Sync.** Nach dem Import wird alles im Editor frei
änderbar:
- Lehrer umbenennen, Farben setzen, Verfügbarkeiten markieren
- Fächer-Kategorien ändern, Hauptfach-Flag setzen, `maxConsecutive`
  konfigurieren
- Lehreinheiten splitten, koppeln, Block-Pattern auswählen, Solver-Toggle

Re-Import wird **kein** Auto-Merge sein, sondern eine Diff-Vorschau die
neue Einträge anbietet ohne bestehende zu überschreiben (idempotent per
Personalnummer / Subject-Code).

## Verworfen

- **Voll-Sync (CSV-Datei watch + Reapply):** Würde manuelle Anpassungen
  bei jedem Re-Import zerstören. Nicht praktikabel.
- **Einseitiger Schreib-Sync zurück nach Sokrates:** Sokrates ist proprietär,
  hat keine offene API für Schreib-Operationen.

## Konsequenzen

**Vorteile:**
- User behält volle Kontrolle nach dem Import. Editor ist die Quelle der
  Wahrheit.
- App kann auch ohne CSV-Datei genutzt werden (manuelles Anlegen aller
  Stammdaten möglich).
- JSON-Backup (siehe ADR-0003) ist die einzige Persistenz, was klare
  Datenschutz-Lage ergibt.

**Kosten:**
- Bei großen Lehrkörper-Änderungen mitten im Schuljahr (z. B. neuer Lehrer)
  muss der User manuell entweder neu importieren (Diff-Vorschau) oder die
  Lehrkraft im Editor anlegen.
- Die App weiß nicht von Stundentafel-Änderungen in Sokrates, sofern der
  User nicht aktiv re-importiert.

## Format-Konventionen die der Parser kennt

(Reicht nur als Übersicht — Details in `src/lib/import/csv.ts`.)

- Spalten: `Gegenstand;Klasse(n);Gruppe;Stunden;ErgStunden;Schulstufen;LehrerIn`
- Fach-Präfixe: `PG_` (Pflicht), `VÜ_` (Verbindl. Übung), `FÖ_` (Förder), `KU_` (Kurs)
- Klassen: `1a`, `2a`, oder `1a+2a` (klassenübergreifend)
- Schulstufen: `05,06` oder `05, 06, 07, 08` (Whitespace tolerant)
- `Stunden` + `ErgStunden` werden zu `count` summiert (irrelevant für Solver,
  nur Buchungs-Konvention in Sokrates)
- Wochen-Pattern (G/U) wird **manuell** im Editor gesetzt — nicht aus der CSV
  ableitbar
- `Gruppe` wird zum `groupKey` (Parallel-Unterricht-Schlüssel)
- Lehrer-Format: `Nachname Vorname (Personalnummer) [(Leitung)]`
  oder `Zz_Planung_…`/`N. N.` für unbesetzte Stellen
