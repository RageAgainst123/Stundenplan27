# Projekt-Kontext

> Diese Datei beantwortet **Wer, Wo, Warum** — damit jede neue Session
> (neuer Chat, neues Modell, anderer Tag) sofort versteht für wen und für
> welche Schule diese App gebaut wird.

## Wer

- **Owner:** Geo Schlegel (Lehrer an der MS SiG, Stundenplan-Koordinator).
- **Nutzer (heute):** Geo selbst, solo. Kein Backend, kein Multi-User.
- **Nutzer (Vision):** Eventuell Kolleg:innen am Schul-Standort mit Lese-Zugriff;
  evtl. Adaption für andere kleine österreichische Mittelschulen.
- **AI-Pair:** Claude Code, dokumentiert via `CLAUDE.md` + Plan-Dateien.

## Was ist die MS SiG

Eine **kleine österreichische Mittelschule** (Sekundarstufe I, Schulstufen 5–8)
mit zwei **Mehrstufenklassen**:

| Klasse | Schulstufen | Bemerkung                                          |
| ------ | ----------- | -------------------------------------------------- |
| **1a** | 5., 6. SSt. | Wird meist getrennt unterrichtet, manchmal 5+6 zusammengezogen. |
| **2a** | 7., 8. SSt. | Wird meist getrennt unterrichtet, manchmal 7+8 zusammengezogen. |

Insgesamt nutzbare Stundenplan-Spalten: **4** (5./6./7./8. SSt.).

**Lehrkörper:** ca. 10 Lehrkräfte (Stand Liste.csv aus Sokrates),
darunter Platzhalter für noch zu besetzende Stellen (`Zz_Planung_…`, `N. N.`).

## Schul-Spezifika (kritisch fürs Datenmodell)

1. **Achse Schulstufe statt Klasse.** Der Stundenplan zeigt 4 Stufen-Spalten,
   nicht 2 Klassen-Spalten. Die Klassen-Information aus der CSV ist Metadaten;
   Solver und Anzeige arbeiten ausschließlich auf Stufen.

2. **Mehrstufen-Kopplungen.** Manche Stunden werden über mehrere Stufen
   zusammengezogen unterrichtet:
   - 5+6 (z. B. PG_BSP Knaben 1/2)
   - 7+8 (z. B. PG_BSP Knaben 3/4)
   - 5+6+7+8 (z. B. „Bewegung und Sport Mädchen" für alle 4 Stufen)
   - **6+7 klassenübergreifend** ist möglich (z. B. PG_REL_RRK_1)

3. **Zwei-wöchige Fächer (G/U-Wochen).** BBO und EH werden alternierend
   unterrichtet — eine Woche die 7. Stufe, die andere die 8. Stufe, im selben
   Slot. „G" = gerade Woche, „U" = ungerade Woche (an die ISO-Kalenderwoche
   gekoppelt).

4. **Parallele Stunden mit verschiedenen Lehrer:innen.** Z. B. BSPK (Knaben-Sport,
   Lehrer A) und BSPM (Mädchen-Sport, Lehrerin B) finden zur gleichen Zeit statt
   — das modelliert die App über `groupKey` auf `LessonSpec`.

5. **Datenquelle:** Sokrates-Verwaltungsprogramm exportiert eine
   Semikolon-CSV namens „Liste". Format-Doku siehe `src/lib/import/csv.ts`.

## Erfolgsmaßstab

Die heutige Stundenplan-Erstellung an der MS SiG dauert **ein ganzes Wochenende
manuell**. Erfolgreich ist die App wenn:

1. **Primär:** Plan für ein neues Schuljahr in <1 Stunde fertig
   (CSV importieren → Stammdaten verfeinern → Generieren → Feinjustierung).
2. **Sekundär:** Plan-Änderungen mitten im Schuljahr (Lehrerwechsel, neue Spec)
   in <5 Minuten regenerieren.
3. **Polish:** Lehrer:innen können sich ihren persönlichen Wochenplan als A4
   ausdrucken.

## Was die App **nicht** sein soll (bewusste Beschränkungen)

- **Kein Verwaltungsprogramm-Ersatz.** Sokrates bleibt die Quelle der Wahrheit
  für Lehrkörper-Stammdaten. Wir importieren, wir schreiben nicht zurück.
- **Kein Supplierungsplaner (SUP).** Wäre eine eigene App. Out of Scope.
- **Keine Räume, keine Klassen-Buchstaben (5a/5b).** Die Schule hat keine
  Parallel-Klassen pro Stufe; das vereinfacht das Modell drastisch und sollte
  so bleiben.
- **Kein Backend.** Alles läuft im Browser. localStorage + JSON-Backup als
  Persistierung. Wenn das nicht mehr reicht, ist es eine bewusste Vision-Phase.

## Technische Mindest-Stützpunkte

- Browser-only (kein Node-Runtime im Produktiv-Pfad)
- Hostbar auf GitHub Pages (statisches Bundle, ~50 KB gz)
- TypeScript-Solver lokal im Browser (Construct + Local Search,
  `src/lib/solver-v2/`). Phase 12 hat den ursprünglichen MiniZinc-WASM-
  Solver komplett entfernt.
- Datenmodell stabil: localStorage-Key `stundenplan27.doc`, Schema-Migration
  über `persistence.ts → migrateDoc()` (akzeptiert v1, v2, v3, v4, v5)

## Live-URL

https://rageagainst123.github.io/Stundenplan27/

## Referenzen für AI-Sessions

- `README.md` — Was die App heute kann (Features, Status)
- `CHANGELOG.md` — Was wann gebaut wurde
- `docs/REQUIREMENTS.md` — Was als nächstes gebaut werden soll
- `docs/decisions/` — Architektur-Entscheidungen (Solver-Wahl, Stack, Modell)
- `CLAUDE.md` — Stolperfallen + Konventionen + Befehle für Folge-Sessions
