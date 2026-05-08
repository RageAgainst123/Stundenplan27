# ADR-0005: State — `setContext`/`getContext`-Store

**Status:** accepted
**Datum:** 2026-05-08

## Kontext

Initiales Pattern war ein Modul-Singleton:

```ts
// store.svelte.ts
export const store = $state({ doc: ... });
```

Das funktionierte für simple Komponenten, brach aber in komplexeren
Reactivity-Pfaden:

- **Cross-Component-Mutation aus async-Handler:** GenerateButton schreibt nach
  `await solve(...)` in `store.doc.placed = [...]`. Nach mehreren Tab-Switches
  oder Dev-Server-HMR-Reloads sahen Sibling-Komponenten (z. B. Sidebar,
  ScheduleGrid) den neuen Wert nicht.
- **Mehrere Listener pro Click:** Im Dev-Mode akkumulierten onclick-Listener
  bei HMR; jeder schrieb in eine andere Closure-Instanz des State.

Symptome (Phase 5b):
- Solver platziert 116 Lessons → DOM zeigt 4
- Sidebar-„Ungeplant"-Counter aktualisiert nicht
- Tab-Switch nach Solver-Run zeigt alte Komponente

## Entschieden

**Store via `setContext`/`getContext`:**

```ts
// store.svelte.ts
export class ScheduleStore { doc = $state(...) }
export function initStore() { /* setContext */ }
export function useStore() { /* getContext */ }
```

`initStore()` einmalig in `App.svelte`. Alle anderen Komponenten holen den
Store via `useStore()`.

Zusätzlich: `$effect.root` in `initStore()` für Auto-Save bei jeder Mutation
(siehe Phase 5c-Bug).

## Verworfen

- **Modul-`export const store`:** Mainmatter-Blog-These „freezes at import
  time" passte zum Symptom. Auch wenn nicht endgültig bewiesen, ist
  Context-Pattern Best-Practice für Cross-Component-Reactivity in Svelte 5.
- **Klassisches `svelte/store` (`writable`):** Funktioniert, aber misst
  Reactivity-Konzepte gegen Runes-Idiome. Hybrid wirkt fragil.
- **Force-Re-Mount via `{#key store.doc.placed.length}`:** Hack der
  Symptom kaschiert, nicht Ursache löst.

## Konsequenzen

**Vorteile:**
- Reactivity stabil über Tab-Switches und async-Mutations.
- Klare Initialisierungs-Reihenfolge (App ist Owner, Komponenten sind
  Konsumenten).
- Auto-Save funktioniert für `bind:value`-Mutationen ohne explizite
  `persistNow()`-Calls in jedem Eingabefeld.

**Kosten:**
- Etwas mehr Boilerplate als Modul-Singleton.
- Tests können nicht trivial den Store importieren (für Test-Code haben wir
  aber keinen Bedarf, da wir Pure-Helpers separat testen).

## Lessons Learned (für AI-Sessions)

- **NIEMALS** zurückgehen auf `export const store = $state(...)` — auch wenn
  es einfacher aussieht. Gleiche Bug-Klasse droht.
- **NIEMALS** `$effect.root` aus `initStore()` entfernen — sonst gehen
  `bind:value`-Änderungen verloren bis ein expliziter `persistNow()` läuft.
- **Beim Bug-Hunting** Reactivity-Probleme zuerst: Production-Build mit
  `npm run build && npm run preview` testen, nicht im Dev-Mode.
