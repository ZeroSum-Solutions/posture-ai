# Independent plan review: GPT-5.6 Sol

Final disposition: no remaining design blockers to the bounded contract/8-week vertical-slice work after revision. This document preserves the initial critique, then the focused followup. Initial line citations refer to the document as read at that stage and may have shifted after edits. The lead applied the final wording correction after the followup.

## Initial review verdict (superseded by the resolution audit below)

**BLOCK for broad implementation.** The scientific framing is generally bounded and the staged 8-week vertical slice is sensible, but six design blockers prevent deterministic, safe implementation. This is a product/engineering review, not clinical certification.

## Findings

1. **BLOCK — Preserving the legacy corrective engine contradicts the new scan policy.**
   The plan says to preserve existing behavior while also forbidding scan-only weakness/tightness inferences and exercise restrictions ([PRD:17](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:17), [PRD:25](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:25), [PRD:50](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:50)). Current code converts reliable warning/danger proxies into corrective priorities, tight/weak roles, and scan-derived exercise vetoes ([buildProgram.ts:119](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/program/buildProgram.ts:119), [roleCoherence.ts:33](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/program/roleCoherence.ts:33)).
   **Scenario:** a repeatable but unvalidated shoulder proxy still produces “tight” and “weak” muscle programming in the legacy workout while the new product claims scans cannot establish those states.
   **Resolution:** specify a legacy-containment/migration contract. Historical snapshots may remain playable, but new generation and science-backed surfaces must require a user-reported or coach-confirmed functional source before restriction or muscle-state language.

2. **BLOCK — “Eligible adult” has no preparticipation/clearance state.**
   Onboarding collects generic symptoms, while the progression policy only reacts to a *new* concerning symptom ([PRD:58](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:58), [PRD:80](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:80)). The annex itself says specified symptoms require medical clearance before starting or resuming exercise ([evidence:32](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-evidence.md:32)); the current player asks only about sharp or worsening pain ([WorkoutPlayer.tsx:835](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/workouts/_player/WorkoutPlayer.tsx:835)).
   **Scenario:** an adult reports existing exertional chest discomfort or a known cardiac condition; nothing defined converts that answer into a blocked assignment/start state.
   **Resolution:** add a clinically reviewed `ExerciseEligibilityV1` gate before plan creation and session start: clearance states, provenance, who may clear, expiry/reassessment, non-overridable stop conditions, and executable allow/deny tests. Exact wording can remain a later clinical contract; the gate cannot.

3. **BLOCK — The Wave 2 athlete journey is impossible under the Wave 4 access sequence.**
   The PRD promises athlete-visible programs/history and a complete onboarding→session→log journey in Wave 2, while own-account assignment, history, and offline logging are deferred to Wave 4 ([PRD:94](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:94), [PRD:203](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:203), [PRD:205](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:205)). Current workout rows are practitioner-scoped, and the public token path can hydrate/rate a session but cannot write detailed set logs ([workout_sessions.sql:114](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260702000000_workout_sessions.sql:114), [token route:18](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/api/workouts/token/[token]/route.ts:18)).
   **Scenario:** a Wave 2 athlete opens the plan, but has neither an athlete identity authorized to write logs/history nor a token endpoint permitted to do so.
   **Resolution:** choose the initial actor model. Either move minimum athlete identity/RLS/logging into Waves 1C–2, or make the first slice explicitly coach-operated and change its journeys and acceptance tests. Add an operation-by-role matrix and the coach review path for symptoms, missing RIR, plate-jump approvals, and return-to-training decisions.

4. **BLOCK — Progression comparability and several numeric branches are underdefined.**
   “Equivalent exposure” does not explicitly include the current prescribed load, exercise/content version, equipment identity, ROM, set count, side, or tempo ([PRD:117](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:117), [PRD:124](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:124)).
   **Scenario:** 55 kg 3×8 followed by 60 kg 3×8 may be interpreted as two equivalent successes, authorizing another increase after only one exposure at 60 kg. Separately, two 3×8 exposures at 0–1 RIR satisfy neither the load-increase branch nor the “add a rep” branch because every set is already at the ceiling.
   **Resolution:** freeze a comparator key and a total ordered decision table covering every valid state, including ceiling reps at excessive effort, started-but-stale sessions, substitutions, retrospective edits, and undulating tracks.

5. **BLOCK — Log validation and load-reduction authority lack deterministic limits.**
   The PRD blocks an “invalid log” but never defines valid domains; “conservative load reduction” has no amount or cap ([PRD:123](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:123), [PRD:126](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:126), [PRD:133](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:133)).
   **Scenario:** a mistyped 600 kg set, fractional/negative reps, out-of-range RIR, or impossible assistance value can enter progression; different implementations can then recommend materially different reductions.
   **Resolution:** define per-field ranges and precision, integer rep/RIR semantics, assistance/bodyweight rules, extreme-change confirmation, and a versioned reduction rule—or route all reductions to explicit coach decisions. Add expected outputs, not only reason-code assertions.

6. **BLOCK — “Feasible valid plan” is not an executable oracle.**
   PR-01 tests all cycle/day/time/equipment combinations but does not define feasibility, goal-specific behavior, minimum weekly coverage, rest-day constraints, or a session-duration calculation ([PRD:100](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:100), [PRD:223](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:223)).
   **Scenario:** identical users selecting “strength” and “general fitness” may legally receive identical plans, and both a 30- and 60-minute session can pass because no expected dose or time budget is defined.
   **Resolution:** require a bounded `ProgramTemplateV1` contract before Wave 1B. It may live outside the PRD, but must define goal mappings, weekly exposure/coverage rules, session-time accounting, schedule constraints, equipment insufficiency, and expected fixture outputs.

7. **BLOCK — Conditioning adaptation is promised before it is designed.**
   The PRD promises separate comparability and next-week conditioning advice, and includes conditioning in the first 8-week milestone, but defers conditioning progression to Wave 3 ([PRD:148](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:148), [PRD:154](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:154), [PRD:204](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:204), [PRD:255](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:255)).
   **Scenario:** two completed 15-minute easy cycling bouts have no deterministic next target; incomplete bouts, effort changes, and outside activity are also unresolved.
   **Resolution:** either include a bounded `ConditioningDecisionV1` in Waves 1B–2 or explicitly make first-milestone conditioning static and remove adaptive-conditioning acceptance until Wave 3.

8. **WARN — The deload evidence map misses a directly relevant 2026 trial.**
   The annex relies on a 2024 complete-cessation trial while recommending reduced sets/effort ([evidence:27](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-evidence.md:27)). A 2026 randomized within-subject study tested reduced volume/frequency and reported similar hypertrophy and 10RM changes in 19 untrained young men, with substantial limitations ([Scientific Reports](https://www.nature.com/articles/s41598-026-40612-5)). This does not invalidate the conservative policy, but it is the closer source for that policy and should be added.

## Required resolutions

Resolve findings 1–3 before schema/UX freeze; 4–7 before implementing the deterministic compiler. Expand PR/CO/DA acceptance fixtures with exact inputs and outputs for each resolved state.

## Remaining nonblocking decisions

- Exact 4/6/12-week templates and undulating prescriptions can remain Wave 3 contracts.
- The e1RM equation/range is safely deferred because it has no load authority.
- Media sourcing can remain pending, but the media contract should define reviewer qualification, checklist, and version-change invalidation before ME-01 is implemented.
- The central scientific summaries checked against the cited publication records were accurately bounded, including the [2026 ACSM position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/), [RIR accuracy review](https://pubmed.ncbi.nlm.nih.gov/34542869/), [concurrent-training analysis](https://pubmed.ncbi.nlm.nih.gov/34757594/), and [posture-causality review](https://pubmed.ncbi.nlm.nih.gov/31451200/).

No files were edited.



---

## Focused resolution audit

| # | Previous finding | Status | Resolution evidence |
|---|---|---|---|
| 1 | Legacy corrective behavior contradicted the scan policy | **RESOLVED** | Historical playback is separated from new generation; unsupported claims are not preserved, legacy inference cannot enter strength templates, and exposed legacy paths require audit/disablement before athlete release ([PRD:46](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:46)). |
| 2 | No eligibility or medical-clearance state | **RESOLVED** | The five-state eligibility machine, fail-closed missing answers, clearance authority, fresh-symptom invalidation, and no acknowledgment bypass are explicit ([PRD:97](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:97), [PRD:320](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:320)). |
| 3 | Athlete journey impossible under access sequencing | **RESOLVED** | Athlete identity and online logging moved to Waves 1C–2; offline/multi-device work is correctly deferred. The actor matrix distinguishes self-directed ownership, coach-assigned publication, and prohibited token access ([PRD:176](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:176), [PRD:284](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:284)). |
| 4 | Comparator and load-epoch progression were ambiguous | **RESOLVED** | The series key, same-load epoch, consumed evidence, idempotent acceptance, stale-proposal invalidation, and post-change evidence reset are defined ([PRD:170](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:170)). The total decision table covers ceiling reps at excessive effort and stale sessions ([PRD:192](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:192)). |
| 5 | Numeric domains and reduction authority were undefined | **RESOLVED** | Load/reps/RIR domains, per-exercise limits, outlier confirmation, assistance/bodyweight separation, and exact conversion are specified. Difficult exposures now produce review, not an invented decrement ([PRD:190](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:190), [PRD:207](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:207)). |
| 6 | `ProgramTemplateV1` lacked an executable oracle | **RESOLVED** | Goal mappings, weekly coverage, schedule constraints, time arithmetic, insufficiency outcomes, and exact fixtures now precede compiler implementation ([PRD:131](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:131), [PRD:325](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:325)). |
| 7 | Conditioning adaptation was deferred beyond the first milestone | **RESOLVED** | `ConditioningDecisionV1` now defines a bounded two-bout duration rule, holds, caps, and excluded intensity/frequency changes; it is assigned to Wave 1B with exact fixtures ([PRD:232](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:232), [PRD:284](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:284), [PRD:326](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:326)). |

## Remaining BLOCKs

**None.** The plan is ready to begin the bounded contract and 8-week vertical-slice work.

One nonblocking editorial cleanup remains: [PRD:165](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-prd.md:165) still says “propose … a conservative load reduction,” while the controlling authority and decision-table sections correctly specify review with no automatic decrement. Align that sentence to prevent implementer confusion.

The revised annex adequately records the Pancar 2026 study and its narrow applicability ([evidence:35](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-09-07-strength-conditioning-evidence.md:35)).

Still correctly gated—not passed—are clinical approval of eligibility/symptom language, scan reliability and construct-validity studies, exercise/media review and rights clearance, and later 4/6/12-week, undulating, offline, and multi-device contracts. This remains a plan review, not clinical certification.
