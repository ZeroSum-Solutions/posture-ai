---
name: deep-audit
description: Evidence-only technical audit of posture-ai — read the actual code and configuration (never framework assumptions), grade nine areas as PROVED / NO-ISSUE / WEAK / N/A with file:line evidence, verify external limits against current primary sources with calculated numbers, ask before changing any code, and finish with a plain-language overview plus an area-to-evidence table.
---

# posture-ai Deep Audit

A read-only, evidence-only audit. The output is `docs/qa/AUDIT.md`. This skill
**never changes code** — if a fix is obvious, record it as a recommendation
and ask; fixes belong to /qa-loop Phase 3 or a normal dev session.

**Announce at start:** "Running /deep-audit — evidence-only, no code changes."

## The three rules of evidence

1. **Actual code, not assumptions.** Every claim cites `file:line` (or a
   config key, migration, or command output). "Next.js handles that by
   default" is not evidence — open `next.config.ts` and prove what THIS app
   does. "Supabase RLS protects it" is not evidence — read the policy in the
   migration and state what it allows.
2. **External limits from current primary sources.** Anything depending on a
   platform ceiling (Vercel function duration/body size, Supabase plan limits
   on DB size/connections/storage/egress, browser API availability like
   getUserMedia/WakeLock/SpeechSynthesis on iOS Safari) is verified by
   WebFetch against the vendor's current docs — cite the URL and the number.
   Never quote a limit from memory; they change.
3. **Calculate, don't estimate.** Bundle sizes from `npx next build` output;
   MediaPipe payload from `ls -l public/mediapipe/`; row counts and index use
   from `EXPLAIN ANALYZE` on the local seeded DB; rate-limit math shown
   (window × limit × routes). Show the arithmetic in the evidence cell.

## Verdicts

Per checked claim, exactly one of:

| Verdict | Meaning |
|---|---|
| **PROVED** | A real issue, demonstrated with evidence + severity (S1-S4) |
| **NO-ISSUE** | Checked and sound — evidence of what was checked and why it's fine |
| **WEAK** | Suspicious but not demonstrated (couldn't repro / needs prod data / time-boxed out). State what would prove it. |
| **N/A** | Area/claim doesn't apply here — one-line why (e.g. "no cron jobs exist") |

An area is **done** when its checklist rows all carry a verdict. An area that
cannot be completed (needs prod access, a real device, a paid tool) is
returned as **BLOCKED** with the exact unmet need — never silently skipped.

## The nine areas (posture-ai-specific checklists)

Work each area to done or BLOCKED. Add rows freely; never delete rows.

**1. Architecture** — engine purity (`packages/posture-engine` has no app
imports?); one engine copy only; content pipeline (`content/` → seed →
DB) single-source; snapshot versioning (`SessionSnapshot version: 1`)
migration story; client/server component boundaries on heavy pages.

**2. Platform compatibility** — iOS Safari: getUserMedia constraints,
WASM/GPU-delegate fallback (`lib/pose/detect.ts`), WakeLock + SpeechSynthesis
in the player (fallbacks when absent?); Android Chrome; `next.config.ts`
browser targets; the 9MB-vs-5.5MB model choice as actually shipped
(`ls -l public/mediapipe/`).

**3. Security** — CSP headers as literally configured (every source list);
auth flows incl. `safe-next` redirect validation; RLS: read EVERY policy in
`supabase/migrations/` and state what each allows, especially cross-tenant
reads; rate limiting coverage (`lib/rate-limit.ts` — which routes are NOT
covered?); token routes (`/api/workouts/token/*`, `/consent/[token]`): hash
storage, expiry, revocation, uniform-404, enumeration resistance; secrets
never client-bundled (`grep` for service-role usage under `app/` client
components); `test_mode` and `/api/dev/*` reachability in production.

**4. Privileged areas** — service-role client usage sites: is every one
behind an ownership check? Approval gates (report export, workout mint,
launch): server-enforced or UI-only? Tombstone/deletion paths honored by
every read (`resolve_workout_token`, reports, progress)? Storage bucket
policies: who can write `exercise-media`?

**5. Performance** — `npx next build` route-by-route first-load JS table
(flag >150kB routes); heavy-account behavior (150 clients / 400 assessments
from the QA seed): clients list, dashboard, progress — paginated or
full-table scans? `EXPLAIN` the hot queries; N+1 in PostgREST embeds;
player tick re-render cost (React.memo coverage); MediaPipe download UX on
first capture.

**6. Deployment** — Vercel: build cmd, node version, env vars present vs
`lib/env` expectations (names only, never values); function
duration/memory vs synchronous `assessPosture` runtime; `vercel.json` /
`next.config.ts` header parity between local prod-run and Vercel;
migration discipline (forward-only, in-order, applied-to-prod status);
rollback story (previous READY deployment + DB compatibility).

**7. Jobs & schedulers** — enumerate anything time-based: token/link expiry
(enforced at read-time or by a job?), consent-link expiry, session cleanup,
`pg_cron`/Edge Functions/Vercel crons (`ls supabase/functions/ 2>/dev/null`;
check vercel.json crons). If none exist: N/A, and verify nothing SILENTLY
DEPENDS on cleanup that never runs (e.g. unbounded token table growth —
calculate growth rate from seed data).

**8. Business logic** — engine: spot-verify 3 distortion computations against
their fixtures by hand-calculating one case each (show arithmetic); severity
zone boundaries (off-by-one at zone edges); muscle-link direction
(tight→stretch, weak→strengthen) sampled against `content/muscles/`;
screening-vocabulary gate coverage: which user-visible strings do NOT pass
through `screeningText`/`assertScreeningText`/lint? Workout timing math
(sets × hold/reps × rest = displayed total?).

**9. Code quality** — `npx tsc --noEmit` + lint clean; `any`-density in
`lib/` and `app/api/` (count them); dead exports (knip/ts-prune if quick);
error-swallowing (`catch` blocks that drop errors silently — grep and read
each); test coverage shape: which of the 22 API routes have zero direct
tests (list them); TODO/FIXME census with ages.

## Output — `docs/qa/AUDIT.md`

1. **Plain-language overview** (≤300 words, no jargon): what was audited,
   the 3-5 findings that matter most, overall confidence, what's blocked.
   Written so a non-engineer stakeholder can read it cold.
2. **Area-to-evidence table**: one row per checked claim —
   `Area | Claim | Verdict | Severity | Evidence (file:line / URL / calculation) | Recommendation`.
3. **Blocked list**: each blocked row with the exact unmet need.
4. Date-stamp and the commit SHA audited. Re-runs append a new dated section
   (or supersede rows with changed verdicts, marked "supersedes YYYY-MM-DD").

## Stop conditions

- STOP when all nine areas are done or BLOCKED and AUDIT.md is written.
- ASK before: changing any code, running anything against production or
  `*.supabase.co` (read-only Management-API reads of prod *config* — env var
  names, plan limits — are allowed; prod *data* reads are not), or spending
  money.
- Time-box WEAK hunts: 2 honest attempts to prove, then log WEAK with the
  missing evidence named.
