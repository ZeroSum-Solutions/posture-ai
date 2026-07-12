---
type: project
title: "Posture AI"
description: "AI-assisted posture and musculoskeletal screening for movement professionals. Clients are captured on camera, landmarks are extracted with MediaPipe, and a deterministic scoring engine produces graded postural findings, corrective exercise programs, and shareable client reports. Screening only — not a medical diagnosis."
resource: "https://github.com/wiggdevin/posture-ai"
timestamp: "2026-07-12T12:14:39.707276+00:00"
project_id: "repository-fa5faa0c0f94578b"
ownership: "product"
lifecycle: "active"
verification_model: "openai-codex-root"
verification_status: "PASS"
evidence_fingerprint: "4ef1a52fc2b26b87c234e54f8f24a97c0f79149af1c22ba54b08d1a3136d2ea6"
okf_version: "0.1"
---
<!-- project-ledger:managed:start -->
# Posture AI

AI-assisted posture and musculoskeletal screening for movement professionals. Clients are captured on camera, landmarks are extracted with MediaPipe, and a deterministic scoring engine produces graded postural findings, corrective exercise programs, and shareable client reports. Screening only — not a medical diagnosis.

## Purpose

Provide AI-assisted posture and musculoskeletal screening for movement professionals.

## Intended users

- movement professionals

## Current status

- Lifecycle: active
- Category: product
- Git branch: main
- Working-tree changes at last scan: 0
- Semantic confidence: high

## Architecture and components

- Next.js (App Router)
- React 19
- Tailwind v4
- MediaPipe Tasks Vision (WASM)
- packages/posture-engine (versioned, deterministic metric engine)
- Supabase (auth, Postgres, RLS)
- Expo app in mobile/
- @react-pdf/renderer PDFs + tokenized share links

## Entry points

- npm run dev
- npm run build
- npm run start

## Commands

- npm run dev
- npm run build
- npm run start
- npm run test
- npm run test:e2e
- npm run typecheck
- npm run lint
- npm run lint:vocab
- npm run qa:seed
- npm run golden
- npm run sync:muscle-viewer

## Dependencies

### Runtime

- @mediapipe/tasks-vision
- @react-pdf/renderer
- @supabase/ssr
- @supabase/supabase-js
- @tailwindcss/postcss
- framer-motion
- next
- pg
- qrcode
- react
- react-dom
- recharts
- zod

### Development

- @axe-core/playwright
- @playwright/test
- @testing-library/react
- @types/node
- @types/pg
- @types/qrcode
- @types/react
- @types/react-dom
- @vitejs/plugin-react
- eslint
- eslint-config-next
- jsdom
- postcss
- supabase
- tailwindcss
- typescript
- vitest

### Services

- Supabase

### Data

- Postgres

### Other projects

- packages/posture-engine
- mobile/
- data/exercises-dataset/

## Integrations

- MediaPipe Tasks Vision
- Supabase
- @react-pdf/renderer

## Related, overlapping, or superseded work

- muscle-viewer (external, referenced in sync:muscle-viewer script)

## Evidence and review

- Evidence fingerprint: `4ef1a52fc2b26b87c234e54f8f24a97c0f79149af1c22ba54b08d1a3136d2ea6`
- Verified by: `openai-codex-root`
- Verification decision: `PASS`
- Review summary: Direct Codex root review found posture-ai evidence-bound after checking its description, purpose, architecture, commands, dependencies, integrations, relationships, and stated ambiguities against the current fingerprint.

### Ambiguities

- Exact deployment environment not specified
- Exact user base size unknown
- Exact version numbers of dependencies not specified beyond package.json
- muscle-viewer repository location and relationship not fully documented
<!-- project-ledger:managed:end -->

<!-- project-ledger:human:start -->
## Human notes

Add durable context here. Project Ledger preserves this section verbatim.
<!-- project-ledger:human:end -->
