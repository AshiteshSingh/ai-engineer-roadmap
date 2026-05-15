# `components/evals/` — redesigned evals hub (`/evals`)

A self-contained, **zero-global-CSS** rebuild of the Phase 5 evals page.
Promoted: `app/evals/page.tsx` renders this composition; the `/evals/v2`
preview route has been removed.

## Modules

| File | Role | Boundary |
|---|---|---|
| `types.ts` | Shared TS contracts (single source of truth) | — |
| `EvalsHero/` | Banner: breadcrumb, title, excerpt, outcomes, badges | server-safe |
| `LessonCard/` | One lesson card + reading-weight progress bar | server-safe |
| `LessonGrid/` | Responsive card grid + empty state | server-safe |
| `EvalsControls/` | Search / difficulty / sort — **controlled, owns no state** | `"use client"` |
| `filter.ts` | Pure `filterAndSortLessons` / `computeFacets` / `computeProgressBySlug` | pure |
| `EvalsBrowser.tsx` | Stateful container: owns filter state, wires Controls → Grid | `"use client"` |

`app/evals/page.tsx` (server) fetches `getGroupedLessons()`, finds
`phase-5-evals`, and binds the category gradient from `meta.gradient` onto a
wrapper as `--cat-from` / `--cat-to` (inline, data-driven — no `.cat-*` class).

## Constraints

- No edits to `app/globals.css` / `app/styles/*`. Styling is CSS Modules only,
  consuming `--ds-*` / `--space-*` / `--text-*` and globally-available Radix
  scale tokens. No `:global`, no `@import`.
- The reading-weight progress bar is a deterministic visual cue
  (`readingTimeMin` relative to the longest lesson). The `progressBySlug` prop
  lets real per-user progress be wired later without touching presentational
  components.

## Status

Promoted. `app/evals/page.tsx` is the only consumer; it composes
`Topbar` + `EvalsHero` + `EvalsBrowser` + `Footer` and passes the Phase 5
lessons in. The presentational components stay route-agnostic and reusable.
