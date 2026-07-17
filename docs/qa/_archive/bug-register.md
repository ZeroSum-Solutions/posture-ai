# Posture AI — Bug Register

> **Status (2026-06-29):** All 17 candidate defects + 2 found-in-review (BUG-018/019) + 2 found-at-runtime (BUG-020 `select-name`, BUG-021 `color-contrast`, BUG-022 `link-in-text-block`) are **RESOLVED** in QA Pass 1. The 3 INTENTIONAL items were left unchanged. See [pass-1-resolution.md](pass-1-resolution.md) for the fix log, regression tests, and verification.

Verified against code as of 2026-06-29. Each candidate from the prior static inventory
was checked against the actual current source before classification.

---

## Summary counts

| Severity | Count |
|----------|-------|
| Blocker | 0 |
| Major | 2 |
| Minor | 9 |
| Cosmetic | 1 |
| A11y | 5 |
| Intentional-by-design (not a bug) | 3 |
| **Total real defects** | **17** |

New bugs found during code review (beyond the 17 candidates): 2 (BUG-018, BUG-019).

---

## Root-cause clusters

### Cluster A: Silent fetch-error swallowing
BUG-004, BUG-005, BUG-006, BUG-008, BUG-018

### Cluster B: Missing `role="alert"` / `aria-live` on error elements
BUG-001, BUG-007, BUG-014, BUG-017

### Cluster C: Auth / compliance gate integrity
BUG-002, BUG-011

### Cluster D: Password length inconsistency
BUG-003, BUG-012

### Cluster E: UI state management
BUG-010, BUG-013, BUG-019

### Cluster F: `aria-required` without HTML `required`
BUG-015 (real defect), BUG-016 (intentional — see below)

---

## Top 5 highest-priority real bugs

1. **BUG-011** — Current Password field collected but never sent: security UX deception (Major)
2. **BUG-002** — Onboarding ack not confirmed before redirect: compliance integrity (Major)
3. **BUG-004** — Client detail assessments fetch silently empty: high-traffic flow (Minor)
4. **BUG-005** — Archive failure: no error, dialog hangs: destructive-action data loss UX (Minor)
5. **BUG-008** — Assessment results exercise + prior-assessment silent failure: core flow (Minor)

---

## Cluster A — Silent fetch-error swallowing

### BUG-004
- **Title:** Client detail: assessments fetch failure silently swallowed
- **Candidate:** B4
- **File:line:** `app/clients/[id]/page.tsx:89–100`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `if (res.ok) { … }` — `setLoading(false)` executes unconditionally but no error state is set when `!res.ok`. Additionally, if `fetch()` throws (network error), `setLoading(false)` is never reached, leaving the spinner permanently.
- **User-visible impact:** Assessment history, progress, and compare tabs silently empty; practitioner has no indication of a fetch failure.
- **Proposed evidence:** e2e repro — intercept `/api/clients/*/assessments` to return 500; assert error banner visible.

---

### BUG-005
- **Title:** Client detail: archive failure shows no error
- **Candidate:** B5
- **File:line:** `app/clients/[id]/page.tsx:105–115`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `if (res.ok) router.push('/clients')` — on `!res.ok`, `setArchiving(false)` fires but `showArchiveConfirm` is not reset and no error is displayed. If `fetch()` throws, `setArchiving` is never cleared, locking the dialog in "Archiving..." state.
- **User-visible impact:** Destructive-action confirmation dialog appears to do nothing on failure; practitioner may retry without understanding what happened.
- **Proposed evidence:** e2e repro — intercept PATCH to return 500; assert error message visible and dialog still interactive.

---

### BUG-006
- **Title:** Assessment wizard Step 1: client fetch failure not surfaced
- **Candidate:** B6
- **File:line:** `app/assessments/new/page.tsx:543–555`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `const { data } = await supabase.from('clients').select(…)` — the `error` return is destructured away. On failure `data = null`, `list = []`, `setLoadingClients(false)` fires, rendering an empty client list with no error.
- **User-visible impact:** Practitioner sees "no clients" with no error message; cannot start a new assessment.
- **Proposed evidence:** Unit test mocking Supabase to return `{ data: null, error: { message: 'network' } }`.

---

### BUG-008
- **Title:** Assessment results: exercises + prior-assessments fetch failures silently swallowed
- **Candidate:** B8
- **File:line:** `app/assessments/[id]/page.tsx:685–696`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** Both `if (priorRes.ok)` and `if (exRes.ok)` blocks omit an else branch; no error state is set for either failure.
- **User-visible impact:** (a) Compare dropdown silently empty — practitioner cannot select a prior assessment for PDF comparison. (b) Exercise recommendations section silently empty — the derived program has no exercises to show.
- **Proposed evidence:** e2e repro — intercept both endpoints to 500; assert that error banners render rather than silent empty sections.

---

### BUG-018 (new — found during code review)
- **Title:** Settings: organization fetch failure silently swallowed
- **Candidate:** N/A
- **File:line:** `app/settings/page.tsx:60–71`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `.catch(() => {})` on the org settings fetch swallows all errors; no toast or error state is set.
- **User-visible impact:** Organization name, covered-entity checkbox, and BAA status fields silently render empty/default. Practitioner editing compliance settings may unknowingly overwrite server state with empty defaults.
- **Proposed evidence:** Unit test mocking `/api/settings/organization` to reject; assert toast or inline error visible.

---

## Cluster B — Missing `role="alert"` / `aria-live`

### BUG-001
- **Title:** Sign-up error banner missing `role="alert"` / `aria-live`
- **Candidate:** B1
- **File:line:** `app/auth/sign-up/page.tsx:72–84`
- **Verdict:** REAL DEFECT
- **Severity:** A11y
- **Code:** The error `<div>` at line 73 has neither `role="alert"` nor `aria-live`. Compare: sign-in (same file pattern) correctly has `role="alert" aria-live="assertive"`.
- **User-visible impact:** Screen-reader users are not notified of sign-up errors without manually navigating to the element.
- **Proposed evidence:** Static (add `role="alert" aria-live="assertive"` to match sign-in pattern).

---

### BUG-007
- **Title:** Assessment results: PDF error not `role="alert"`
- **Candidate:** B7
- **File:line:** `app/assessments/[id]/page.tsx:936`
- **Verdict:** REAL DEFECT
- **Severity:** A11y
- **Code:** `{pdfError && <div style={{ color: '#EF4444' … }}>{pdfError}</div>}` — no `role="alert"` or `aria-live`.
- **User-visible impact:** Screen-reader users are not notified when PDF generation or approval fails.
- **Proposed evidence:** Static (add `role="alert"`).

---

### BUG-014
- **Title:** RemoteConsentButton: error `<span>` lacks `role="alert"`
- **Candidate:** B14
- **File:line:** `components/RemoteConsentButton.tsx:69`
- **Verdict:** REAL DEFECT
- **Severity:** A11y
- **Code:** `{error && <span style={{ … color: '#EF4444' }}>{error}</span>}` — no role or aria-live.
- **User-visible impact:** Screen-reader users not notified when consent link generation fails.
- **Proposed evidence:** Static (add `role="alert"`).

---

### BUG-017
- **Title:** Exercises page: error paragraph not `role="alert"`
- **Candidate:** B17
- **File:line:** `app/exercises/page.tsx:95`
- **Verdict:** REAL DEFECT
- **Severity:** A11y
- **Code:** `{error && <p style={{ color: '#EF4444' }}>Error loading exercises: {error}</p>}` — no `role="alert"`.
- **User-visible impact:** Screen-reader users not notified when exercise library fails to load.
- **Proposed evidence:** Static (add `role="alert"`).

---

## Cluster C — Auth / compliance gate integrity

### BUG-002
- **Title:** Onboarding: practitioner redirect fires even if disclaimer ack update fails
- **Candidate:** B2
- **File:line:** `app/onboarding/page.tsx:14–22`
- **Verdict:** REAL DEFECT
- **Severity:** Major
- **Code:**
  ```ts
  await supabase
    .from('practitioners')
    .update({ non_diagnostic_ack_at: new Date().toISOString() })
    .eq('id', user.id)
  // error return is not checked; redirect fires unconditionally:
  window.location.assign('/dashboard')
  ```
- **User-visible impact:** If the update fails (RLS denial, network error, Supabase outage), the server-side gate re-reads `non_diagnostic_ack_at = null` on the next request and redirects back to /onboarding — a silent redirect loop. No error message is ever shown. Also, the non-diagnostic disclaimer is a compliance requirement; unchecked failure leaves the gate in an unknown state.
- **Proposed evidence:** Unit test mocking Supabase update to return error; assert error message is shown and redirect does NOT fire.

---

### BUG-011
- **Title:** Settings: "Current Password" field collected but never sent to Supabase
- **Candidate:** B11
- **File:line:** `app/settings/page.tsx:158–177`
- **Verdict:** REAL DEFECT
- **Severity:** Major
- **Code:**
  ```ts
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  ```
  `currentPassword` state is bound to a field (line 437–445) but never passed to `updateUser`. Supabase `updateUser` does not verify the old password — it relies on session validity.
- **User-visible impact:** (1) The "Current Password" field misleads practitioners into thinking their identity is re-verified before a password change. (2) Any authenticated session can change the password without re-entering the current one. Remove or actually use the field; if UX requires re-verification, use `supabase.auth.signInWithPassword` to verify before `updateUser`.
- **Proposed evidence:** e2e repro — fill in a wrong current password + valid new password; assert that password IS changed (demonstrates the field has no effect).

---

## Cluster D — Password length inconsistency

### BUG-003
- **Title:** Password min-length mismatch: sign-up enforces 8 chars, update-password enforces 6 chars
- **Candidate:** B3
- **File:line:** `app/auth/sign-up/page.tsx:116` vs `lib/auth/password.ts:2`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** Sign-up input has `minLength={8}` and placeholder "At least 8 characters." `validatePasswordReset` uses `MIN_PASSWORD_LENGTH = 6`. Settings placeholder reads "min 6 characters."
- **User-visible impact:** A practitioner who resets to a 6- or 7-character password cannot re-create their account with the same password (browser prevents submission). Creates confusing mental model. The correct floor is Supabase's default (6 chars).
- **Proposed evidence:** Static — pick a single value and apply it consistently to sign-up `minLength`, `placeholder`, and `validatePasswordReset`.

---

### BUG-012
- **Title:** Settings: no client-side password length validation before Supabase call
- **Candidate:** B12
- **File:line:** `app/settings/page.tsx:459–476`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** Submit is disabled only when `!newPassword.trim()` (empty string). A 1-char password is enabled and sent to Supabase, which rejects it server-side. No minLength or inline JS check.
- **User-visible impact:** Unnecessary round-trip and confusing error message from Supabase rather than a clear client-side message. Minor UX friction.
- **Proposed evidence:** Unit test — submit with 3-char password; assert error shown before network call.

---

## Cluster E — UI state management

### BUG-010
- **Title:** Assessment results: approve button uses `cursor: 'wait'` (inconsistent with app pattern)
- **Candidate:** B10
- **File:line:** `app/assessments/[id]/page.tsx:973`
- **Verdict:** REAL DEFECT
- **Severity:** Cosmetic
- **Code:** `cursor: approving ? 'wait' : 'pointer'` — the rest of the app uses `cursor: 'not-allowed'` for disabled async states (settings save, client form, archive). The PDF buttons two lines below also use `cursor: 'wait'`.
- **User-visible impact:** Minor visual inconsistency; `wait` implies the browser is frozen rather than an async background task.
- **Proposed evidence:** Static (change to `not-allowed` or standardize `wait` across all async buttons).

---

### BUG-013
- **Title:** RemoteConsentButton: "Copied" state never resets
- **Candidate:** B13
- **File:line:** `components/RemoteConsentButton.tsx:46–49`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `onClick={() => { navigator.clipboard?.writeText(link.url); setCopied(true) }}` — `setCopied` is never reset to `false` via timeout.
- **User-visible impact:** After clicking "Copy link" once, the button permanently displays "Copied" for the session. Practitioners cannot tell if a subsequent click copied the link.
- **Proposed evidence:** Static + unit test — confirm button reverts to "Copy link" after ~2s.

---

### BUG-019 (new — found during code review)
- **Title:** RemoteConsentButton: clipboard.writeText() Promise rejection not handled
- **Candidate:** N/A
- **File:line:** `components/RemoteConsentButton.tsx:46`
- **Verdict:** REAL DEFECT
- **Severity:** Minor
- **Code:** `navigator.clipboard?.writeText(link.url)` returns a Promise that is not awaited and has no `.catch()`. If the clipboard API is unavailable or the user denies clipboard permission, the Promise rejects silently, but `setCopied(true)` has already fired.
- **User-visible impact:** Button shows "Copied" even though the link was NOT copied to clipboard. Practitioner may send the wrong link (or no link) to the subject.
- **Proposed evidence:** Unit test mocking `navigator.clipboard.writeText` to reject; assert "Copied" does NOT appear and an error is shown instead.

---

## Cluster F — `aria-required` without HTML `required`

### BUG-015
- **Title:** ConsentResponder: `signer_name` has `aria-required` but no HTML `required`
- **Candidate:** B15
- **File:line:** `components/ConsentResponder.tsx:84`
- **Verdict:** REAL DEFECT
- **Severity:** A11y
- **Code:** `aria-required="true"` is present but `required` is absent. The `<form>` does NOT have `noValidate`, so native browser validation would enforce `required` if set. JS validation at line 13 handles enforcement, but the missing `required` means native browser validation does not fire as a fallback.
- **User-visible impact:** AT/screen readers should still announce the field as required via `aria-required`; however, the browser's built-in required indicator (e.g., asterisk in some UA implementations) and native validation tooltip are absent.
- **Proposed evidence:** Static (add `required` to match `aria-required`).

---

### BUG-016 (intentional — not a defect)
- **Title:** ClientForm: `first_name`/`last_name` `aria-required` without HTML `required`
- **Candidate:** B16
- **File:line:** `app/clients/ClientForm.tsx:222, 237`
- **Verdict:** INTENTIONAL-BY-DESIGN
- **Reasoning:** The form uses `noValidate` (line 197), which explicitly disables native browser validation for all fields. The pattern `noValidate` + `aria-required` + JS validation (lines 114–118) is standard for custom-validation UIs that use inline field errors. Removing `required` prevents the native browser validation UI from conflicting with the custom error display. This is correct behavior.
- **Action:** No fix needed.

---

## Intentional-by-design (not defects)

### BUG-009 — persistOverrides failure silent
- **Candidate:** B9
- **File:line:** `app/assessments/[id]/page.tsx:721–732`
- **Verdict:** INTENTIONAL-BY-DESIGN
- **Reasoning:** The code comment explicitly states the rationale: "Non-blocking: the UI already reflects the change; a failed save retries on next edit." Coach overrides (capability, priority_keys, exercise_swaps) are optimistic — the UI state is immediately correct; the server merely persists it. A silent failure here means the PDF may not reflect the last edit if the server was unavailable, but the next edit will re-persist correctly.
- **Residual risk:** If the server remains unreachable during the session, the final PDF uses stale override data. This is an acceptable documented trade-off.
- **Action:** No fix needed. Consider adding a low-priority background retry or a non-intrusive indicator if the team wants to harden this.

---

### Forgot-password "always shows sent" (not in candidate list)
- **Verdict:** INTENTIONAL-BY-DESIGN
- **File:line:** `app/auth/forgot-password/page.tsx:38–41`
- **Reasoning:** Supabase call result is ignored and `setSent(true)` fires unconditionally. This is email-enumeration protection: the form cannot reveal whether an email is registered. Confirmed by inline comment.
- **Action:** No fix needed.

---

### BUG-016 (see above)
- Already classified as intentional.
