# Training progression independent review

Model: Grok 4.6 Build via subscription OAuth. Root integration verification: 213 training tests, TypeScript and focused ESLint passed on the frozen candidate. Scope: exact loads, profile/eligibility schemas and deterministic progression. UI, persistence, compiler, clinical policy and device validation are not certified here.

The repairs close both prior blockers and the named WARN defects in this packet. Quantity and equipment arithmetic still hold. Progression identity now distinguishes outcomes without putting raw `now` in the key. The V1 1000 kg parser bound is on every progression load. Eligibility snapshots carry provenance and window data. Recalled and imported rows cannot enter the in-app window. Manual substituted loads recalibrate instead of becoming engine proposals. Symptom, session, outlier, and effort order matches the PRD table.

This review uses only the supplied sources, the prior review, the PRD, and the 181-test / typecheck receipts. It does not re-run tests, re-hash files, or certify UI, persistence, compiler, or clinical policy.

---

## Prior finding closure

| ID | Prior defect | Verdict | Evidence |
| --- | --- | --- | --- |
| BLOCK-1 | Distinct decisions shared one `decisionKey` | **Closed** | `decision.ts:54-77` hashes `kind`, `reasonCodes`, `subjectId`, full `eligibility` (includes `sourceRevisionId` and window), prescription/series, inventory, source revisions, acknowledgements, and proposal. `now` is omitted on purpose. `decision.test.ts:623-644` proves empty-source `calibration_required` / `acute_stop` / `eligibility_unanswered` keys differ, same-outcome later `now` keeps the key, and the 14-day gate changes it. |
| BLOCK-2 | Progression parser dropped the 1000 kg bound | **Closed** | `validation.ts:28-31, 43-50` apply `isEnteredLoadAtMostCanonicalKg(..., '1000')` to prescribed, actual, accepted, bar/collar/plate, dumbbell, and stack loads. `decision.test.ts:683-696` rejects `1000.001` kg in all three places. |
| WARN-1 | Constrained `authorized` behaved as `eligible_general` | **Closed** | `decision.ts:175-180` never returns `null` for `cleared_with_constraints`. Matching `authorized` still yields `eligibility_constraints_unavailable`. `decision.test.ts:511-530`. |
| WARN-2 | `eligible_general` snapshot lacked window, supersession, origin | **Closed** | `eligibility.ts:173-183` require `source`, `effectiveFrom`, `effectiveUntil`, `supersededAt`. `decision.ts:159-168` rejects synthetic, not-yet-effective, expired, and superseded snapshots. `decision.test.ts:698-710`. |
| WARN-3 | Recalled/imported history could enter the evidence window | **Closed** | `types.ts:68-71` add closed provenance. `decision.ts:307` keeps only `in_app`. `isComparableCompleted` also requires `in_app` (`decision.ts:227-228`). `decision.test.ts:646-655`. Profile still forces `progressionEvidenceEligible: false`. |
| WARN-4 | History unit/basis rules untested | **Closed** | `profile.test.ts:162-216` reject lb-on-kg inventory and `barbell_total` on dumbbell inventory. |
| WARN-5 | Session lifecycle ran before symptom | **Closed** | `decision.ts:312-314` holds `adverse_symptom_hold` before session/stale/invalid. `decision.test.ts:266-285`. |
| WARN-6 | Outlier math skipped when actual equalled prescribed | **Closed** | `decision.ts:351-357` compares performed load to the last accepted actual whenever a prior comparable exists. `decision.test.ts:670-681`: prescribed and performed 80 kg after accepted 60 kg → `unconfirmed_outlier_hold`. |
| WARN-7 | One-rep adopted a substituted performed load | **Closed** | `decision.ts:348-350, 360, 378-380`: any `performed ≠ prescribed` sets `calibration_required` after outlier handling. `decision.test.ts:408-421, 423-439, 451-458`: 70/72 kg recalibrate; acknowledged 75 kg recalibrates; it does not emit `one_rep_progression`. |
| WARN-8 | Working ordinals had to be `1..n` after warm-ups | **Closed** | `decision.ts:199-201` checks count and unique ordinals only. `decision.test.ts:657-668` accepts working ordinals 3–5. |
| WARN-9 | Dual authorization vocabularies; generic `available` must not clear constrained | **Closed as designed** | Generic `EligibilityAuthorizationV1` still cannot be `available` except `eligible_general` + `supported` (`eligibility.ts:198-205`). Progression uses a separate required-window extension and still refuses constrained proposals (WARN-1). |
| WARN-10 | `machine_stack` is resistance-only | **Closed for V1** | No assistance basis. `decision.test.ts:712-721` rejects extra `application: 'assistance'` at the strict parser. Residual: add a distinct basis before any assistance catalog item. |
| WARN-11 | Chronology used a different error type | **Closed** | Chronology lives in `validation.ts:194-208`. Failures throw `ProgressionInputValidationError`. `decision.test.ts:600-608`. Timestamps require offset-true ISO and a trailing `Z` (`validation.ts:11`). |
| WARN-12 | Tests covered only 163 cases | **Closed as a blocker; residual gaps below** | Packet receipt: 181 passed. New tests cover the former BLOCK/WARN triggers. |

---

## Identity vs temporal outcomes

Idempotency is outcome-stable, not clock-stable.

- Same validated inputs and same branch → same `decisionKey`, even if `now` moves inside the gate (`decision.test.ts:634-643`).
- Crossing a temporal gate changes `kind` / `reasonCodes`, so the key changes (14-day return review).
- Distinct empty-source stops/calibrations no longer collapse to one digest (`decision.test.ts:623-632`).

That matches the PRD rule: series/epoch + rule version + ordered source revisions, with regeneration of the same inputs returning the same proposal. Raw `now` is not part of the digest. That is correct. Putting `now` in the key would break replay inside a gate.

---

## Remaining items

No remaining BLOCK in this freeze.

Residual coverage only, not a reopen:

1. **Authorization field mismatches are implemented and untested.**
   **File/line:** `decision.ts:137-149`
   **Trigger:** `eligibilityAuthorization.subjectId` / `exerciseVersionId` / `programRevisionId` / `policyVersion` disagree with the input.
   **Current behavior:** `authorizationMatches` fails → `eligibility_constraints_unavailable`. Source-revision and expiry are tested (`decision.test.ts:532-575`); the other four fields are not.
   **Fix:** Add the four mismatch fixtures. No production change required unless a later edit drops a conjunct.

2. **Exact 1000 kg is allowed and not asserted on the progression parser.**
   **File/line:** `validation.ts:29-31`; quantity primitive still has no 1000 kg cap (`quantity.ts:97-116`).
   **Trigger:** canonical `1000` kg.
   **Current behavior:** `<= 1000` accepts; `1000.001` rejects. That is the PRD bound.
   **Fix:** One exact-1000 accept fixture next to the existing reject cases.

3. **Later assistance catalog (prior WARN-10 residual).**
   **File/line:** `equipment.ts:213-230`, `decision.ts:424-436`
   **Trigger:** an assistance machine on `machine_stack`.
   **Fix:** Do not reuse this positive-load path. Add a distinct basis before any such catalog item.

Zero-rep working sets still take `invalid_log_hold` (`decision.ts:202-204, 336-338`) because completed dynamic sets require positive reps. That is fail-closed and matches the PRD completed-set rule. It is not a reopen of WARN-8.

---

## What holds (rechecked)

| Check | Result |
| --- | --- |
| Exact `1 lb = 0.45359237 kg`; `(new-prior)/prior > 0.20` | 72 kg `within_limit`, 73 kg `exceeds_limit`; exact 20% is not an outlier |
| Outlier rebuilt from entered load | `createLoadQuantity` on `entered`; forged `canonicalKg` ignored |
| Acknowledgement binds prior + actual revision ids | Pair match required; recorded on the decision |
| 5% equipment search, bar+collars, symmetric pairs | Smallest greater load; odd plate unused; 50 000-state fail-closed |
| Recalled/imported never count as in-app evidence | Provenance filter + comparable-history filter + profile `literal(false)` |
| Generic eligibility cannot mark constrained `available` | Schema + answers gate; progression never proposes on constraints |
| Acute stop, unsupported scope, unanswered, clinical review | Fail closed before proposals |
| Empty in-app history → calibration | `decision.ts:309` |
| Stale `>24h`, return `≥14d` | Exact 24h is not stale; exact 14d is return review |
| Symptom → session → invalid/outlier → unknown RIR → `6_plus` → mixed → calibration → gap → comparator → difficulty → one-rep / two-ceiling | Matches the PRD table; one-rep and two-ceiling remain disjoint |
| Manual actual ≠ prescribed | Named `calibration_required`, not a load/rep proposal |
| 1000 kg V1 bound | Profile and progression parsers; quantity primitive remains the exact decimal engine |

---

## Scoped accept / reject

| Slice | Verdict |
| --- | --- |
| `lib/training/quantity.ts` | **Accept** |
| `lib/training/equipment.ts` | **Accept** (assistance basis still future work) |
| `lib/training/contracts/profile.ts` | **Accept** |
| `lib/training/contracts/eligibility.ts` | **Accept** as an unvalidated, fail-closed contract. Not clinical clearance. |
| Progression identity, 1000 kg parser, in-app evidence, eligibility window, manual-load calibration, precedence | **Accept** |
| Progression freeze as immutable decision + V1 parser | **Accept** |

Do not treat this packet as certified for UI, persistence, live eligibility policy, or real-athlete constrained clearance. Constrained `authorized` still must not propose until a validated constraint vocabulary exists.
