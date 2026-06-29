# E2E Loop Progress — posture-ai

Loop branch: `e2e-hardening` (base `main` @ `f3c9c8a`). Spec: `E2E_LOOP_PROMPT.md`.
Suite: Playwright, projects `desktop-chromium` + `mobile-webkit`, serial (`workers:1`, `fullyParallel:false`).

---

## Baseline (first run — 2026-06-28, iteration 1)

**Environment for this baseline:**
- `npx supabase db reset` first → local DB rebuilt from the full migration chain through `20260628010000_muscle_links_evidence_columns.sql` (CI-faithful; seed ships via migrations `20260101000001_seed_data.sql` + `20260612020000_muscle_kb_seed.sql`, not `seed.sql`).
- Killed a stray `next dev` squatting on port `3100` (would have been reused, serving stale code without `POSTURE_TEST_MODE_ENABLED`) so the runner spawned a fresh, test-mode server.
- Command: `npm run test:e2e` (plain local run → `retries:0`, `list` reporter, so flake surfaces as failure rather than being masked).

**Result: 13 passed · 2 failed · 2 skipped (17 tests, 42.1s).**

Per-test:
- ✓ `[setup] auth.setup.ts` — authenticate test practitioner
- ✓ `[desktop-chromium] a11y.spec.ts` ×2 (static surfaces; wizard+results axe budget)
- ✓ `[desktop-chromium] assessment-flow.spec.ts` ×2 (golden path test-mode → 10 findings + PDF; wizard requires client)
- ✓ `[desktop-chromium] capture-errors.spec.ts` ×3 (permission denied; no orientation sensors; non-person upload)
- ✓ `[desktop-chromium] muscle-kb.spec.ts:7` — finding chips link to muscle pages
- ✓ `[desktop-chromium] real-detection.spec.ts` — upload front+side, detect landmarks, score (no-CDN assertion held)
- ✓ `[mobile-webkit] assessment-flow.spec.ts` ×2
- ✓ `[mobile-webkit] muscle-kb.spec.ts:7` — finding chips
- ⏭️ `[mobile-webkit] a11y.spec.ts` ×2 — intentional `test.skip` off non-chromium (rule 4: legitimate, stays)
- ✘ `[desktop-chromium] muscle-kb.spec.ts:33` — "muscle library lists regions and supports search"
- ✘ `[mobile-webkit] muscle-kb.spec.ts:33` — same test

(Matrix sanity: `real-detection` + `capture-errors` are `testIgnore`d on `mobile-webkit`, so mobile only ran assessment-flow×2 + muscle-kb×2 + a11y×2(skipped). Matches the documented project matrix.)

**Failure detail (both projects, identical):**
```
e2e/muscle-kb.spec.ts:38
  expect(await cards.count()).toBe(28)
  Expected: 28   Received: 29
```

**CI `checks` partial baseline (2026-06-28):**
- `npm run lint` → **PASS** (0 errors, 12 pre-existing warnings in `app/` + `packages/posture-engine/` — non-fatal; engine is off-limits to this loop).
- `npm run typecheck` (`tsc --noEmit`, includes `e2e/`) → **PASS**.
- Not yet measured this loop (measure before any completion claim): `npx vitest run`, `npm test -w @posture-ai/engine`, `npm run build`.

---

## Done
- **[2026-06-28] Iteration 1 — baseline established.** Reset local DB to CI-faithful state, cleared stale `:3100` server, ran full suite, gathered DB ground truth, recorded lint/typecheck, created this file. (commit `16ce612`)
- **[2026-06-28] Iteration 2 — Phase 1 green.** Fixed `muscle-kb.spec.ts:38` count 28→29 — proven legitimate seed growth (seed `20260612020000` inserts 28; migration `20260627000000_muscle_evidence_reconciliation.sql` adds 1; DB = 29 distinct, no dupes; trapezius = 3 so line-41 kept). Verified muscle-kb green both projects, then full suite green, then lint + typecheck. (commit `4f0ea9a`)
- **[2026-06-28] Iteration 3 — Phase 2 specs (2/9).** Added `e2e/health.spec.ts` (`GET /api/health` → 200 ok/connected/schema ready) and `e2e/auth-access.spec.ts` (`/dashboard` server-redirect + `/clients` client-redirect → `/auth/sign-in` when signed out; storageState emptied). Verified new specs green both projects, then full suite **21/0/2 green**, lint + typecheck. (commit `f86a524`)
- **[2026-06-28] Iteration 4 — Phase 2 spec (3/9): logout.** Added `e2e/logout.spec.ts` — NavBar logout (desktop button + mobile hamburger) → `/auth/sign-in` + cleared session (protected page bounces back). Discovered the app's `signOut()` is GLOBAL scope (GoTrue revokes the shared session immediately, not at JWT expiry), which poisoned specs running after logout; fixed by re-signing-in + re-saving `e2e/.auth/user.json` in `afterEach` (runs on failure too → no cascade). Verified full suite **23/0/2 green** (muscle-kb/real-detection run after logout and stay green). (commit `384b352`)

- **[2026-06-28] Iteration 5 — Phase 2 spec (4/9): client list/search.** Added `e2e/clients.spec.ts` — creates two uniquely-tokened clients, asserts both list on `/clients`, a token search narrows to one, clearing restores both. Verified full suite **25/0/2 green** (27 tests), lint + typecheck. (commit `2585f73`)

- **[2026-06-28] Iteration 6 — client mutation: archive (+ edit-feature finding).** Confirmed the app has **no client-edit feature** (no edit UI on `app/clients/[id]/page.tsx`, no edit subroute, `PATCH /api/clients/[id]` accepts only `archived_at`). Implemented the real client-mutation flow instead — `e2e/clients.spec.ts` now archives a throwaway client (confirm dialog → dropped from the active list; a keeper proves the list rendered). Verified full suite **27/0/2 green** (29 tests), lint + typecheck. (commit `baac946`) See **Escalations** re: "client edit".

- **[2026-06-28] Iteration 7 — Phase 2 spec: wizard back-navigation.** Added `e2e/wizard-nav.spec.ts` — test-mode wizard: select client (step 1) → Next → step 2 → Back, asserts step 1 still shows the client selected (Next enabled + "✓ Selected"). Verified full suite **29/0/2 green** (31 tests), lint + typecheck. (commit `00d9863`)

- **[2026-06-28] Iteration 8 — Phase 2 spec: abandon mid-wizard.** Added to `e2e/wizard-nav.spec.ts` — reach step 2 (test mode), leave via "← Back to Clients", assert via `/api/clients/[id]/assessments` that none was created. (First attempt asserted via the detail-page UI and flaked on webkit — a client-side `getUser` race on chained navigations; switched to an API assertion for determinism.) Verified full suite **31/0/2 green** (33 tests), lint + typecheck. (commit `df1911b`)

- **[2026-06-28] Iteration 9 — Phase 2 spec: client empty-state.** Added to `e2e/clients.spec.ts` — fresh client → `/clients/[id]` shows "No assessments yet" + "+ New Assessment" CTA; Progress/Compare tabs absent (<2 assessments), Assessments/Info present. Verified full suite **33/0/2 green** (35 tests), lint + typecheck. (commit `a933f6e`)

- **[2026-06-28] Iteration 10 — Phase 2 spec: unreviewed-content badge (Phase 2 COMPLETE).** Added `e2e/unreviewed-content.spec.ts` — unreviewed muscle page (`/muscles/upper-trapezius`; all 29 seeded muscles have `reviewed_at` NULL) shows the "Pending review" badge in dev/preview (gate: `flag==='1' || NODE_ENV!=='production'`). Verified full suite **35/0/2 green** (37 tests), lint + typecheck. (commit `defe7f3`) **All 8 Required Phase-2 specs implemented** + client edit N/A.
- **[2026-06-28] Iteration 11 — Phase 3 (docs) COMPLETE.** Added `e2e/README.md` (prereqs, run + CI-mimic, project matrix + intentional skips, spec inventory, test-mode, how-to-add, flake policy). Documented the `no-person.png` negative fixture in `fixtures/photos/README.md`. Verified `docs/RUNBOOK.md` testing section accurate (run procedure unchanged) and that all 11 specs + `auth.setup` carry top-of-file comments. Docs-only → suite unchanged; lint + typecheck green. (commit `d3bf1f8`)
- **[2026-06-28] Iteration 12 — Phase 4: CI `checks` chain green + `ci.yml` confirmed.** Ran the full chain locally: lint ✓, typecheck ✓, `vitest run` **219 passed** (23 files), `npm test -w @posture-ai/engine` **60 passed** (4 files), `npm run build` ✓ (compiled + 24 static pages). Confirmed `.github/workflows/ci.yml` runs that exact `checks` chain plus an `e2e` job (`supabase start -x …`, `playwright install --with-deps chromium webkit`, `npm run test:e2e`, failure-artifact upload); new specs are auto-discovered via `testDir`, so no ci.yml change is needed. Verification only — no code change.
- **[2026-06-28] Iteration 13 — Phase 4 durability gate A: 3× plain green.** Ran `npm run test:e2e` three times consecutively (clearing `:3100` between runs): **35 passed · 0 failed · 2 skipped** each (49.7s / 50.0s / 50.2s), exit 0 all three. Plain-run durability confirmed — no flake.
- **[2026-06-28] Iteration 14 — Phase 4 durability gate B: 3× CI-mimic green.** Ran `npx supabase db reset` + `CI=1 npm run test:e2e` three times consecutively: reset exit 0 + run exit 0 each, **35 passed · 0 failed · 2 skipped** (49.6s / 49.9s / 50.1s), **0 flaky** all three. CI-mimic durability confirmed. **All loop-verifiable DoD boxes are now green** → `E2E_LOOP_COMPLETE` emitted.

## Current suite state (2026-06-28, post-iteration-14) — ✅ LOOP COMPLETE
- `npm run test:e2e` (`retries:0`): **35 passed · 0 failed · 2 intentional skips** (37 tests).
- Full CI `checks` chain (iter 12): lint ✓ · typecheck ✓ · vitest 219/219 ✓ · engine 60/60 ✓ · build ✓. `ci.yml` confirmed.
- **Durability gate A (iter 13): 3× plain green** (all 35/0/2). ✅
- **Durability gate B (iter 14): 3× CI-mimic green** (`db reset` + `CI=1 test:e2e`, all 35/0/2, 0 flaky). ✅

## Definition of Done — final status
- [x] `npm run test:e2e` 100% green on both projects, **3× in a row** (gate A), **zero dodge-skips** — the 2 skips are pre-existing intentional (a11y on mobile-webkit).
- [x] Every Required Phase-2 spec implemented + green (8) — **except `client edit`, which has no feature in the app** (see Escalations / Pending human confirmation). Client **archive** covered as the real mutation. Deferrable candidates deferred with technical reasons.
- [x] `e2e/README.md` exists + accurate; fixtures + RUNBOOK match reality.
- [x] Local CI-mimic green **3×** on both projects (gate B). Real GitHub `checks`+`e2e` = pending human confirmation.
- [x] Full CI `checks` chain green locally (lint + typecheck + vitest 219 + engine 60 + build).
- [x] This progress file is current with no open critical items.

## Pending human confirmation (loop cannot self-verify)
1. **GitHub CI green** — the loop must not push `main` or open a PR, so it cannot trigger the real `checks`+`e2e` runs. ⚠️ GitHub Actions minutes were exhausted as of 2026-06-12 — a human must confirm billing, open a PR from `e2e-hardening`, and confirm both jobs pass.
2. **`client edit` coverage decision** — no edit feature exists (no UI; `PATCH /api/clients/[id]` accepts only `archived_at`). Accept client **archive** coverage in lieu of edit, or build a client-edit feature outside this loop (then add its spec).
3. **Deferred Phase-2 candidates** — session expiry, real PDF render/download, multi-assessment progress chart, mobile-webkit camera capture (each has a logged technical reason). Sign off, or schedule.

## Handoff
- All work is on `e2e-hardening` (base `main` @ `f3c9c8a`). **No** `main` push / PR / merge / `zs-land` / deploy was performed. `packages/posture-engine` + `supabase/migrations/` untouched.
- `E2E_LOOP_PROMPT.md` remains untracked (the loop reads it from disk).
- Next human steps: review the branch → decide #2 → sort GitHub Actions billing (#1) → open a PR → confirm real CI.

## Backlog / deferred (priority order)

### Phase 1 — get fully green ✅ (all baseline failures fixed; suite green)
1. ✅ **DONE (iteration 2, commit `4f0ea9a`)** — `e2e/muscle-kb.spec.ts:38` count 28 → 29. Proven legitimate seed growth (seed=28 + `20260627000000_muscle_evidence_reconciliation.sql`=1 → 29 distinct in DB; trapezius=3, line-41 kept). Suite now 15/0/2 green.
   - Remaining Phase-1 gate (run as an END verification, after Phase 2/3): 3× consecutive green `npm run test:e2e`, both projects.

### Phase 2 — coverage gaps — **Required (not deferrable)**
Confirm each against `app/` before writing; extend `e2e/helpers.ts` (don't duplicate); unique client names via `crypto.randomUUID().slice(0,8)` (NOT the `Date.now().slice(-7)` truncation, which can collide).
- [x] unauthenticated redirect to sign-in — `e2e/auth-access.spec.ts` (iter 3)
- [x] logout — `e2e/logout.spec.ts` (iter 4)
- [~] client edit — **N/A: no edit feature exists** (no edit UI; `PATCH /api/clients/[id]` accepts only `archived_at`). Pending human confirmation; client **archive** covered instead — `e2e/clients.spec.ts` (iter 6). See Escalations.
- [x] client list/search — `e2e/clients.spec.ts` (iter 5)
- [x] wizard back-navigation — `e2e/wizard-nav.spec.ts` (iter 7)
- [x] abandon mid-wizard — `e2e/wizard-nav.spec.ts` (iter 8)
- [x] empty-state when a client has no assessments — `e2e/clients.spec.ts` (iter 9)
- [x] `/api/health` happy path — `e2e/health.spec.ts` (iter 3)
- [x] unreviewed-content badge behavior (dev/preview) — `e2e/unreviewed-content.spec.ts` (iter 10)

### Phase 2 — deferrable (log a concrete blocker when deferring)
- session expiry (timing-dependent), real PDF render/download (`@react-pdf` heavy), multi-assessment progress chart (needs multi-assessment seeding), `mobile-webkit` camera capture (WebKit camera constraints).

### Phase 3 — docs ✅ (iter 11)
- [x] `e2e/README.md` — created (run, prereqs, matrix, test-mode, how-to-add, flake policy)
- [x] `e2e/fixtures/photos/README.md` — added the `no-person.png` negative fixture
- [x] `docs/RUNBOOK.md` testing section — verified accurate; run procedure unchanged
- [x] per-spec top-of-file comments — all 11 specs + `auth.setup` carry them (verified)

### Phase 4 — CI hardening
- [x] Confirm `.github/workflows/ci.yml` (supabase `start` excludes, `playwright install --with-deps chromium webkit`, on-failure artifact upload) still holds — verified iter 12; new specs auto-discovered via `testDir`, no change needed.
- [x] Full `checks` chain green locally (iter 12): lint ✓ · typecheck ✓ · vitest 219 ✓ · engine 60 ✓ · build ✓.
- [x] Plain durability: 3× consecutive green `npm run test:e2e`, both projects (iter 13: 35/0/2 ×3).
- [x] Local CI mimic durability: `npx supabase db reset` + `CI=1 npm run test:e2e`, both projects, **3× green** (iter 14: 35/0/2 ×3, 0 flaky).
- [ ] GitHub CI = **pending human confirmation** (loop must not push `main` / open PR). ⚠️ GitHub Actions minutes were exhausted as of 2026-06-12 — a human must confirm billing + the real `checks` + `e2e` runs.

---

## Escalations (human decisions needed)
- **"Client edit" Required spec has no corresponding feature.** `app/clients/[id]/page.tsx` exposes only Archive + a read-only Info tab; no edit subroute; `PATCH /api/clients/[id]` whitelists only `archived_at`. A UI edit test is impossible without building the feature, which is out of this loop's scope (tests only; not a product bug). Covered client **archive** instead (the real mutation). **Decision needed:** accept archive coverage in lieu of edit, or schedule a client-edit feature outside the loop. Logged here, not silently skipped.

## Known flakes / risks
- No flake observed in the baseline run — the 2 failures are deterministic count-drift, not flake.
- **Stale local seed / stray `:3100` server** can taint runs → always `npx supabase db reset` + clear `:3100` before a clean run (done this iteration).
- **Shared practitioner account + serial run** → new specs must use fully-unique client names and rely on `db reset` between full runs to avoid name-selector aliasing.
- **Webkit client-side `getUser` race:** chaining `/clients` → `/clients/[id]` navigations quickly can abort the detail page's `getUser` fetch ("Load failed") → false redirect to sign-in. Prefer asserting client data via `page.request` API calls (or a single clean `goto`) over rapid UI navigation chains (see the iter-8 abandon test).

## Notes
- `E2E_LOOP_PROMPT.md` is present at repo root but **untracked** (loop reads it from disk; left as-is unless asked to commit).
- Guardrails honored every iteration: on `e2e-hardening`; no `main` push / PR / land / deploy; `packages/posture-engine` + `supabase/migrations/` untouched.
- **✅ LOOP COMPLETE (2026-06-28, iter 14).** Every loop-verifiable DoD box is green and durable (3× plain + 3× CI-mimic, both projects; full `checks` chain green; docs accurate; progress file current). The items the loop cannot verify itself are written up under **Pending human confirmation** above (GitHub CI; `client edit` coverage decision; deferred-candidate sign-off). `E2E_LOOP_COMPLETE` emitted — the token means the loop has done everything it can; it does **not** claim GitHub CI is green.
