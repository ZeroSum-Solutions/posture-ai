# PR-08 — Device and Accessibility Release Harness

**Status:** accepted after Opus 4.8 revision-1 `PASS`

**Goal task:** `PR-08` / criterion `PR-08.PASS`

**Canonical scope:** `docs/plans/2026-07-19-production-readiness-goal-spec.md` lines 265–276
**Base:** `92b31ab453b1e70c630cdfbb88d67688633a184d` on `codex/production-readiness-goal`

## Outcome

Build a mechanically executable device and accessibility evidence harness. PR-08 passes only when the harness, contract, adversarial fixtures, automated browser coverage, receipts, and independent engineering review pass. It does **not** claim that physical device testing happened.

HG-04 stays frozen until a human completes and independently reviews two physical consent → four-view capture → score → results runs on each supported device class, plus the required recovery and accessibility matrix. Desktop or Playwright emulation can never satisfy HG-04.

## Frozen release boundary

### Supported physical classes

| Class | Minimum floor | Required identity |
|---|---|---|
| `iphone_safari` | iOS 17 or newer, Safari supplied by that OS, physical phone | model, OS version, Safari version/build, physical-device assertion |
| `android_chrome` | Android 11 or newer, an explicit integer `chrome_min_major` frozen in the versioned contract, physical mid/low phone with 4–6 GB RAM | model, RAM class, OS version, Chrome major/full build, physical-device assertion |

The contract records `published_at` and the official release source used to choose `chrome_min_major`; relative rules such as “current or N-1” never appear in validation. The validator rejects unidentified, emulated, desktop, unsupported-OS, below-floor browser, or flagship-only Android evidence. The eventual HG-04 packet must name the exact selected models; PR-08 freezes the envelope, not a device purchase.

### Core journey

Each device class requires two distinct physical runs. Every run must bind the same release commit and configuration hash and contain ordered evidence for:

1. invitation-only practitioner sign-in and AAL2 session;
2. client selection and valid consent state;
3. front, left, right, and back capture;
4. at least one retake with the replaced view identified;
5. score completion;
6. assessment-only results and markings;
7. PDF request and successful open/download behavior.

The four required runs must have unique run IDs, collection challenge nonces, non-overlapping start/end timestamps, and evidence hashes. Evidence reuse across runs fails validation. At least one cold-cache and one warm-cache run is required per class.

### Required per-class matrix

The packet must also prove each row on both device classes unless the contract explicitly marks it optional:

- portrait and landscape transition with usable controls and preserved state;
- camera permission denial, visible recovery path, and regrant without reload;
- no-person and multiple-person hard failure with photo acceptance blocked;
- cold model load, warm model load, and both-delegate/worker recovery;
- background → foreground recovery with camera/runtime cleanup and restart;
- sustained four-view/retake session with no leak, hang, or context-loss crash;
- keyboard-only traversal for all keyboard-capable release surfaces;
- VoiceOver on iPhone and TalkBack on Android, with spoken labels/order captured in reviewer notes;
- reduced-motion behavior;
- wake-lock acquisition, loss, reacquisition, and cleanup when the capability exists;
- audio primary path, mute, and fallback/interruption behavior only when the release configuration enables the workout surface.

Core consent/capture/score/results rows are never waivable. A capability may be `not_applicable` only when the contract enumerates it as optional and the receipt binds either an objective unsupported-capability probe or the exact release configuration proving the feature disabled. The selected assessment-only configuration makes workout/audio rows configuration-N/A; it does not make capture wake-lock or accessibility rows optional.

## Privacy and evidence rules

- No real client data, posture photos, landmarks, names, emails, or identifiers enter Git.
- Collection uses a consented test subject or synthetic target and a dedicated non-production client record.
- Raw video/screenshots live in a protected external evidence root. No physical capture frame, even redacted, is committed to Git. The proof-rooted packet contains metadata, byte-derived SHA-256 bindings, and validator/reviewer receipts only.
- Evidence metadata records media type, byte length, captured-at time, source run/row, relative path under the declared evidence root, and SHA-256.
- The validator hashes binary evidence from raw bytes and rejects absolute paths, traversal, symlinks, missing/zero-byte files, MIME/size/hash mismatch, duplicate hashes where uniqueness is required, fixture/test-mode markers, and files outside the evidence root. The generic goal artifact loader never reads raw media.
- A hash proves binding, not truth. Final HG-04 acceptance therefore also requires a named independent reviewer to sample raw artifacts and bind sampled hashes to a signed review receipt.

## Human-gate authority and evidence-root composition

`check-device-evidence` is necessary but never sufficient for HG-04. It is a read-only validator and cannot update goal state. Its proof-rooted result distinguishes:

- `packet_structurally_valid` — the schema, run matrix, byte hashes, floor, and bindings pass;
- `physical_packet_valid` — structural validation plus physical-mode requirements pass;
- `hg04_launch_eligible` — always `false` from this validator alone.

The raw evidence root remains external. A proof-rooted `device-validation.json` binds the raw-root manifest hash without making raw media a generic goal artifact. HG-04 can become launch-eligible only when all are present:

1. `physical_packet_valid:true` from the task-specific validator;
2. a separate proof-rooted independent sampling receipt covering all four core recordings, both device-identity artifacts, every exclusion, and the deterministic contract sample of remaining rows;
3. an Ed25519 detached signature over that review receipt, verified against an approved reviewer public-key fingerprint bound to the release configuration (test keys can prove mechanics but are launch-ineligible);
4. reviewer identity differs from operator identity;
5. an explicit human-owned transition of HG-04 to completed.

The launch checker validates these conditions only when `task_id === "HG-04"`; it does not alter the generic policy for any other human/provider gate and never performs the state transition itself. A repository fixture can exercise the complete cryptographic/structural happy path with an ephemeral test key, but must return `hg04_launch_eligible:false`.

## Repository deliverables

1. `docs/qa/device-release-contract.json`
   - versioned device floor;
   - release commit/configuration binding rules;
   - core journey steps;
   - per-class matrix rows;
   - required/optional classification;
   - evidence-type and reviewer-sampling rules;
   - numeric telemetry thresholds or explicit manual-review dispositions.
2. `docs/qa/device-evidence.schema.json`
   - structural JSON Schema for collection packets;
   - strict unknown-field rejection;
   - no secret or subject-data fields.
3. `scripts/check-device-evidence.mjs`
   - `--contract`, `--receipt`, `--evidence-root`, `--expected-commit`, and `--expected-configuration-hash` inputs;
   - explicit `--fixture` mode for repository tests that can prove `packet_structurally_valid:true` but can never return HG-04 launch eligibility;
   - machine-readable PASS/FAIL result and stable reason codes.
4. `scripts/check-device-evidence.test.ts`
   - direct unit/contract coverage and malicious/adversarial fixtures.
5. `scripts/fixtures/device-evidence/`
   - one complete labeled non-production structural happy-path packet;
   - invalid variants generated or transformed in-test where practical;
   - tiny non-sensitive dummy artifact files only.
6. `docs/qa/device-evidence-checklist.md`
   - human collection instructions generated from or mechanically checked against the contract;
   - explicitly supersedes both stale device checklists.
7. Playwright changes
   - named Android/mobile-Chromium project;
   - responsive release-matrix spec;
   - mobile WebKit/Chromium accessibility scans;
   - reduced-motion, orientation, visibility recovery, wake-lock, multiple-person, PDF, and enabled-feature applicability paths;
   - machine-readable Playwright and Axe receipts.
8. Goal/release integration
   - package command `device:evidence:check`;
   - CI uploads passing and failing sanitized Playwright/Axe receipts;
   - production-readiness checker applies the specialized physical-packet plus signed-review rules only to HG-04, while retaining the existing generic checks for all other human/provider gates;
   - manifest/source inventory/E2E inventory and hashes updated mechanically;
   - `docs/RUNBOOK.md`, `docs/qa/AUDIT.md`, `docs/qa/INVENTORY.md`, and `e2e/README.md` point to the canonical contract/checklist; the canonical checklist explicitly incorporates the useful live-worker telemetry rows from the older Slice-3 document rather than discarding them.

## Implementation slices

### Slice A — Contract, schema, and fail-closed validator

**RED first**

- A minimal `{task_id:"HG-04", verified:true, commit}` receipt passes the current generic launch logic; add a failing goal-checker test proving this must be rejected.
- Add failing validator tests for:
  - empty packet;
  - unknown schema version or unknown fields;
  - stale/missing commit or configuration hash;
  - one run per class rather than two;
  - duplicate run ID or reused evidence hash;
  - emulated/test-mode/fixture receipt in physical mode;
  - unsupported iOS/Android/browser floor;
  - missing view, consent, score, result, retake, or PDF step;
  - missing core matrix row;
  - illegal core `not_applicable`;
  - optional exclusion without capability/configuration proof;
  - missing artifact, traversal, symlink, wrong size, or wrong hash;
  - self-attested review with no sampled artifact hashes, unsigned review, unapproved/test reviewer key, or reviewer equal to operator;
  - mismatched reviewer/packet/contract binding.

**GREEN**

- Implement the immutable contract, strict schema, raw-byte hashing, reason-coded validator, package command, HG-04-only launch integration, detached review signature verification, and external-root/proof-root composition.
- The repository fixture proves the complete structural and signature mechanics but prints `hg04_launch_eligible:false`.
- The canonical launch checker must reject empty/malformed/fabricated HG-04 packets while continuing to leave HG-04 frozen when no physical packet exists.

**Slice pass**

- Focused validator and goal-checker tests pass.
- `git diff --check`, typecheck, and lint pass.
- Independent review finds no path that converts fixture/emulated evidence into HG-04 eligibility.

### Slice B — Android proxy and responsive/accessibility automation

**RED first**

- Inventory test fails because no Android/mobile-Chromium project exists.
- A11y coverage test fails because responsive release surfaces are scanned only in desktop Chromium.
- Add failing tests for reduced motion and keyboard/focus behavior at phone width.

**GREEN**

- Add a stable Pixel-style Android/mobile-Chromium project without claiming physical-device equivalence.
- Run release-surface Axe scans on desktop Chromium, iPhone-like WebKit, and Android-like Chromium. Remove the PR-08-owned mobile-WebKit Axe skip rather than carrying the contradiction forward.
- Keep the current serious/critical zero budget unless the Opus review explicitly justifies a stricter ratchet; record moderate/minor findings in the generated receipt rather than silently dropping them.
- Cover mobile navigation, consent, capture wizard states, hard-failure/review states, assessment-only results, and PDF action.
- Add reduced-motion and keyboard-only coverage at release viewports.

**Slice pass**

- All new projects/specs pass in a production build with zero unowned skips.
- Axe JSON contains every required route/state/project and zero serious/critical violations.
- The E2E inventory and approved-skip ledger match actual Playwright discovery.

### Slice C — Recovery, capability, and long-session automation

**RED first**

- Add failing tests for multiple-person Playwright hard block, portrait/landscape state preservation, hidden/visible recovery, and wake-lock lifecycle.
- Add a bounded long-session test that initially fails without deterministic cleanup assertions.
- Add contract-level workout/audio applicability tests that fail if an assessment-only release silently requires or omits enabled-only rows.

**GREEN**

- Exercise existing capture/runtime behavior through explicit Playwright hooks where browser APIs cannot be driven directly; hooks must be test-build-only and production-refused.
- Test visibility cleanup/restart and wake-lock acquire/reacquire/release without weakening failure fallbacks.
- Verify long-session resource counters stay bounded using deterministic lifecycle counters; do not claim physical memory evidence.
- Verify mobile PDF behavior. Prove workout/audio N/A from the exact flags-off release configuration and configuration hash, not from the fixture-enabled Playwright environment. The intended-beta flags-off browser rehearsal remains PR-17/HG-09 scope.

**Slice pass**

- Browser paths pass without retries.
- Automated receipts label emulated/device-independent evidence and cannot satisfy HG-04.
- Existing real-detection coverage remains intact.

### Slice D — Receipt emission, CI, documentation, and independent audit

**RED first**

- CI contract test fails when passing Playwright/Axe artifacts are not retained.
- Documentation coherence test fails while RUNBOOK/AUDIT/README point to stale checklists or stale skip lists.

**GREEN**

- Emit deterministic sanitized Playwright/Axe release receipts and retain them on CI success and failure.
- Update source/E2E inventories and configuration hashes using the repository generators; never hand-edit a derived hash. Because the Android project changes configuration-hash-covered `e2e.*` fields, obtain an independent configuration-delta review and rebind every completed PR-00 through PR-07 review receipt to the new configuration hash while preserving its original verdict and adding the delta receipt. Do not copy an old PASS into a new hash without review.
- Supersede stale checklists and document the production-build versus development-telemetry distinction.
- Add the HG-04 empty-packet/frozen result to the PR-08 acceptance packet.

**Slice pass**

- Independent reviewer samples contract, fixtures, raw test receipts, and every required row rather than accepting a narrative PASS.
- Opus 4.8 plan findings and final implementation findings are dispositioned.
- Full Section 7 gates and retry-disabled E2E pass.
- PR-08 proof/state binds the final commit, exact changed files, command receipts, independent PASS review, and rollback note.

## Mechanical verification

Run at the final PR-08 commit:

```bash
npm run device:evidence:check -- --contract docs/qa/device-release-contract.json --receipt scripts/fixtures/device-evidence/complete/receipt.json --evidence-root scripts/fixtures/device-evidence/complete/artifacts --fixture
npx vitest run scripts/check-device-evidence.test.ts scripts/check-production-readiness-goal.test.ts
npx vitest run
npm test -w @posture-ai/engine
npm run typecheck
npm run lint
npm run golden
npm run voice:verify
npm run build
npm run calibrate:check
CI=1 npm run test:e2e
git diff --check
node scripts/check-production-readiness-goal.mjs --build
python3 /Users/zero-suminc./projects/tools/zs-skills/skills/meta/goal/scripts/check-complete.py posture-ai-production-readiness
```

The last two commands are expected to remain nonzero after PR-08 because PR-09 through PR-17 and human/provider gates remain open. Their outputs must contain no PR-08 proof error. A nonzero global goal result is not rewritten as a PR-08 failure or a whole-goal success.

## Completion criteria

PR-08 is complete only when all are true:

1. Contract/schema/checklist enumerate every canonical PR-08 row and agree mechanically.
2. The validator rejects every listed invalid/missing/fabricated fixture and cannot make fixture/emulated evidence physical-eligible.
3. The generic HG-04 receipt bypass is closed in the production-readiness checker; device validation remains necessary-not-sufficient and a signed independent sampling receipt plus explicit human state transition are required.
4. Android-like Chromium and iPhone-like WebKit automation are present and clearly labeled as proxies.
5. Responsive Axe, keyboard, reduced-motion, orientation, recovery, wake-lock, long-session, PDF, and configuration-dependent feature coverage pass.
6. Passing and failing sanitized automation receipts are retained and inventory-bound; the mobile-WebKit Axe skip is removed.
7. No real subject data or physical capture frame is committed; external binary evidence is hashed from bytes and represented only through proof-rooted validation/review receipts.
8. Opus 4.8 and an independent code reviewer return PASS after all material findings are repaired.
9. Full mechanical gates pass at the final commit with zero unexplained retry.
10. The changed E2E configuration hash is independently reviewed and PR-00 through PR-07 review receipts are honestly rebound through a configuration-delta receipt.
11. `proof/PR-08.PASS.txt` and structured proof receipts validate; PR-08 is persisted completed while HG-04 stays frozen.

## Rollback

Before any hosted or CI policy activation, revert the PR-08 commit as one unit. After CI/release consumers depend on the contract, preserve evidence and audit history, keep HG-04 frozen, and use a forward-compatible contract revision. Never loosen the supported floor, reduce the two-run requirement, waive a core row, or convert fixture/emulation into physical evidence to restore a green result.

## Opus 4.8 review record

Round 1 returned `VERDICT: REVISE`: one P0, four P1, and six P2 findings. Revision 1 makes device validation necessary-not-sufficient, separates fixture-enabled automation from flags-off release applicability, specifies the configuration-hash rebind cascade, scopes specialized launch logic to HG-04, composes external raw evidence with proof-rooted receipts, freezes an integer Chrome floor, aligns the CLI, exercises the structural happy path without physical eligibility, forbids committed capture frames, incorporates rather than discards Slice-3 telemetry rows, removes the PR-08-owned WebKit Axe skip, and restores the frozen engine command.

Round 2 used the exact `claude-opus-4-8` subscription model in read-only mode and returned `VERDICT: PASS`. It confirmed every prior finding closed, found no new material defect, and verified that the per-class matrix covers every canonical PR-08 row while leaving HG-04 under explicit human authority.
