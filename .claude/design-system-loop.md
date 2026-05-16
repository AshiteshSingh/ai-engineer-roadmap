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

- [ ] app/page.tsx
- [ ] app/memorize/page.tsx
- [ ] app/memorize/[categorySlug]/page.tsx
- [ ] app/applications/page.tsx
- [ ] app/applications/[id]/page.tsx
- [ ] app/applications/[id]/prep/page.tsx
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
