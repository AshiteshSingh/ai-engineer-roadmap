# Design-System Consistency Loop — Progress Ledger

Worktree: `/Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap-ds`
(branch `design-system-loop`, tracks `origin/design-system-loop`).
Full plan: `/Users/vadimnicolai/.claude/plans/need-5min-ux-and-eager-pixel.md`.

Each tick: take the **first unchecked** page below, apply the rubric, edit only
that page's file + a co-located `*.module.css`, `pnpm run build`, then
`git -C <worktree> add -A && commit && push`, then check it off here.

## Rubric (per page)

1. Container → `<Section>` (`@/components/ui/section`), drop `maxWidth:1000`/ad-hoc widths.
2. Typography → `@/components/ui/heading` + `Eyebrow`/`Subhead`, sizes from `--text-*`.
3. Color → semantic `--ds-*` (no raw `--gray-*`/`--color-*`/hex/rgb).
4. Radius/shadow/space → `--ds-radius-*`, `--ds-shadow-*`, `--space-*` (kill `--radius-3`, `9999px`, `borderRadius:8`).
5. Primitives → `@/components/ui/*` (`Button`,`Card`,`Pill`,`Tag`,`Stat`,`Divider`) over one-off Radix/raw-div.
6. Static inline styles → co-located `<Page>.module.css`; keep only dynamic values inline (via CSS vars).
7. **No global CSS**: never edit/create/grow `globals.css`, `styles/*.css`, `css-memorize.css`; add **no** new global imports.
8. Atomic: only the chosen page file + its module in one pass.
9. `pnpm run build` (exactly that — never a turbo filter) must pass; fix new TS/lint errors.
10. Commit + push the worktree, then check the box here.

## Pages (priority order)

- [x] app/page.tsx
- [x] app/memorize/page.tsx
- [x] app/memorize/[categorySlug]/page.tsx
- [x] app/applications/page.tsx
- [x] app/applications/[id]/page.tsx
- [x] app/applications/[id]/prep/page.tsx
- [ ] app/applications/[id]/prep/memorize/page.tsx
- [ ] app/applications/[id]/debrief/page.tsx
- [ ] app/applications/[id]/notes/page.tsx
- [ ] app/applications/[id]/interviewers/page.tsx
- [ ] app/aws/page.tsx
- [ ] app/aws/[slug]/page.tsx
- [ ] app/courses/page.tsx
- [ ] app/coursework/page.tsx
- [ ] app/coursework/[slug]/page.tsx
- [ ] app/coursework/[slug]/slovenia/page.tsx
- [ ] app/coursework/[slug]/slovenia/ideas/page.tsx
- [ ] app/coursework/[slug]/slovenia/images/page.tsx
- [ ] app/coursework/[slug]/slovenia/images/[imageSlug]/page.tsx
- [ ] app/problems/page.tsx
- [ ] app/problems/[slug]/page.tsx
- [ ] app/evals/page.tsx
- [ ] app/kv-quant/page.tsx
- [ ] app/langgraph/lead-gen/page.tsx
- [ ] app/langgraph/lead-gen/sd/page.tsx
- [ ] app/nexttech/senior-genai-engineer/page.tsx
- [ ] app/self-evaluation/page.tsx
- [ ] app/[slug]/page.tsx
- [ ] app/resume/[slug]/page.tsx
- [ ] app/resume/[slug]/[variant]/page.tsx
- [ ] app/(auth)/login/page.tsx
- [ ] app/(auth)/signup/page.tsx
- [ ] app/not-found.tsx

## Tick log

(append `<page> — <one-line summary>` per completed tick)

- app/page.tsx — already on Section/Eyebrow/Heading; moved inline `paddingBottom:0` → `page.module.css` (.flushBottom). Build green (c16f94d). Conservative: homepage is the live redesign; existing global classes left untouched per no-new-global scope.
- app/applications/[id]/prep/page.tsx — large/sensitive (markdown renderer). Conservative: 3 simple-state `<Box>` → `<Section>`; title → ui `<Heading as=h1 size=xl>`; nav back-link `--gray-11` → `.backLink`/`--ds-text`; 2× `<pre>` fixed broken **undefined `--font-size-1`** + raw `--gray-2` → `.codePre` (font-size intentionally omitted to preserve current inherited size). Violet-accented md prose styles left as-is (intentional theme, no --ds- equivalent). Build green (34a0e9e).
- app/applications/[id]/page.tsx — 4 simple loading/error/not-found/fallback `Container size=3` → `<Section>`; static `Skeleton maxWidth:200` → `page.module.css` `.skel`. Main full-bleed tabbed detail (`Container size=4` + global `.app-detail`/`maxWidth:100%`) left intact (sensitive layout); no raw color vars present. Build green (ec3e68f).
- app/applications/page.tsx — `Container size=4` → `<Section>`; title → ui `<Heading as=h1 size=xl>`; raw `--gray-1/2/5/9`/`--color-surface`/`borderRadius:8` → `--ds-*` via `page.module.css` (12 statics extracted); per-column dynamic colors kept inline via `--chip-bg/border/op` CSS vars; pre-existing `app-row` global class kept. Build green (ab413bf).
- app/memorize/[categorySlug]/page.tsx — full-height dashboard shell (left non-Section, conservative); raw `--gray-11`/`--gray-2`/undefined `--radius-3` → tokens; 8 static inline objects → `page.module.css` (.screen/.screenCol/.backLink/.empty/.skelTitle). Radix Heading/Box layout + css-memorize import kept. Build green (c3291dd).
- app/memorize/page.tsx — 3× `<Box maxWidth:1000>` → `<Section>`; Radix `<Heading size=7>` → ui `<Heading as=h1 size=xl>`; raw `--gray-2`/undefined `--radius-3` → `.empty` with `--ds-surface-sub`/`--ds-border-subtle`/`--ds-radius`; 6 static inline objects → `page.module.css`; progress bar dynamic via `--pct`/`--bar` CSS vars. Kept `css-memorize.css` import + `memorize-cat-*` globals untouched. Build green (b75c21b).
