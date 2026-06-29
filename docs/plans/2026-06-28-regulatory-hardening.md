# Posture-AI — Regulatory Hardening (BIPA / COPPA / MHMD / FDA-lane)

**Date:** 2026-06-28 · **Branch:** `regulatory-hardening` · **Status:** in implementation

Design record + implementation plan for the regulatory hardening pass. Brainstormed
with a GPT (Codex) reasoning pass + a 6-agent codebase discovery sweep. The app was
already privacy-strong (on-device pose, no raw-image storage, no faceprint, a
content-layer vocab ban); this work converts "true by construction" into **enforced,
tested, logged invariants** and closes four real gaps: subject consent, age-gate,
intended-use guardrails, and data-subject rights.

## Product-owner decisions (locked)

1. **Minors:** block under-13 entirely; **13–17 require a recorded guardian consent**.
2. **Face data:** strip the **unused eye/mouth keypoints** (indices 1–6, 9–10) before
   persistence; keep nose/ears (0/7/8, used in scoring) → full reproducibility.
3. **Consumer:** **practitioner-only, enforced** server-side (honors the FDA NO-GO).
4. **Consent UX:** **both** in-person (on-device e-sign) **and** remote (link/QR).

## Hard constraints

- `packages/posture-engine` is **FROZEN** — never modify. `Zone = maintain|warning|danger|unreliable`
  originates there; all vocabulary changes happen at the display/report layer only.
- Never weaken a test; honor the e2e flake policy. New gates must be threaded through
  e2e legitimately (real consent + adult DOB), not bypassed.
- Subscription-only billing; no new heavy deps. Remote consent adds only `qrcode`.

## Architecture facts (from discovery)

- Auth: Supabase SSR (`lib/supabase/server.ts` / `client.ts`; service client exists).
  Every authed user is auto-enrolled as a practitioner (`handle_new_user()` trigger).
  No `middleware.ts`. API routes do `if (!user) 401` but no practitioner-membership check.
- Capture: `app/assessments/new/page.tsx` — Step 1 client-select (~815) → Step 2 capture
  (~878); gate at the "Next: Upload Views" button (~863). `selectedClient.date_of_birth`
  is available. Pose runs client-side in `lib/pose/detect.ts` (`getLandmarker` 34–58,
  `POSE_LANDMARK_NAMES` 11–21, `detectPose` 86–115). Persist path:
  `app/api/assessments/route.ts` `capturesToInsert` (84–92, `pose_frame` at 90),
  landmarks keyed by **string name**. Schema `lib/validation/frames.ts` (37–52) has **no**
  image fields. `captures.storage_path` is never set for assessments (reports use it).
- Reports/export: `app/api/reports/route.ts`; PDF render at `renderToBuffer` (~217);
  PDFs uploaded to `posture-reports` bucket (`${user.id}/${assessment_id}/...pdf`).
- Vocab: `content/muscles/types.ts` `BANNED_TERM_PATTERNS` (diagnos/treat/cure/patient/prescri),
  enforced via Zod `screeningText` on content + `content/content.test.ts`; the
  `imbalance-copy.ts` guard is dev-only (needs elevation to a test).
- No third-party trackers; CSP in `next.config.ts` already blocks external origins.
  Client delete today = soft archive (`archived_at`); FKs `ON DELETE CASCADE` from clients.

## Data model (one migration: `20260629000000_regulatory_hardening.sql`)

Lean, additive, idempotent. **No auto-mutating triggers** (deletion/consent are explicit
API paths so they're testable and can't fire during normal edits).

- Enums: `consent_method (e_signature|verbal|paper|remote_link)`,
  `signer_relationship (self|parent|legal_guardian|other)`,
  `consent_kind (enrollment|assessment_capture|data_sharing|revocation)`.
- `consent_records` (append-only): client_id, practitioner_id, assessment_id?, kind,
  consent_version, consent_hash, signer_name, signer_relationship, method, jurisdiction,
  signed_at, recorded_at, revoked_at?, notes. RLS: practitioner SELECT/INSERT own; **no
  UPDATE/DELETE policy** (immutable; revocation = new row). Remote inserts via service role.
- `consent_tokens` (remote flow): token (unique), client_id, practitioner_id,
  consent_version, expires_at, consumed_at?. Practitioner SELECT own; verify endpoint uses service role.
- `organizations` (minimal): name, is_covered_entity bool, baa_status (not_required|pending|signed),
  baa_signed_at?. `practitioners.organization_id` FK (nullable). No multi-tenant roles (YAGNI).
- `clients` += `deleted_at`, `deletion_reason`. `assessments` += `practitioner_approved` bool,
  `practitioner_approved_at`. `client_deletion_log` (redacted tombstone): original_client_id,
  practitioner_id, deleted_at, reason, assessments_purged, captures_purged.

## Workstreams → implementation waves

Each wave is implemented, verified (typecheck/lint/relevant tests), and committed before
the next. e2e is updated within the wave that changes a covered flow.

### Wave 1 — Schema + shared libs
- The migration above. `lib/auth/requirePractitioner.ts` (API guard: authed + practitioner
  row + org BAA gate). `lib/consent/policy.ts` (versioned consent text + `sha256` hash +
  `CONSENT_VERSION`). `lib/clients/age.ts` (age band: adult / minor_13_17 / under_13).
- Verify: `npx supabase db reset` clean; `npm run typecheck`.

### Wave 2 — Biometric guardrails (WS1)
- `lib/pose/detect.ts`: pose-model-only load guard (reject any model path containing
  "face"; log a per-run no-face assertion with model variant). `lib/pose/face-min.ts`
  (`FACE_MINIMIZE_NAMES` = eyes 1–6 + mouth 9–10; `stripFaceLandmarks(frame)`).
- `app/api/assessments/route.ts`: strip face landmarks before insert; never set storage_path.
- `lib/validation/frames.ts`: reject any image/dataURL/base64/blob field (defense-in-depth).
- Migration: `CHECK (storage_path IS NULL)` is **not** added to captures (reports reuse
  the column via the same table? no — captures has its own storage_path) — add the CHECK
  on `captures.storage_path` only. Verify: unit test for strip + reject; typecheck.

### Wave 3 — Practitioner-only enforcement (WS4a)
- `middleware.ts` (matcher excludes `/auth/*`, `/`, `/consent/*`, `/privacy`, `/terms`,
  `/api/health`, static): require authed practitioner; redirect else. `requirePractitioner()`
  in all mutating/data API routes. `/api/exercises` + `/muscles` gated to practitioners.
- Verify: `auth-access.spec` still green; add a spec asserting unauth → redirect on capture.

### Wave 4 — Subject consent + age gate (WS2 + WS3)
- In-person: `components/ConsentCapture.tsx` (consent text + canvas e-sign) used at client
  creation (`ClientForm`) and just-in-time before first capture. Records via
  `POST /api/consent` (writes `consent_records`, denormalizes `clients.consent_recorded_at`).
- Remote: `POST /api/consent/link` (token + QR data-url), public `app/consent/[token]/page.tsx`,
  `POST /api/consent/[token]` (service-role insert). `lib/consent/qr.ts` (uses `qrcode`).
- Age gate: capture flow blocks under-13; 13–17 requires a consent_record with
  `signer_relationship in (parent, legal_guardian)`. Server-side mirror in
  `POST /api/assessments` (re-check age + valid consent). `lib/clients/age.ts`.
- e2e: `helpers.createClient` also creates an adult `self` consent record so assessment
  specs stay green; new `consent-age.spec.ts` proves block-under-13, block-no-consent,
  allow-adult-with-consent.

### Wave 5 — Intended-use guardrails (WS4b vocab lint + WS4c professional-review)
- `scripts/lint-vocabulary.mjs`: scan user-facing strings (content/, lib/pdf/, app/
  copy) against `BANNED_TERM_PATTERNS` + an extended advisory set (abnormal/disease/
  disorder), allow-listing disclaimer constants + the approved screening vocabulary.
  Wire `lint:vocab` into `package.json` + CI. Elevate the imbalance-copy guard to a test.
- Professional-review: `assessments.practitioner_approved`; `PATCH /api/assessments/[id]/approve`;
  gate `POST /api/reports` (403 unless approved); "Review & Approve" UI on the assessment page.
- Verify: `lint:vocab` passes; reports e2e updated to approve before export.

### Wave 6 — Privacy surface + deletion + org-gate (WS5 + WS6)
- `app/privacy/page.tsx` + `app/terms/page.tsx` (public; consumer-health-data + biometric
  posture, retention/destruction schedule, deletion/access method, **no-trackers** + no-sale).
  Footer links in `app/layout.tsx`. *Legal copy is placeholder pending counsel — marked in-file.*
- `DELETE /api/clients/[id]`: purge `posture-reports` storage, delete assessments (cascade),
  redact client PII in place + set `deleted_at`, redact `consent_records.signer_name`, insert
  `client_deletion_log`. List/detail queries exclude `deleted_at`.
- Org-gate: `requirePractitioner` blocks capture when the practitioner's org
  `is_covered_entity AND baa_status <> 'signed'` (no-op for solo/null-org).
- Verify: deletion e2e (create → delete → gone + log); typecheck.

### Wave 7 — Phase-2 LIDAR guardrails (doc only)
- `docs/plans/phase2-lidar-privacy-constraints.md`: no face/depth mesh, minimize depth
  points, reuse the same consent + retention + no-face guard.

### Wave 8 — Full verification + land
- `npm run lint && npm run typecheck && npm run lint:vocab && npm run build`;
  `npx supabase db reset && CI=1 npm run test:e2e`; unit tests.
- Adversarial review workflow (security + correctness + "did we weaken a test?").
- Commit per wave; `zs-land` only if everything is green.

## Deferred — human/legal (owner action, not code)
FDA intended-use memo / pathway call (consumer NO-GO) · BAA execution per clinic ·
exercise-video licensing + likeness releases · counsel review of consent language + the
BIPA retention/destruction policy + MHMD posture · pose-data-as-biometric opinion ·
state biometric laws beyond IL · GDPR Art. 9 / DPIA if EU subjects.

## Acceptance (done-when, per workstream)
See the presented plan; each item's done-when is the verification gate for its wave. No
red CI is landed. Frozen engine untouched. No test weakened.
