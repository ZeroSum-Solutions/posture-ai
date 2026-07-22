# Legal governance inventory

- Status: PR-05 engineering inventory
- Launch boundary: invite-only U.S. practitioner fitness/wellness beta
- Product scope key: `us_fitness_wellness_assessment_beta_v1`
- Jurisdiction: `US`
- Locale: `en-US`

This inventory describes implementation surfaces and data flows. It is not legal
advice and does not approve any wording. Counsel and product approval remain the
separate HG-02 launch gate. Until that gate passes, the production legal catalog
contains no active document and regulated actions fail closed.

## Deployment interlock

PR-05 must not be deployed to a live environment before HG-02 supplies and
verifies effective, counsel-approved production documents for all four governed
kinds. This is a deliberate hard interlock, not a feature flag: with an empty or
invalid production catalog, practitioner admission redirects to the unavailable
onboarding state and regulated APIs return `legal_unavailable`. A release check
must resolve and hash-validate all four production documents before promotion.

The HG-02/product receipt must also acknowledge the migration behavior for
existing data: a legacy practitioner acknowledgement requires acceptance of the
governed practitioner documents, and a legacy subject-consent event requires a
new governed consent before another capture. No legacy event is silently
relabeled as reviewed legal evidence.

The database migration has a one-way activation latch. It is initially inactive
so the expand migration can coexist with the prior release during deployment.
HG-02 may activate it only after the governed app, all four approved documents,
schema health, practitioner acceptance, subject consent, capture, report, and
workout/share smoke checks pass. Activation blocks every new
`legacy_unverified` regulated row while preserving ordinary lifecycle updates to
historical rows. After activation, rollback to any release older than PR-05 is
forbidden; incident response must use a PR-05-compatible forward fix or a later
known-good deployment.

## Governed documents and consumers

| Document kind | Required consumers | Acceptance evidence |
|---|---|---|
| Privacy | Public Privacy page; practitioner onboarding | Practitioner, exact document ID/version/hash/context/time |
| Terms | Public Terms page; practitioner onboarding | Practitioner, exact document ID/version/hash/context/time |
| Subject consent | Client creation; in-person consent; remote consent | Subject or authorized signer, exact document ID/version/hash/context/time |
| Screening notice | App footer; capture/results; practitioner and client PDFs; new workout/share snapshots | Artifact provenance; practitioner acknowledgement through onboarding |

Public pages and user flows must show the document version, effective date,
jurisdiction, product scope, and a visible non-production label for fixtures.
Drafts and scaffolds are never eligible. A fixture is eligible only in the
explicit local/CI test corridor and never when `VERCEL_ENV=production`.
HG-02 must also render the final approved screening notice through both PDF
variants and verify that its complete text remains legible without overlapping
report content; fixture brevity is not evidence that final counsel copy fits.

## Stored data and processors

| Category | Representative stores | Purpose | Processor/runtime | PR-05 disposition |
|---|---|---|---|---|
| Practitioner identity and admission | Auth users; practitioners; invitations; MFA recovery and access events | Invite-only account access and recovery | Supabase Auth/Postgres | Privacy/Terms scope; provider settings remain HG-01/HG-06 |
| Client identity and profile | clients | Identify the screened adult and record relevant profile fields | Supabase Postgres | Privacy disclosure input; lifecycle execution is PR-06 |
| Consent evidence | consent_tokens; consent_records; practitioner_legal_acceptances | Prove exact wording presented and accepted | Supabase Postgres | Version/hash/context provenance; legacy rows remain unverified |
| Capture measurements | captures; minimized pose frames; assessments; findings | Compute and retain posture-screening measurements | Browser MediaPipe; Supabase Postgres | Raw new-capture photos remain device-local; each assessment records the exact compatible consent document the subject signed |
| Reports and exports | reports; report object storage | Practitioner/client report generation and retrieval | App runtime; Supabase Storage | New artifacts store the governing screening-notice snapshot/version |
| Workout/share history | workout_sessions; share events; session runs and ratings | Optional reviewed follow-up tools and public token projection | App runtime; Supabase Postgres | New snapshots carry governing notice provenance; feature activation is PR-07 |
| Operational evidence | privacy-safe application logs; release/QA receipts | Reliability, incident, and release verification | Vercel/runtime; repository artifacts | No raw subject identifiers in application logs; provider retention is HG-07 |
| Source and deployment control | Git repository and CI/deploy metadata | Reviewed change, build, and promotion provenance | GitHub/Vercel | Counsel-approved catalog changes require reviewed source and HG-02 evidence |

MediaPipe model assets are self-hosted and pose inference runs in the browser.
This inventory does not claim that provider defaults, backups, or log retention
have been verified; those receipts belong to HG-07/HG-08.

## Promises and lifecycle ownership

| Promise or transition | Engineering owner | PR-05 behavior |
|---|---|---|
| Document publication/effective date | PR-05 + HG-02 | Versioned resolver; no approved production document until HG-02 |
| Material legal change | PR-05 + HG-02 | Explicit materiality metadata; prior acceptance becomes re-consent-required |
| Non-material legal change | PR-05 + HG-02 | Prior acceptance can remain valid only through the declared supersession rule |
| Consent grant | PR-05 | Exact presented version/hash/context stored atomically |
| Consent withdrawal | PR-06 | Existing revocation remains authoritative; user-facing withdrawal flow is not claimed complete here |
| Share mint/use/revoke/rotate | PR-06 | PR-05 adds copy provenance only; lifecycle controls remain PR-06 |
| Retention periods and scheduled purge | PR-06 + HG-02/HG-07 | No period is invented; mechanism and provider proof remain separate gates |
| Client erasure and external-object retry | PR-06 | Existing behavior is preserved; transactional outbox/retry remains PR-06 |
| Historical report/share compatibility | PR-16 | Legacy artifacts remain visibly unversioned and are never relabeled current |

## Fail-closed state transitions

```text
scaffold/draft -> never active
test fixture -> local/CI fixture mode only -> never production active
counsel-approved + effective -> eligible only for exact scope/jurisdiction/locale
retired -> historical pinned display only; never selected for a new acceptance

missing acceptance -> regulated action blocked
legacy/unverified acceptance -> re-consent required
current acceptance -> regulated action allowed
material supersession -> re-consent required
non-material supersession -> prior acceptance may remain current
revocation -> blocked regardless of version compatibility
```

Remote consent tokens bind an exact subject-consent document when minted. A
later deployment may not substitute new wording under the old token's version.
A material supersession invalidates the old token; a permitted non-material
supersession may still display and record the exact pinned older document.

## Legacy compatibility

The following fields and artifacts remain readable but cannot authorize a new
governed action by themselves:

- `practitioners.non_diagnostic_ack_at`;
- `clients.consent_recorded_at`;
- consent rows or tokens without legal document provenance;
- `AssessmentResult.disclaimer` from historical engine output;
- version-1 workout snapshots containing only a literal `disclaimer`;
- report rows and stored PDFs without legal-notice provenance.

No legacy row is backfilled or represented as counsel-approved merely because a
version label or wording appears to match.
