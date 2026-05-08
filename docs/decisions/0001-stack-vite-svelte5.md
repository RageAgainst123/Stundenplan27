# ADR-0001: Stack — Vite + Svelte 5 + TypeScript

**Status:** accepted
**Datum:** 2026-05-07

## Kontext

Wir bauen eine Browser-only-App mit komplexer reactive UI (Drag & Drop,
Filter, Live-Konflikte, Wochenraster mit ~160 Cells), die ohne Backend
auskommen muss. Das Datenmodell hat viele verschachtelte Strukturen
(Specs mit Blocks, Kopplungen, Wochen-Pattern), bei denen TypeScript
echten Wert liefert.

## Entschieden

**Vite 8 + Svelte 5 (Runes-Modus) + TypeScript 6**, gebaut zu statischem
Bundle für GitHub Pages.

## Verworfen

- **React + Vite:** Mehr Boilerplate für reactive State, größeres Bundle,
  mehr Click-Through-Komplexität für Forms.
- **Vue 3 + Vite:** Solide, aber weniger frische Reactivity-Story als
  Svelte 5 Runes für unsere Use-Cases.
- **SvelteKit:** Wäre Server-Side-Rendering-fähig, das brauchen wir nicht.
  SPA-Mode mit Svelte allein ist leichter zu hosten.
- **Vanilla JS:** Würde uns für das Editor-Volumen (8 Komponenten, Bulk-Edit,
  Drag & Drop) zu viel manuelles DOM-Pflegen kosten.

## Konsequenzen

**Vorteile:**
- Bundle-Größe der App selbst (~100 KB JS gzipped) ist sehr schlank;
  größter Brocken ist der MiniZinc-WASM-Solver (17 MB) — den hätten wir mit
  jedem Stack.
- Svelte 5 Runes (`$state`, `$derived`, `$effect`) machen reactive Logic
  lesbar; kein Redux/MobX/Zustand-Overhead nötig.
- TypeScript verhindert Schema-Drift bei Datenmodell-Änderungen.

**Kosten:**
- Svelte 5 ist relativ neu, einige Reactivity-Edge-Cases sind unvertraut
  (siehe ADR-0005).
- Ökosystem kleiner als React; einige spezialisierte Libraries (Drag &
  Drop, Datepicker) haben weniger Optionen.

## Folge-Entscheidungen

- Drag & Drop: `@thisux/sveltednd` (Svelte-5-nativ, frisch)
- State Pattern: `setContext`/`getContext` (siehe ADR-0005)
