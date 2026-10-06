---
name: qa-loop
description: Full user-level QA loop for posture-ai — build sanitized production-scale local data, inventory every user-facing surface with acceptance criteria and risk-based edge cases, test as a real user logging bugs with evidence, fix by root cause with regression tests, rerun until a clean pass or blocked handoff.
---

# posture-ai QA Loop

An iterative loop: **Seed → Inventory → Test → Fix → Rerun**, repeated until a
clean pass or a blocked handoff. State is durable in `docs/qa/` so the loop
survives context resets and can be resumed by any session.

**Announce at start:** "Running /qa-loop — iteration N" (N from the highest
`docs/qa/passes/PASS-*.md` + 1).

## Hard guardrails (read before anything)

0. **Preflight first.** Run `npm run qa:preflight` before Phase 0 and after switching
   branches or worktrees. It must exit 0. The check requires an attached, clean,
   non-primary branch and loopback-only Supabase URLs. Its receipt authorizes only
   local synthetic QA; it explicitly leaves commit, push, merge, deploy, production
   data, and real-person data outside the run.
1. **Local only.** Every DB write goes to local Supabase. Before ANY seed or
   test run, verify: `grep NEXT_PUBLIC_SUPABASE_URL .env.local` →
   must be `127.0.0.1` / `localhost`. If it points at `*.supabase.co`, STOP
   and ask. Never run this loop against production
   (`dhrkezfypzutiwtmcmof`) or the Vercel deployment.
2. **Synthetic data only.** Seeded clients/practitioners are generated fake
   people (faker-style names, `qa+<n>@example.test` emails, synthetic
   landmarks from `e2e/fixtures/`). Never copy, import, or paraphrase real
   client or production data. This IS the "sanitized" requirement — sanitized
   by construction, not by scrubbing.
3. **Ask first** (AskUserQuestion / plain question) before: anything touching
   production or `*.supabase.co`, anything involving real/sensitive data,
   destructive actions outside the local stack (dropping remote schemas,
   deleting storage buckets, force-pushes), or installing new paid services.
   Local-stack resets (`npx supabase db reset`) are pre-authorized — they are
   the loop's normal operation.
4. **Screening vocabulary** applies to every string a fix introduces
   (no diagnos*/treat*/cure*/patient*/prescri* — the vocabulary-lint test
   enforces this; run it after any content change).
5. Keep fixes on the current feature branch. Do not commit, push, open or merge a
   PR, run `~/bin/zs-land`, or deploy unless the user separately authorizes that
   exact action after reviewing the run. Record the verified local diff and leave a
   blocked handoff when that authorization is absent.

## State files (all under `docs/qa/`)

| File | Purpose |
|---|---|
| `INVENTORY.md` | Every user-facing item: route, role, controls, acceptance criteria, edge cases, per-pass status. The loop's checklist — pre-seeded, keep it current. |
| `BUGLOG.md` | Append-only numbered bugs (`QA-001…`) with severity, repro steps, evidence links, status (open/fixed/wontfix + PR#). |
| `passes/PASS-NN.md` | One report per iteration: what ran, pass/fail counts, bugs found, verdict. |
| `evidence/` | Screenshots, HAR/console dumps, named `QA-NNN-*.png`. Gitignored if large; reference by path in BUGLOG. |

## Phase 0 — Sanitized production-scale environment

1. Start the stack production-like:
   - `npx supabase start` (local), apply all migrations: `npx supabase db reset`
   - Build and run the REAL production bundle: `npx next build && npx next start -p 3100`
     (not `next dev` — turbopack dev masks CSP, caching, and hydration issues).
   - `NEXT_PUBLIC_POSTURE_TEST_MODE` must be **unset** for the prod-like run;
     the camera step is exercised with fixture landmarks via the seed data and
     `?testMode=1` ONLY in the explicitly-marked capture items (real camera
     cannot run headless — see INVENTORY item CAM-REAL, which is a manual
     device check, never faked to PASS).
2. Seed at production scale with `scripts/qa-seed.mjs`. If it does not exist,
   create it (service-role key from local `supabase status`, never remote):
   - 3 practitioner accounts (via the same path as `app/api/dev/create-test-user`
     or Supabase admin API) — one brand-new (empty state), one typical
     (~30 clients), one heavy (~150 clients).
   - ~400 assessments across them using `e2e/fixtures/` landmark sets, spread
     over 6 months of `created_at` (progress/comparison views need history),
     mixed approval states (draft / approved / approved-then-client-deleted
     tombstone).
   - Consent records in every state: granted, declined, pending link, expired
     link, minor-without-consent.
   - Workout sessions: minted, part-run, completed, rated; share tokens:
     active, expired, revoked.
   - Deterministic (`--seed 42`) so reruns are comparable; idempotent
     (re-running resets and reseeds).
3. Smoke-check: `/api/health` 200 on :3100, sign-in works for all 3 accounts.
   Record seed counts in the pass report.

## Phase 1 — Inventory with acceptance criteria

`docs/qa/INVENTORY.md` is pre-seeded from the real route tree. Each pass:

1. **Diff it against reality**: `find app -name page.tsx -o -name route.ts`,
   plus modals/sheets/buttons discovered while testing. New surface → new rows.
   Removed surface → mark `RETIRED`, don't delete (history matters).
2. Every item must have, before testing starts:
   - **Acceptance criteria** — 1-3 observable statements ("submitting invalid
     X shows message Y and preserves input", not "works correctly").
   - **Edge cases** — FINITE and risk-ranked, max 5 per item. Pick by risk:
     auth/RLS boundaries, money/consent/PHI-adjacent paths, empty states,
     the heavy account (pagination/perf), token expiry/revocation, offline
     and double-submit. Skip low-risk permutations; say so in the row.
3. Roles to cover per item where applicable: **practitioner** (authed),
   **consent-token client** (`/consent/[token]`), **share-token client**
   (`/s/[token]`), **anonymous** (must be denied cleanly, never 500).

## Phase 2 — Test as a real user

Work through INVENTORY.md top to bottom against :3100. Do not stop to fix —
log and keep testing (fixing mid-pass invalidates the pass).

- Drive a real browser in a named EGO Lite task space using the available EGO
  controller. Do not create a blank or ephemeral browser profile. If EGO cannot
  drive a required local surface, mark that browser item BLOCKED and continue with
  the remaining inventory. Mobile viewport first
  (390×844 via `resize_page`/`emulate`) — this is a mobile-web product; then
  spot-check desktop.
- For each item: walk the acceptance criteria, then its edge cases. Mark
  PASS / FAIL / BLOCKED (+reason) in the inventory's current-pass column.
- Every FAIL becomes a BUGLOG entry **at the moment it's found**:
  severity (S1 data-loss/security/crash, S2 broken feature, S3 degraded,
  S4 cosmetic), exact repro steps from a fresh state, expected vs actual,
  and evidence: screenshot + relevant console errors + failing network
  request (status/body). A bug without repro evidence is not logged, it's
  investigated until it has some.
- Also record non-bug observations (slow pages >3s on the heavy account,
  layout jank, confusing copy) as S4 or a NOTES section — cheap now,
  expensive to rediscover.

## Phase 3 — Root-cause review and coherent fixes

1. Read all OPEN bugs together **before fixing any**. Cluster by shared cause
   (same missing guard, same component, same query pattern). One cluster =
   one fix = one branch. Record the clustering in the pass report.
2. Per cluster, use superpowers:systematic-debugging, then TDD: failing
   regression test first (vitest or a new e2e spec — the suite in `e2e/`
   is the natural home), minimal fix, suite green
   (`npx vitest run && npm run test:e2e`). Keep the result local until the user
   separately authorizes publication. Update BUGLOG entries with the verified local
   branch and commit only when a commit was authorized; otherwise use `fixed locally`.
3. Wontfix/deferred requires a one-line reason and Devin's ack for S1/S2.

## Phase 4 — Rerun and verdict

Rerun the FULL inventory (Phase 0 reseed → Phase 2), not just failed items —
fixes regress neighbors.

- **CLEAN PASS**: every non-RETIRED item PASS in the *same* run, zero open
  S1/S2, e2e + vitest green. Write `passes/PASS-NN.md` with verdict CLEAN,
  summarize open S3/S4 as a backlog, and STOP the loop.
- **BLOCKED**: an item can't be tested (env, missing decision, needs real
  device or Devin's account) after 2 honest attempts → mark BLOCKED with
  reason, finish everything else, write the pass report with verdict
  BLOCKED-HANDOFF listing exactly what a human must do. STOP — do not
  improvise around blockers.
- Otherwise: verdict CONTINUE, start iteration N+1. After **4 iterations**
  without a clean pass, stop and hand off regardless — that smells like a
  process problem, not a bug backlog.

## Resuming

Any session resumes by reading `docs/qa/INVENTORY.md`, `BUGLOG.md`, and the
latest `passes/PASS-NN.md` — never restart from scratch if state exists.
