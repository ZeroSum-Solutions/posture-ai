# QA Bug Log — posture-ai

Append-only. One entry per bug found by `/qa-loop`. Never renumber; never
delete — mark `fixed (PR #N)` / `wontfix (reason, ack)` instead.

Severity: **S1** data-loss / security / crash · **S2** feature broken ·
**S3** degraded but usable · **S4** cosmetic / copy.

Template:

```
## QA-NNN — <one-line title>
severity: S? · status: open · found: PASS-NN · item: <INVENTORY id>
repro (from fresh seed):
  1. …
expected: …
actual: …
evidence: docs/qa/evidence/QA-NNN-*.png · console: … · network: <route status+body>
```

---

## QA-001 — Erased (tombstoned) clients still appear in the clients list and dashboard count
severity: S3 · status: FIXED (branch fix/qa-001-erased-client-read-paths) · found: PASS-01 · item: CLI-01, CLI-05, MSC-02
FIX: added `.is('deleted_at', null)` to the client-list query (app/clients/page.tsx:31), the
dashboard Total-Clients count (app/dashboard/page.tsx:29), and the new-assessment client
picker (app/assessments/new/page.tsx:66); converted the dashboard Recent-Activity query to
`clients!inner(... , deleted_at)` + `.is('clients.deleted_at', null)` so a tombstoned client's
assessment can't surface. Regression test e2e/clients.spec.ts "erased client is hidden from the
clients list" (asserts by id-bearing row href, which survives PII redaction). Verified in the
rebuilt prod bundle: /clients 28 rows (no Beth/Carl), dashboard 28, recent activity clean,
wizard picker 28 — all four read paths. typecheck + 8 clients/deletion e2e green.
root cause: inconsistent soft-delete filtering across client read paths. The clients
list server query (`app/clients/page.tsx:30`) and the dashboard "Total Clients" count
(`app/dashboard/page.tsx:~26`) filter only `.is('archived_at', null)` and OMIT
`.is('deleted_at', null)`. The API route `app/api/clients/route.ts:20-21` correctly
filters BOTH. So an erased client (deleted_at set, the GDPR/BIPA tombstone) remains
listed and counted, contradicting the deletion contract and disagreeing with the API.
repro (from fresh seed, `qa+prac-typical@example.test` / `TestPass1234!`):
  1. Sign in as prac-typical → /dashboard shows "Total Clients 30".
  2. DB truth: 28 active (deleted_at IS NULL) + 2 tombstoned (deleted_at set): Beth Smith, Carl Smith.
  3. Go to /clients — 30 rows render, including "Beth Smith DOB 12/12/1975" and "Carl Smith DOB 9/13/1982" (both tombstoned), each linking to a detail page.
expected: erased clients excluded everywhere — list and dashboard count = 28, matching the API route and the clients list's own `deleted_at`-aware siblings.
actual: list shows 30 (incl. 2 erased); dashboard counts 30. Ghost rows + inflated count + list/dashboard/API disagreement.
evidence: docs/qa/evidence/QA-001-clients-list-tombstoned.png (Beth & Carl visible) · DB: `select count(*) filter (where deleted_at is null)`=28 vs `archived_at is null`=30 · code: clients/page.tsx:30, dashboard/page.tsx count query, api/clients/route.ts:20-21
note: seed tombstones are not PII-redacted, so full names show here; production erasure redacts PII, so prod would show redacted ghost rows — still wrong. Clusters with AUDIT.md Area 4 WEAK (clients/[id]/assessments omits deleted_at). Fix = add `.is('deleted_at', null)` to the read paths (one root-cause branch).
ADDITIONAL read-path leaks found this pass (same root cause, same branch):
  - Dashboard "Recent Activity" lists a tombstoned client's assessment (Carl Smith shown on /dashboard) — assessment/recent-activity query joins clients without `deleted_at` filter.
  - Assessment wizard client picker (`/assessments/new` step 1) lists tombstoned Beth Smith + Carl Smith as selectable — client-select query omits `deleted_at`. (Submit would still be blocked by the `assessments_reject_deleted_client` trigger, so it's a UX/consistency leak, not a data-integrity hole.)
Full fix scope = add `.is('deleted_at', null)` to: clients list (page.tsx:30), dashboard count (dashboard/page.tsx), dashboard recent-activity query, and the wizard client-select query. Audit whether `clients/[id]/assessments` (AUDIT Area 4) needs it too. One branch, one regression test per read path.

## QA-002 — Muscle Guide + all muscle detail pages + results muscle links dead-end in production build
severity: S3 · status: open · found: PASS-01 · item: KB-01, RES-02
root cause: the reviewed-content gate hides 100% of muscle content in prod because
0 of 29 seeded muscles have `reviewed_at` set. `app/muscles/page.tsx:8` +
`app/muscles/[slug]/page.tsx:6` compute `SHOW_UNREVIEWED = NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT==='1' || NODE_ENV!=='production'`.
In a `next start` (NODE_ENV=production) build the list query filters `.not('reviewed_at','is',null)`
(page.tsx:22) and the detail page calls `notFound()` when `!reviewed_at` (\[slug\]/page.tsx:49).
With 0 reviewed rows: `/muscles` renders an empty library ("No muscles match \"\""),
every `/muscles/[slug]` 404s, and the results page muscle chips
(`app/assessments/[id]/MuscleBodyMap.tsx:164` → `<Link href={`/muscles/${slug}`}>`) all
dead-end at 404. The gate itself is intentional (clinical review before go-live), but the
app degrades ungracefully: a blank guide with a "No muscles match" false-empty message and
live links to 404s, rather than an empty-state explanation + suppressed dead links.
repro (from fresh seed, prod build on :3100, `qa+prac-typical`):
  1. Visit /muscles → "Muscle Guide" header + disclaimer, then "No muscles match \"\"." — zero entries, empty search box.
  2. Visit any /muscles/[slug] (e.g. /muscles/upper-trapezius) → 404 not-found.
  3. Open a results page with implicated muscles → tight/weak muscle chips are clickable Links that 404.
  4. DB truth: `select count(*), count(*) filter (where reviewed_at is not null) from muscles` = 29 total / 0 reviewed.
expected: either (a) muscle content is clinically reviewed before launch (content/governance — set reviewed_at), OR (b) the app degrades gracefully when no reviewed content exists: a real empty-state ("Muscle guides are being finalized") instead of a search "no match" message, and results-page muscle chips render as plain text (not 404 links) when the target isn't reviewable.
actual: empty guide with misleading "No muscles match" copy; 29 dead detail routes; live 404 links from the core results flow.
evidence: docs/qa/evidence/QA-002-muscles-empty-prod.png · code: app/muscles/page.tsx:8,22, app/muscles/[slug]/page.tsx:6,49, app/assessments/[id]/MuscleBodyMap.tsx:164 · DB: muscles 29/0 reviewed
note: this is a launch-readiness + graceful-degradation issue, not a crash. Two-part fix — content review is a product decision (out of code scope); the code-side fix (graceful empty-state + suppress dead muscle links when target unreviewed) is one root-cause branch. Verified library FUNCTIONALITY separately by temporarily marking muscles reviewed on local DB (renders/searches/links correctly), so the components themselves are sound.

## QA-003 — Results-page program comboboxes lack id/name (a11y)
severity: S4 · status: open · found: PASS-01 · item: XC-01, RES-04
root cause: the assessment results page renders ~13 `<select>` controls (per-focus
CLIENT CAPABILITY + per-exercise SWAP dropdowns) without an `id` or `name` attribute.
Chrome DevTools Issues reports "A form field element should have an id or name attribute
(count: 13)". Screen-reader users get a usable accessible name from surrounding text, but
the missing id/name is a real a11y/autofill hygiene gap and the only console signal on an
otherwise-clean results page.
repro: open any /assessments/[id] results page → DevTools Issues → 1 issue, count 13.
expected: each select has an id and/or name (e.g. `swap-${slug}`, `capability-${focusKey}`).
actual: 13 anonymous form fields; DevTools issue emitted.
evidence: console issue msgid on assessment 97221b37 results page · likely in the RampTable / program-render component (SWAP + capability selects).
note: cosmetic/hygiene — bundle with QA-002 muscle-guide graceful-degradation branch OR its own tiny a11y branch. Add id/name to the select elements + a regression test asserting the results page emits zero DevTools form-field issues.
