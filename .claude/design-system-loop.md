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
- [x] app/applications/[id]/prep/memorize/page.tsx
- [x] app/applications/[id]/debrief/page.tsx
- [x] app/applications/[id]/notes/page.tsx
- [x] app/applications/[id]/interviewers/page.tsx
- [x] app/aws/page.tsx
- [x] app/aws/[slug]/page.tsx
- [x] app/courses/page.tsx
- [x] app/coursework/page.tsx
- [x] app/coursework/[slug]/page.tsx
- [x] app/coursework/[slug]/slovenia/page.tsx
- [x] app/coursework/[slug]/slovenia/ideas/page.tsx
- [x] app/coursework/[slug]/slovenia/images/page.tsx
- [x] app/coursework/[slug]/slovenia/images/[imageSlug]/page.tsx
- [x] app/problems/page.tsx
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
- app/problems/page.tsx — replaced Radix `<Section size=3><Container size=3>` nest with ui `<Section>`; title → ui `<Heading as=h1 size=xl>`; 2 static inline (link/spacer22) → `page.module.css`. No raw vars. Build green (e55349c).
- app/coursework/[slug]/slovenia/images/[imageSlug]/page.tsx — 2× `Container size=3` → `<Section>` (cw-container kept); 3 page titles → ui Heading (notFound size=6 kept Radix); undefined `--radius-4`→`--ds-radius-lg`, raw `--gray-2/3`→`--ds-surface-sub`; dynamic bg/objectFit via `--frame-bg`/`--fit`; blue phrase accent kept. Completes /coursework/* cluster. Build green (89f2d4d).
- app/coursework/[slug]/slovenia/images/page.tsx — large gallery: `Container size=3` → `<Section>` (cw-container kept); title → ui Heading; ~20 static inline objects → `page.module.css`; undefined `--radius-2/3`→`--ds-radius[-md]`, raw `--gray-3/4/5`→`--ds-*`; dynamic bg/objectFit/selected-outline via CSS vars + conditional `.selected` class; teal accent + functional overlay rgba/blur kept. Build green (1471a98).
- app/coursework/[slug]/slovenia/ideas/page.tsx — `Container size=3` → `<Section>` (cw-container kept); title → ui Heading; ~17 static inline objects (12+ identical list styles via replace_all, label/grow/pairBox/wordBox/badge80) → `page.module.css`; raw `--gray-2`→`--ds-surface-sub`, `borderRadius:8`→`--ds-radius`; teal accent kept. Build green (5a0e272).
- app/coursework/[slug]/slovenia/page.tsx — `Container size=3` → `<Section>` (cw-container kept); event title → ui `<Heading as=h1 size=xl>`; 9 static inline objects → `page.module.css` (.grow0/.grow/.tealCard/.linkCard/.list/.emoji). Teal route accent + Radix size=4 card subheads kept (conservative). Build green (9ccd1ee).
- app/coursework/[slug]/page.tsx — near-identical to /coursework: 3× `Container size=3` → `<Section>` (cw-container kept); learner-name title → ui `<Heading as=h1 size=xl>`; raw `--accent-9` → `--ds-accent`; 8 static inline objects → `page.module.css`. notFound block had mixed indentation (open 4-sp, close 6-sp) → grep-verified + fixed dangling close. Build green (9d989da).
- app/coursework/page.tsx — 2× `Container size=3` → `<Section>` (kept `cw-container` global class); title → ui `<Heading as=h1 size=xl>`; raw `--accent-9` → `--ds-accent`; 9 static inline objects → `page.module.css` (.clickable/.fileMain/.fileIcon/.minw0/.previewFrame/.previewImg/.emptyCard[Sm]/.hidden); dynamic file-row cursor kept inline. `cw-*` globals untouched. Build green (38ad385).
- app/courses/page.tsx — mostly global `courses-page`/`course-card` classes (left as-is, `.courses-page` layout not Section-able). Only actionable: empty-state `<p>` inline `--gray-9`+0.875rem → `page.module.css` `.empty` (`--ds-text-faint`/`--text-sm`). Build green (bcc0b58).
- app/aws/[slug]/page.tsx — NO CHANGES (same as /aws): server component, full-bleed article layout via shared components + pre-existing global `article-*`/`badge-pill`/`cat-*` classes; zero inline styles/raw vars/Radix containers. Ledger-only tick.
- app/aws/page.tsx — NO CHANGES (already clean for rubric scope): server component, full-bleed article layout via shared components + pre-existing global `article-*`/`badge-pill`/`cat-*` classes; zero inline styles, zero raw `--gray-*`, no Radix Container/Heading, no undefined tokens. Forcing `<Section>` would break article-grid; migrating globals is out of scope. Ledger-only tick.
- app/applications/[id]/interviewers/page.tsx — 5× `Container size=3` → `<Section>`; `--gray-6` Tabs border, content Card border (cyan accent kept), TextArea (fixed undefined `--font-size-1`) → `page.module.css` (.skel/.tabsList/.panel/.codeArea). Cyan markdown `components` map left as-is (intentional theme, like prep's violet). Build green (1efc932).
- app/applications/[id]/notes/page.tsx — identical shape to debrief: 5× `Container size=3` → `<Section>`; `--gray-6` Tabs border + 2 Skeletons → `page.module.css`. Build green (89eb4a6).
- app/applications/[id]/debrief/page.tsx — plain `Container size=3` (not full-bleed) so all 5 → `<Section>`; raw `--gray-6` Tabs border + 2 static Skeletons → `page.module.css` (.skel/.tabsList → `--ds-border`). Radix error Headings + `tab-shortcut-hint` global kept. Build green (7e27859).
- app/applications/[id]/prep/memorize/page.tsx — full-height dashboard shell (left non-Section, like tick 3); 11 static inline objects → `page.module.css` (.screen/.screenCol[NoScroll]/.backLink/.skelTitle/.fillCol/.genCard/.rocket/.fullBtn); raw `--gray-11` → `--ds-text`. Radix Heading toolbar + css-memorize import + violet accent kept. 480/32px kept literal (no clean token). Build green (7588631).
- app/applications/[id]/prep/page.tsx — large/sensitive (markdown renderer). Conservative: 3 simple-state `<Box>` → `<Section>`; title → ui `<Heading as=h1 size=xl>`; nav back-link `--gray-11` → `.backLink`/`--ds-text`; 2× `<pre>` fixed broken **undefined `--font-size-1`** + raw `--gray-2` → `.codePre` (font-size intentionally omitted to preserve current inherited size). Violet-accented md prose styles left as-is (intentional theme, no --ds- equivalent). Build green (34a0e9e).
- app/applications/[id]/page.tsx — 4 simple loading/error/not-found/fallback `Container size=3` → `<Section>`; static `Skeleton maxWidth:200` → `page.module.css` `.skel`. Main full-bleed tabbed detail (`Container size=4` + global `.app-detail`/`maxWidth:100%`) left intact (sensitive layout); no raw color vars present. Build green (ec3e68f).
- app/applications/page.tsx — `Container size=4` → `<Section>`; title → ui `<Heading as=h1 size=xl>`; raw `--gray-1/2/5/9`/`--color-surface`/`borderRadius:8` → `--ds-*` via `page.module.css` (12 statics extracted); per-column dynamic colors kept inline via `--chip-bg/border/op` CSS vars; pre-existing `app-row` global class kept. Build green (ab413bf).
- app/memorize/[categorySlug]/page.tsx — full-height dashboard shell (left non-Section, conservative); raw `--gray-11`/`--gray-2`/undefined `--radius-3` → tokens; 8 static inline objects → `page.module.css` (.screen/.screenCol/.backLink/.empty/.skelTitle). Radix Heading/Box layout + css-memorize import kept. Build green (c3291dd).
- app/memorize/page.tsx — 3× `<Box maxWidth:1000>` → `<Section>`; Radix `<Heading size=7>` → ui `<Heading as=h1 size=xl>`; raw `--gray-2`/undefined `--radius-3` → `.empty` with `--ds-surface-sub`/`--ds-border-subtle`/`--ds-radius`; 6 static inline objects → `page.module.css`; progress bar dynamic via `--pct`/`--bar` CSS vars. Kept `css-memorize.css` import + `memorize-cat-*` globals untouched. Build green (b75c21b).
