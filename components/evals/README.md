# `components/evals/` — redesigned evals hub (`/evals/v2`)

A self-contained, **zero-global-CSS** rebuild of the Phase 5 evals page, staged
at the preview route `/evals/v2`. The original `app/evals/page.tsx` is
unchanged until this is promoted.

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

`app/evals/v2/page.tsx` (server) fetches `getGroupedLessons()`, finds
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

## Promotion (user-gated)

When approved, make `app/evals/page.tsx` render the same composition as
`app/evals/v2/page.tsx` (or redirect `/evals` → `/evals/v2`), then optionally
remove `app/evals/v2/`. This is the only change to `app/evals/page.tsx`.
