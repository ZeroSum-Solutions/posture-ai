# Posture AI: screening-informed strength and conditioning

Status: approved by Devin for goal-driven implementation on 2026-09-07. The lead has dispositioned the external Grok 4.6 findings and this revision incorporates the programming, ownership and scope decisions below. Eligibility clinical validation remains unmet and must stay labeled that way, but it does not block unrelated contract, compiler or persistence work against synthetic fixtures. Implementation is in progress. The original-app eight-week flow is being integrated; broader release criteria remain pending until their evidence is recorded. Prepared 2026-09-07 for Devin. Integration baseline: `ce18f8a67969a68c065875ad4460b161ac04435b` in the existing Posture AI application.

## 1. Product decision

Build a complete strength-and-conditioning experience within the existing application: choose a goal and schedule, understand the plan, perform sessions, log actual work, and see a reasoned next-session/next-week recommendation. Screening is one contextual input. Training history, actual performance, symptoms, available equipment, preferences, and coach-confirmed limitations determine the usable program.

The product promise is “a clear plan that adapts to your training,” not that a photograph diagnoses weakness, predicts injury, or establishes a safe lifting load. A normal scan, missing scan, or unusable finding must not make general strength programming impossible. An unclear scan offers a retake and excludes that observation from adaptation; it does not label the person incapable.

Working audience assumption: adults using the two reviewed entry templates, strength or general fitness, with optional coach support. The first athlete-facing release includes self-directed programs as well as explicitly coach-assigned programs. A self-directed athlete owns a training subject through their verified Supabase Auth identity; they do not need a fictitious practitioner or a legacy `clients` row. A coach link is optional and grants only the permissions recorded by that relationship. Athlete account access is an explicit prerequisite for the first athlete-facing release. Coach-only internal testing can happen earlier, but it must not be presented as independent athlete use. Specialized rehabilitation, return-to-sport clearance, minors, pregnancy-specific programming, elite competition peaking, nutrition, wearables, social feeds, and automatic real-time technique grading are outside this release. Pregnancy or postpartum status does not itself establish a contraindication or clinical clearance; the product asks whether the athlete needs unsupported specialized programming and follows the versioned eligibility policy.

### Approaches considered

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Extend the current corrective-session selector | Smallest change | No whole-body cycle, quantified training history, or independent plan when findings are empty | Keep for optional preparation/accessories only |
| Deterministic program engine, verified catalog, performance-driven progression; bounded AI explanation | Testable prescriptions, replayable decisions, works without AI | Requires new program and set-log contracts | Recommended |
| Free-form AI coach invents each cycle from scan results | Fast-looking prototype | Unsupported scan inferences, unstable programming and hard-to-test load changes | Do not use as the numerical authority |

## 2. What exists and what needs replacing or extending

The existing Workouts UI, session player, client/assessment ownership, media fallback chain, and versioned corrective snapshots are assets to reuse. The current `strength` preference reorders corrective categories; its sessions last 10/15/20 minutes and equipment options are band/roller. It explicitly filters out barbells, dumbbells and other gym equipment. This cannot be presented as a general strength program. Evidence: [personalize.ts](../../lib/workout/personalize.ts:4), [equipment filtering](../../lib/workout/personalize.ts:46), [goal ranking](../../lib/workout/personalize.ts:54).

The current assessment builder consumes findings, assessment grade and coach overrides, then produces a playable corrective session. Preserve this legacy behavior behind its existing contract; add a separate typed strength-and-conditioning program engine within the same product. Evidence: [buildSessionFromAssessment.ts](../../lib/workout/buildSessionFromAssessment.ts:26).

The scan engine documents several measurements as engineering proxies with validation still pending. `reliable` is a measurement-quality flag, not proof of clinical validity or of an exercise restriction. Evidence: [threshold provenance](../../packages/posture-engine/src/thresholds.ts:24), [priority eligibility](../../lib/program/selectPriorities.ts:49).

**Normative precedence:** this PRD and its frozen contract fixtures control implementation. Every linked annex is advisory and superseded wherever it conflicts with this document, including candidate RIR ranges, coach-only sequencing or a 4-week-first milestone.

Detailed audit annexes:

- [Scan, interpretation and programming audit](2026-09-07-scan-programming-audit.md).
- [Programming evidence and proposed defaults](2026-09-07-strength-conditioning-evidence.md).
- [Current product, schema and media gaps](2026-09-07-strength-product-gap-audit.md).

## 3. Audit first: what a scan is allowed to contribute

The completed source audit found one narrow software defect fixed in checkpoint `bd94785`: incomplete assessments could be approved and used to build workouts. It also found three first-phase gaps: operator-declared views are not verified against the image; workout selection loses uncertainty/construct metadata; and some report/comparison language is stronger than the validation evidence. See the scan annex for exact source citations and test receipts. Those remaining gaps are not represented as fixed by the status-gate patch.

The existing engine's clinical validity and real re-stance repeatability are not established by this repository's current evidence. This is why automated scan-derived exercise restrictions stay disabled in the proposed strength engine while the general training product progresses independently.


Trace the entire chain: original capture/upload → view identification and image orientation → exact frame/landmarks → coordinate transformation → measurement → uncertainty/validity → stored finding → report language → programming input. Every persisted finding must resolve to its immutable capture/frame manifest and engine/model version. Current production processing posts landmarks rather than photographs; keep that privacy boundary by default. A source hash/manifest records association but does not let the server independently reverify pixels. Raw images for reproducible validation are retained only in an explicitly consented evaluation dataset, with access and retention controls; do not introduce production photo storage as an incidental audit change. Fix proven code errors with a failing/passing regression; keep missing validation evidence explicit rather than inventing numerical corrections.

### Legacy behavior and first-release scope

Legacy compatibility means preserving historical saved prescriptions and playback, not preserving unsupported claims or allowing a new generation path to bypass the new policy. Before the athlete-facing strength release, audit every entry into preview, mint, copy/regenerate, reports and comparison views. New strength generation must consume only the new screening adapter and program compiler. Do not feed the legacy top-three corrective-priority selector into a strength template.

For existing report/history views, preserve the original record but add adjacent version/measurement context; present engineering-score differences as descriptive changes rather than validated improvement. New report text must be observational until a causal/response claim has an applicable evidence record. Existing corrective generation stays explicitly coach-reviewed and separate from strength-load decisions. Reusing its media/player presentation does not reuse its inference policy. The scan audit's open view-identity, metadata and copy work is wave 1A; it must be closed or explicitly disabled for the new exposed path before athlete release.

### Screening contract

Proposed `ScreeningContextV1` contains assessment ID, subject ID, captured-at time, input modality, source view IDs and image hashes, source dimensions, orientation/mirror transforms, camera protocol, pose model/engine versions, and an array of observations. Each observation includes metric definition and units, value or unavailable reason, side, contributing views, measurement-quality flags, repeatability evidence reference if available, construct-validity status, and threshold provenance.

Do not compress all of this into one confidence percentage. Distinguish:

1. Capture quality: are the required anatomy and views visible and associated correctly?
2. Repeatability: does the measurement remain stable under repeated measurement under the defined protocol?
3. Agreement/validity: does it measure the named construct against a suitable independent reference?
4. Actionability: is there evidence and contextual confirmation supporting a programming change?

Initial action policy is deliberately narrow:

| Input | Permitted effect | Must not do |
| --- | --- | --- |
| Missing/low-quality/unsupported static observation | Retake suggestion; show unavailable; no load change | Substitute zero/normal, invent certainty, ban a lift |
| Repeatable static observation without confirmed functional limitation | Optional assessment question or coach review; optional low-dose preparation chosen with user preference | Infer muscle weakness/tightness, predict injury, downgrade strength capacity |
| User-reported intolerance or coach-confirmed task limitation | Offer compatible exercise/ROM/equipment alternatives; preserve training intent; document reason | Claim the image established a diagnosis |
| Actual set performance and effort | Adjust the next equivalent exposure within policy | Rewrite a completed session or guarantee next-week performance |
| New concerning symptom | Stop the affected activity and route to the appropriate review pathway; urgent symptoms get an urgent-care message | Let a good posture score or AI override the symptom |

A symptom flow must distinguish acute concerning symptoms from routine exertion. Its wording and escalation policy need a qualified clinical reviewer. An exercise-specific restriction needs source, author, date, scope and review date; it cannot originate solely from an unvalidated static proxy. No automatic asymmetric loading from an asymmetry score.

This boundary follows the distinction in the literature: posture associations do not establish causality for low-back pain ([Swain et al., 2020](https://www.sciencedirect.com/science/article/pii/S002192901930524X)); a review of static-posture assessments found limited validity and no responsiveness evidence among the included studies ([Woldendorp et al., 2022](https://pubmed.ncbi.nlm.nih.gov/34366318/)). Neither review validates this application. The proposed program policy is a product inference from these limits, not a finding of either paper.

### Measurement validation gates

- Geometry fixture suite: equivalent images at different resolutions/aspect ratios, EXIF orientations, camera-facing/mirror modes, and known landmark transforms must produce equivalent canonical measurements within numeric tolerance. Explicit laterality assertions prevent a visually plausible but reversed result.
- Capture integrity: every view's stored image, dimensions and landmarks come from the same accepted frame; interrupted/retried capture cannot reuse another subject/view's data. Missing, duplicate and mislabeled views produce a specific response.
- Quality edge suite: occlusion, low landmark visibility, missing confidence, no pose, body crop, camera roll, malformed/NaN/out-of-range coordinates, contradictory side views and stale model versions. Unavailable must survive storage and UI rendering.
- Reliability study: independent repeated captures with repositioning, multiple raters/devices and representative participants. Report within-subject error, bias, Bland–Altman limits of agreement and appropriate ICC with confidence intervals. Reprocessing one photograph is a software-repeatability test, not human test–retest evidence.
- Construct validity is per metric: use a reference measuring the same anatomical construct, blind the readers, separate development from held-out evaluation, quantify missingness and device/subgroup error. Comparison with another unvalidated app is not ground truth.
- Before a study, register metric-specific maximum acceptable error and decision purpose with a measurement specialist. Do not manufacture a universal degree tolerance or accuracy percentage in this PRD. Until a metric has an approved protocol and passes it, keep it descriptive and outside automated programming constraints.
- Only label a longitudinal change meaningful when the acquisition protocols are comparable and a validated change threshold exists; otherwise show descriptive variation without a “fixed/improved” claim.

## 4. User experience

Keep one application and existing visual identity. Use a spacious desktop program workspace and stacked mobile flows, with real screenshots of populated, empty, loading and failure states.

### Onboarding → program

Collect the minimum useful information: strength/general-fitness goal, experience and recent consistency, days available (2/3/4), session duration (30/45/60 minutes), equipment and actual load increments, preferred conditioning modes, exercise familiarity, relevant symptoms/limitations, and optional recent working sets. Explain why each field is needed. Recalled or imported working sets may inform a familiarization suggestion, but they never count as either of the two qualifying in-app progression exposures. Do not require a 1RM test or invent a starting load from age, appearance, sex or scan score. Reported experience changes familiarization questions, not access to unreviewed advanced or low-rep templates; the first release exposes only the strength and general-fitness entry templates.

Default recommendation: a simple full-body plan at 2–3 strength days; offer an upper/lower structure for 4 days. The user sees the full cycle, this week, today's session and a short “why this plan” explanation before starting. When availability cannot accommodate the requested dose, suggest a feasible smaller plan rather than silently dropping rest or compressing work.

### Eligibility and symptom state machine

Before assigning the first live program, collect an explicit adult-scope answer (`confirmed_18_plus | minor | unknown`), current activity, known cardiovascular/metabolic/renal disease, relevant signs/symptoms, desired exercise intensity, uncertainty, pregnancy/postpartum context, and whether the athlete is requesting specialized programming outside the supported entry templates. Implement a versioned preparticipation policy reviewed by a qualified clinician, based on the [ACSM/Exercise is Medicine screening tool](https://www.exerciseismedicine.org/assets/page_documents/EIM%20exercise%20preparticipation%20screening.pdf). It is separate from scan quality and document-signing gates. A minor or unknown adult-scope answer makes assignment/start unavailable. A request for unsupported specialized programming follows a neutral unavailable/review path. Pregnancy or postpartum context is an input to the reviewed policy and is not hard-coded as either `eligible_general` or a blanket exclusion.

Eligibility states are `unanswered`, `eligible_general`, `needs_clinical_review`, `acute_stop`, and `cleared_with_constraints`. A separate scope result records `supported | outside_release | unanswered`, so product scope is not misrepresented as a diagnosis. Missing or contradictory answers cannot be silently treated as eligible; users can view educational material and draft choices while assignment/start remains unavailable. Live assignment/start requires `scope=supported` plus `eligible_general` or a current `cleared_with_constraints` decision. Historical disease answers are not an automatic emergency; the policy uses activity, symptoms and intended intensity together. Typed constraints record source, author/reviewer scope, effective time, review/expiry conditions and compiler-readable limitations; the UI cannot submit its own decision state.

Concerning acute symptoms such as exertional chest discomfort, fainting or severe unusual breathlessness stop the entire exercise session and show an urgent-help action appropriate to the context. A new localized musculoskeletal symptom stops the affected movement and routes to review; it does not by itself diagnose a condition. Routine exertion and delayed soreness are recorded separately. Exact wording/triage is a named clinical-policy deliverable with test fixtures before pilot, not left to AI.

Only a qualified reviewer with the appropriate scope can record clearance when required, with source, date, scope/constraints and review/expiry conditions. A coach's normal program edit cannot clear an acute stop or medical-review state. Fresh symptoms supersede prior clearance; a scan or prior successful lift cannot clear the state. Do not add an “acknowledge and continue” bypass. Synthetic internal demonstrations may use labeled fixtures; they do not grant a real athlete clearance. The unresolved clinical branch table and user-facing symptom/urgent-help wording remain explicit validation work; they do not prevent schema, UI state, authorization or compiler work against labeled synthetic decisions.

### Today → train → log

One exercise at a time: demonstration, setup, prescribed sets/reps/effort, previous comparable performance, suggested load, large input fields, rest timer and a visible swap/stop action. Show the whole session outline without forcing navigation through every exercise. Auto-starting a rest timer never marks a set complete. Warm-ups are separate from working sets.

Log each completed set: load, unit, reps, optional RIR (repetitions in reserve), side if unilateral, and a simple symptom flag. Time/distance-based conditioning uses its own fields. Keep a one-tap “same as last set” action, a visible edit/undo path, and a clear saved/pending-sync status. Labels explicitly say “per dumbbell”, “total barbell including bar”, or “assistance” as appropriate.

### Review → next week

Show planned versus actual sessions, working sets and reps; comparable load/rep records; effort and symptom context; conditioning minutes; and the exact recommendation with its reason. Example: “All 3 sets reached 8 reps at the target effort twice. Next time: 62.5 kg for 3 × 6–8.” A target is provisional, not a prediction or promise. Explain holds, reductions and missing-data cases as clearly as increases.

Primary navigation remains coherent: Today, Program, Exercise library and History within the workout area. Coaches retain client context; an athlete only sees their own assigned program and logs. The main app navigation need not be redesigned to deliver the first cycle.

## 5. Programming system and cycle structure

Scientific evidence informs the strategy; exact defaults below are conservative, versioned product policies to evaluate, not scientifically optimal constants. The evidence annex owns source strength and population limitations.

Base templates cover knee-dominant, hinge, horizontal/vertical push and pull as appropriate to equipment/ability, optional unilateral/carry/trunk work, and conditioning. Balance is evaluated over a week, not by forcing every pattern into every session. Alternatives are linked by training intent with explicit differences; an exercise swap is not proof of biomechanical equivalence.

Initial design defaults: 2 working sets per exercise for a new/unfamiliar movement, with 2–3 as a routine range; primary lifts use 6–10 reps and accessories 8–15, generally leaving 2–3 RIR. Rest budget is normally 2–3 minutes for demanding compound work and 1–2 minutes for accessories, adjustable upward. Count preparation work toward total session time and relevant training exposure. Do not silently assign more volume because the scan produces more findings.

A first template uses two full-body sessions per week, each with a knee-dominant movement, hinge, push, pull and optional trunk/carry. Use two working sets per selected movement, with alternatives set by equipment and tolerability. The third-day option adds a similarly balanced session only when the chosen schedule/time supports it; it is not an extra “corrective” volume tax. The 4-day option distributes the same deliberate weekly work into upper/lower days. A 30-minute session may omit optional trunk/carry, but must retain its warm-up and stated rest. This is a template blueprint; the exact launch exercise roster is frozen only after catalog and media review.

Starting load: recalled or imported history may seed a familiarization suggestion only. It cannot enter the two-exposure evidence window. Every initial or recalibration target requires explicit confirmation of unit, load basis and available equipment and remains a user/coach selection rather than an engine recommendation or safety certification. A new in-app progression series begins with completed calibration work. Technique confidence, symptom response and recovery can keep an exercise at familiarization even when the calendar advances; no default max attempt.

### ProgramTemplateV1: compiler oracle before implementation

The contract owner freezes this bounded template schema and its fixture outputs before other workers implement the compiler. Fields include goal, experience tier, allowed cycle lengths, weekly schedule, per-session movement slots, primary/accessory role, compatible reviewed exercise IDs, working sets, rep/effort bands, rest, preparation allowance, conditioning prescription, progression policy and feasibility reason codes. The athlete may select only compatible reviewed variants. Default selection follows authored preference order and then stable exercise-version ID, independent of scans. Invalid or insufficient choices return ranked alternatives for explicit acceptance; the compiler cannot fill a slot from free text.

V1 goal mapping: `strength` uses 6–10 reps on primary loaded movements, 8–15 on accessories, 2–3 minutes compound rest, strength work first; `general_fitness` uses 8–12 primary reps and 8–15 accessories with the same adequate rest and more visible conditioning scheduling. Both use two working sets initially and two manageable conditioning bouts; neither goal secretly changes because a scan grade changes. These are two deliberate entry templates, not claims of optimal rep ranges. More maximal-strength-specific low-rep work remains an intermediate template after review.

Weekly minimum for the initial 2/3-day full-body template: each required knee-dominant, hinge, push and pull slot appears in at least two sessions, with two working sets per slot/session. This yields four working sets per slot/week at two days and six at three; it does not claim equal stimulus for every muscle. The 4-day upper/lower template distributes required upper and lower slots across two corresponding days each. The catalog must explicitly mark any suitable substitution that changes coverage; missing compatible equipment/tolerable variants returns `needs_template_adjustment`, never an invented exercise or zero-length session.

Schedule rule: full-body sessions are on nonconsecutive local calendar days; upper/lower alternation leaves at least one intervening day before repeating the same required slots. This is an initial scheduling policy, not a universal biological cutoff. If requested days cannot fit, propose fewer sessions or alternative days for explicit acceptance. Preserve as many selected days as possible, then rank alternatives by number of moved sessions and lexicographic weekday order. Never silently double a missed day, move a session into a forbidden date or auto-accept an alternative. Off-day conditioning is permitted and does not count as a strength session. Store athlete timezone and local scheduled date separately from actual timestamps, and test DST and timezone travel.

Time estimate (planning heuristic): sum each dynamic working set's rep ceiling × 4 seconds, actual hold/interval durations, `(sets − 1) × prescribed rest` per exercise, 60 seconds between exercises, plus 5 minutes warm-up and 2 minutes cool-down; add any separate preparation/conditioning time explicitly. Longer coached tempo overrides the 4-second estimate. This estimate is not a timer that forces the athlete to start. To fit the selected 30/45/60-minute budget, first remove optional accessories/conditioning from that session (reschedule required conditioning), then offer a different compatible reviewed template. Never shrink rest, required coverage or preparation silently; if no solution fits, return `time_budget_insufficient` with a feasible alternative.

Oracle example: four exercises, each 2×6–10, 120-second between-set rest, gives `4 × (2 × 10 × 4 + 120) + 3 × 60 + 300 + 120 = 1400 seconds` (23m20s), so it fits 30 minutes. The same four exercises at 3×6–10 with 180-second rest give `4 × (3 × 10 × 4 + 2 × 180) + 3 × 60 + 420 = 2520 seconds` (42 minutes): reject a 30-minute request or offer the two-set template; it fits 45 minutes. A 60-minute preference permits longer rest/optional reviewed work; it does not require inventing more sets to fill the clock.

### Cycle menu

| Length | Intended use | Explicit structure |
| --- | --- | --- |
| 4 weeks | Introduction or short adherence block | Week 1 familiarization, weeks 2–3 progressive practice, week 4 submaximal review/consolidation; easier work if recovery calls for it |
| 6 weeks | First sustained cycle | Week 1 familiarization, weeks 2–5 progressive practice, week 6 review and next-cycle choice |
| 8 weeks | Default complete cycle | Week 1 calibration, weeks 2–3 build, week 4 review/adjust, weeks 5–7 build with stable key lifts, week 8 review |
| 12 weeks | Longer development | Three 4-week blocks; review at 4/8/12; changes made from adherence, performance and recovery, not automatic exercise randomization |

These lengths are planning horizons, not proven biological transformation windows. Review weeks do not require maximal testing. A deload is optional and triggered by context or coach choice; there is no claim that everyone needs one every fourth week. Never make up missed workouts by doubling the next week.

Beginner default: repeatable exercises and double progression. Intermediate option: undulating exposures (for example a heavier lower-rep day and a moderate higher-rep day for the same pattern). Preserve progression history separately by exercise, load convention, rep-range/effort prescription and exposure type; do not mistake fewer reps on a heavy day for failure relative to a volume day. V1 automatic progression changes reps or load only; prescribed working-set counts remain fixed until a documented coach/program revision. Do not change both load and set count in the same progression step. “Undulating” is an option, not a premium scientific superiority claim.

### Next-exposure decision policy V1

Order is part of the contract: eligibility/symptom check → data completeness/comparability → recovery review → goal/phase constraints → performance → equipment rounding → time/weekly-volume validation → explanation.

1. A new concerning symptom suspends automatic advancement for that exercise and starts the review flow. Missing data stays unknown, never zero. No automatic progression from an unfinished session, invalid log, unexplained substitution or unresolved sync conflict.
2. Compare the two most recent qualifying exposures in the current series/load epoch. A load increase requires every prescribed working set in both exposures at one identical working load, ceiling reps and the target RIR or easier, with no adverse symptom flag. Mixed working loads return `mixed_working_load_review`; they do not discard the difficult sets. Propose the smallest achievable increment within the configured cap and reset all target reps to the low end. RIR is optional to record but required for autonomous load advancement.
3. Rep progression evaluates the most recent qualifying exposure only. When its completed working sets stay within range and effort is at target or easier, keep load and add exactly one total rep to the earliest below-ceiling set. One exposure at a new load blocks a load increase but does not block this valid one-rep branch. Do not progress an incomplete exercise instance, a still-running/aborted session, or a terminal omission; an explicitly completed session with omissions may preserve other fully completed instances. Unknown effort holds. `6_plus` returns `effort_too_easy_recalibration`; neither value earns the two-success load advancement.
4. One below-range exposure: hold, explain and check sleep/recovery/context. Two comparable below-range exposures despite completing the session: propose a review, with no automatic decrement; an authorized reviewer or new accepted familiarization selects any achievable lower load; do not label the athlete a failure. Symptom flags never count as a normal plateau.
5. V1 automated increase cap: 5% per comparable exposure; a larger available equipment jump means hold and progress reps, or ask for coach adjustment. Default 0.5/1/1.25 kg and fractional lb values are examples only: use the athlete's inventory. Cap and evidence window are product heuristics to test. No forced increase when a valid smaller increment is unavailable.
6. More than 24 elapsed hours after session start marks an unfinished session stale. A gap of 14 elapsed days or more since the latest comparable completed exposure creates a return-session review rather than replaying a stale increase. Compute elapsed time from supplied UTC timestamps and scheduling from athlete-local dates/timezone; reject future or inconsistent chronology. A new comparator series starts with calibration. These thresholds are product policy, not physiological laws. No retroactive alteration of completed weeks after a later scan or log edit.
7. Deload suggestions require a multi-signal review (repeated performance difficulty, fatigue and schedule/illness context); propose reduced sets and/or effort, preserve user/coach choice, and do not claim an injury prediction.

### Progression state, authority and replay

A progression series is keyed by athlete, exercise/content version, exact equipment ID and load basis, side/ROM/tempo convention, prescribed working-set count, rep range, effort band and exposure type. A material change creates a new series. The evidence window contains the two most recent completed, acknowledged, non-conflicted in-app exposures within the current series/load epoch, both at the same working load and after the last applied load change. Recalled/imported history, calibration, warm-ups and extra unscheduled sets do not qualify.

Compute an increase from that verified performed load, never from a future target that has not been attempted. A decision key combines series/epoch, rule version and the ordered source-log revisions. Regeneration of the same inputs returns the same proposal and cannot compound increases. Applying a proposal is an idempotent transaction; it records consumed evidence and advances the epoch. A second increase requires two new qualifying exposures at the new load. Stale proposals become invalid if their source logs are corrected, the assignment is revoked, eligibility changes or a new program revision changes the prescription. Revalidate on acceptance/start. Historical decisions remain auditable.

V1 authority is explicit per immutable `programMode`. In `self_directed`, the eligible adult owns the program, may publish a validated initial plan and explicitly accept a bounded progression proposal. A hold is always available. In `coach_assigned`, the assigned coach publishes the initial plan and accepts/edits/rejects load/dose proposals; the athlete logs, reviews suggestions and may hold/stop but cannot publish a higher prescription. Changing modes requires a new authorized revision, not a client-supplied toggle. No background job silently changes a future prescription. The UI distinguishes “suggested next target” from an accepted “next prescribed target.”

| Operation | Athlete, own self-directed program | Athlete, coach-assigned program | Assigned coach | Other user / share token |
| --- | --- | --- | --- | --- |
| Read own plan/history and enter/edit own actuals | Yes | Yes | May review; log on behalf only with granted permission and attribution | Denied |
| Create/publish initial program | Validated own plan | Request a plan | Within active client assignment | Denied |
| Accept bounded rep/load proposal | Explicit acceptance after revalidation | Request/hold only | Within policy and assignment | Denied |
| Increase beyond policy, change exercise/dose | Review required; may choose a validated alternative/new calibration | Request only | Documented review; constraints still enforced | Denied |
| Hold, stop, report symptom | Always | Always | Can pause assigned plan | Denied |
| Clear acute/medical-review state | No | No | Only with separately verified clinical scope/clearance provenance; ordinary coaching authority is insufficient | Denied |
| Grant/revoke coach relationship | Own consent/invitation flow | Own consent/revocation | May end relationship, not silently reassign athlete | Denied |

Invitation/claim is bound to a verified auth identity and the intended training subject or optional legacy client, is expiring and single-use, and cannot claim a record by guessed ID or name. Both athlete and practitioner protected sessions retain the existing AAL2 boundary. RLS and every write route derive the subject owner from `auth.uid()` and any coach authority from an active relationship; a supplied practitioner ID, actor ID or share token grants nothing. Relationship revocation invalidates future coach writes and pending coach proposals but does not delete athlete-owned history or silently convert a coach-authored prescription into athlete-editable authority. That conversion requires a new authorized self-directed revision.

Two below-range exposures create a review proposal rather than an automatic arbitrary decrement. The assigned coach (or an appropriate review flow for a self-directed athlete) may select an achievable lower load, reduced sets or a different suitable movement. In self-directed V1, the engine does not invent a decrement: it offers hold, lower-load familiarization through a new calibration, or referral/review. A changed dose creates a new progression series. Bodyweight and assistance exercises use dedicated reviewed progression policies; V1 does not apply the positive external-load percentage formula to them.

### Total decision table and valid log domains

Apply the first matching branch; an increase is never the fallback. `hold` preserves the current accepted prescription, `review` leaves it unchanged and explains the required decision, and `recalibrate` starts a new familiarization prescription only after explicit acceptance.

| Ordered condition | Output |
| --- | --- |
| Ineligible or new acute stop | Stop the entire session; no progression or session-start authorization |
| New movement-specific symptom | Hold/review the affected exercise series; do not convert an unrelated symptom into a session-wide clearance decision |
| Unfinished session strictly more than 24 elapsed hours after its supplied UTC start | Stale-session review; do not auto-complete or advance; late actuals remain history only until reviewed |
| Unfinished or aborted session | Hold every series; do not auto-complete or advance. An explicitly completed session with recorded omissions may still evaluate its completed exercise instances |
| Incomplete exercise instance, conflict, missing required actuals, invalid log or unconfirmed outlier | Hold that series; preserve values and return the specific reason |
| Unknown RIR | Hold that series with `effort_unknown_hold`; no load or rep progression |
| `6_plus` on any working set | Recalibrate that series with `effort_too_easy_recalibration`; preserve the original value; no load or rep progression |
| Mixed working loads within an exercise instance | Review that series with `mixed_working_load_review`; do not discard the difficult sets or enter the rep branch |
| Latest comparable completed exposure at least 14 elapsed days ago | Return review; do not advance until the series is reviewed |
| Changed comparator key or only one success at a new load | Recalibrate or block load increase; still evaluate the valid most-recent-exposure rep branch |
| Any working set below lower rep bound or below target effort band (including 0–1 RIR with target 2–3), including ceiling reps at excessive effort | Hold first time; review after two equivalent difficult exposures; no automatic decrement |
| Two same-load successes, all sets at ceiling, effort at target or easier | Propose smallest achievable increment within cap; if none fits, hold/review |
| All sets in range, every set at target effort or easier, some below ceiling | Propose exactly one total rep on earliest below-ceiling set |
| All other valid states, inconsistent effort or no supported modality rule | Hold with specific reason; no invented recommendation |

Validation defaults for the adult V1 contract: finite decimal load in kg/lb, 0–1000 kg canonical magnitude, at most three decimal places in the entered unit; work-set reps are integers 0–100 (zero is a recorded failed/aborted set, never completion); RIR is an integer 0–5 or `6_plus`/`unknown`; completed dynamic sets require positive reps and all required fields. `6_plus` is observed but imprecise and produces a recalibration reason distinct from unknown effort; neither earns automatic load progression, and unknown RIR does not earn rep progression. Values outside the catalog's exercise/equipment bounds are rejected even if inside global schema bounds. An active exercise version must provide those equipment/load limits before it is selectable.

A jump in entered load exceeding 20% from the last positive comparable actual load, calculated as `(new - prior) / prior > 0.20`, is flagged as an outlier and excluded from progression until explicit unit/load-basis confirmation. Exactly 20% does not trigger that branch. Zero or unknown prior load uses explicit calibration rather than division. Initial/recalibration choices always require confirmation even when the increase is 20% or less. Manual actuals and calibrations never masquerade as engine recommendations. This is data-quality protection, not an injury threshold or a bar on what the athlete actually performed. A corrected log invalidates affected unapplied proposals.

Bodyweight external load may be zero; recorded assistance is nonnegative and must not exceed a configured supported machine range. Assistance and bodyweight have no autonomous percentage-load progression in V1. Negative loads are never used to encode assistance. Unilateral actuals are side-tagged and cannot silently combine asymmetric work. Conditioning duration is integer seconds 1–14400, distance is finite nonnegative with a declared supported unit, and effort is integer 0–10 or unknown. Missing planned bouts and unknown effort block conditioning progression.

The 1000 kg/100 rep/4-hour global maxima are parser/typo bounds, not suggested training doses or assurances of safety. Per-exercise and per-plan policy is stricter. Exact unit conversion uses `1 lb = 0.45359237 kg`; preserve original decimals and a decimal canonical representation with sufficient scale for exact supported-unit input, never repeated display rounding.

### Numeric contract and examples

Store exact decimal input and its declared unit; use decimal/fixed-point arithmetic for conversions and equipment calculations. Do not accumulate binary floating-point rounding. Keep original entry plus canonical quantity and load basis. Display-unit changes cannot mutate the underlying workout. A barbell total includes the configured bar, collars and symmetric plate pairs; plate inventory records per-side amounts and counts. Dumbbells use a sorted list of achievable per-hand loads. Machine stacks use a sorted list tied to the exact equipment ID. Deduplicate equivalent totals deterministically and choose the smallest achievable greater load that satisfies the cap. Record assistance and bodyweight external load separately; assistance remains nonnegative and uses no positive-load progression formula.

| Case | Expected deterministic result |
| --- | --- |
| Barbell 60 kg total, 3 × 6–8, all 8 reps at 2–3 RIR on two comparable exposures; 1.25 kg plates per side available | 62.5 kg total, target 3 × 6–8; increase is 4.17%; explain evidence window |
| 60 kg, reps 8/7/6 at target RIR | Hold 60 kg; propose 8/8/6 (one total rep), within range |
| 20 kg total, only a 2.5 kg total increment available | 12.5% exceeds 5% cap: no automatic increase; hold/rep progression or alternative equipment |
| A 0.25 kg plate on each side | +0.50 kg total, never +0.25 kg total |
| Two dumbbells logged as 12.5 kg per hand | Display and store per-hand 12.5; pair external load is 25 only for an explicitly defined pair-volume calculation |
| 100 lb viewed in kg | Canonical equivalent 45.359237 kg; presentation rounding must not change prescribed plates or re-round on every toggle |
| Assistance reduced from 30 to 25 kg on the same machine | Greater task difficulty; never treat it as a 5 kg regression |
| Missing last set, absent RIR, pain flag, or pending conflicting edit | No autonomous load increase; distinct reason code for each |

Estimated 1RM is outside the first slice. A later descriptive trend requires a frozen equation and eligible set domain and must be labeled an estimate; it cannot become initial-load authority. Exclude warm-ups, high-rep endurance work, unknown effort, assistance, machine substitutions and unlike ROM/variants from cross-comparison. No global “tonnage score” compares unrelated exercises; workload summaries state what is counted and omit unknowns.

## 6. Conditioning as a first-class part of the plan

Start with accessible modes selected by preference and tolerance: walking, cycle, rower or another cataloged option. The program models modality, duration, work/recovery intervals, intensity using a simple effort/talk-test cue, and optional heart-rate data. Do not calculate precise heart-rate zones from a posture image or assume an age formula is an individual threshold test.

Initial product default: offer two manageable easy/moderate bouts weekly at 10 minutes each. The athlete must accept the planned duration and may deliberately choose 1–20 minutes, including a shorter duration based on a reported comfortable continuous bout. Do not infer the start from posture score or treat recalled weekly activity as completed program work. Report activity outside the gym as context; it does not complete either planned bout or enter the advancement window. Public-health activity targets are a longer-term destination rather than a mandatory first-week dose. Progress duration before intensity, one variable at a time, with a versioned rule and recovery review. The template supplies the reviewed effort cue/band. Intervals are a later optional module; no automatic all-out sprint prescription.

Protect strength quality when scheduling demanding endurance and lower-body sessions. Prefer separated days or sufficient separation when practical; if paired, place the priority task first. Off-day conditioning is allowed and does not count as a strength session. Exact spacing is a pragmatic choice, not a guaranteed interference threshold. V1 conditioning-duration rule (product heuristic): after two comparable completed bouts at or below the target effort, without an adverse symptom flag, propose up to two minutes per next comparable bout, capped at +4 total minutes, +10% of prior completed weekly minutes, 30 minutes per bout and 60 planned minutes per week. For the initial two-bout template, calculate `min(2, floor(min(4, 0.10 × prior completed weekly minutes) / 2))`, then fit the result within both authored ceilings. If either planned bout is incomplete or lacks effort data, or no whole minute fits, hold both. Missing completion/effort or a changed modality produces a hold/recalibration; no automatic intensity or frequency increase in the same step. These ceilings are template limits, not physiological safety thresholds or WHO targets. Conditioning logs use modality-specific comparability; metres on a rower and running metres are not equivalent workloads.

## 7. Media: useful instruction that fits the app

Reuse the existing media schema/player fallback chain. The earlier [media upgrade plan](2026-07-04-exercise-media-and-content-upgrade.md) records infrastructure as completed but clip acquisition as declined; recheck actual assets and licenses in the product audit. Do not interpret “pipeline ready” as “exercise demonstrations available.”

Recommended visual direction: real coached demonstrations, neutral dark background, consistent framing and light, full body plus equipment visible, controlled repetitions, minimal branding, optional side/front alternate view. A loop should show setup, execution and return without concealing the range of motion. A short loop serves quick reference; a longer detail clip and authored cues support unfamiliar exercises. Animation is a valid alternative only when its movement has been reviewed as carefully as filmed instruction.

First obtain a small representative pilot covering squat, hinge, push, pull, unilateral work, carry/trunk and conditioning; then scale the approved treatment. Choose own filming or a licensed source only after checking exact-variation coverage, commercial distribution/storage rights, model releases, modification rights and costs. No bulk scraping or assumed rights from a public URL. No purchase is part of this planning turn.

Media reviewer means a qualified strength-and-conditioning professional competent in the demonstrated movement, named in the manifest. The checklist covers setup, full movement cycle, loading convention, usable range, camera visibility, cue accuracy, variant match and contraindicated implications; rights review is separate. Exercise/technique revision changes invalidate its prior media match until re-reviewed. Every launched program exercise needs a reviewed demo or explicit reviewed static sequence, setup/cues, common errors stated without alarmism, exact equipment/load convention, regressions/progressions, captions/text equivalent, a poster, and a working no-video fallback. Match demonstration to the prescribed variant; an attractive generic squat clip cannot stand in for every squat. Generated media must not ship as exercise instruction merely because it looks plausible; coach verification remains required.

Use responsive MP4/WebM where supported, reduced-motion behavior, no forced audio, poster-first loading, one active clip at a time, retry/fallback for failure, and accessible controls. Media manifests carry exercise version, URL/hash, rights evidence, reviewer/date and fallback status. Staged catalog exercises cannot be selected by the live engine before these requirements pass.

## 8. Architecture and data contracts

Keep existing correction sessions immutable and playable as designed. New strength/conditioning records use an explicit program/session schema version and a discriminated kind. Do not put new cycle semantics into the legacy week-1-to-3 field or silently reinterpret old session items.

Proposed components within the existing repository:

- `lib/training/contracts/`: schemas, load conventions, capability-free athlete profile, safety/review states, program/session/log versioning.
- `lib/training/screening/`: one adapter from stored findings to `ScreeningContextV1`; no UI or AI dependencies.
- `lib/training/engine/`: pure template compiler, constraints, scheduling, dosage, progression, equipment arithmetic and reason codes.
- `content/training/`: typed strength/conditioning exercise metadata and template definitions; reusable exercise IDs link to existing media where appropriate.
- `app/api/training/`: authorized program/assignment/session/log endpoints; transactional persistence and idempotency.
- Existing `app/workouts/` and player components: program overview, today/logging, history/review and migration-aware legacy entry points.

Data entities: athlete training subject and profile; optional legacy-client bridge; coach-athlete relationship; program template/version; assigned program/version; week and scheduled session; immutable session prescription with source profile/screening/rule versions; performed session; per-set log event with exercise instance ID/side, actual values, units and mutation revision; conditioning bout; progression decision with input hash/reasons; media review/rights record. A program revision affects only eligible future sessions. Session prescriptions freeze at start; completed actuals are auditable.

### Subject ownership and access contract

Add `training_subjects` as the athlete-owned root. Each active row has one unique `owner_user_id` referencing Supabase Auth. A self-directed athlete can own this subject with no practitioner and no legacy `clients` row. `client_accounts` is an optional one-to-one bridge from a training subject to an existing practitioner-owned client; it is a lookup/provenance link, not the source of athlete authority. `coaching_relationships` grants an active practitioner explicit versioned permissions over one training subject. Existing `clients.practitioner_id`, `practitioners.role`, corrective records and practitioner RLS remain unchanged.

Athlete invitation/claim is expiring, single-use and bound to the verified Auth user/email plus the intended subject or optional client. The Auth provisioning hook must choose exactly one invitation class: the existing practitioner branch keeps its current behavior, while the athlete branch creates or activates a training subject and never creates a practitioner. Both actor types retain the existing AAL2 protected-session requirement. No request field, share token, guessed client ID or display name can grant subject ownership or coach authority.

New-table RLS permits an athlete to read rows whose `training_subjects.owner_user_id = auth.uid()`. It permits a practitioner to read only when the current user is an active AAL2 practitioner and an active `coaching_relationships` row grants the required permission for that subject. Authenticated direct writes stay revoked; server-side transactional writers derive the actor from the JWT, recheck subject/relationship status inside the transaction, and scope every target by subject. Relationship revocation immediately blocks future coach writes and pending coach proposals. It retains athlete-owned history and does not change program mode.

Erasing a linked legacy client removes practitioner-owned client data, the `client_accounts` bridge and coaching access. It does not erase the athlete-owned training subject or history. Subject erasure is a separate explicit owner request that covers training profiles, eligibility records, programs, prescriptions, logs and queued mutations under the privacy lifecycle. Private scan assets are not sent to a media vendor or general LLM by default.

Coach unlink or linked-client erasure ends the coach-assigned assignment and preserves it as historical. Its immutable prescriptions and history remain readable, but no actor may publish new prescriptions into that ended assignment. Corrections to historical actuals remain permitted only under the existing eligibility, session and subject-ownership rules; they do not reopen the ended program. The athlete may explicitly create a new self-directed assignment from their current profile and calibration. That is a new assignment with self-directed authority, never an implicit conversion of the prior program mode.

At the API boundary use request IDs and transactional uniqueness for retries; optimistic revisions for edits; stable set/exercise-instance IDs rather than array indexes. Online athlete-versus-coach conflicts are required in the first release and return the current safe projection instead of using last-write-wins. A later offline outbox queues only owned session mutations. Store minimal sensitive offline data, remove it on logout/account change, and distinguish locally saved from server acknowledged. A late offline replay must not resurrect deleted data.

AI can explain an approved deterministic plan, suggest choices from an allowed catalog or collect preferences through a schema. It cannot create contraindications, override a symptom stop, invent load numbers, change science rules or write directly to the database. Validate provider output, use an approved configured provider, and fall back to the deterministic plan on timeout, malformed output or absent credentials. Every number in AI explanation must resolve to the approved prescription/decision.

## 9. Parallel delivery plan

This PRD expands the original app; there is no separate demo app. Estimates should be made after the scan audit and contract review. The next demonstration should show a narrow truthful vertical slice, not represent the complete 12-week adaptive system as finished.

| Wave | Workstream and owner | Deliverable | Dependency and completion gate |
| --- | --- | --- | --- |
| 0, now | Scan auditor | Trace, concrete defects/fixes, validity limits and eval inventory | Before any automated scan-driven training restrictions |
| 0, parallel | Programming researcher | Evidence matrix with population limits and versioned policy proposals | Before freezing progression/dosage rules |
| 0, parallel | Product/data/media auditor | Existing-system map, access gaps, reuse and media coverage | Before schema/UI scope freezes |
| 0, integration | Lead + independent model | This PRD, critique and resolved findings | User receives complete reviewed plan |
| 1A | Scan owner | Reproduced correctness fixes; explicit unavailable/provenance output | Own capture/engine/findings files; independent regression review |
| 1B | Program owner | Contracts, exercise metadata, 8-week deterministic compiler, two-bout ConditioningDecisionV1 and simulations | Own `lib/training/contracts`, `lib/training/engine`, `lib/training/screening` and `content/training`; consumes agreed screening adapter |
| 1C | Experience/data owner | Auth-owned subject, optional client/coach links, authorized profile, immutable sessions and online set-log vertical slice | Own the ordered migrations, `lib/training/access`, `lib/training/persistence`, `app/api/training` and `app/train`; consume frozen contracts, no duplicate rule logic |
| 1, media parallel | Content producer with coach reviewer | Representative demo pilot + manifest | Can proceed without scan-model research; no unlicensed downloads |
| 2 | Integration | One complete adult 8-week plan on the athlete’s own account: onboarding → session → log → next recommendation | All safety/data invariants and real desktop/mobile journeys pass |
| 3 | Expansion | 4/6/12-week configurations, intermediate undulation, additional conditioning modalities/interval policies, expanded media | Every added template passes simulation and coach review |
| 4 | Sync and coaching expansion | Durable offline queue, multi-device edits and richer coach review | Identity is already required in wave 2; pass offline expiry/conflict/deletion tests |
| 5 | Pilot and validation | Small monitored adult pilot, telemetry/recovery workflows, measurement study | No broad claim of scan-based injury prevention or clinical accuracy |

With four agent slots, run at most three independent workers plus the integrating lead. Freeze contracts first; use separate worktrees for implementation. The contract owner serializes shared schema changes. Only the integration owner combines migrations, updates generated inventories and deploys. Independent review is separate from authorship; focused fixes rerun affected gates, and a changed merge candidate gets fresh required CI. Existing user files/processes stay intact.

## 10. Evals and acceptance tests

These are required future tests, not claims of current passes. Scope each gate to the capability being released: the first online athlete release requires eligibility, ownership, prescription and online-log invariants; offline replay/multi-device guarantees are required before wave 4 is enabled. Measurement-study gates are required before measurement-change or scan-driven restriction claims, not before a scan-independent general training plan. Use executable fixtures with inputs, expected output, rule version and reason codes. Track source evidence separately from test results: a green deterministic suite cannot prove clinical efficacy.

| ID | Scenario | Required outcome |
| --- | --- | --- |
| SC-01 | Equivalent image resizes/orientations and known mirror transforms | Same canonical metric within defined numerical tolerance; correct anatomical side |
| SC-02 | Wrong/missing view, stale frame, contradictory metadata | Reject/mark unavailable; no plausible invented finding |
| SC-03 | Low visibility, missing confidence, NaN, incomplete landmarks | No actionable default; unavailable preserved through persistence/report/program |
| SC-04 | Repeated capture versus repeated processing | Metrics/evidence distinguish the two; no false reliability claim |
| SC-05 | Unvalidated proxy has severe-looking magnitude | No lift ban, automatic load reduction, weakness diagnosis or injury prediction |
| SC-06 | Normal/no scan | Valid general plan from goals, capacity and constraints; no corrective-priority requirement |
| SC-07 | Scan from another client or different model | Cross-client denied; incompatible versions explicit, never silently compared |
| PR-01 | First slice: 8 weeks × 2/3/4 days; full scope: all 4/6/8/12-week lengths × supported time/equipment tiers | Feasible valid plan or specific insufficiency response; no empty session or impossible equipment; full matrix remains the Wave 3 gate |
| PR-02 | Two eligible 60 kg 3 × 6–8 exposures, each performed 8/8/8 at target RIR, with 1.25 kg plates/side | 62.5 kg next accepted target begins 6/6/6 within the same range; reason names both source revisions |
| PR-03 | Most recent 60 kg exposure is 8/7/6 at target effort; also test prior ceiling then most-recent below ceiling | Same load, one total rep on earliest below-ceiling set from the most recent exposure; no simultaneous load/set increase |
| PR-04 | Fractional plates, kg/lb toggles, per-hand vs pair | Exact arithmetic, no drift, explicit load basis |
| PR-05 | Next available jump exceeds cap | No forced rounding up; hold/rep progress/review |
| PR-06 | Assistance exercise, bodyweight, changed machine or ROM | No invalid e1RM/tonnage comparison; reset comparability where needed |
| PR-07 | Missing RIR/set, active or aborted session, explicit terminal omissions, unresolved sync, symptom stop | No automatic increase for incomplete instances; completed instances survive only explicit terminal completion-with-omissions; reason matches cause |
| PR-08 | New adverse symptom despite strong performance | Review path takes precedence over load advancement |
| PR-09 | Unfinished session at exactly/over 24 hours; latest comparable exposure at exactly/over 14 elapsed days | Stale only when session age is >24 hours; return review at ≥14 days; no catch-up doubling; immutable completed history |
| PR-10 | Heavy/volume undulating exposures | Separate comparison tracks; no false plateau |
| PR-11 | New scan or retrospective log edit | Past prescription preserved; revision affects only eligible future work |
| PR-13 | Recompute/accept same evidence twice or correct an input after proposal | Same proposal or stale rejection; at most one applied advancement, no compounding from an unperformed target |
| PR-14 | Athlete attempts publishing a coach-owned target or routine coach override clears acute stop | Denied; only scoped authorized actions can change prescription/clearance |
| EL-01 | Minor/unknown adult scope, empty/contradictory answers, disease/activity/intensity combinations, pregnancy/postpartum context, unsupported specialized request and fresh symptoms | Minor/unknown or unsupported scope denies assignment/start; reviewed policy returns the remaining state/constraints; pregnancy alone is neither blanket denial nor claimed clearance; acute stop has no acknowledgement bypass |
| PR-12 | AI timeout, invalid exercise, invented number or instruction override | Deterministic valid fallback; unauthorized output rejected |
| CO-01 | New exerciser with low activity | Feasible starting dose; no automatic all-out intervals |
| CO-02 | Conditioning mode changes or strength/conditioning scheduling collision | Explicit reschedule/comparability handling; no invalid combined workload |
| PR-15 | Same exercise at 55 then 60 kg; exact 20% and >20% changes; zero/unknown prior; ceiling reps at RIR0; fractional reps; 600 kg typo | No two-at-60 increase; exact 20% is not the outlier branch; >20% requires acknowledgement; zero/unknown calibrates; effort hold/review; fractional reps rejected |
| PR-16 | Four-exercise duration fixtures above and consecutive-only requested days | 1400s fits30; 2520s does not; propose alternate schedule rather than silently violating it |
| CO-03 | Two completed 10-, 20-, 29- or 30-minute bouts at target effort; off-day placement and extra-gym activity | Next bouts are 11, 22, 30 and hold respectively within 30/bout and 60/week; off-day valid; outside activity does not complete a bout; incomplete bout holds |
| DA-01 | Online double tap/retry now; delayed offline replay in Wave 4 | One logical set/session mutation; request-ID payload mismatch conflicts; no duplicated work or progression |
| DA-02 | Concurrent online athlete/coach writes from the same revision | One commits; the other receives a visible revision conflict/current projection; neither silently overwrites |
| DA-03 | Self-directed owner, linked client, assigned/unassigned coach, other athlete and shared token read or write | Only owner or active permissioned relationship succeeds; no history or scan leakage; client/practitioner IDs in requests grant nothing |
| DA-04 | Logout, coach unlink, linked-client erasure, subject erasure and expired assignment; offline queue when Wave 4 exists | Local data clears; coach/client erasure removes link/access but preserves athlete-owned history; explicit subject erasure removes it; replay denied; no resurrection |
| UX-01 | 320/390/768/1280/1440px, populated builder and long names | No clipped content or horizontal scroll; reachable controls with keyboard and bottom dock |
| UX-02 | Numeric entry, keyboard opening, rest, back/refresh/resume | Actuals persist; clear saved state; no accidental set completion |
| UX-03 | Network loss, blocked video, reduced motion, screen reader | Usable text/poster controls and recoverable log flow |
| ME-01 | Every exercise selected by launch templates | Exact-variant reviewed demo/static sequence + cue coverage + rights manifest |
| ME-02 | Missing/expired/wrong media and video decode failure | Correct fallback and explicit catalog status; never mismatched instructional clip |

Simulation suite: at least 1,000 seeded synthetic training histories spanning success, plateau, gaps, fatigue, unit changes and adversarial inputs; zero violations of hard constraints, deterministic replay, bounded load progression and complete reason codes. These histories test software behavior, not human outcomes. Hold out cases from policy tuning. Each supported template needs a qualified coach's independent scenario review before release.

The contract proof set must include two ceiling successes versus ceiling then below-ceiling; first exposure at a new load; mixed loads; terminal omissions versus active/aborted session; recalled history; unknown versus `6_plus`; exact 20% versus greater than 20%; conditioning 10→11, 20→22, 29→30 and 30→hold; off-day scheduling; and two online actors writing the same revision. Each fixture records exact inputs, output, policy version and reason code.

Usability eval: five representative users complete onboarding, log/edit a working set and find the next target without coaching. Proposed pilot target: at least four of five complete each critical task; investigate every data-loss or unsafe-action failure regardless of aggregate score. Target normal set logging within 10 seconds after familiarization; measure rather than assert. No missing/duplicate logs in fault-injection tests. Monitor real error rates with privacy-minimal telemetry after launch.

Release requires focused checks, relevant full unit/integration suites, authenticated browser journeys on Chromium/WebKit, real-phone interaction testing, independent review and verification of the exact deployed revision. Camera behavior on physical devices remains a separate requirement from viewport emulation.

## 11. Scope and success

First milestone: one complete 8-week strength-and-conditioning program for an eligible adult using their own account, with self-directed and coach-assigned authority explicitly enforced, with stable core movements, online logged working sets, explainable progression, conditioning bouts, and reviewed media for every included exercise. It must work equally well with an absent scan. This proves the architecture before multiplying templates.

Full scope adds the 4/6/12-week options, intermediate undulation and durable offline/multi-device behavior under the same contracts. Athlete identity and online self-logging are already required for the first athlete-facing milestone. A lower posture grade is not a success metric. Track program adherence, retention, comparable performance trends, conditioning participation, logging reliability, reported tolerability and usability. Do not claim the software caused strength gains or prevented injury without appropriate outcome evidence.

Execution decisions are frozen: deterministic-program-first, an 8-week athlete-owned vertical slice, self-directed and coach-assigned modes, the existing AAL2 boundary, athlete-owned history after coach unlink/client erasure, and all 4/6/8/12-week options in full scope. The unresolved live-release decision is the clinically reviewed eligibility branch table, constraint semantics and user-facing symptom/urgent-help wording. That validation blocks real-athlete activation, not unrelated schema, authorization, compiler or synthetic-prototype work. Prototype fixtures require clear synthetic labeling, not a new clinical approval workflow. Budget and sourcing for exercise media still require a concrete licensed/filming proposal after the pilot coverage review.

## 12. Review record

Scan-status correction: checkpoint `bd94785`; 22 focused route tests, full TypeScript, changed-file ESLint and independent code review pass. The scan annex records the remaining nonblocking database-writer status predicate followup. No metric formula, threshold, model or scientific claim was changed by that fix. Production deployment `dpl_5p8uwC5ty2mbGLFL6Bug37s1Li2S` is READY and the public alias was verified at 2026-09-08 01:09 UTC. A complete existing assessment still generated a preview in the IDE browser; no production test data was added. The followup checkpoint `ce18f8a` reconciles the generated algorithm inventory and exact seed/test fixture hashes after the route change; the previously failing content gate now passes 150 tests locally. No database rows or approval evidence were changed. The followup is also deployed: `dpl_FfXfTTkAYgLTD3uf2tnvs9vZUYhd`, READY at `ce18f8a67969a68c065875ad4460b161ac04435b`; public alias verified 2026-09-08 01:27 UTC. Baseline PR #149 full CI passed at ce18f8a: lint/typecheck/unit/build, Playwright e2e and performance budgets. This baseline result does not verify later strength-training changes; their integration evidence is tracked separately.

Independent plan reviewer: GPT-5.6 Sol, xhigh reasoning, read-only Codex invocation using the subscription lane. The [initial critique and focused resolution audit](2026-09-07-strength-conditioning-plan-review.md) record seven design blockers resolved and no remaining blockers to starting bounded contract/8-week vertical-slice work. The final minor wording correction (review rather than automatic decrement) is applied. This is not clinical certification. The three audit/research annexes were produced in parallel; the lead reconciles their candidate policies into this single normative PRD.

No implementation or scientific-validity claim should be inferred from this document’s completeness.

## 13. External Grok review and execution goal

Devin approved execution of the full plan with delegated workers and a lead orchestrator. The additional [Grok 4.6 subscription audit](2026-09-07-strength-conditioning-grok-review.md) is complete, and the lead's [contract dispositions](2026-09-07-grok-contract-dispositions.md) are incorporated into this normative revision. BLOCK-1 is resolved by the auth-owned `training_subjects` model and optional client/coach links. BLOCK-2 is resolved at the product-contract level by the explicit adult/scope inputs and no-blanket-pregnancy rule; the clinical decision table and wording remain honestly unvalidated. The accepted numerical and online-conflict findings are now part of sections 5, 6, 8 and 10. Goal state: `/Users/zero-suminc./.claude/goal-state/posture-ai-strength-conditioning/state.json`. New runtime work must consume these resolved normative contracts.

The [Grok contract followup](2026-09-07-strength-conditioning-grok-followup.md) resolves the original two blockers and accepts the settled engineering contracts after NEW-1 and NEW-2. Their assignment-succession and per-series decision rules are applied in sections8 and5. Engineering contract freeze is effective for implementation and synthetic fixtures; clinical policy validation, media approval, measurement validity and human evaluations remain unproven and are not included in that freeze.


## September 8 demo additions from the owner

These additions extend the existing application and the current demo slice; they do not replace the strength-and-conditioning objective.

- Provide an extensive searchable exercise library with at least 250 distinct exercises. Keep source and media provenance, meaningful equipment/movement metadata, and useful filters. Library inclusion does not silently mark an exercise as reviewed for automatic program selection. Verify the distinct count and actual search/filter behavior.
- Persist the actual selected capture images for new screenings and show them in the evidence page capture set, with a usable enlarged view. Keep front/side identity consistent with the submitted capture. Existing records that never stored photographs must state that limitation instead of showing invented images. Verify access control, bounded uploads, image/view association, retry behavior, and deletion handling.
- Improve the interactive 3D model's visual quality, controls, responsive fit, and discoverability from the assessment. Explain observational findings without presenting static scans as proof of muscle tightness or weakness. Verify mouse/touch/keyboard controls and graceful unavailable-renderer behavior.
- Check the main desktop and mobile journeys for clipping, overflow, navigation and functional errors, then publish the verified candidate to the existing production URL. Deployment proof must identify the released revision and verify the production pages; local checks alone are insufficient.

### Selecting reference exercises into a saved workout

The exercise library must support the owner's request to pull exercises into a workout. Browsing 250 or more entries alone does not meet that need. Add manual routines in the original Workouts experience: select and order exercises, enter sets/reps and exact decimal load with units or conditioning duration, save, reopen, edit, and follow the routine. Persist routines under the authenticated training subject so refresh or a different signed-in device can retrieve them. Preserve exercise instructions and source/media attribution from the saved reference snapshot.

These are user-authored routines. Reference inclusion does not create a reviewed compiler entry, a scan-derived restriction, or an automatic progression prescription. The existing full strength-program objective remains required; manual creation adds a useful path alongside it. Do not substitute browser-local storage or a checklist for the required durable program/logging capabilities.

| ID | Scenario | Required result |
| --- | --- | --- |
| MR-01 | Search the 280-entry collection, select, reorder, remove | Every retained reference can be selected; stable item IDs and order survive save/reopen; unknown and duplicate IDs are rejected |
| MR-02 | Strength dosage, microload decimals, conditioning duration | Exact entered strings/units survive; invalid numbers and unsupported fields are rejected; user authors the dose |
| MR-03 | Owner, authorized coach, unrelated athlete, unassigned coach | Only authorized actors can create/read/edit/archive; request IDs or subject IDs grant no authority |
| MR-04 | Lost create acknowledgement, exact retry, stale revision | One saved routine; changed-payload request reuse and stale edits conflict visibly; no silent overwrite |
| MR-05 | Reopen after library changes | Saved source identity, instructions and media attribution remain identifiable; unavailable assets get a usable text fallback |
| MR-06 | 320/390/768/1280px, keyboard, refresh and navigation | Reachable controls, no horizontal overflow, saved state and errors visible; native Workouts navigation exposes manual routines |
