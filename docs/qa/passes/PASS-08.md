# QA Loop — Iteration 8 (PASS-08) — TIGHTENING AND BUG SWEEP

**Date:** 2026-08-07
**Scope:** repository hygiene, open PR/worktree reconciliation, deep audit,
performance regression repair, security/data-integrity hardening, and exact-head
regression verification
**Verdict:** **ENGINEERING FIXES GREEN / ONE GOVERNED CLINICAL MIGRATION REQUIRES OWNER APPROVAL / PHYSICAL DEVICE GATE REMAINS**

## Outcome

The bounded source audit proved no S1 defects. All non-schema defects reproduced
in this pass have fixes on the consolidated branch, including the Progress-tab
interaction regression, stale camera permission work, cross-engine pose-worker
startup, migration-blind health readiness, silent/out-of-order workout saves,
public-token rate-limit failure behavior, global script CSP, logo rollback,
legacy unbounded reads, dashboard-average truncation, webpack page exports, MFA
input focus, and direct coverage for every API route.

The genu varum/valgum direction defect remains intentionally unfixed: correcting
it requires a governed schema/content migration and regenerated clinical hashes.
That migration was explicitly raised for owner approval and was not inferred from
the broad bug-fix authorization. Clinical surfaces remain disabled by default, so
the unreviewed content is not activated.

## Reproduced root causes and repairs

- Expanding recorded scores synchronously mounted and painted a 20-row table on a
  long glass-card page. The disclosure now presents immediately and defers the
  table mount; the 4× CPU Chromium probe improved to p95 64 ms from the official
  failing p95 304 ms.
- A pending camera-permission preflight could outlive visibility/unmount state.
  Generation checks now retire stale work before `getUserMedia`.
- WebKit worker fallback had made Chromium consume an `import.meta` WASM loader as
  a classic script. The worker now preserves the Chromium fileset and installs
  the supported WebKit import hook only where required.
- Health checked tables/columns but not three RPCs required by the client
  directory and dashboard. Exact function-signature probes now return
  `pending_migration` when any is absent.
- Workout saves were fire-and-forget and the server revision check was a
  read-then-update race. The server now performs practitioner-scoped CAS; the
  authenticated player serializes acknowledgements, retries three times, rebases
  conflicts, and exposes unsaved/manual-retry state.
- Anonymous bearer-token endpoints used the availability-oriented fail-open
  limiter. Consent response, workout-token hydration, and token rating now use
  the strict limiter and deny before token work when the backing RPC fails.
- Production script CSP allowed inline/eval execution. Responses now carry a
  per-request nonce with `strict-dynamic`, `object-src 'none'`, dev-only
  `unsafe-eval`, and the MediaPipe-required `wasm-unsafe-eval` exception.
- Logo metadata failure could orphan an object. Uploads now use unique
  user-prefixed names, compensate on failed metadata persistence, and scope prior
  object cleanup to the authenticated user prefix.
- Legacy no-limit endpoints and weekly dashboard averaging could silently lose
  rows at PostgREST's cap. Legacy no-limit requests now fail before DB work;
  dashboard scores page deterministically in 500-row batches and fail visibly on
  partial-read errors.
- Next route files exported test helpers, which webpack rejects. Route files now
  expose only allowed exports; both Turbopack and webpack builds pass.

## Verification at consolidated head

- Focused integration matrix: 156/156 tests.
- Full Vitest: 233 files, 2,211/2,211 tests.
- TypeScript: pass.
- ESLint: 0 errors; 21 pre-existing warnings.
- Canonical Next 16.2.6 Turbopack production build: pass.
- Optional webpack production build: pass.
- Frozen performance smoke: 80/80; budget hash remains
  `13d2331f4fa4fe11fe98b9a98fbb631ac734040ef54a0ef2af6137bc98f46b74`.
- Isolated local Supabase start, full reset, and migration replay: pass without
  stopping the unrelated stack; SQL contracts 161/161.
- Generated clinical inventory and production-readiness source pins: current.
- Formal security reviews for security, data-integrity, and workout-persistence
  lanes: PASS; exact-range secret scans found no leak.

## Evidence still pending or human-gated

- Official GitHub performance receipt for the performance repair was still
  running when this local pass was recorded; its lint/build and Playwright jobs
  were green.
- CAM-REAL remains a physical iPhone Safari and Android Chrome gate. Headless
  Chromium/WebKit worker execution is not physical-device evidence.
- Production migration state, provider backup/PITR, and restore evidence were not
  queried or mutated.
- Direction-specific genu content requires explicit owner approval plus the
  existing licensed-clinician governance path.

## Stop condition

Engineering can land after one independent exact-head verifier and green required
PR checks. Clinical direction migration and physical-device/provider evidence stay
explicitly blocked rather than being reported as passing.
