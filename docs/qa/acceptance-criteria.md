# Posture AI — QA Acceptance Criteria

**Risk basis:** Auth/consent/age/approval gates carry the highest risk (HIPAA, COPPA, non-diagnostic disclaimer).
Silent fetch-failure and missing ARIA roles are secondary priorities.

Access tier ladder (low → full):
| Tier | State | Expected behavior on protected routes |
|------|-------|---------------------------------------|
| T0 | Unauthenticated | Redirect to /auth/sign-in |
| T1 | Authed, no practitioner row | 403 (API) or error page |
| T2 | Practitioner, no disclaimer ack | Redirect to /onboarding |
| T3 | Covered-entity org, BAA not signed | 403 on data/capture routes |
| T4 | Full access | Normal render |

---

## / (root)

**Criterion:** All tiers are immediately redirected to the appropriate destination (sign-in for T0, dashboard for T2+).

Edge cases:
- Unauthenticated → must redirect to /auth/sign-in, not render a blank page.
- T2 with ack not set → must NOT land on dashboard; must redirect to /onboarding.
- No infinite redirect loop between / → /dashboard → /onboarding.

---

## /auth/sign-in

**Criterion:** A practitioner can sign in with email/password or Google OAuth, and is sent to /dashboard on success.

Edge cases:
- Wrong credentials → inline error renders with `role="alert"` so screen readers announce it.
- Google OAuth button disabled while email form is submitting (and vice versa).
- Unauthenticated only: signed-in users visiting this route should redirect to /dashboard.
- Network failure during sign-in → user-visible error, not silent hang.
- Loading state: button shows "Signing in..." and is `disabled` to prevent double-submit.

---

## /auth/sign-up

**Criterion:** A new user can create an account; on success shows confirmation to check email. On failure shows an error.

Edge cases:
- Invalid email → Supabase error message displayed (currently missing `role="alert"` — see BUG-001).
- Password shorter than enforced minimum → error shown before Supabase call.
- UI minimum is 8 characters (`minLength={8}`) but lib/auth/password.ts enforces 6; reset flow accepts 6-char passwords. Discrepancy must not confuse practitioners (see BUG-003).
- Supabase unavailable → error rendered, not silent.
- Success state: "Check your email" message appears; no further form shown.
- Already-registered email: Supabase typically returns success to prevent enumeration — confirm behavior matches expectation.

---

## /auth/forgot-password

**Criterion:** Submitting a valid email shows neutral "sent" confirmation regardless of whether the email is registered (email-enumeration protection — this is INTENTIONAL design, not a bug).

Edge cases:
- Invalid email format → client-side regex error shown with `role="alert"` before Supabase call.
- Throttled request → still shows neutral sent message (intentional; not an error to surface).
- Loading state: button disabled during request.

---

## /auth/update-password

**Criterion:** A practitioner arriving via a valid reset link can set a new password (min 6 chars via `validatePasswordReset`). On success → /dashboard. Expired/invalid link → shows message and link to request a new one.

Edge cases:
- No recovery session (link expired) → "invalid or expired" message + link to /auth/forgot-password; form NOT shown.
- Password and confirm mismatch → error shown before Supabase call.
- Password < 6 chars → error shown before Supabase call.
- Error div has `role="alert"` (confirmed present).
- Successful reset: router pushes /dashboard; practitioner does not land on /onboarding if ack was previously recorded.

---

## /onboarding

**Criterion:** A practitioner who has not acknowledged the non-diagnostic disclaimer is redirected here. Checking the box and clicking "I Acknowledge and Continue" records `non_diagnostic_ack_at` in `practitioners` and navigates to /dashboard.

Edge cases:
- Button disabled when checkbox unchecked (correct behavior per code).
- **If the Supabase update fails**, ack is NOT recorded but navigation still fires → practitioner loops back to /onboarding on next load (server gate catches it). No error message is shown. (See BUG-002.)
- T0 (unauthenticated) visiting /onboarding → redirect to /auth/sign-in.
- T1 (no practitioner row) visiting /onboarding → 403 or redirect.
- Practitioner with ack already recorded → must NOT be shown /onboarding again.

---

## /dashboard

**Criterion:** T4 practitioners see their active client count, assessments this week, and recent completed assessments. New Assessment button present.

Edge cases:
- T0 → redirect to /auth/sign-in (server component gate).
- T2 (no ack) → redirect to /onboarding.
- T3 (covered entity, no BAA) → may still render dashboard but data API routes return 403; practitioner sees only structural elements.
- Empty state: no assessments yet → renders "Run your first assessment" CTA.
- Server-side fetch failures for counts/assessments: page must not crash; at minimum, graceful degradation.

---

## /clients

**Criterion:** Active (non-archived) clients are listed, paginated if needed. "New Client" button present.

Edge cases:
- T0 → redirect.
- Empty state → "No clients yet" CTA.
- Archived clients must NOT appear in the list.
- RLS: practitioner sees only their own clients (`practitioner_id = auth.uid()`).
- Fetch failure → error shown with `role="alert"`, not silent empty list.

---

## /clients/new

**Criterion:** Practitioner can create a new client. The form requires: first name, last name, signer name (consent), and consent checkbox. Subject consent is recorded on submit via the `signer_name` / `signer_relationship` fields passed to the API.

Edge cases:
- Missing first name or last name → field errors shown with `role="alert"` inline (verified present in ClientForm).
- Missing signer name with checkbox unchecked → errors shown for both.
- COPPA / age gate: date_of_birth < 13 years old → server must reject or show COPPA block; under-13 is blocked.
- Under-13 client: must not be created without guardian consent (role = parent/legal_guardian).
- 13–17 client: guardian consent required.
- Invalid DOB → field error (uses browser validity API).
- API error → shown via `role="alert"` banner (ClientForm line 200, confirmed present).
- Negative height/weight → field errors.

---

## /clients/[id]

**Criterion:** Practitioner sees client profile, assessment history, progress charts (≥2 assessments), compare tab (≥2 assessments), and info tab. Archive button present. RemoteConsentButton shown if consent not yet recorded.

Edge cases:
- T0 → redirect to /auth/sign-in.
- Wrong practitioner_id (someone else's client) → redirect to /clients (RLS + explicit check).
- Assessments fetch fails → silently shows empty list with no error (BUG-004).
- Archive PATCH fails → no error shown, dialog may persist with no feedback (BUG-005).
- Progress / Compare tabs only appear when `assessments.length >= 2`.
- Compare tab with same assessment selected for both dropdowns: options are `disabled={a.id === compareTargetId}` (prevents same-same).
- Consent pending: RemoteConsentButton renders; "Send remote consent link" generates a 7-day single-use token.
- "Copied" button on RemoteConsentButton permanently stays "Copied" after first click (BUG-013).
- If clipboard write fails, "Copied" still shows (BUG-019).
- Network error during fetch: spinner clears but empty state shown with no error.

---

## /clients/[id]/edit

**Criterion:** Practitioner can edit non-consent fields (name, DOB, sex, height, weight, notes). Consent cannot be altered via edit. Saves via PATCH to API.

Edge cases:
- API error → surfaced via ClientForm `role="alert"` banner.
- Unit toggle (US/Metric) converts entered values correctly without data loss.
- Negative height/weight → field errors.
- Invalid DOB format → field error.

---

## /assessments/new (3-step wizard)

### Step 1: Client selection

**Criterion:** Practitioner selects a client from their active client list. Pre-selected via `?client_id=` query param. Client without consent_recorded_at shows COPPA/age gate controls.

Edge cases:
- Client list fetch fails → `loadingClients` clears but list is silently empty; practitioner sees "no clients" with no error (BUG-006).
- Preselected `client_id` not in list (archived, wrong practitioner) → client not selected, practitioner must choose manually.
- Client under 13 → age gate blocks progress with COPPA error.
- Client 13–17 → age gate requires guardian consent.
- `ageGateError` shown as user-visible message.

### Step 2: Upload / Camera capture

**Criterion:** Front and Side views required; Back optional. Upload via file or camera. Photo quality preflight runs (detectPose → assessFrameQuality). Cannot advance if front/side are missing or no-person-detected.

Edge cases:
- Camera permission denied → user-friendly error with message, fallback to file upload.
- Camera disconnected mid-session → "Camera disconnected" error in modal.
- Red tilt (>5°): capture blocked with banner; "Capture anyway" override available.
- Upload of non-JPEG/PNG → ignored by file input filter.
- Model load failure (`setModelError(true)`) → user-visible indicator.
- `no_person` detected → slot shows error badge; advance blocked.
- Test mode (`NEXT_PUBLIC_POSTURE_TEST_MODE=1` or `?testMode=1`) → skips model checks.

### Step 3: Processing / polling

**Criterion:** Assessment is submitted to API, status polled every 2s until `complete`. On complete, redirects to /assessments/[id].

Edge cases:
- Status poll returns `failed` → `processingError` shown to user.
- Network error during poll → retries silently (every 2s), no spinner freeze.
- Status endpoint returns non-ok → "Failed to check assessment status" error shown.

---

## /assessments/[id]

**Criterion:** Practitioner sees findings, grade, captures, exercise program, approve button, and PDF export buttons. Approval must precede PDF export.

Edge cases:
- `practitioner_approved = false` → PDF export buttons present but report API gate must enforce approval (not only UI).
- Prior-assessments fetch fails → silently empty compare dropdown (BUG-008).
- Exercises fetch fails → silently empty exercise program section (BUG-008).
- PDF generation fails → `pdfError` shown but missing `role="alert"` (BUG-007).
- Approve PATCH fails → `pdfError` shown with message, `approving` cleared.
- `persistOverrides` (capability/priority/swaps) fail silently → intentional by-design; note that PDF may not reflect last edits if server save failed (BUG-009, classified intentional).
- `unreliableFindings` zone: shown as a separate "unreliable" section, not in grade calculation.
- Level-verified badge: present if `assessment.level_verified` is set.
- Loading: spinner with CSS animation.
- Assessment not found (404) → error message + "Back to Clients" link.
- T0 → redirect to /auth/sign-in.
- T3 (covered entity, no BAA) → 403 from API; results not accessible.

---

## /exercises

**Criterion:** Authenticated practitioner sees full exercise library, filterable by category. Category filter buttons use `aria-pressed`.

Edge cases:
- T0 → redirect to /auth/sign-in.
- Fetch error → rendered as plain `<p>` with no `role="alert"` (BUG-017).
- Empty filter result → "No exercises found for category X" shown.
- Loading state: "Loading exercises..." shown before data arrives.

---

## /muscles

**Criterion:** Authenticated practitioner can browse the muscle knowledge base.

Edge cases:
- T0 → redirect to /auth/sign-in.
- Empty library → empty state rendered, not crash.
- Fetch error → surfaced (verify `role="alert"` present).

---

## /muscles/[slug]

**Criterion:** Authenticated practitioner sees detail for a single muscle including related imbalances.

Edge cases:
- Unknown slug → 404 / "not found" message.
- T0 → redirect.

---

## /settings

**Criterion:** Practitioner can update display name, practice name, logo, organization/BAA fields, and password.

Edge cases:
- Profile save fails → toast with `role="alert"` shown.
- Logo upload: accepts JPEG/PNG/WebP only; shown on PDF reports.
- **Current Password field is rendered but never sent to `supabase.auth.updateUser`** → misleads user into thinking old password is verified (BUG-011).
- New password submitted with no client-side length check → short password reaches Supabase, which returns an error (BUG-012).
- Organization fetch fails → `.catch(() => {})` swallows error, org fields render with empty/default values silently (BUG-018).
- Covered-entity + BAA not signed → warning banner shown in UI; practitioner cannot use data routes until BAA signed.
- BAA date field only appears when status = `signed`.
- Sign Out button uses `POST /api/auth/sign-out` (form action, not client-side fetch).

---

## /consent/[token] (public)

**Criterion:** Subject (or guardian) arrives via a single-use link minted by the practitioner. They see the consent text, select their relationship to the client, type their full legal name, and submit. On success → "Consent recorded" confirmation. No login required.

Edge cases:
- Expired token (>7 days) → API returns error; error shown with `role="alert"` (confirmed present in ConsentResponder).
- Already-used token → same as expired; single-use enforced server-side.
- Missing signer name on submit → client-side error shown ("Please type the signer's full name to sign."). `aria-required="true"` present but no HTML `required` (BUG-015).
- Network error on submit → "Network error — please try again." error with `role="alert"`.
- Guardian consent: `signer_relationship = parent | legal_guardian` accepted.
- Success: `status = 'done'` renders confirmation; no further form.

---

## /privacy and /terms

**Criterion:** Public pages accessible without authentication. Render correct content.

Edge cases:
- T0 → accessible (public).
- No auth check should block these pages.

---

## 404 (not-found.tsx)

**Criterion:** Unknown routes render a user-friendly not-found page with a link back to home/dashboard.

Edge cases:
- Not-found must not expose internal error detail.
- Should include a keyboard-navigable link back.

---

## Cross-cutting: API Gates

| Gate | When | Expected |
|------|------|----------|
| `practitionerGate` (lib/auth/requirePractitioner.ts) | All data API routes | 403 if no practitioner row or BAA not signed for covered entity |
| `captureEligibility` / COPPA | Assessment creation | Under-13 blocked; 13–17 requires guardian relationship |
| `practitioner_approved` | PDF export (`/api/reports`) | 403 if assessment not approved |
| Consent token | `/api/consent/respond` | 422/404 if token expired/used |
| Right-to-erasure DELETE | `/api/clients/[id]` DELETE | Cascades to assessments/findings; scoped to practitioner_id |
| RLS | All Supabase reads | `practitioner_id = auth.uid()` scopes all client/assessment data |

---

## Cross-cutting: Accessibility Baseline

- All error messages must have `role="alert"` (or `aria-live="assertive"`) so screen readers announce them.
- All interactive controls ≥44px touch target.
- `aria-pressed` on toggle buttons (category filters, unit toggle).
- `aria-label` on icon-only buttons.
- Keyboard navigation: all forms submittable via Enter; modals trappable.
- Focus management: after modal close (Archive confirm), focus returns to trigger.
