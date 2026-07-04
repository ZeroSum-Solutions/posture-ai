# QA Inventory — posture-ai

Master checklist for `/qa-loop`. One row per user-facing item. Generated from
the real route tree at commit `c466787` (2026-07-04) — diff against
`find app -name page.tsx -o -name route.ts` at the start of every pass.

**Roles:** P = practitioner (authed) · CT = consent-token client · ST = share-token client · A = anonymous
**Status:** blank = untested · PASS · FAIL(QA-NNN) · BLOCKED(reason) · RETIRED
**Edge cases are finite and risk-ranked — max 5/row.** `(expand)` = criteria need refinement in Phase 1 before testing that row.

## Auth & account

| ID | Item | Roles | Acceptance criteria | Edge cases (risk-ranked) | Pass 1 |
|---|---|---|---|---|---|
| AUTH-01 | `/auth/sign-up` | A | Valid email+password creates account, lands in onboarding; errors shown inline, input preserved | duplicate email; weak password message; double-submit creates one account | |
| AUTH-02 | `/auth/sign-in` | A | Valid creds → dashboard; invalid → inline error, no user enumeration in message | wrong password 5× (rate-limit UX); `?next=` open-redirect attempt (must stay same-origin, `lib/auth/safe-next`) | |
| AUTH-03 | `/auth/forgot-password` + `/auth/update-password` | A | Reset email flow completes; new password works; old session invalidated | expired reset link; reuse of consumed link | |
| AUTH-04 | Sign-out (`/api/auth/sign-out`) | P | Session ends; protected routes redirect to sign-in; back-button shows no cached PHI-adjacent data | sign-out in one tab, action in second tab | |
| AUTH-05 | Route protection (middleware) | A | EVERY P-only page/API 307s or 401s cleanly for anonymous — never 500, never data leak | direct API hits with no cookie; stale/garbage JWT | |
| AUTH-06 | `/onboarding` | P | Disclaimer ack required before app use; persists; not re-shown after | skip attempt via direct URL to /dashboard pre-ack | |

## Clients

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| CLI-01 | `/clients` list | P | Lists own clients only; search works; empty state on fresh account | heavy account (150 clients): loads <3s, pagination/scroll correct | |
| CLI-02 | `/clients/new` | P | Create with validation (DOB, email format); appears in list | minor (<18) DOB flags consent requirement; duplicate name allowed but disambiguated | |
| CLI-03 | `/clients/[id]` detail | P | Shows client, assessment history, consent status | other practitioner's client id → 404 not 403-leak; deleted client → tombstone behavior | |
| CLI-04 | `/clients/[id]/edit` | P | Edits persist; cancel discards | concurrent edit (two tabs) last-write behavior stated | |
| CLI-05 | Client deletion | P | Deletion flow completes; `client_deletion_log` written; data unreachable after | deleted client's share tokens/reports return uniform 404 (deletion.spec parity); undo not offered | |

## Consent (BIPA-adjacent — highest risk area)

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| CON-01 | Record consent in-person (`/api/consent`) | P | Consent recorded with type+timestamp; reflected on client page and capture gate | re-consent after decline; consent for minor by guardian | |
| CON-02 | Consent link mint (`/api/consent/link`) | P | Link generated, expiring; copyable | expired link visit; revoked-before-visit | |
| CON-03 | `/consent/[token]` client page | CT, A | Client can grant/decline; screening-safe copy; confirmation shown | reuse after respond (idempotent, no flip); garbage token → uniform 404; expired → clear message not 500 | |
| CON-04 | Capture gate on consent | P | Step 1→2 blocked without consent (age+consent both checked, PR #51); link offered | consent granted mid-wizard in second tab → gate re-checks | |

## Assessment wizard & capture

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| WIZ-01 | `/assessments/new` step flow | P | Client select → capture → review → submit; Back preserves state (wizard-nav.spec parity) | abandon at step 2 creates no assessment; refresh mid-wizard | |
| WIZ-02 | Capture (fixture path, `?testMode=1` run only) | P | Front+side capture with countdown, preview, retake; per-photo quality preflight messages | no-person-detected retake message; legs-not-visible warning + override | |
| WIZ-03 | Tilt/level gates | P | >5° tilt blocks with live feedback; override allowed and recorded | mid-burst tilt aborts partial frames (PR #51) | |
| CAM-REAL | Real camera on physical iPhone Safari + Android Chrome | P | getUserMedia flow completes on real devices; model download progress shown; no tab crash | low-power mode; camera-in-use by another app; permission denied then re-granted | BLOCKED(manual device pass — never fake to PASS) |
| WIZ-04 | Submit → scoring (`POST /api/assessments`) | P | Synchronous scoring returns complete; invalid frames JSON rejected by zod with 4xx | oversized payload; double-submit → one assessment; network drop mid-submit UX | |

## Results & knowledge base

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| RES-01 | `/assessments/[id]` results | P | 10 distortions with severity zones + grade; unreliable metrics explained with re-shoot guidance | unreliable-landmark assessment renders without crash; other-practitioner id → 404 | |
| RES-02 | 3D muscle map + aggregate summary | P | Implicated muscles highlighted; links to muscle pages (muscle-3d.spec parity) | WebGL unavailable → fallback, not blank | |
| RES-03 | Accuracy & methodology card | P | Stability/uncertainty/limitations shown; screening vocabulary | (expand) | |
| RES-04 | Priority program + exercise detail sheet | P | RampTable exercise names open detail sheet: instructions, sets/hold, muscles, media-or-fallback | exercise with no media → clean fallback (never broken img); slow query → loading state (PR #54 single-select) | |
| KB-01 | `/muscles` + `/muscles/[slug]` | P | Library lists regions, search works (muscle-kb.spec parity); detail shows anatomy/function/why | unreviewed muscle shows Pending-review badge in dev/preview only | |
| KB-02 | `/exercises` library | P | 73 exercises listed with thumbnails-or-fallback; filterable | (expand) | |

## Reports & progress

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| REP-01 | Report generation (`/api/reports`) | P | Practitioner + client PDFs generate; branded; screening vocabulary throughout | export blocked until approval (report-approval.spec parity) | |
| REP-02 | Comparison report | P | Two assessments same client compare correctly | two DIFFERENT clients must be impossible (PHI boundary, spec parity); pre/post with unreliable metrics | |
| PRG-01 | Progress view across assessments | P | 6-month seeded history renders trend correctly; deltas match hand-checked numbers | single-assessment client (no trend); 150-client account load time | |

## Workouts & player

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| WKT-01 | Mint session (`POST /api/workouts`) | P | Approval-gated launch CTA mints frozen snapshot (workout-mint.spec parity) | unapproved assessment cannot mint (server-enforced, not just UI) | |
| WKT-02 | `/workouts/[sessionId]` player | P | Hold countdown ring, reps tap-next, rest, summary; voice cues speak alignment cue set 1 / avoid cue set 2+; captions match; wake-lock held | skip fast through items (preload abort, PR #57); SpeechSynthesis unavailable → silent but functional; leave mid-run and resume | |
| WKT-03 | Demo canvas three-tier fallback | P | video → poster → gradient, per-slug re-arm; never a broken video element | dead media URL at each tier; slow network first paint | |
| WKT-04 | Up-next steps + form cues | P | Steps render on up-next; cues match authored content (coverage-gate test parity) | exercise with 8 steps fits mobile viewport | |
| WKT-05 | Run persistence (`PATCH /api/workouts/[id]/run`) | P | Idempotent; resume restores position | replayed PATCH doesn't double-advance; run on other practitioner's session → 404 | |
| WKT-06 | Rate (`POST /api/workouts/[id]/rate`) | P | Rating + notes saved; notes screening-linted | banned term in notes → rejected with message | |
| SHR-01 | Share link mint + `/s/[token]` | P, ST, A | Share mints expiring link, raw token shown once with copy; client page is redacted projection (no internal ids) | expired token → uniform 404; revoked → uniform 404; token enumeration (2 garbage tokens) → uniform 404, rate-limited; approved-then-deleted assessment → tombstone 404 | |
| SHR-02 | Token rate (`/api/workouts/token/[token]/rate`) | ST | Client can rate via token; same lint rules | rate after token expiry mid-session | |

## Settings, misc, cross-cutting

| ID | Item | Roles | Acceptance criteria | Edge cases | Pass 1 |
|---|---|---|---|---|---|
| SET-01 | `/settings` + organization settings | P | Profile + org branding save; branding appears on PDFs | empty org name on PDF; oversized logo upload | |
| MSC-01 | `/`, `/privacy`, `/terms` | A | Root redirects to sign-in (or dashboard when authed); legal pages render | (expand) | |
| MSC-02 | `/dashboard` | P | Correct counts vs seeded data (calculate expected numbers); recent activity accurate | fresh empty account state | |
| XC-01 | a11y sweep | all | axe (a11y.spec) has no critical violations on: sign-in, dashboard, wizard, results, player | player contrast during video playback | |
| XC-02 | Error states | all | Killed API mid-flow → user-facing message, no raw error text leaks (error-states.spec parity) | /api/health DB-down body leaks nothing (PR #50 hardening) | |
| XC-03 | Screening vocabulary sweep | all | No banned terms visible anywhere in the seeded UI walk | generated content paths (cues, captions, PDFs) | |
| XC-04 | Mobile viewport integrity | all | Every P-page usable at 390×844; touch targets ≥44px on primary actions | player controls reachable one-thumb | |

## Retired

(none yet)
