# Grok4.6 contract followup

Document-only independent review via grok.com OAuth. Requested grok-4.6; returned grok-4.6-build. Stop reason: end_turn.

The revised PRD, lead dispositions, and Wave 1C execution plan close the original access and numeric holes well enough that Wave 1B/1C engineering contracts can freeze after two surgical patches. Clinical wording, measurement validity, media rights, and human usability stay unproven. That status must stay labeled. It does not block synthetic contract tests or unrelated persistence work.

This is a document-only consistency review of the supplied texts. It is not runtime, source, literature, or clinical verification.

## Verdict

- **Wave 1B programming oracle + Wave 1C identity/online-log contracts:** freeze-ready after the two minimal fixes below.
- **Live athlete activation / Wave 2:** still blocked on the named clinical policy table, reviewed media/rights, and Wave 1A disable-or-close. Those are already labeled. Do not relabel them as approved.
- **Full goal (4/6/12-week cycles, undulation, offline/multi-device, measurement studies, usability eval):** still in the plan. They are not first-slice engineering freeze blockers.

The earlier 60 kg → 70 kg example is **16.67%**, not greater than 20%. The revised outlier rule is `(new - prior) / prior > 0.20` with exact 20% excluded. That correction is accepted.

Pregnancy-specific programming stays out of scope. Pregnancy or postpartum status is **not** a blanket finding that general training is unsafe.

## Historical findings

| ID | Status | Remaining concrete contradiction |
|---|---|---|
| **BLOCK-1** | **resolved** | Original hole is closed: `training_subjects.owner_user_id` from Auth, no hidden practitioner, no required `clients` row, share token / request `practitioner_id` / `actor_user_id` grant nothing, AAL2 retained, RLS is read-only defense-in-depth, writes are server-side JWT-derived. See **NEW-1** for a succession gap that appears only after this model exists. |
| **BLOCK-2** | **resolved** | Adult-scope `confirmed_18_plus \| minor \| unknown` is now collected. `minor` or `unknown` denies assignment/start. Specialized-programming scope is a separate `supported \| outside_release \| unanswered` result. Pregnancy/postpartum is an input to the reviewed policy and is **not** hard-coded as `eligible_general` or as exclusion. The old required test “pregnancy flagged → not `eligible_general`” is **withdrawn**. Remaining live branch table belongs to WARN-1, not this block. |
| **WARN-1** | **partially resolved** | States, fail-closed start rule, answer/decision split, and “UI cannot submit decision state” are specified. The activity × disease × symptoms × intensity × pregnancy **answer→state table** and a **closed compiler-readable constraint vocabulary** are still absent. That remains a live-athlete blocker. It is an accepted deferral for labeled synthetic fixtures. |
| **WARN-2** | **resolved** | Recalled/imported sets may seed familiarization only. They never enter the two-exposure window. Calibration/warm-ups/unscheduled sets do not qualify. |
| **WARN-3** | **partially resolved** | Load increase now requires both window exposures, identical working load, all prescribed working sets at ceiling, target RIR or easier. Rep +1 uses only the most recent qualifying exposure, one total rep on the earliest below-ceiling set. One success at a new load blocks load increase only. **Remaining:** the ordered decision table puts `Unfinished/aborted session, incomplete instance` in one first-match row. If that row is session-global, it poisons completed instances and contradicts PR-07 / the prose that an explicitly completed session with omissions may still evaluate other completed instances. The table also has **no `mixed_working_load_review` row**, so mixed 60/60/62.5 can fall into the +1-rep branch. |
| **WARN-4** | **resolved** | `6_plus` is observed, not missing. Ceiling `6_plus` → `effort_too_easy_recalibration`. Unknown → hold with a specific reason. Neither earns two-success load advancement. Original values are preserved. Residual only: dispositions name `effort_unknown_hold`; the PRD table does not. `6_plus` on a below-ceiling exposure can still match “target or easier” and earn +1 rep. |
| **WARN-5** | **resolved** | 5% caps automatic proposals only. Every initial/recalibration target needs explicit unit / load-basis / equipment confirmation, including 60 → 70 kg. Outlier acknowledgement is only `(new-prior)/prior > 0.20`. Calibration does not consume progression evidence and is never stored as an engine recommendation. |
| **WARN-6** | **resolved** | Two-bout template has 30 min/bout and 60 planned min/week ceilings. Formula then fit: `min(2, floor(min(4, 0.10 × prior completed weekly minutes) / 2))`. CO-03 10→11, 20→22, 29→30, 30→hold is consistent. Off-day conditioning is allowed and is not a strength session. Extra-gym activity does not complete a bout. Athlete must accept 1–20 min starting duration. |
| **WARN-7** | **resolved** | `reliable` is capture-quality, not repeatability or a lift ban. Strength generation uses only the new adapter. Unvalidated proxies stay descriptive. Optional preparation is preference-gated, not scan-volume. Wave 1A must be closed or disabled on the strength path before athlete release; that is a Wave 2 gate, not a Wave 1B freeze hole. |
| **WARN-8** | **resolved** in the PRD | Normative precedence names annex RIR, coach-only sequencing, and 4-week-first as superseded. Annex files were not in this packet, so annex headers themselves are unverified. Workers must implement from this PRD and frozen fixtures only. |
| **WARN-9** | **resolved** | Online athlete-versus-coach revision conflicts are in the first athlete release (Wave 1C/2). Offline outbox stays Wave 4. DA-02 is required now. |

### NITs

| NIT | Status |
|---|---|
| 1 PR-02 as `3×6–8` performed `8/8/8` → 62.5 kg starting `6/6/6` | resolved |
| 2 “up to two minutes per bout” | resolved |
| 3 first matrix is 8 weeks × 2/3/4; 4/6/12 and undulation remain Wave 3 / full goal | resolved |
| 4 e1RM out of first slice; later descriptive metric still in full plan | resolved |
| 5 4 s/rep is a planning heuristic, not a forced timer | resolved |
| 6 first release is only strength and general-fitness entry templates | resolved |

## Semantics check

**Comparator.** Load increase: two most recent qualifying in-app exposures in the current series/load epoch, same working load, every prescribed working set at ceiling reps, target RIR or easier, no symptom flag, no mixed load. Apply smallest achievable increment within 5%, reset reps to the low end. Rep +1: most recent qualifying exposure only; all working sets in range and at target or easier; add exactly one total rep to the earliest below-ceiling set. Recalled history, calibration, warm-ups, extras, unfinished/aborted sessions, and incomplete instances do not qualify. Set count does not change in an automatic step.

**RIR.** Domain is integer 0–5, `6_plus`, or `unknown`. Optional to record; required for autonomous load advancement. Unknown blocks load and rep progression. `6_plus` blocks load increase via recalibration. 0–1 RIR against a 2–3 target is excessive effort (hold, then review after two). Annex `0..10` is not the contract.

**Calibration / outlier.** Three different gates: (1) automatic +5% cap, (2) actual-load outlier only if `(new-prior)/prior > 0.20`, (3) every initial/recalibration confirmed even at 16.67%. Zero/unknown prior never divides; it calibrates. 60 → 72 kg is exact 20% and is **not** the outlier branch.

**Equipment.** Barbell total = configured bar + collars + symmetric plate pairs; plate mass is per side. Dumbbells are per-hand. Machine stacks are tied to exact equipment ID. Choose the smallest achievable greater load that still respects the cap; if the jump exceeds 5%, hold. Assistance is nonnegative and has no V1 percentage-load progression. `1 lb = 0.45359237 kg`. Store entered decimals; do not persist IEEE floats.

**Time.** Unfinished session is stale only if elapsed start → now **> 24 h** (exactly 24 h is not stale). Return review at **≥ 14** elapsed days since the latest comparable completed exposure. Elapsed arithmetic uses supplied UTC; scheduling uses athlete-local date/timezone. Reject future or inconsistent chronology. Planning estimate matches the 1400 s / 2520 s oracles.

**Conditioning.** Two planned bouts, default 10 min after athlete acceptance, 1–20 min allowed. Progress duration only, using the formula above, then clamp to 30/bout and 60/week. Incomplete or missing effort holds **both**. Off-day is valid. Extra-gym activity is context only.

**Ownership / RLS.** Athlete owner is `auth.uid()` on an active non-deleted subject plus AAL2. Coach access is an active AAL2 practitioner plus an active `coaching_relationships` permission. Authenticated direct writes are revoked. Invitation class is exclusive: practitioner branch unchanged; athlete branch never creates a practitioner; ambiguous/absent invites fail closed.

**Online conflicts.** Unique `(actor_user_id, request_id)`; same payload retries return the original receipt; different payload is conflict. Two writers at revision N: one commits, the other gets the current safe projection. No last-write-wins.

**Erasure.** Legacy client erase removes practitioner client data, `client_accounts`, coaching access, and pending coach proposals. It keeps the athlete subject and history. Subject erase is a separate owner request. Neither path silently converts a coach-authored prescription into self-directed load authority.

## New narrow blockers

Do not treat these as new product requirements. They are contradictions inside the settled texts.

**NEW-1 — Unlink succession is named as forbidden conversion, not as a replacement operation.** After coach unlink / client erase, mode must not flip to self-directed, history must remain, and the athlete cannot publish a higher coach-owned target. The texts never say how a still-active `coach_assigned` assignment becomes a new self-directed assignment the athlete may publish. Wave 1C cannot implement both “no silent conversion” and “self-directed owner can publish” without that operation.

Minimal fix: on unlink/client-erase, the coach assignment becomes historical (`ended` / `unassigned`). Old prescriptions stay immutable. The owner may `program:self_publish` a **new** assignment. Logging against historical coach sessions remains allowed; publishing into them does not.

**NEW-2 — Decision table grain and mixed-load row.** Freeze the oracle as per-series after session completion, not session-global:

1. Ineligible / acute / affected-movement stop → session-wide stop.
2. Unfinished or aborted session → session-wide hold.
3. Per incomplete instance / unknown RIR / invalid / unconfirmed outlier / `6_plus` ceiling → hold or recalibrate **that series only**.
4. Mixed working load → `mixed_working_load_review` for that series; do not take the +1-rep branch.
5. Then load / rep / hold rows as written.

Also: `6_plus` on any working set blocks autonomous **rep** progression as well as load increase, or the table must say the opposite explicitly. Unknown already blocks both.

No other new first-slice blockers. Catalog/media roster, 4/6/12-week matrices, offline replay, measurement studies, and usability 4/5 remain full-goal evidence, not Wave 1 freeze gates.

## Unproven, not approved, not blocking for this freeze

| Item | Required label | Blocks |
|---|---|---|
| Eligibility branch table, constraint semantics, urgent-help wording | unvalidated; named clinical owner | live assignment/start, not schema/compiler/synthetic fixtures |
| Scan clinical validity / repeatability | engineering proxy only | scan-derived restrictions, not a no-scan general plan |
| Media rights, filming, licenses | not purchased; pipeline ≠ clips | Wave 2 launch roster, not contract schemas |
| Human usability 4/5 and 10-second logging | eval, not a current pass | Wave 2/5, not Wave 1B |

Synthetic fixtures may exercise `eligible_general` / `cleared_with_constraints` / `acute_stop` if labeled synthetic. They do not clear a real athlete.

## Freeze conclusion

**Yes — freeze the settled engineering contracts** (ProgramTemplateV1 / ProgressionDecisionV1 / ConditioningDecisionV1 / ScreeningContextV1 adapter policy / subject-ownership / online mutation receipts) **after NEW-1 and NEW-2**.

Do not freeze, and do not call approved: the clinical answer→state table, user-facing symptom copy, measurement validity, production media rights, or human-outcome claims.

Proposed freeze pack:

1. Apply NEW-2 to the ordered decision table and add mixed-load plus per-instance omission fixtures (8/8/8 then 8/8/7; 60/60/62.5; accessory omitted after explicit session complete; `6_plus` vs `unknown`; exact 20% vs >20% using 60→72 vs 60→73, **not** 60→70).
2. Apply NEW-1 assignment-status transition in the Wave 1C identity contract.
3. Keep WARN-1 as a fail-closed live gate: no current approved decision ⇒ start denied. Constraint schema: closed `limitationKind` plus unknown-code ⇒ `needs_template_adjustment`.
4. Annexes stay advisory. Fixtures live only with the PRD.

After those patches, Wave 1B and Wave 1C can start from one contract owner. Independent review of the oracle fixtures is still required before workers implement compilers or migrations. This followup does not certify the product, the scan engine, or any training outcome.

## Lead disposition after review

NEW-1 is implemented in PRD section8 and the athlete execution plan: ended coach assignment remains historical; self-directed continuation requires a new assignment. NEW-2 is implemented in section5: decision scope is per exercise series after explicit session completion, mixed loads precede rep progression, and unknown/6_plus cannot advance. Localized movement symptoms hold the affected series; they do not imply a session-global acute stop. The specific unfinished-session >24h branch precedes the generic unfinished branch. Both advisory annexes now explicitly defer to the normative PRD.

Settled engineering contracts may proceed. Clinical policy/constraint validation, media rights/review, real-device and human outcome evidence remain unproven. This review and its dispositions do not certify runtime behavior.
