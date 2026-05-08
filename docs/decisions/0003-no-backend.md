# ADR-0003: Persistenz — localStorage, kein Backend

**Status:** accepted
**Datum:** 2026-05-07

## Kontext

Die App ist ein Solo-Tool für eine kleine Schule. Datenmenge pro
Schuljahr: ~50 Lehreinheiten + ~10 Lehrer + ~20 Fächer. Multi-User-Editing
ist explizit Out-of-Scope (siehe `docs/REQUIREMENTS.md`). Datenschutz: Lehrer-
und Stunden-Daten der Schule sollen nicht ohne klare Notwendigkeit auf einem
fremden Server liegen.

## Entschieden

**localStorage** als Primary-Storage. JSON-Export/Import als Backup-Mechanismus
und für Schuljahres-Versionierung. Schema-Migration über
`persistence.ts → migrateDoc()`.

## Verworfen

- **Cloudflare Workers + D1:** Wäre einfach + günstig, aber sobald Daten auf
  fremdem Server liegen, ist die Datenschutz-Frage für Lehrer-Daten zu klären
  — Aufwand größer als Nutzen für ein Solo-Tool.
- **JSONBin / Firestore:** Klassische Backend-as-a-Service-Optionen, gleiche
  Datenschutz-Bedenken plus API-Key-Probleme.
- **IndexedDB:** Mehr Speicherplatz als localStorage, aber komplexere API. Bei
  unserer Datenmenge (~30 KB JSON) overkill.
- **Filesystem-Access-API:** Browser-Support mau, würde Web-App-Fühlung
  brechen.

## Konsequenzen

**Vorteile:**
- Zero-Setup für den Nutzer. App lädt, läuft, persistiert.
- Klares Datenschutz-Modell: Daten verlassen den Browser nur via expliziten
  JSON-Export.
- Keine Backend-Wartung, keine Auth-Logik, keine Server-Kosten.
- GitHub Pages als Hosting reicht (statisch).

**Kosten:**
- localStorage ist browser-/profil-gebunden. Wechsel des Geräts erfordert
  JSON-Export → Import.
- Multi-Tab-Synchronisierung gibt es nicht; bei zwei Tabs der gleichen App
  überschreiben sich die Schreibzugriffe.
- Keine Versionierung in der App. Für mehrere Schuljahre: mehrere Export-Files.

## Folge-Entscheidungen

- localStorage-Key: `stundenplan27.doc` (siehe persistence.ts). Nicht ändern
  ohne Migration.
- JSON-Export via Browser-`a.download`-Pattern, kein Server-Roundtrip.
- Schema-Versionierung im `meta.schemaVersion`-Feld; aktuelles Schema = `1`.
