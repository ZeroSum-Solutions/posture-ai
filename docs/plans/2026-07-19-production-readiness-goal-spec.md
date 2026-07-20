---
title: Production-readiness autonomous goal specification
date: 2026-07-19
status: proposed
owner: Zero Sum Solutions
audited_commit: 0d3f84bdd6d7edbe8784b3ff73cf9704292bb33d
launch_target: Invite-only U.S. practitioner beta, responsive web
council: Codex; Anthropic Fable 5 medium; Kimi K3 biomechanical review
source_audit: docs/qa/AUDIT.md#production-readiness-re-audit--2026-07-19
---

# Production-readiness autonomous goal specification

## 1. Goal

Move Posture AI from its current tested-development state to a release candidate that is safe to consider for an invite-only U.S. practitioner beta. Execute one ordered item at a time. Every item begins with an evidence audit, iterates until its pass contract is met, receives an independent review, records durable proof, and only then unlocks its dependents.

This file is designed to be the input to `/goal`. It is an execution contract, not a statement that launch is already authorized.

## 2. Working launch boundary

Unless the owner changes it in PR-00, use this narrow boundary:

- responsive web application only;
- invited U.S. practitioners and their consented adult clients;
- screening, posture tracking, report review, and explicitly enabled follow-up tools;
- no diagnosis, treatment claim, population norm, percentile, or clinical-validity claim;
- no billing, public consumer signup, native Expo release, or international rollout;
- non-HIPAA fitness/wellness beta cohort;
- lite pose model remains the scoring default unless a later evidence gate supports changing it.

### Non-goals

- Shipping the current native app.
- Launching payments or subscriptions.
- Training or recalibrating the engine to imitate the Moti legacy archive.
- Representing engineering proxies as anatomical ASIS, diagnostic, causal, population-ranked, or clinically validated measurements.
- Turning `consumerEligible` on merely to make the roadmap pass.
- Completing a public, paid, enterprise, or covered-entity launch under this specification.

## 3. Recorded owner decisions

The launch-boundary answers are recorded in `docs/plans/2026-07-19-production-readiness-decisions.md`. PR-00 initializes and consumes that decision record. These decisions constrain implementation but do not authorize launch.

| Decision | Recorded boundary | Consequence |
|---|---|---|
| First milestone | **Invite-only practitioner beta — confirmed** | Public signup, billing, and public/paid launch stay excluded. |
| HIPAA boundary | **Non-HIPAA fitness/wellness cohort — confirmed** | Any future covered-entity admission reopens scope and makes BAAs, admin-controlled organization status, enforced MFA, PITR/backup settings, access audit, and operating controls hard launch blockers. |
| Clinical reviewer | **Licensed clinician available — confirmed** | HG-03 still requires an itemized signed review ledger. Until it passes, assessment-only/server-disabled recommendations remain the safe default. |
| Production promotion | **Manual owner approval after HG-09 — retained safety boundary** | Autonomous execution may prepare a release candidate but may not deploy or migrate production. HG-10 remains a separate explicit approval at launch time. |

## 4. Two completion gates

### 4.1 Autonomous build complete

`/goal` may report **autonomous build complete** only when:

- every engineering task has `status:"completed"` with its proof artifact and independent review;
- every human/provider task has either `status:"completed"` with evidence or `status:"frozen"` with owner, dependency, and exact acceptance criteria;
- after PR-17 is evidenced and persisted completed, the plan-specific validator reports `autonomous_build_complete=true`; the bundled `check-complete.py` may pass as a supplemental syntax/existence check;
- the worktree, commits, CI, audit ledger, and rollback notes reconcile.

This state means the autonomous work loop is exhausted. It does **not** mean production-ready or launch-authorized if a required launch gate is frozen.

### 4.2 Launch authorized

The system may be described as **eligible for beta launch** only when:

- every applicable S1 and S2 item has `status:"completed"` and a passing/proven-not-applicable outcome;
- no launch-critical legal, clinical, device, provider, recovery, or privacy gate is frozen;
- HG-09 passes the fresh intended-beta configuration rehearsal;
- the final council finds no unresolved blocker;
- the owner explicitly approves the controlled production promotion.

PR-00 must add `scripts/check-production-readiness-goal.mjs` with `--build` and `--launch` modes. It validates task kind, dependencies, attempts, applicability, outcome, proof manifests, command/exit-code receipts, independent-review verdicts, rollback notes, required human/provider receipts, CI/rehearsal evidence, release-configuration hash, and the allowed diff/clean-tree state. `--build` emits `autonomous_build_complete`; it runs only after PR-17 is persisted completed. `--launch` emits `launch_authorized` and fails unless the current manifest shows zero applicable open/frozen S1 or S2 rows, all required human/provider receipts, no unresolved council `NO-GO`, all flaky-test dispositions, current CI, a fresh intended-beta configuration rehearsal, matching configuration hash, and explicit owner approval. Section 4.2 requires `--launch` exit code `0`. The bundled goal checker's `GATE: DONE` output alone is never evidence of launch readiness because it accepts frozen tasks and only checks that proof text files are nonempty.

No automation may translate “frozen,” “waived for build,” or “awaiting human” into “production ready.”

## 5. Durable goal state

On goal initialization, use slug `posture-ai-production-readiness` and create the operational state at `~/.claude/goal-state/posture-ai-production-readiness/state.json`, which is the location read by the installed goal tooling. Keep durable product/audit outputs in the repository. Create:

- state file containing task status, attempts, dependencies, evidence paths, commit, and last decision;
- mandatory flat `proof/PR-XX.PASS.txt` and `proof/HG-XX.PASS.txt` manifests beside the goal state for the bundled checker, plus optional detailed artifacts under `proof/PR-XX/` or `proof/HG-XX/`; each flat manifest links every acceptance criterion to exact command/receipt/review/rollback evidence;
- `docs/qa/AUDIT.md` updates for findings opened or closed;
- `docs/qa/BUGLOG.md` and `docs/qa/INVENTORY.md` reconciliation when affected;
- a final completion report distinguishing autonomous completion from launch authorization.

Persist state using the goal tool's supported task status values. Execution phase and acceptance outcome are separate fields:

- `status`: `pending`, `in_progress`, `completed`, or `frozen`;
- `phase`: `auditing`, `implementing`, `verifying`, or `independent_review` while in progress;
- `outcome` on completed tasks: `passed` or `not_applicable`;
- `attempts`, `applicability_reason`, `proof_manifest`, `review_verdict`, and `last_decision`.

Every task has the stable criterion ID `PR-XX.PASS` or `HG-XX.PASS` and a `kind` of `engineering`, `human`, or `provider`. Its proof manifest maps every acceptance bullet to a task-specific artifact and records hashes or commit references where appropriate. A `not_applicable` outcome requires a proven scope reason and reviewer approval. Only `status:"completed"` with `outcome:"passed"` or reviewer-approved `outcome:"not_applicable"` unlocks engineering dependents. Human/provider gates never block independent engineering work; they are additional dependencies of launch authorization. Retry/replan/block state belongs in the phase/decision fields; a stopped blocked task is persisted as frozen with its exact blocker. A frozen launch gate never unlocks HG-09/HG-10 or `--launch` authorization.

## 6. Mandatory per-item loop

For every task below, `/goal` must execute this exact loop:

1. **Route and read.** Read the goal state, this spec, the source audit, applicable `AGENTS.md`, and only the task-relevant files. Use CodeGraph first when locating code.
2. **Pre-audit.** Reproduce the finding against current `HEAD`; record file/line or runtime evidence. If the finding is already fixed, prove it and continue directly to verification rather than recreating work.
3. **Plan the smallest slice.** State scope, dependencies, risk, excluded surfaces, rollback, and expected proof. Do not mix unrelated cleanup.
4. **Create a failing check.** Add or identify a test, static assertion, or user-level reproduction that fails for the reason being fixed. Human/provider tasks use a signed checklist as their failing gate.
5. **Implement.** Make the smallest coherent change. Preserve stored-data compatibility and unrelated user work.
6. **Verify locally.** Run task-specific checks plus the proportional global gate. Save exact commands and outputs to the proof artifact.
7. **Adversarial review.** A reviewer independent of the implementation evaluates the actual diff and proof. Kimi K3 is preferred for biomechanics/reliability/clinical-claim questions; Fable 5 medium for product, privacy, security, operations, and copy; Codex resolves conflicts against repository evidence. No named model may be silently substituted.
8. **User-level QA.** Exercise the affected path in a production build or controlled environment. Physical-device tasks require the named hardware evidence; a desktop emulation is not equivalent.
9. **Decide.** Persist `status:"completed", outcome:"passed"` only when every acceptance criterion is evidenced. A proven exclusion uses `status:"completed", outcome:"not_applicable"`. Update audit/QA ledgers, state, and dependency graph; then move to the next unlocked item.
10. **Iterate or stop.** On failure, diagnose and retry at most twice. After two failed repair attempts, replan once with new evidence. If the replanned attempt fails, mark the task blocked with the precise cause and stop dependent work. Never lower a threshold, delete a test, or weaken copy solely to make a gate pass.
11. **Publish safely.** Commit and open/update a PR only after the task passes its local gate. Require CI before merge. Production schema changes, provider configuration, and deployment remain approval-required even when the implementation is complete.

## 7. Global verification gate

Run the full gate before each merge that changes scoring, comparison, capture, auth, consent, data lifecycle, clinical content, migrations, or release configuration; and always before PR-17:

```bash
npm run lint
npm run typecheck
npx vitest run
npm test -w @posture-ai/engine
npm run golden
npm run calibrate:check
npm run voice:verify
npm run build
CI=1 npm run test:e2e
git diff --check
```

Additional rules:

- Migration tasks must pass `npx supabase db reset` against a disposable local database and prove compatibility with the immediately prior deployed app shape.
- `CI=1 npm run test:e2e` is the required local production-mode browser command because `scripts/run-e2e.mjs`/`playwright.config.ts` build and serve with `next start` in CI mode. PR-00 freezes the expected Playwright projects/test inventory, approved skip allowlist with reason/owner/expiry, and retry policy. PR-17 allows zero unapproved skip, retry, or flaky result.
- Each proof records the exact commit SHA and changed-file allowlist. Before merge, `git diff --check` must pass and the staged file set must equal that allowlist. PR-17 runs from a committed SHA with `git status --porcelain` empty and records the exact successful CI run URL/ID.
- Never run migration, deletion, retention, restore, or deployment tests against production without explicit approval.
- Warnings are tracked debt, not silently reported as a clean zero-warning gate.
- The baseline on 2026-07-19 is 0 lint errors/22 warnings, 876 root tests, 132 engine tests, passing golden and build. Test counts are a drift signal, not proof of coverage because coverage collection is disabled. Any reduction requires explanation and independent review. PR-09 owns a named `npm run test:critical-contracts` ratchet for scoring, comparison, capture, auth, consent/lifecycle, workout state, and migration guards; it is part of PR-09 and PR-17 verification.

### Frozen beta performance floors

PR-09 records the exact runner and may tighten these before its first baseline; it may not loosen them after seeing results without owner and independent-review approval.

| Surface | Required floor |
|---|---|
| Client/history page size | maximum 50 records per response page |
| Client/history API payload | maximum 512 KiB per paginated response |
| Seeded API p95 | at most 750 ms on the declared local CI runner with 1,000-record fixture |
| Browser Core Web Vitals | LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1 on the frozen throttled profile |
| Route application JS | at most 350 KiB compressed initial JS per primary beta route, excluding separately cached MediaPipe model/runtime and optional on-demand 3D viewer |
| Cold camera readiness | p95 at most 20 s on frozen 10 Mbps/4x CPU throttling profile |
| Warm camera readiness | p95 at most 5 s with cached assets on the same profile |
| Pagination integrity | zero duplicate or omitted records under fixture traversal and concurrent insert tests |

## 8. Ordered execution backlog

### PR-00 — Freeze the release boundary

**Goal:** turn the assumptions in Section 2 into machine-readable constraints and hard feature gates while tracking owner decisions separately as HG-00.

- **Depends on:** none.
- **Pre-audit:** inventory live admission, HIPAA/BAA settings, client-facing clinical surfaces, native routes, billing routes, and production deployment ownership.
- **Implement:** create `docs/qa/production-readiness-manifest.json`, mapping every current audit row to severity, applicability, engineering task, human/provider gates, dependencies, status, outcome, and proof. Add a release-boundary assertion that defaults to excluding native, billing, public signup, population claims, and covered entities. If clinician approval is absent, the safe default is assessment-only. Add `scripts/check-production-readiness-goal.mjs` with `--build` and `--launch` fixture tests proving wrong task kind, unmet dependency, excess attempts, missing command/exit code/review/rollback, frozen engineering work, frozen S1/S2, missing receipt, council no-go, undisposed flake, stale CI, dirty/unexpected diff, absent/mismatched release-configuration hash, test-only flags in launch evidence, and absent owner approval each fail closed.
- **Verify:** fixture matrix passes; every audit row and PR/HG criterion appears exactly once in the manifest; recommended defaults are enforced until HG-00 records a different approved boundary.
- **Independent review:** Fable challenges launch/product boundary; Kimi challenges clinical and biomechanical claim boundary.
- **Pass:** every later task has a machine-readable applicable/non-applicable rule, validators pass their fail-closed fixtures, and unresolved owner decisions are represented as HG-00 rather than blocking unrelated engineering.
- **Failure/stop:** a validator that cannot detect a frozen engineering task or missing launch receipt blocks all completion claims.
- **Artifacts:** applicability manifest, route/config inventory, validator fixtures, reviewer verdicts.

### PR-01 — Make scores and grades tell one truth

**Goal:** remove contradictions and unsupported population framing from web and PDF results.

- **Depends on:** PR-00 boundary recorded or recommended defaults accepted for engineering.
- **Pre-audit:** reproduce grade-band drift at exact boundaries and trace every grade/rank consumer with CodeGraph.
- **Implement:** create one shared grade-display projection sourced from engine thresholds; use neutral descriptors; remove or rename Front/Side Rank to “view severity index” with its exact formula and no population language; delete stale percentile/rank fields where compatibility allows or mark them internal/deprecated.
- **Automated tests:** all six grade boundaries and just-inside/just-outside values; web/PDF snapshot parity; banned-copy checks for `elite`, `critical`, `percentile`, `rank`, `top X%`, and modeled-population wording on result surfaces.
- **User QA:** open a score 14 assessment and boundary fixtures in responsive web; export PDF; verify displayed grade, legend, color, accessible text, and PDF agree.
- **Independent review:** Fable reviews comprehension and claim restraint; Codex verifies threshold provenance.
- **Pass:** one source of truth and zero contradictory or population-norm output.
- **Rollback:** restore consumer changes together; never restore stale text alone.
- **Artifacts:** drift test, screenshots, PDFs, source-consumer map, review.

### PR-02 — Make progress comparisons honest

**Goal:** ensure Progress, Compare, charts, and PDFs never call noise or cross-engine changes improvement/regression.

- **Depends on:** PR-01.
- **Pre-audit:** trace version and comparison data from API to every consumer; reproduce a nonzero sub-deadband change and a cross-engine comparison.
- **Implement:** centralize a single comparison policy; retain `scoring_engine_version`; fail closed across versions; use the existing fixed fallback (`score=3`, `severity=5 percentage points`) only while no eligible reliability profile exists; label it as measurement tolerance; suppress or caveat grade-direction claims; segment trend charts at engine-version boundaries.
- **Automated tests:** exact deadband edges, both directions, missing version, unequal version, sparse history, legacy records, and byte-identical web/PDF decisions.
- **User QA:** verify unchanged, within-tolerance, improved, regressed, and not-comparable examples in Progress/Compare and PDF.
- **Independent review:** Kimi reviews units and measurement-claim semantics; Fable reviews user wording; Codex verifies all consumers use the same module.
- **Pass:** no consumer infers direction outside the central policy; cross-version data is visibly not comparable.
- **Rollback:** revert all consumers with the policy; do not retain mixed comparison semantics.
- **Artifacts:** truth table, fixtures, screenshots/PDFs, review.

### PR-03 — Close capture hard failures and cold-start readiness

**Goal:** make the four-view mobile-web capture flow fail early, explainably, and recoverably.

- **Depends on:** PR-01; may run after PR-02 or in a separate non-overlapping branch.
- **Pre-audit:** reproduce no-person, multiple-person, permission denied, model timeout, worker failure, and GPU failure; measure cold asset load under throttling.
- **Implement:** disable “Use This Photo” for hard failures; retain corrective reason; expose model/download/initialization readiness; surface and adversarially test the existing bounded timeouts and GPU-to-CPU fallbacks; add missing restart/retry and both-delegates-failed recovery; verify client and server idempotency/double-submit behavior and implement a change only if pre-audit reproduces a gap; preserve final server validation.
- **Automated tests:** hard-failure accept button, retry recovery, worker restart, existing CPU fallback and timeout paths, both delegates failing, idempotency, and all four required slots.
- **User QA:** Chrome throttling and available local mobile-browser emulation; record cold/warm timing and peak-memory symptoms. Physical-device closure belongs to HG-04.
- **Independent review:** Fable reviews recovery UX; Codex reviews state machine and late-submit integrity.
- **Pass:** invalid captures cannot be accepted; valid recovery completes without reload; the user always knows whether assets are downloading, initializing, ready, or failed.
- **Rollback:** keep server-side invalid-slot rejection even if client readiness UI is rolled back.
- **Artifacts:** video/screenshots, timing table, state-machine tests, review.

### PR-04 — Enforce invitation-only practitioner access

**Goal:** make the beta's admission and account-security boundary real in code and provider configuration.

- **Depends on:** PR-00.
- **Pre-audit:** inspect repository admission/session behavior and read-only production Auth settings when available; provider mutation and receipt belong to HG-01.
- **Implement:** remove/disable public signup; admin-issued invitation/allowlist flow; prevent automatic unqualified practitioner enrollment; require AAL2 for practitioner sessions; build enrollment, recovery, and break-glass documentation.
- **Automated tests:** uninvited signup denied, invited account succeeds, role escalation denied, AAL1 blocked from protected data/actions, MFA recovery, revoked user, two-tab signout.
- **Independent review:** Fable security review plus real-database two-user/two-organization authorization test.
- **Pass:** code, local provider fixtures, and server checks deny uninvited/AAL1 access and support the approved configuration. Live provider agreement is separately tested by HG-01.
- **Failure/stop:** inability to enforce the policy in code blocks dependents; missing live access freezes HG-01 but not later engineering.
- **Artifacts:** auth matrix, local provider fixture, E2E transcript, review.

### PR-05 — Replace legal scaffolding with governed text

**Goal:** build versioned Privacy, Terms, consent, retention, withdrawal, and re-consent infrastructure; counsel approval is separately tracked as HG-02.

- **Depends on:** PR-00.
- **Pre-audit:** inventory every legal/disclaimer/consent surface, data category, processor, retention promise, and state transition.
- **Implement:** versioned document model and display; effective dates; acceptance record; material-change/re-consent behavior; jurisdiction/product-scope fields; fail-closed handling that prevents draft/scaffold versions from becoming beta-active. Engineering may build and test the mechanism but may not approve legal substance.
- **Automated tests:** version shown/stored, old acceptance handling, re-consent gate, export/PDF/share copy parity, accessibility.
- **Independent review:** Fable checks product/legal consistency; Codex checks implementation and data record.
- **Pass:** versioning, activation, acceptance, and re-consent behavior pass using clearly labeled non-production fixtures; unapproved/scaffold versions fail closed. HG-02 governs activation of counsel-approved text.
- **Failure/stop:** implementation defects block PR-06; absent counsel approval freezes HG-02 only and blocks launch.
- **Artifacts:** legal inventory, version fixtures, screenshots, review.

### PR-06 — Complete consent, share, retention, and erasure lifecycles

**Goal:** make every privacy promise an end-to-end state transition with revocation and auditable completion.

- **Depends on:** PR-05 version/lifecycle infrastructure; PR-04 identity boundary. HG-02 approval is a launch gate, not an engineering dependency.
- **Pre-audit:** map consent grant/withdraw, workout share mint/use/revoke/rotate, client deletion, object storage, logs, backups, and retention stores.
- **Implement:** consent withdrawal endpoint/UI; share-token inventory, revoke, and rotate; controlled erasure reason codes; transactional database deletion plus idempotent outbox/retry for external objects; retention matrix and scheduled cleanup; privacy-safe audit events.
- **Automated tests:** revoked token denied immediately, rotation invalidates old token, repeated erasure is safe, injected external-delete failure retries, unauthorized lifecycle actions denied, retention job boundaries.
- **User QA:** grant → use → withdraw; mint → open → revoke; create client → delete → verify absence and tombstone minimization.
- **Independent review:** Fable privacy/security review; Codex transaction/failure-mode review.
- **Pass:** lifecycle state and UI agree; failures are retryable and visible; free text/PII is not retained in tombstones or logs.
- **Rollback:** schema changes follow expand-migrate-contract; never restore revoked access during rollback.
- **Artifacts:** lifecycle diagrams, failure-injection results, deletion receipt, review.

### PR-07 — Gate clinical content and recommendations

**Goal:** prevent unreviewed muscle/exercise/contraindication content from reaching beta users.

- **Depends on:** PR-00 safe-default boundary and PR-05 claim/version infrastructure. HG-03 controls whether approved recommendation content can be activated.
- **Pre-audit:** enumerate all muscle, exercise, link, evidence, contraindication, program, workout, PDF, and share consumers; reconcile all 29 muscle records and the complete exercise inventory.
- **Implement:** make assessment-only the server-enforced default. Add review metadata and activation checks so a version approved through HG-03 can enable only its reviewed items. Until then, remove/disable programs, workouts, muscle knowledge links, and recommendation copy from beta routes and server/API/export handlers.
- **Automated tests:** unreviewed/rejected content never renders; approved content version is stable in historical snapshots; link checker; contraindication propagation; no dead link from reports. Direct-request tests prove disabled recommendations cannot be generated, minted, shared, or exported even when navigation is bypassed.
- **Independent review:** Kimi reviews biomechanics/claim-scope enforcement; HG-03's licensed clinician remains the content approver.
- **Pass:** all unreviewed recommendation surfaces are demonstrably disabled at UI and server boundaries; the optional approved-content path is tested but cannot activate without HG-03 evidence.
- **Failure/stop:** partial review cannot be generalized to unreviewed records.
- **Artifacts:** review ledger, feature-gate matrix, link report, reviewer verdict.

### PR-08 — Build the device/accessibility release harness

**Goal:** make the supported-device and accessibility matrix mechanically executable; HG-04 owns the physical runs.

- **Depends on:** PR-03, PR-04, and PR-07's safe feature boundary.
- **Pre-audit:** finalize supported browser/device floor and reuse the existing device-evidence checklist.
- **Implement:** encode the checklist, supported floor, required evidence fields, two-run requirement, optional-capability rules, production-mode Playwright coverage, accessibility scans, and receipt validation. Include four views, retake, orientation, no/multiple person, permission deny/regrant, cold/warm load, worker recovery, background/foreground, long session, PDF, enabled feature flow, VoiceOver/TalkBack, wake lock, and audio where applicable.
- **Automated tests:** device-independent Playwright paths, accessibility scans, and invalid/missing/fabricated receipt fixtures.
- **Independent review:** reviewer samples raw video/screenshots and checks every row has evidence rather than a self-attested “pass.”
- **Pass:** the harness fails closed unless the complete consent → four-view capture → score → results path is evidenced twice on both device classes; only optional capabilities can be excluded. HG-04 supplies the real runs and remains launch-blocking until complete.
- **Failure/stop:** desktop emulation cannot satisfy HG-04; excluding a core platform requires a formal PR-00/HG-00 boundary revision and renewed owner/council approval.
- **Artifacts:** executable checklist/schema, Playwright/axe receipts, invalid-receipt tests, review.

### PR-09 — Bound data access and prove beta-scale performance

**Goal:** keep client and assessment history responsive and complete as practices grow.

- **Depends on:** PR-02 comparison semantics.
- **Pre-audit:** before measuring or optimizing, commit `docs/qa/performance-budgets.json` using the numeric floors below and record the controlled runner/device/network profile; then profile the four unbounded queries, chart payloads, result/capture bundles, camera cold path, and database indexes. Any budget change after baseline requires owner and independent-review approval.
- **Implement:** cursor pagination and search; stable ordering; bounded API contracts; incremental chart/history fetch; lazy-load heavy client modules; add only query-supported indexes.
- **Automated tests:** 150/300/1000 client/assessment fixtures; no duplicates/omissions across cursors; filters/search; concurrent inserts; response and bundle budgets. Add `npm run test:critical-contracts` covering scoring, comparison, capture, auth, consent/lifecycle, workout state, and migration guards, and make it required in CI/PR-17.
- **User QA:** slow-network and older-device client selection, history, compare, and assessment start.
- **Independent review:** Codex architecture/performance review; Fable reviews pagination UX.
- **Pass:** the frozen numeric budgets and `npm run test:critical-contracts` pass with complete data and bounded responses on the largest fixture.
- **Rollback:** retain old API compatibility through one deployed version; index rollback documented.
- **Artifacts:** before/after profiles, query plans, bundle report, review.

### PR-10 — Freeze and verify the Tier B reliability protocol/tooling

**Goal:** make the reliability protocol, collection manifest, analysis, and eligibility adjudication ready before HG-05 collects human data.

- **Depends on:** PR-00 scope, PR-03 capture behavior, and PR-08 device/browser receipt harness; capture protocol and scoring algorithm/version frozen for collection.
- **Pre-audit:** independently verify protocol, randomization, view labels, operator/device metadata, dataset fingerprinting, ICC(2,1), SEM, MDC95 units, missingness, and eligibility guards. Before subject 1, freeze the exact capture build/commit, model asset hashes, engine version, browser/device/OS versions, and protocol revision.
- **Implement:** validate collection manifests and frozen hashes; run reference/fixture datasets through per-metric n, ICC, SEM, MDC95 in severity percentage points, uncertainty intervals, missingness, and clustered sensitivity by participant/device/operator; reject pseudo-replicates treated as independent people. The protocol estimand is within-session re-positioned repeatability, not day-to-day reliability.
- **Independent review:** Kimi biomedical/biomechanical review plus an independent statistical reviewer; Codex checks implementation/provenance.
- **Pass:** protocol and analysis fixtures pass; deviations/fingerprint mismatches fail closed; HG-05 has an immutable collection packet. A failed metric is demoted/redesigned, not hidden by threshold changes.
- **Failure/stop:** no `consumerEligible:true` with missing data, wrong units, stale engine, inadequate clustering, or unsigned review.
- **Artifacts:** protocol/manifest schemas, reference statistics, rejection fixtures, collection packet, reviewer decisions.

### PR-11 — Consume reliability profiles fail-closed

**Goal:** replace engineering deadbands only when an eligible profile safely matches the running engine.

- **Depends on:** HG-05 eligible output. If HG-05 is frozen or produces no eligible metric profile, keep the documented fallback and persist this task as `status:"completed"`, `outcome:"not_applicable"` with the absence/ineligibility proof and reviewer approval; never pass it by fabricating a profile.
- **Pre-audit:** inventory every comparison consumer and profile-field/unit expectation.
- **Implement:** load only versioned eligible profiles; validate schema, engine fingerprint, metric set, units, and provenance; use severity-percentage-point MDC; reject absent, ineligible, stale, malformed, or wrong-unit data; preserve byte-identical fallback behavior.
- **Automated tests:** every rejection reason; exact edge semantics; web/PDF/API parity; deleting the profile restores the fallback without changing stored assessments.
- **Independent review:** Kimi checks measurement units/claims; Codex checks fail-closed mechanics.
- **Pass:** no profile can affect users unless every eligibility predicate matches; rollback is deletion/config reversion, not data migration.
- **Artifacts:** profile schema, rejection matrix, parity fixtures, review.

### PR-12 — Decide pelvic proxy, weights, and model default from evidence

**Goal:** make explicit product decisions about weak constructs and model cost without pretending the legacy archive is clinical validation.

- **Depends on:** PR-03 device-performance instrumentation, PR-10 analysis tooling, and PR-05/07 claim governance. HG-05 evidence is optional input; absent/weak evidence preserves the current lite default and conservative proxy treatment.
- **Pre-audit:** compare lite/full metric deltas under the repository decision rule, device latency/memory, Tier B repeatability, pelvic construct limitations, grade sensitivity, and user-facing labels.
- **Implement:** update labels, evidence/validity weights, grade contribution, or model default only when the signed decision record supports it. Engineering proxies remain named as proxies.
- **Automated tests:** decision-rule computation, grade sensitivity, copy/weight drift, lite/full configuration, rollback.
- **Independent review:** Kimi leads biomechanics; Fable challenges product consequences; Codex verifies computations and repository rule adherence.
- **Pass:** every change cites its evidence and tradeoff; no default switch rests on shoulder correlation alone; pelvic behavior has an explicit retain/demote/remove rationale.
- **Failure/stop:** disagreement or weak evidence preserves the current default and conservative language.
- **Artifacts:** decision memo, model comparison, latency receipt, review.

### PR-13 — Harden exposed and sensitive operations

**Goal:** close practical abuse, tenant-isolation, and browser-policy gaps for the selected beta.

- **Depends on:** PR-04 and PR-06.
- **Pre-audit:** enumerate public, token-bearing, expensive, state-changing, export, approval, and destructive endpoints; map rate limit, auth, tenant, CSRF/origin, logging, and response behavior.
- **Implement:** strict limiter/degraded-mode policy for sensitive routes; privacy-safe structured logs; nonce/hash CSP rollout; required secret/dependency/code scanning; eliminate raw identifiers where operationally unnecessary.
- **Automated tests:** limiter outage/abuse, cross-tenant two-user matrix on real Postgres/RLS, token replay, origin/CSRF where applicable, CSP report-only violations, log redaction, scanner gates.
- **Independent review:** Fable security review; Codex verifies exploit-focused tests and avoids compliance theater.
- **Pass:** no high-impact route is fail-open without an explicit safe degradation; tenant matrix and scanners pass; CSP enforcement has no required unsafe fallback.
- **Rollback:** staged CSP report-only rollout; rate-limit rollback must preserve strict protection on token/destructive routes.
- **Artifacts:** endpoint matrix, test transcript, CSP report, scan results, review.

### PR-14 — Make releases and schema changes reversible

**Goal:** produce a typed, staged, migration-safe release path instead of relying on direct `main` deployment.

- **Depends on:** PR-04; migration portions also depend on PR-06.
- **Pre-audit:** inventory environment variables, staging-isolation requirements, migration ledger, promotion contract, branch-rule requirements, health semantics, and prior-version compatibility. Live provider mutation/receipt belongs to HG-06.
- **Implement:** typed env validation including `NEXT_PUBLIC_APP_URL`; enforceable staging configuration contract; migration prepromotion and ledger; expand-migrate-contract policy; health 503 for non-ready states; required-check configuration-as-code where supported; explicit application and schema rollback decision tree.
- **Automated tests:** missing/invalid env; stale/pending schema health; local database reset; current and immediately prior app version against expanded schema; migration idempotency where designed.
- **Independent review:** Fable operations review; Codex migration/compatibility review.
- **Pass:** local/isolated-staging fixtures prove the compatibility window and non-destructive rollback; configuration validation fails closed. HG-06 separately proves the live Vercel/Supabase/GitHub settings match.
- **Failure/stop:** never solve an irreversible migration by assuming instant application rollback.
- **Artifacts:** runbook, migration matrix, configuration fixtures, review.

### PR-15 — Prove observability, backup, restore, and incident response

**Goal:** detect user-impacting failures and recover within declared limits.

- **Depends on:** PR-14 release path; PR-06 retention semantics.
- **Pre-audit:** inventory runtime errors, health, logs, alert contracts, on-call ownership, backup/PITR requirements, object storage, retention, and provider interfaces. Live provider-configuration receipts belong to HG-07; alert-delivery and restore-drill receipts belong to HG-08.
- **Implement:** privacy-configured error monitoring adapter; actionable availability/error/auth/capture alert rules; privacy-safe log policy; declared RPO/RTO; backup/PITR/storage verification commands; incident, rollback, restore-validation, and communications runbook.
- **Automated tests:** synthetic alert fixture, privacy redaction, failed-erasure/health signals, backup metadata validation, restored-data integrity checker, and missing-provider fail-closed behavior.
- **Independent review:** a non-operator reviews raw timestamps and restored data checks.
- **Pass:** adapters, rules, validation tooling, and runbook pass controlled fixtures. HG-07 separately proves live provider configuration; HG-08 proves real alert delivery and isolated restore within RPO/RTO.
- **Failure/stop:** provider marketing/defaults are not evidence. A missing restore receipt blocks beta.
- **Artifacts:** alert/restore fixtures, integrity checker, RPO/RTO proposal, runbook, review.

### PR-16 — Preserve historical workout and share compatibility

**Goal:** ensure stored snapshots and share links remain safe as runtime schemas and content versions evolve.

- **Depends on:** PR-06 and PR-07; coordinate migrations with PR-14.
- **Pre-audit:** enumerate all persisted workout snapshot versions, token projections, historical assessment engine versions, and readers.
- **Implement:** runtime schema validation; explicit snapshot/content/engine versions; migration or supported rejection UI; immutable historical display where required; privacy-safe share projection.
- **Automated tests:** oldest supported fixture, unknown future version, malformed snapshot, deleted/rejected content, revoked token, current/prior app compatibility.
- **Independent review:** Codex data-contract review; Fable reviews user recovery messaging.
- **Pass:** malformed/unknown data cannot crash or silently misstate a plan; supported history renders deterministically.
- **Rollback:** readers remain backward-compatible through the declared window.
- **Artifacts:** schema/version registry, historical fixtures, compatibility matrix, review.

### PR-17 — Run the release-candidate rehearsal and final audit

**Goal:** prove the complete selected beta journey and hand the owner an honest launch decision.

- **Depends on:** every applicable PR-00 through PR-16 engineering task. `--launch` additionally requires every applicable HG gate completed, not frozen.
- **Pre-audit:** reconcile goal state, git/CI, audit, buglog, inventory, provider receipts, current production/staging schema, device matrix, legal and clinical versions, backup proof, and exclusions.
- **Execute on an isolated production-mode staging/local environment:** invite practitioner → enroll MFA → create client → record fixture consent → capture four views → inspect results/markings → approve → PDF → enabled workout/share → follow-up comparison → withdraw consent → revoke share → delete client → verify audit/retention behavior. If a live provider or approved legal/content artifact is not yet available, use explicitly labeled non-production fixtures and leave the corresponding HG task frozen. Consume HG-04's physical-device evidence separately; do not relabel desktop emulation as that proof. If assessment-only mode is selected, directly probe disabled program/workout/share/export endpoints and prove they fail closed.
- **Global verification:** run Section 7 plus `npm run test:critical-contracts`; require current CI; zero open engineering-owned S1/S2; no flaky retry accepted without root-cause disposition. Human/provider S1/S2 remain visible in the manifest and block `--launch`, not `--build`. These checks and the rehearsal criteria complete PR-17; do not make PR-17 depend on its own `--build` result.
- **Independent review:** Codex, Fable 5 medium, and Kimi K3 review the engineering rehearsal packet and return defects to their owning task. This is not the final launch council, which occurs on the intended-beta configuration in HG-09.
- **Pass:** every applicable engineering criterion and exclusion is evidenced and the final audit/release/rollback packet is ready. Persist PR-17 `status:"completed", outcome:"passed"`; only then run `scripts/check-production-readiness-goal.mjs --build` as a separate global postcondition.
- **Failure/stop:** an engineering failure blocks `--build`. A frozen human gate, failed restore/device path, legal/clinical gap, or unresolved S1/S2 makes `--launch` return `NO-GO` without invalidating already completed independent engineering. Do not deploy.
- **Artifacts:** engineering rehearsal record, final engineering audit, preliminary council reviews, release/rollback packet.

## 9. Human and provider gates

These are separate state tasks with `kind:"human"` or `kind:"provider"`. They use `proof/HG-XX.PASS.txt`, may be frozen without deadlocking independent PR engineering, and are all checked by `--launch`.

| ID | Kind | Owner | Engineering prerequisite | Pass proof | Launch rule |
|---|---|---|---|---|---|
| HG-00 | human | Product owner | PR-00 | dated beta/public, HIPAA, clinical-surface, and promotion-boundary decision | Required; changes regenerate/apply the manifest and receive renewed council review. |
| HG-01 | provider | Auth account owner | PR-04 | redacted production Auth receipt proving signup disabled/invitations enforced, AAL2 required, redirect/session/recovery settings verified, plus live invited/uninvited tests | Required. Hidden signup UI is insufficient. |
| HG-02 | human | Counsel + product owner | PR-05 | counsel-approved Privacy/Terms/Consent versions, effective dates, cohort/jurisdiction, retention, withdrawal, and re-consent disposition | Required. Draft fixtures never qualify. |
| HG-03 | human | Licensed clinician | PR-07 | itemized signed muscle/exercise/link/contraindication review ledger | Required only if recommendations/workouts/knowledge links are enabled; otherwise HG-00 assessment-only decision plus server-side disablement proves `not_applicable`. |
| HG-04 | human | QA owner | PR-03 and PR-08 | raw iPhone Safari and selected mid/low Android Chrome receipts; core consent → four-view capture → score → results path passes twice on both, plus the accessibility/recovery matrix | Required. Desktop emulation is not proof. |
| HG-05 | human | Collection owner + statistical reviewer | PR-08, PR-10, and completed HG-04 physical-device floor | at least 144 consented/de-identified photos using within-session re-positioned repeats; frozen build/model/engine/device/browser/protocol hashes; report with ICC/SEM/MDC95, intervals, missingness, clustering, and signed eligibility decisions | Required for beta change claims; failed metrics remain ineligible and are demoted/caveated rather than tuned. |
| HG-06 | provider | Vercel/Supabase/GitHub owners | PR-04 and PR-14 | redacted live configuration receipt proving isolated staging, typed required variables, protected main/required checks/scanners, authoritative migration health, and approved promotion path | Required. |
| HG-07 | provider | Operations provider owner | PR-15 | redacted production/staging monitoring, alert-route, backup/PITR, storage-coverage, retention, and access configuration receipt | Required. Provider defaults are not proof. |
| HG-08 | human | Operations owner | HG-07 and PR-15 | safe synthetic alert reaches the named owner; isolated backup restore meets declared RPO/RTO; integrity checker passes; elapsed time and storage gaps are recorded | Required. |
| HG-09 | human | QA owner + final council | PR-17 and completed HG-00 through HG-08 as applicable | fresh integrated rehearsal on the intended beta configuration: test mode off, selected clinical gates applied, approved legal/content versions active, intended staging/provider settings, configuration hash matching the release candidate; then Codex, Fable 5 medium, and Kimi K3 issue final verdicts with no unresolved `NO-GO` | Required. A fixture/test-mode rehearsal cannot substitute. |
| HG-10 | human | Product owner | HG-09 final packet and council | explicit dated production-promotion approval tied to commit, CI run, manifest/configuration hashes, final audit, and rollback packet | Required last; then `--launch` must exit `0`. |

If a covered entity joins the cohort, add verified Supabase and Vercel BAAs, Supabase plan/security controls, access review, audit-log operations, and HIPAA-specific counsel signoff before launch. Self-selecting a “BAA signed” value in application settings is not proof.

## 10. Stop rules

- Never say “production ready” while any applicable S1/S2 or human launch gate is open or frozen.
- Never set or consume `consumerEligible:true` without complete Tier B data, correct units, engine/profile match, uncertainty review, and signed eligibility decision.
- Never tune thresholds, grade bands, or metric weights merely to make repeatability or comparison tests pass.
- Never publish percentile, rank, elite, critical, diagnostic, causal, or clinical-validity language without the matching evidence and approved product scope.
- Never deploy, migrate, delete, restore, rotate production secrets, or change production provider configuration without explicit approval.
- Never silently substitute a requested council model. Record unavailable/overloaded status and retry or return the seat as blocked.
- Never let native, public signup, billing, or covered-entity behavior enter the beta by accident; exclusions are tested release requirements.
- Never move to a dependent task until its prerequisites are passed with proof.

## 11. First autonomous slice

Start with **PR-00, then PR-01, PR-02, and PR-03**. PR-00 installs the manifest and fail-closed completion validators used by every later item. PR-01 through PR-03 directly affect the trustworthiness and usability of Meagan's current testing, require no counsel or clinical-data collection to begin, and remove the most visible contradictions before more testers generate longitudinal data.

In parallel with those engineering items, PR-00 should ingest the recorded HG-00 launch-boundary decisions. The available clinician can begin HG-03, but the first beta remains assessment-only until the signed review ledger passes and the server-side activation gate is proven.
