# `components/phase-hub/` — reusable dedicated phase page

A self-contained, **zero-global-CSS** hub for a single roadmap phase:
`Topbar` + hero + interactive (search / filter / sort) lesson browser +
`Footer`. One suite powers every dedicated phase route — currently
`/evals` (Phase 6) and `/rag` (Phase 3); more phases bind the same suite.

## Modules

| File | Role | Boundary |
|---|---|---|
| `types.ts` | Shared TS contracts (single source of truth) | — |
| `PhaseHero/` | Banner: breadcrumb, title, excerpt, outcomes, badges | server-safe |
| `LessonCard/` | One lesson card + reading-weight progress bar | server-safe |
| `LessonGrid/` | Responsive card grid + empty state | server-safe |
| `PhaseControls/` | Search / difficulty / sort — **controlled, owns no state** | `"use client"` |
| `filter.ts` | Pure `filterAndSortLessons` / `computeFacets` / `computeProgressBySlug` | pure |
| `PhaseBrowser.tsx` | Stateful container: owns filter state, wires Controls → Grid | `"use client"` |
| `PhaseHub.tsx` | Server composition: fetch group by slug → Topbar + Hero + Browser + Footer | server |

`PhaseHub` fetches `getGroupedLessons()`, finds the phase by `slug`, and binds
the category gradient from `meta.gradient` onto a wrapper as `--cat-from` /
`--cat-to` (inline, data-driven — no `.cat-*` class). Each `app/<route>/page.tsx`
is a thin wrapper: `generateMetadata` via `phaseHubMetadata(slug)`
(`lib/phase-hub-metadata.ts`, server-only) + `<PhaseHub slug=… />`. The
client-safe route map lives separately in `lib/phase-hubs.ts`.

## Adding a phase

1. Create `app/<route>/page.tsx` mirroring `app/rag/page.tsx` with the
   phase slug.
2. Add the slug → route entry to `PHASE_HUB_ROUTES` in `lib/phase-hubs.ts`.

The homepage card auto-links to the route (no modal) once both exist — see
`CategoryModalTrigger` in `components/category-modal.tsx`.

## Constraints

- No edits to `app/globals.css` / `app/styles/*`. Styling is CSS Modules only,
  consuming `--ds-*` / `--space-*` / `--text-*` and globally-available Radix
  scale tokens. No `:global`, no `@import`.
- The reading-weight progress bar is a deterministic visual cue
  (`readingTimeMin` relative to the longest lesson). The `progressBySlug` prop
  lets real per-user progress be wired later without touching presentational
  components.
- Presentational components stay route-agnostic and reusable across phases.
