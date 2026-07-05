# Rate-Limit Coverage + Fail-Open Implementation Plan (audit play ②b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Security** change — TDD.

**Goal:** Close the rate-limit gaps: (1) add `enforceRateLimit` to the ~10 mutating routes that have none, and (2) give the three highest-risk mutations a **fail-closed** variant so a limiter DB error can't silently open the gate on compliance-sensitive writes. Add the unit-test coverage the limiter has never had.

**Architecture:** `enforceRateLimit(service, {route, userId, limit, windowSeconds})` (`lib/rate-limit.ts`) calls the `check_rate_limit` `SECURITY DEFINER` RPC over `api_rate_limits` (fixed 60s window; migration `20260612030000_rate_limits.sql`). On RPC error it **returns `true` (fail-open)** — `lib/rate-limit.ts:17-19`. That default is a *documented product decision* ("availability beats strictness for a screening tool") and is correct for high-frequency UX writes, but wrong for irreversible/compliance mutations. Rather than flip the global default (which would regress the deliberate availability posture), we add a sibling `enforceRateLimitStrict` that returns `false` on error, and use it on the three sensitive routes. Everything else uses the existing fail-open helper. **No schema change** — the table and RPC already exist.

**Tech Stack:** Next.js 16 App Router, Supabase RPC, Vitest.

**Reference pattern (mirror exactly):** `app/api/workouts/route.ts:48-52` (gate → `enforceRateLimit` → `logEvent('rate_limited', 429)` → 429 response).

**Audit evidence:** `docs/qa/AUDIT.md` 2026-07-05 delta — "fail-open rate limiter, 9 uncovered mutating routes (3 new)".

## Global Constraints

- No schema/migration change (table + RPC exist). Local Supabase only (`supabase status` = 127.0.0.1).
- **Preserve the documented fail-open default** for `enforceRateLimit`; add fail-closed only via the new strict helper on the three named routes.
- Every new 429 path logs `logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })` (the dominant pattern; the three currently-silent 429s are the inconsistency, not the model).
- Insert the check **immediately after the auth/practitioner gate, before any mutation** (or at the very top for public IP-keyed routes).
- One feature branch → `~/bin/zs-land`. Never commit to main. Surgical — do not refactor unrelated route logic.

---

## Task 1: Unit-test the limiter + add `enforceRateLimitStrict` (TDD)

**Files:**
- Create: `lib/rate-limit.test.ts`
- Modify: `lib/rate-limit.ts` (add `enforceRateLimitStrict`; leave `enforceRateLimit` behavior unchanged)

**Interfaces:**
- Produces: `enforceRateLimitStrict(service, opts): Promise<boolean>` — identical to `enforceRateLimit` except it returns `false` (deny) when the RPC errors. Both share the RPC-count semantics.

- [ ] **Step 1: Write failing tests** — mock the Supabase RPC (`service.rpc` returns `{ data, error }`). Cover both helpers:

```ts
import { describe, it, expect, vi } from 'vitest'
import { enforceRateLimit, enforceRateLimitStrict } from './rate-limit'

const svc = (rpc: () => Promise<{ data: unknown; error: unknown }>) =>
  ({ rpc: vi.fn(rpc) }) as unknown as import('@supabase/supabase-js').SupabaseClient
const opts = { route: 'test', userId: 'u1', limit: 5, windowSeconds: 60 }

describe('enforceRateLimit (fail-open)', () => {
  it('allows when under limit (rpc true)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: true, error: null })), opts)).toBe(true)
  })
  it('denies when over limit (rpc false)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: false, error: null })), opts)).toBe(false)
  })
  it('FAILS OPEN on rpc error (documented availability posture)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: null, error: { message: 'db down' } })), opts)).toBe(true)
  })
})

describe('enforceRateLimitStrict (fail-closed)', () => {
  it('allows/denies identically under normal operation', async () => {
    expect(await enforceRateLimitStrict(svc(async () => ({ data: true, error: null })), opts)).toBe(true)
    expect(await enforceRateLimitStrict(svc(async () => ({ data: false, error: null })), opts)).toBe(false)
  })
  it('FAILS CLOSED on rpc error', async () => {
    expect(await enforceRateLimitStrict(svc(async () => ({ data: null, error: { message: 'db down' } })), opts)).toBe(false)
  })
})
```

- [ ] **Step 2:** `npx vitest run lib/rate-limit.test.ts` → FAIL (strict helper missing; fail-open tests should already pass and lock the current behavior).
- [ ] **Step 3: Implement `enforceRateLimitStrict`** — extract the shared RPC call, differ only in the error return:

```ts
// keep enforceRateLimit exactly as-is (returns true on error).
export async function enforceRateLimitStrict(
  service: SupabaseClient,
  opts: { route: string; userId: string; limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await service.rpc('check_rate_limit', { /* same args as enforceRateLimit */ })
  if (error) {
    logEvent({ route: opts.route, outcome: 'server_error', status: 0, detail: `rate-limit rpc failed (strict, denying): ${error.message}` })
    return false   // fail-closed
  }
  return data === true
}
```

(Factor the RPC arg-building into a private helper if it reduces duplication — but do not alter `enforceRateLimit`'s return contract.)

- [ ] **Step 4:** `npx vitest run lib/rate-limit.test.ts` → PASS (all 5). **Commit** — `test(rate-limit): cover fail-open default + add fail-closed enforceRateLimitStrict`.

---

## Task 2: Add rate limiting to the uncovered mutating routes

**Coverage target (buckets + limits chosen to match the existing 60s-window scheme):**

| Route | Method | Bucket | limit/60s | Helper |
|---|---|---|---|---|
| `app/api/assessments/[id]/route.ts` | PATCH | `assessments_update` | 30 | fail-open |
| `app/api/assessments/[id]/approve/route.ts` | PATCH | `assessments_approve` | 20 | **strict** |
| `app/api/clients/[id]/route.ts` | PATCH | `clients_update` | 30 | fail-open |
| `app/api/consent/route.ts` | POST | `consent_create` | 20 | **strict** |
| `app/api/consent/link/route.ts` | POST | `consent_link` | 20 | **strict** |
| `app/api/workouts/[id]/rate/route.ts` | POST | `workouts_rate` | 20 | fail-open |
| `app/api/workouts/[id]/run/route.ts` | PATCH | `workouts_run` | 120 | fail-open (high-frequency playback; client already dedups writes) |
| `app/api/settings/route.ts` | PATCH | `settings_update` | 30 | fail-open |
| `app/api/settings/route.ts` | POST (logo) | `settings_logo` | 10 | fail-open (upload cost) |
| `app/api/settings/organization/route.ts` | PATCH | `settings_org` | 20 | fail-open |

- [ ] **Step 1: For each authenticated route**, insert immediately after the practitioner gate and before mutations (mirror `workouts/route.ts:48-52`):

```ts
const service = createSupabaseServiceClient()
const allowed = await enforceRateLimit(service, { route: '<bucket>', userId: user.id, limit: <N>, windowSeconds: 60 })
if (!allowed) {
  logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
  return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
}
```

Use `enforceRateLimitStrict` for the three **strict** rows. Ensure each route has a `ROUTE` const and `userHash` (add `const userHash = hashUser(user.id)` if absent — several already have it).

- [ ] **Step 2: `settings/organization` exception** — this route skips `practitionerGate` by design (BAA bootstrap; see its file header). Slot the check **after** its `loadPractitioner` check, before the service writes, keyed on `user.id`.

- [ ] **Step 3: `workouts/[id]/run` note** — this is the route the red-flag cluster (PR #89) modified. Place the rate-limit check after the auth/gate block and BEFORE the `existing` run fetch, so a flood can't even hit the DB read. The `redFlagBlocksCompletion` / `buildRunUpdate` logic stays below it, untouched.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run` → PASS. Confirm each edited route imports `enforceRateLimit`/`enforceRateLimitStrict` and `hashUser` as needed.

- [ ] **Step 5: Manual smoke (local)** — with `supabase status` = 127.0.0.1 and `npm run dev`, hammer one newly-guarded route past its limit (e.g. `PATCH /api/settings` 31× in 60s) and confirm a 429 with the standard body. Confirm a normal single call still 200s.

- [ ] **Step 6: Commit** — `feat(api): rate-limit the 10 uncovered mutating routes (strict on consent + approval)`.

---

## Task 3 (hygiene): log the three currently-silent 429s

**Files:** `app/api/clients/route.ts:40`, `app/api/clients/[id]/route.ts:126`, `app/api/consent/respond/route.ts:30-31`

- [ ] **Step 1:** Add the standard `logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })` (or IP-hash equivalent for `consent/respond`) before each existing silent 429 return, so every 429 in the app is observable.
- [ ] **Step 2:** `npx vitest run` → PASS. **Commit + land** — `chore(api): log the three previously-silent rate-limit 429s` → `~/bin/zs-land`.

---

## Success Criteria

- [ ] Every mutating route handler (`POST`/`PATCH`/`PUT`/`DELETE`) except `auth/sign-out` calls a rate-limit helper — verify with a coverage grep (`grep -L enforceRateLimit` across mutating route files returns only sign-out).
- [ ] `consent`, `consent/link`, `assessments/[id]/approve` use `enforceRateLimitStrict`; the limiter fails **closed** for them under RPC error (unit-tested).
- [ ] `enforceRateLimit` still fails open (unchanged behavior, locked by a test).
- [ ] Every 429 path emits a `rate_limited` log. `npx tsc --noEmit` clean; full `npx vitest run` green.

## Non-goals

- Changing the fixed-window algorithm to sliding-window / token-bucket (out of scope; current window is adequate).
- Per-IP limiting on authenticated routes (practitioner-scoped `user.id` keying is the right boundary for those).
- Distributed/edge rate limiting (the DB-backed limiter is sufficient at current scale).
