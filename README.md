# Posture AI

AI-assisted posture and musculoskeletal screening for movement professionals. Clients are captured on camera, landmarks are extracted with MediaPipe, and a deterministic scoring engine produces graded postural findings, corrective exercise programs, and shareable client reports.

**Screening only — not a medical diagnosis.**

## Stack

- **Web:** Next.js (App Router) · React 19 · Tailwind v4
- **Pose:** MediaPipe Tasks Vision (WASM, served from `public/mediapipe/`)
- **Scoring:** `packages/posture-engine` — versioned, deterministic metric engine
- **Backend:** Supabase (auth, Postgres, RLS) — migrations in `supabase/migrations/`
- **Mobile:** Expo app in `mobile/`
- **Reports:** `@react-pdf/renderer` PDFs + tokenized share links
- **Design system:** Posture AI Dark — normative contract in [`DESIGN.md`](DESIGN.md)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in Supabase credentials
npm run dev                  # copies MediaPipe WASM, starts Turbopack dev server
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` | Dev server / production build (both pre-copy MediaPipe WASM) |
| `npm run test` | Vitest unit tests (engine, lib) |
| `npm run test:e2e` | Playwright end-to-end suite (see `e2e/README.md`) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |
| `npm run lint:vocab` | Content vocabulary lint (`content/`) |
| `npm run qa:seed` | Seed QA data into Supabase |
| `npm run golden` | Regenerate the golden report fixture |
| `npm run sync:muscle-viewer` | Rebuild and vendor the 3D muscle viewer from `../muscle-viewer` |

## Layout

```
app/                  Next.js routes (dashboard, clients, assessments, capture, reports)
components/           Shared React components
lib/                  Domain logic (pose, capture, findings, program, reports, supabase)
packages/posture-engine/  Versioned scoring engine (workspace package)
content/              Reviewed exercise / muscle / report copy
data/exercises-dataset/   Exercise reference data (gitignored nested clone)
supabase/migrations/  Database schema
mobile/               Expo mobile app
e2e/                  Playwright tests
docs/                 Plans, QA runbook, brand system
```

## Docs

- [`DESIGN.md`](DESIGN.md) — Posture AI Dark design contract (lint: `npx --yes -p @google/design.md@0.3.0 design.md lint DESIGN.md`)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operations runbook
- [`docs/plans/`](docs/plans/) — dated design and implementation plans
