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

## Current suite state (2026-06-28, post-iteration-2)
- `npm run test:e2e` (clean db-reset run, `retries:0`): **15 passed · 0 failed · 2 intentional skips** → **fully green**.
- 1 clean green run recorded. The DoD gates — 3× consecutive green `test:e2e` **and** 3× CI-mimic (`db reset` + `CI=1 test:e2e`) — are END verifications to run after Phase 2/3, because adding the Required specs changes the suite.

## In progress
- (none — iteration 2 complete)

## Next up
- **Iteration 3:** begin Phase 2 Required specs. Suggested order (simplest / least shared-state first): `/api/health` happy path → unauthenticated redirect to sign-in → logout → client list/search → client edit → wizard back-navigation → abandon mid-wizard → empty-state (no assessments) → unreviewed-content badge. One spec (or one tight group) per iteration, each verified + committed.

## Backlog / deferred (priority order)

### Phase 1 — get fully green ✅ (all baseline failures fixed; suite green)
1. ✅ **DONE (iteration 2, commit `4f0ea9a`)** — `e2e/muscle-kb.spec.ts:38` count 28 → 29. Proven legitimate seed growth (seed=28 + `20260627000000_muscle_evidence_reconciliation.sql`=1 → 29 distinct in DB; trapezius=3, line-41 kept). Suite now 15/0/2 green.
   - Remaining Phase-1 gate (run as an END verification, after Phase 2/3): 3× consecutive green `npm run test:e2e`, both projects.

### Phase 2 — coverage gaps — **Required (not deferrable)**
Confirm each against `app/` before writing; extend `e2e/helpers.ts` (don't duplicate); unique client names via `crypto.randomUUID().slice(0,8)` (NOT the `Date.now().slice(-7)` truncation, which can collide).
- [ ] unauthenticated redirect to sign-in
- [ ] logout
- [ ] client edit
- [ ] client list/search
- [ ] wizard back-navigation
- [ ] abandon mid-wizard
- [ ] empty-state when a client has no assessments
- [ ] `/api/health` happy path
- [ ] unreviewed-content badge behavior (dev/preview)

### Phase 2 — deferrable (log a concrete blocker when deferring)
- session expiry (timing-dependent), real PDF render/download (`@react-pdf` heavy), multi-assessment progress chart (needs multi-assessment seeding), `mobile-webkit` camera capture (WebKit camera constraints).

### Phase 3 — docs
- [ ] `e2e/README.md` (run, prereqs, project matrix, test-mode, how to add a spec, flake policy)
- [ ] `e2e/fixtures/photos/README.md` accuracy
- [ ] `docs/RUNBOOK.md` testing section (if run procedure changes)
- [ ] per-spec top-of-file comments where missing

### Phase 4 — CI hardening
- [ ] Confirm `.github/workflows/ci.yml` (supabase `start` excludes, `playwright install --with-deps chromium webkit`, on-failure artifact upload) still holds as specs are added.
- [ ] Local CI mimic durability: `npx supabase db reset` + `CI=1 npm run test:e2e`, both projects, **3× green**.
- [ ] Full `checks` chain green locally: `npm run lint && npm run typecheck && npx vitest run && npm test -w @posture-ai/engine && npm run build`.
- [ ] GitHub CI = **pending human confirmation** (loop must not push `main` / open PR). ⚠️ GitHub Actions minutes were exhausted as of 2026-06-12 — a human must confirm billing + the real `checks` + `e2e` runs.

---

## Known flakes / risks
- No flake observed in the baseline run — the 2 failures are deterministic count-drift, not flake.
- **Stale local seed / stray `:3100` server** can taint runs → always `npx supabase db reset` + clear `:3100` before a clean run (done this iteration).
- **Shared practitioner account + serial run** → new specs must use fully-unique client names and rely on `db reset` between full runs to avoid name-selector aliasing.

## Notes
- `E2E_LOOP_PROMPT.md` is present at repo root but **untracked** (loop reads it from disk; left as-is unless asked to commit).
- Guardrails honored every iteration: on `e2e-hardening`; no `main` push / PR / land / deploy; `packages/posture-engine` + `supabase/migrations/` untouched.
- **Not done** — Definition of Done not met: suite is green, but 0 of 9 Required Phase-2 specs exist, no `e2e/README.md`, `vitest`/engine/`build` not yet measured this loop, and the 3×-streak + 3× CI-mimic end-gates are unrun. Completion token must NOT be emitted.
