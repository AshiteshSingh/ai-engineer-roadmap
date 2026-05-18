# Evidence dossier — Vitrifi Cortex Portal

> Owner-only knowledge source for tailored interview prep. Every claim here is
> verifiable from the cortex-portal git history / codebase. **Verified-claims
> guardrail: no invented metrics.** Impact is stated qualitatively unless a
> number is directly measurable. Where a target role's stack differs from what
> is below, the prep must bridge it **honestly** as transferable, never claim
> direct experience.

## The project

**Cortex Portal** (Vitrifi) — an enterprise platform for **regulated UK fibre /
broadband telecom infrastructure**: order/provisioning management, subscriber &
tenant administration, network-activator field operations, a self-serve customer
portal, and a service marketplace, integrating external carriers (e.g.
CityFibre, OpenReach).

It is a **monorepo** (Turbo + pnpm workspaces): Go microservices (`services/*`),
React web apps (`web/portal`, `web/network-activator`), shared TS packages
(`packages/ui|hooks|validations|utils`), shared Go libs (`lib/go/*`), Temporal
task workers (`tasks/`), and schema definitions (`schemas/gql|openapi|proto`).
It runs in a regulated environment where data correctness, auditability, RBAC,
and multi-tenancy are first-order requirements — structurally the same shape as
a supervisory data cockpit.

## My role & scale (git-verified)

- **#1 contributor by commit count.** `git shortlog -sne --all`: 4,560 commits
  under `vadim.nicolai-ext@vitrifi.net` + 764 under `vadim.nicolai@vitrifi.net`
  ≈ **5,324 commits of 22,440 total (~24%)** — well ahead of the next
  contributor (~2,823). Active span **Mar 2022 → Dec 2025** (~3.7 years).
- Full-stack: React/TypeScript frontend **and** Go backend, plus shared
  packages, DB migrations, and CI.

## Stack (verified)

- **Frontend:** React 18, React Router 7, TypeScript, Rsbuild, Apollo Client
  (GraphQL), React Hook Form + Zod, Ant Design, Emotion, TanStack React Table,
  GraphQL Codegen, Playwright (E2E).
- **Backend:** Go (Chi router, GQLGen GraphQL, REST), PostgreSQL via pgx + SQLC,
  MongoDB, golang-migrate, Temporal (workflow orchestration), NATS (protobuf
  messaging), AWS S3 / Cognito / Secrets Manager, OpenTelemetry tracing,
  testify.
- **Infra:** Docker multi-stage builds, GitLab CI, Kubernetes (sealed-secrets,
  Teleport cluster access).

## Themes with commit evidence

- **Forms / validation framework migration.** Led the move of all portal forms
  to Zod v4 with `zodResolver`, including the `@hookform/resolvers` v5 upgrade
  and a custom resolver handling null/undefined globally, letting types infer
  from the schema. Commits: `9035d2fa6` (migrate all forms to Zod v4),
  `0fde0ef79` (@hookform/resolvers → v5), `a72b8cd64` (custom global
  null/undefined zodResolver), `65d0eb559` (drop explicit FormValues, infer from
  zodResolver), `e558cbd2e` (portal schemas → v4 syntax), `ebf50be55` (App
  create/edit Zod schema).
- **Custom hook architecture.** Built `useFormErrorHandler`, centralising the
  bridge between Apollo GraphQL error extensions, field-level form errors, and
  i18n notifications; refactored database forms onto it. Commits: `556941673`,
  `1cf73862c`, `b8814fe7a` (improved custom-hook typings).
- **Backend-side query performance for large tables.** Moved
  search/sort/filter/aggregation out of the browser into SQL so large
  reporting/event tables stay responsive — including a `NULLIF`-based
  empty-parameter optimisation, with tests. Commits: `a5738e7ff` (NULLIF search
  optimisation + tests), `4600fc17f` (address sorting → backend, natural-number
  sort), `c00e317b1` (support-ticket status filtering & aggregation → backend).
- **RBAC / multi-tenancy / auth.** Permission seed data per role; extracted
  Cognito user-pool matching into a reusable `xaws` package with unit tests.
  Commits: `fc5cddf77` (Admin-role CRUD permission seed), `1d27ae428` (Cognito
  pool-name matching → xaws + tests).
- **Testing discipline.** Added unit tests reaching 100% coverage on several Go
  packages; fixed testifylint correctness (`require.Len` vs `require.Equal`);
  contributed Go integration/fuzz and Playwright E2E coverage. Commits:
  `76a00658d` (100% coverage: errorcode/mime/natsjson/activity/connkey),
  `4f7bdd4f9` (testifylint fixes).
- **TypeScript strictness.** Replaced explicit `any` across the codebase and
  fixed the resulting type errors. Commits: `c71190dff`, `196795258`.
- **Architecture / maintainability.** Drove the component-collocation pattern
  (`docs/frontend-patterns.md`) — feature-scoped components over generic
  catch-all folders — and DB schema evolution via golang-migrate.

## ECB requirement → cortex-portal proof (cheat-sheet source)

| ECB JD asks | Cortex Portal proof |
|---|---|
| Data-intensive dashboard in a **regulated** environment, audit trails, data accuracy paramount | Regulated UK-fibre telecom ops portal; lead contributor over ~3.7y; reporting/event tables, audited provisioning flows, golang-migrate schema evolution |
| React 18 + TypeScript; visualisation/reporting modules | React 18 + TS, TanStack React Table for dense reporting grids, Apollo cache as the data layer |
| Redux Toolkit / D3.js | **Transferable, not direct** — normalised client state via Apollo cache + selectors; data-grid rendering via TanStack Table. Be explicit this is the analogue, not D3/Redux itself |
| REST API backend (Python FastAPI / Java Spring Boot) | **Transferable, not direct** — Go GraphQL (GQLGen) + REST (Chi); same concerns: validation, pagination, structured errors, OpenAPI/codegen contracts |
| SQL (PostgreSQL/Oracle) + ETL | PostgreSQL via pgx/SQLC, golang-migrate; NATS event pipelines + Temporal workflows ≈ long-running ingest/ETL orchestration |
| OAuth2 / SAML / RBAC in enterprise env | Multi-tenant RBAC with per-role permission model; AWS Cognito; sealed-secrets |
| Large-dataset query performance | Search/sort/filter/aggregation pushed to SQL incl. `NULLIF` optimisation (`a5738e7ff`, `4600fc17f`, `c00e317b1`) |
| Testing pyramid (Jest/Cypress/pytest) | Playwright E2E + Go testify unit/integration + fuzz; 100%-coverage initiatives (`76a00658d`) |
| Docker / Kubernetes / GitLab CI | **Direct match** — Docker multi-stage, GitLab CI, Kubernetes (sealed-secrets, Teleport) |
| Banking regulation domain (Basel/CRR) | **No direct domain** — frame as proven fast ramp-up into a regulated, audited domain (telecom regulatory) with non-technical domain experts |

## Honest gaps (do not bluff)

- **D3.js / Redux Toolkit:** no production D3; state is Apollo-cache-based, not
  Redux. Bridge: dense data grids (TanStack Table), normalised client cache +
  memoised selectors, render-perf discipline — directly transferable, learn the
  specific libs fast.
- **Python / Java backend:** backend experience is Go. Bridge: same API
  concerns (schema-first contracts, validation, pagination, structured errors,
  auth middleware) — FastAPI/Spring is a syntax delta, not a concept delta.
- **Banking/supervisory domain:** none. Bridge: demonstrated regulated-domain
  ramp-up in telecom; structured approach to learning a domain from experts.
