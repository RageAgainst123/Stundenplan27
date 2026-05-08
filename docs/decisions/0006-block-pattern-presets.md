# ADR-0006: Block-Pattern als Preset-Dropdown

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Eine Lehreinheit mit `count=4` (4 Wochenstunden Mathe) kann verschieden
gelegt werden:
- 4 Einzelstunden: `[1,1,1,1]`
- 2 Doppelstunden: `[2,2]`
- 1 Doppel + 2 Einzel: `[2,1,1]`
- 1 Tripel + 1 Einzel: `[3,1]`

Der User muss diese Wahl pro Spec treffen können. Die Frage: **welches
UI-Element**? Untis, FET und aSc TimeTables nehmen unterschiedliche Wege:

- **FET:** Wizard-Aufteilung (eine Aktivität → mehrere Activities mit
  optionalem „Force Consecutive"-Flag).
- **Untis:** Block-Notation `2-1` (= 1 Doppel + Rest Einzel). Mächtig, aber
  cryptisch.
- **aSc:** Multi-Select-Dropdowns für jede Stunde einzeln.

## Entschieden

**Preset-Dropdown** mit auto-generierten Vorschlägen pro `count`:

```svelte
<select onchange={(e) => setBlockFromKey(s, e.target.value)}>
  {#each blockPresets(s.count) as preset}
    <option value={blockKey(preset)}>{blockLabel(preset)}</option>
  {/each}
</select>
```

`blockPresets(4)` liefert: `[[1,1,1,1], [2,2], [2,1,1], [3,1]]`.
`blockLabel([2,1,1])` liefert: `"1×2er + 2×1er"`.

Implementiert in `src/lib/blocks.ts` (mit 19 Tests).

## Verworfen

- **Visueller Block-Editor (Stack-Plot mit +/− Buttons):** Cooler, aber
  mehr Klicks für 90% der Fälle (wo eines der 4 Standard-Patterns reicht).
- **Free-Text `2+1+1`-Eingabe:** Fehleranfällig (Tippfehler →
  Validierungs-Hölle).
- **Untis-Style `count - blocks`:** Cryptisch, schwer lernbar.

## Konsequenzen

**Vorteile:**
- Trivial zu nutzen für 90% der Specs (Default = alle Einzelstunden).
- Tests für `blockPresets()` decken die UX-relevanten Fälle ab.
- `blocks.ts` ist Pure-TS, im Solver wiederverwendbar (Constraint 7
  „Block-Kontiguität").

**Kosten:**
- Bei `count=8` oder höher fehlen evtl. Patterns (z. B. `[3,3,2]`); aktuell
  decken die Presets `count` 1–6 vollständig ab.
- Wenn ein User wirklich exotische Pattern braucht, müsste `blockPresets()`
  erweitert werden — kein Free-Text-Fallback heute.

## Folge-Entscheidungen

- Solver-Modell expandiert ein Spec mit `blocks=[2,2]` zu **4 Lesson-
  Instanzen** mit zwei `block_id`-Werten.
- Constraint 7 in `model.mzn` zwingt `block_id`-Geschwister auf
  `(same day, same grade, |Δperiod| ≤ block_size - 1)`.
