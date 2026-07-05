# Consent-Token Hashing Implementation Plan (audit play ②a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **security** change — TDD, no shortcuts.

**Goal:** Stop storing consent tokens in plaintext. Store only a SHA-256 hash at rest; the raw token lives only in the link URL / QR delivered to the subject — exactly mirroring the already-proven workout share-token pattern.

**Architecture:** Today `consent_tokens.token` holds the raw `randomUUID()` string with a UNIQUE constraint, and both the pre-flight read (`/api/consent/respond`) and the `record_remote_consent` RPC look it up by plaintext equality. A DB read (backup, log, replica, breach) therefore exposes live consent links. The workout share token already solved this: `generateShareToken()` returns `{ token, tokenHash }`, only `tokenHash` is persisted (`session_token_hash`), and resolution hashes the presented token before lookup (`resolve_workout_token(p_token_hash)`). We replicate that for consent: a new `hashConsentToken`/`generateConsentToken` helper, a `token_hash` column replacing `token`, and an RPC that takes `p_token_hash`. The raw token never touches the DB.

**Tech Stack:** Next.js 16 App Router, `node:crypto` (SHA-256, app-layer — no `pgcrypto`, per the existing convention), Supabase RPC (plpgsql), Vitest, Playwright.

**Reference implementation (copy this):** `lib/workout/token.ts` (`hashShareToken`/`generateShareToken`), `app/api/workouts/route.ts:85-99` (store hash only), `app/api/workouts/token/[token]/route.ts:40` (hash-then-resolve), `supabase/migrations/20260702010000_resolve_workout_token.sql` (RPC by hash). Tests to mirror: `lib/workout/token.test.ts`.

**Audit evidence:** `docs/qa/AUDIT.md` — 2026-07-04 security headliners, carried in the 2026-07-05 delta ("plaintext consent tokens").

## Global Constraints

- **Forward-only migration**, next free timestamp after the highest landed migration at implementation time (use `20260708040000` if no coherence-Stage-2 migrations have landed; otherwise the next free slot). Local Supabase only (`supabase status` = 127.0.0.1). **Prod is out of scope for this plan** — the migration joins the prod queue and is applied only under a separate explicit "apply to prod".
- Screening-vocabulary ban holds for any user-visible copy (none changes here).
- The raw token MUST stay in the delivered URL (`/consent/<token>`) and QR — that is the only channel to the subject; there is no email/SMS integration. Only the *at-rest* representation changes.
- **Existing rows are considered compromised** (they were stored plaintext): invalidate unconsumed rows rather than backfilling hashes (a hash-in-place gives no retroactive protection). Consumed rows are already single-use-exhausted and inert.
- One feature branch → `~/bin/zs-land`. Never commit to main.

---

## Task 1: The hash/generate helper (TDD, pure)

**Files:**
- Create: `lib/consent/token.ts`
- Create: `lib/consent/token.test.ts`

**Interfaces:**
- Produces: `hashConsentToken(token: string): string` (SHA-256 hex) and `generateConsentToken(): { token: string; tokenHash: string }` (256-bit CSPRNG raw token via `randomBytes(32).toString('base64url')`, plus its hash). Deliberately upgrades entropy from the old 128-bit UUID to 256-bit, matching the share token.

- [ ] **Step 1: Write the failing test** — mirror `lib/workout/token.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hashConsentToken, generateConsentToken } from './token'

describe('consent token', () => {
  it('generates a 256-bit base64url raw token + its sha256 hex hash', () => {
    const { token, tokenHash } = generateConsentToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)      // base64url, 32 bytes
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)         // sha256 hex
    expect(tokenHash).not.toContain(token)              // hash never embeds raw
  })
  it('hashConsentToken is deterministic and matches generate', () => {
    const { token, tokenHash } = generateConsentToken()
    expect(hashConsentToken(token)).toBe(tokenHash)
  })
  it('mints unique tokens', () => {
    expect(generateConsentToken().token).not.toBe(generateConsentToken().token)
  })
})
```

- [ ] **Step 2:** `npx vitest run lib/consent/token.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/consent/token.ts` (copy `lib/workout/token.ts` verbatim, rename `Share`→`Consent`):

```ts
import { randomBytes, createHash } from 'node:crypto'

export function hashConsentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateConsentToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashConsentToken(token) }
}
```

- [ ] **Step 4:** `npx vitest run lib/consent/token.test.ts` → PASS.
- [ ] **Step 5: Commit** — `chore(consent): add consent-token hash/generate helper (mirror share token)`.

---

## Task 2: Migration — `token_hash` column + RPC by hash + invalidate legacy rows

**Files:**
- Create: `supabase/migrations/<next>_consent_token_hash.sql`

**Evidence:** `consent_tokens` defined at `supabase/migrations/20260629000000_regulatory_hardening.sql:81-92` (`token TEXT UNIQUE NOT NULL`, redundant `idx_consent_tokens_token`). RPC at `supabase/migrations/20260629100000_regulatory_hardening_v2.sql:85-98` (`record_remote_consent(p_token text, …)` with `WHERE ct.token = p_token`).

- [ ] **Step 1: Write the migration** (single forward-only file):

```sql
-- Consent tokens at rest: store only SHA-256(token). Raw token lives in the
-- delivered URL/QR only, never in the DB. Mirrors session_token_hash.

-- 1. New hash column.
ALTER TABLE consent_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- 2. Legacy rows were stored plaintext → treat as compromised. Invalidate every
--    unconsumed token (dead-links them; practitioners re-mint). Consumed rows are
--    already single-use-exhausted. Give ALL rows a sentinel hash so NOT NULL holds
--    without exposing anything (we never look these up again).
UPDATE consent_tokens SET consumed_at = now() WHERE consumed_at IS NULL;
UPDATE consent_tokens SET token_hash = 'legacy_' || id::text WHERE token_hash IS NULL;

-- 3. Enforce the new shape, drop the plaintext column (and its UNIQUE/index).
ALTER TABLE consent_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE consent_tokens ADD CONSTRAINT consent_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE consent_tokens DROP COLUMN token;   -- drops idx_consent_tokens_token too

-- 4. RPC now takes the hash. A param RENAME requires DROP + CREATE (CREATE OR
--    REPLACE cannot rename input params).
DROP FUNCTION IF EXISTS record_remote_consent(text, text, text, timestamptz, text, text);
-- ^ match the EXACT existing signature (verify arg types in _v2.sql before writing).
CREATE FUNCTION record_remote_consent(p_token_hash text, /* …rest identical… */)
RETURNS /* … */ LANGUAGE plpgsql SECURITY DEFINER AS $$
-- body identical to the original EXCEPT:
--   SELECT … FROM consent_tokens ct WHERE ct.token_hash = p_token_hash;
--   UPDATE consent_tokens SET consumed_at = p_signed_at
--     WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > p_signed_at;
$$;
-- Re-GRANT execute to service_role exactly as the original did.
```

> **Implementation note:** open `20260629100000_regulatory_hardening_v2.sql:85-98` and copy the full function body + signature + GRANT verbatim, changing only the parameter name (`p_token`→`p_token_hash`) and the two `WHERE` clauses. Do not hand-edit behavior. The `DROP FUNCTION` signature MUST match the original argument list exactly or it errors.

- [ ] **Step 2: Apply locally + verify**

```bash
supabase db reset   # applies all migrations incl. this one, on 127.0.0.1
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d consent_tokens"      # no 'token' column; token_hash NOT NULL UNIQUE
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\df record_remote_consent"  # signature shows p_token_hash
```

- [ ] **Step 3: Commit** — `feat(consent): hash consent tokens at rest (token_hash column + RPC by hash; invalidate legacy)`.

---

## Task 3: Route wiring — mint stores hash, respond hashes before lookup

**Files:**
- Modify: `app/api/consent/link/route.ts:34-49` (mint)
- Modify: `app/api/consent/respond/route.ts:43-47` + the RPC call site (consume)
- Modify: `scripts/qa-seed.ts:318-330` (seed writes `token_hash`)

- [ ] **Step 1: Mint stores the hash, returns raw in URL** — in `link/route.ts`:

```ts
import { generateConsentToken } from '@/lib/consent/token'
// …
const { token, tokenHash } = generateConsentToken()
const { error } = await service.from('consent_tokens').insert({
  token_hash: tokenHash,          // was: token
  client_id: clientId,
  practitioner_id: user.id,
  consent_version: CONSENT_VERSION,
  expires_at: expiresAt,
})
const url = `${new URL(req.url).origin}/consent/${token}`   // raw token — unchanged
```

Remove the `import { randomUUID }` if now unused.

- [ ] **Step 2: Respond hashes before both lookups** — in `respond/route.ts`:

```ts
import { hashConsentToken } from '@/lib/consent/token'
// …
const tokenHash = hashConsentToken(token)
const { data: tok } = await service
  .from('consent_tokens')
  .select('consent_version')
  .eq('token_hash', tokenHash)          // was: .eq('token', token)
  .maybeSingle()
// …
await service.rpc('record_remote_consent', { p_token_hash: tokenHash, /* …rest… */ })  // was p_token
```

Trace every `record_remote_consent` call site and rename the arg key `p_token` → `p_token_hash`.

- [ ] **Step 3: QA seed** — in `qa-seed.ts:318-330`, compute `hashConsentToken(rawToken)` and insert `token_hash` instead of `token` (keep the raw token only if the seed's own flow needs to hit `/consent/<token>`; otherwise store just the hash).

- [ ] **Step 4: Typecheck + vocab** — `npx tsc --noEmit && npx vitest run lib/ui-vocabulary.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(consent): mint stores token_hash, respond resolves by hash (no plaintext at rest)`.

---

## Task 4: e2e — the remote-consent flow still works end to end

**Files:**
- Verify/adjust: `e2e/consent-age.spec.ts:44-77`

The e2e already extracts the raw token from the returned URL (`url.split('/consent/')[1]`) and POSTs it to `/respond` — that path is unchanged (raw token still in the URL). The hashing is transparent to the client. This task confirms the round-trip and single-use (410 on re-submit) still pass against the new schema.

- [ ] **Step 1:** `npm run test:e2e -- --grep "consent"` → PASS (link mint → capture blocked → respond unlocks → second submit 410).
- [ ] **Step 2:** If the seed or fixtures referenced a `token` column, fix them (grep `consent_tokens` in `e2e/` + `scripts/`).
- [ ] **Step 3: Commit + land** — `test(e2e): confirm remote-consent round-trip on hashed tokens` → `~/bin/zs-land`.

---

## Success Criteria

- [ ] `consent_tokens` has no `token` column; `token_hash TEXT NOT NULL UNIQUE`; no raw token is ever written by any code path (`grep -rn "\.token\b" app/api/consent scripts` shows only URL construction from the in-memory raw token).
- [ ] `record_remote_consent` takes `p_token_hash`; both lookups match by hash.
- [ ] `npx tsc --noEmit` clean; full `npx vitest run` green; consent e2e green.
- [ ] Legacy unconsumed rows invalidated (`consumed_at` set); no plaintext token survives the migration.

## Non-goals

- Email/SMS delivery of links (none exists; out of scope).
- Rotating `CONSENT_VERSION` or changing the consent legal copy.
- Rate-limiting `/api/consent/*` — tracked in the rate-limit-coverage plan (play ②b).
