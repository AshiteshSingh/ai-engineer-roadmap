# CV / Resume Generation

## Overview

The CV is generated as a server-rendered PDF using `@react-pdf/renderer`. There is no AI involvement — the pipeline is purely deterministic: static JSON data goes in, a styled A4 PDF comes out.

## Architecture

```
packages/resume/src/data.json              <-- default resume (JSON Resume schema)
packages/resume/src/toby/data.json         <-- tailored variant (Toby Ranson / fullstack-bank role)
        │
packages/resume/src/index.ts               <-- re-exports both + VARIANTS map
        │
        ├─► app/resume/[slug]/page.tsx                    (default viewer)
        ├─► app/resume/[slug]/[variant]/page.tsx          (variant viewer)
        │
        ├─► app/api/resume-pdf/[slug]/route.ts            (default PDF endpoint)
        └─► app/api/resume-pdf/[slug]/[variant]/route.ts  (variant PDF endpoint)
                │
                └─► packages/resume/src/render.tsx
                        │       renderResumePdf(slug, variant = "default")
                        │
                        └─► @react-pdf/renderer  →  PDF buffer  →  HTTP response
```

## Data

All resume content lives in `packages/resume/src/data.json`. It follows a JSON Resume-inspired schema with these sections:

| Section      | Description                                       |
| ------------ | ------------------------------------------------- |
| `basics`     | Name, title, contact, summary, key skills         |
| `skills`     | Languages, frameworks, libraries, databases, etc. |
| `work`       | Work history with HTML bullet summaries            |
| `education`  | Degrees and institutions                          |
| `activities` | AI projects with highlights and links             |
| `volunteer`  | Open-source / volunteer roles                     |

To update the CV, edit `data.json` directly. No rebuild or migration is needed — the API route reads the data at request time (`force-dynamic`).

## PDF Rendering

`packages/resume/src/render.tsx` converts the JSON data into a React component tree using `@react-pdf/renderer`:

- **Page format:** A4, Helvetica, 9pt base font
- **Layout:** Flex-based with header, summary, skills (pipe-separated groups), AI projects, experience, education
- **HTML parsing:** Work summaries contain `<li>` HTML — a `htmlToBullets()` helper strips tags and extracts "Tech stack:" lines separately
- **Export:** `renderResumePdf(slug)` returns a `Buffer` (or `null` for unknown slugs)

## Routes

| Route                        | What it does                                          |
| ---------------------------- | ----------------------------------------------------- |
| `/resume/[slug]`             | Viewer page — renders an iframe with the PDF embedded |
| `/api/resume-pdf/[slug]`     | Returns the raw PDF (`application/pdf`, 1h cache)     |

The only slug currently mapped is `vadim`.

## Adding a New Resume

1. Create a new data object (same shape as `data.json`)
2. Add it to the `SLUGS` map in both `render.tsx` and `page.tsx`
3. Access it at `/resume/<new-slug>`
