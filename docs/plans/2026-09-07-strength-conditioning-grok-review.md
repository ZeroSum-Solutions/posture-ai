# External Grok 4.6 review — subscription OAuth

Completed 2026-09-07 via Grok Build 1.0.13, requested `grok-4.6`, response model `grok-4.6-build`, session `01a07eb3-eaf9-7123-b6f3-346b0f4f9f5e`, stop reason `end_turn`. Full PRD plus three annexes supplied with line numbers using `--verbatim`. Detailed Sol critique withheld, but the PRD contained its review-status summary. No repository/browsing tools were available. This is an advisory document review; findings require lead disposition and are not clinical certification.

# Independent Grok 4.6 audit: Posture AI strength-and-conditioning PRD

**Scope:** document-only. I did not inspect the repository, run tests, or retrieve the cited papers. Annex file:line pointers are claims inside those annexes, not confirmed source.

**Verdict**

- **Bounded first-milestone implementation (Wave 1 contracts, 8-week online compiler, identity/log slice):** **not freeze-ready.** The programming policy is mostly testable and honestly labelled. Two access contracts required by the 8-week athlete loop are still incomplete, and a few numerical rules are not executable as written.
- **First athlete-facing 8-week release (Wave 2):** **no-go** until those contracts, a frozen eligibility decision table, population gates, a fail-closed exercise/media roster, and the progression comparator holes below are closed.
- **Full release (4/6/12-week options, undulation, offline/multi-device, scan-driven restrictions, outcome claims):** **no-go, and not claimed by this PRD.** Intentional deferral of those items is not a first-milestone blocker.
- **Clinical validity:** **not certified.** Completeness of the document is not evidence.

The prior review record (`2026-09-07-strength-conditioning-prd.md:352-357`) is not independent evidence. I did not reuse its “no remaining blockers” conclusion.

---

## BLOCK

### BLOCK-1 — Self-directed ownership has no subject model

**Where:** `2026-09-07-strength-conditioning-prd.md:11`, `:176-188`, `:267`; `2026-09-07-strength-product-gap-audit.md:11`, `:40`, `:50-54`.

**Scenario:** An eligible adult with no coach signs up and publishes a self-directed 8-week plan. Today’s model is a practitioner-owned `client` with no auth-user key. The PRD requires athlete accounts and forbids share tokens as principals, but it never says who creates the client/subject row, whether `practitioner_id` may be null, or which RLS predicate holds when there is no coach.

**Consequence:** Wave 2 cannot ship both required modes. Likely failure modes are “self-directed still needs a hidden practitioner,” or writes authorized by a client-supplied practitioner id, which the PRD itself forbids.

**Smallest fix:** Freeze one subject-creation path for `programMode=self_directed` (athlete auth identity creates/owns the subject; coach relationship is optional and additive). Ban share tokens and practitioner-id parameters as authority. Define revocation: coach exit does not delete athlete-owned history and does not silently convert a coach-authored prescription into athlete-editable load authority without a new revision.

**Test:** Athlete A, no coach, publishes a validated 8-week plan and logs one set; Athlete B and any practitioner receive 403 on that program. Invite-claim still binds only the intended client. After coach revocation, pending coach proposals refuse; athlete cannot publish a higher coach-owned target.

### BLOCK-2 — Out-of-scope people can still be assigned a live program

**Where:** `2026-09-07-strength-conditioning-prd.md:11`, `:98-106`.

**Scenario:** A 16-year-old, or an adult who is pregnant, completes the ACSM-style questions as currently listed (activity, known disease, signs/symptoms, intended intensity, uncertainty). Those fields do not encode age or pregnancy. Minors and pregnancy-specific programming are explicitly outside this release. Missing answers cannot count as eligible, but these questions are not asked.

**Consequence:** The product can assign the same barbell 8-week loop the PRD says it will not offer these groups. That is an access/safety hole, not a paperwork gap.

**Smallest fix:** Add versioned eligibility inputs for date of birth (or 18+ with a defined adult threshold) and pregnancy/postpartum. Map minor → assignment unavailable; pregnancy/postpartum → `needs_clinical_review` or unavailable. Do not use an “acknowledge and continue” bypass.

**Test:** EL-01 fixtures: age 17 + otherwise “healthy” answers → `unanswered`/`ineligible`, start denied; pregnancy flagged → not `eligible_general`; adult with empty ACSM form → start denied.

---

## WARN

### WARN-1 — Eligibility is named, not specified

**Where:** `prd.md:98-106`, `:296-320` (EL-01).

**Scenario:** Two adults report the same known disease with different current activity and intended intensity. The PRD lists ACSM/EIM as the basis and lists states, but it does not give the branch table. `cleared_with_constraints` has no typed constraints for the compiler.

**Consequence:** EL-01 cannot be implemented twice with the same outputs. A coach-normal edit is correctly barred from clearing `acute_stop`, but implementers can still invent the rest.

**Fix:** Freeze a versioned answer→state table and a constraint object the compiler must consume. Clinical wording stays a named review, but the branches cannot.

**Test:** Fixture matrix of activity × disease × symptoms × intensity × uncertainty, including contradictions and fresh symptoms after clearance.

### WARN-2 — Onboarding “recent working sets” can become load authority

**Where:** `prd.md:93-94`, `:129-130`, `:163-175`, `:221`.

**Scenario:** At onboarding the user types “squat 60 kg × 8.” If that memory is stored as two completed equivalent exposures, the engine can propose 62.5 kg before any in-app set.

**Consequence:** The PRD’s “no invented starting load” rule is bypassed by unsourced recall.

**Fix:** Onboarding history may seed a familiarization suggestion only. It must not enter the two-exposure evidence window. First in-app series starts in calibration.

**Test:** Typed 60 kg history, zero logged sessions → familiarization or hold, never PR-02 increment.

### WARN-3 — Comparator window is not fully executable

**Where:** `prd.md:159-175`, `:194-205`, `:221-228`; PR-02/PR-03/PR-15.

**Scenario A:** Session has 8/8/8 at 60 kg then 8/8/7 at 60 kg. Load increase needs two ceiling exposures; +1 rep is written as if it applies to “all sets” without saying last session vs both.

**Scenario B:** One working set is logged at 62.5 kg inside a 60 kg session (mixed load).

**Scenario C:** Accessory skipped, primaries complete. “Unfinished session” may freeze every series.

**Consequence:** Different compilers will hold, add a rep, or increment load on the same logs.

**Fix:** Load increase: every prescribed working set of **both** window exposures at ceiling, target RIR or easier, same working load, no mixed-load sessions. Rep +1: last qualifying exposure only. Progression is per series; incomplete instances do not poison completed ones unless the session is aborted/stopped.

**Test:** Extend PR-03/PR-15 with mixed-load, 8/8/8 then 8/8/7, and primary-complete/accessory-skipped fixtures; assert reason codes.

### WARN-4 — `6_plus` RIR is treated as missing data

**Where:** `prd.md:199`, `:207-209`.

**Scenario:** Two sessions of all ceiling reps at `6_plus` (too easy). Policy holds, same as unknown RIR. Autonomous increase never fires.

**Consequence:** Honest easy logging stalls progression; users will under-report RIR to get a load change.

**Fix:** Distinct reason: `6_plus` + ceiling → review/recalibrate (“log nearer 2–3 RIR or confirm increase”), not the missing-data hold.

**Test:** Two all-8s at `6_plus` vs two all-8s at unknown RIR → different codes; neither silently applies 62.5 kg.

### WARN-5 — Familiarization can bypass the 5% cap

**Where:** `prd.md:129`, `:183`, `:190-191`, `:209`.

**Scenario:** Self-directed athlete accepts “new calibration” at 70 kg after 60 kg, or first-ever squat 200 kg inside catalog bounds. The 20% outlier rule needs a prior comparable load; a new series may not have one.

**Consequence:** The advertised 5% automatic cap becomes optional via calibration.

**Fix:** New series still requires explicit confirmation for jumps over 20% from last same-pattern load if one exists; first-ever loads require confirmation against catalog limits, not only the 1000 kg parser bound. Calibration must not apply a progression proposal.

**Test:** 60 kg series then “calibrate” 70 kg → confirmation required, epoch does not consume PR-02 evidence.

### WARN-6 — Conditioning increment has no ceiling; off-day bouts are undefined

**Where:** `prd.md:139-141`, `:236-238`; CO-03.

**Scenario:** Two completed 20-minute bouts keep receiving `min(2, …)` minutes per week with no per-bout or weekly max. Also: user has only two strength days; required conditioning is rescheduled. Schedule rules discuss strength days, not whether off-day walks are sessions.

**Consequence:** Duration can grow without bound; or required conditioning cannot be placed without violating nonconsecutive strength-day rules.

**Fix:** Versioned per-bout and weekly duration caps; state that reported extra-gym activity is display/WHO contribution only and does not complete planned bouts or substitute the evidence window; allow off-day conditioning without treating it as a strength session.

**Test:** CO-03 plus 20-minute bouts at the cap (hold); incomplete bout holds both; extra-gym 150 minutes does not complete planned bouts; 2-day strength + off-day walk is valid.

### WARN-7 — Scan `reliable` must not satisfy “repeatable”

**Where:** `prd.md:27-28`, `:48-50`, `:64-84`; `2026-09-07-scan-programming-audit.md:34-38`, `:61-67`.

**Scenario:** A finding with engine `reliable=true` and no test–retest record hits the “repeatable static observation” branch and offers low-dose preparation.

**Consequence:** Unvalidated proxies become programming inputs despite the PRD’s own gate.

**Fix:** Adapter maps current findings to unavailable/descriptive until capture quality, repeatability, validity, and actionability are separate persisted fields. Optional preparation is preference-gated, never scan-gated. Wave 1A remains closed or disabled on the strength path.

**Test:** SC-05/SC-06: severe-looking unvalidated proxy → no ban, no load change, no extra volume; missing scan still compiles a general plan.

### WARN-8 — Annex defaults will be implemented if workers treat annexes as code

**Where:** PRD `:29-30` vs `strength-product-gap-audit.md:79` (RIR `0..10`), `:105` (self-service progression as a later tier), `:167-176` (coach-only 4-week first).

**Scenario:** A worker implements RIR 0–10 or delays athlete self-logging because the gap audit said so.

**Consequence:** First milestone splits from the normative PRD.

**Fix:** Put a one-line header on each annex: superseded on conflict. Duplicate the RIR domain and 8-week/self-directed decision only in the PRD/contracts pack.

**Test:** Contract fixtures reject RIR 7 as out of domain; 8-week self-directed compile is in Wave 1B/1C, not “later.”

### WARN-9 — Online multi-actor conflict is not Wave 4-only

**Where:** `prd.md:269`, `:296`, DA-01–DA-04; authority table `:178-186`.

**Scenario:** Coach logs on behalf while the athlete edits the same set, in a live online Wave 2 build. Offline guarantees are correctly deferred; concurrent authorized writers are not.

**Fix:** Wave 2 requires revision conflict visibility and no last-write-wins for coach-on-behalf vs athlete. Keep durable outbox/multi-device in Wave 4.

**Test:** DA-02 against two online actors, no offline queue.

---

## NIT

1. **PR-02 vs default template** (`prd.md:127`, `:221`, `:301`): rewrite as `2×6–10` or `3×6–8`, not `3×8`, so “lower rep target” is defined.
2. **Conditioning prose vs formula** (`prd.md:238`): say “up to 2 minutes each,” because 10+10 becomes 11+11.
3. **PR-01/PR-10** (`prd.md:307`, `:316`): mark 4/6/12 and undulation as Wave 3 so the first gate is 8-week × 2/3/4 × time/equipment only.
4. **e1RM** (`prd.md:230`): omit from milestone 1 until the equation and eligible set range are frozen.
5. **Time estimate** (`prd.md:141-143`): show that 4 s/rep and prescribed rest are planning heuristics, not a forced timer.
6. **Experience tier** (`prd.md:93`, `:135`): define beginner vs intermediate with operable rules, or freeze one entry template.

---

## Scientific claims: verify sources vs confirmed document facts

I could not retrieve papers. These need independent source checks before anyone repeats them as fact:

| Claim in docs | Why it needs a check |
|---|---|
| Swain et al. 2020 — PRD ScienceDirect `S002192901930524X` vs annex PubMed `31451200` | Two identifiers; confirm they are the same paper and that the PRD’s causality limit matches the paper’s scope (low-back pain / posture, not all constructs). |
| Woldendorp et al. 2022, PubMed `34366318` | Confirm year, included-study “no responsiveness” wording, and that it does not validate this app (the PRD already says it does not). |
| Currier et al. 2026 ACSM stand, PubMed `41843416`, dates 2026-03-05 / 2026-04-01 / 2026-03-17 | Confirm publication and that “≥80% 1RM, 2–3 sets, ≥2 sessions/week” is not copied into athlete UI as this product’s dose. |
| Plotkin 2022; Hickmott 2022; Halperin 2022; Grgic 2022; Moesgaard 2022; Schumann 2022; Coleman 2024; Pancar 2026; WHO 2020; EIM/ACSM PDF | Confirm they support **direction** only. None of them, on this paper, validate 5%, 14 days, 2–3 RIR, 4 s/rep, or 8-week biology. |

**Not contradictions, and correctly labelled if left as product policy:** 5% cap, 14-day return, 2-set start, 8-week default, optional deload, no scan→injury inference, e1RM not load authority, WHO minutes as destination not week-1 dose.

**Internal arithmetic that is consistent on the page:** 1400 s / 2520 s examples (`prd.md:143`); 60→62.5 kg with 1.25 kg plates/side (4.17% < 5%); 0.25 kg per side → +0.50 kg total; 100 lb = 45.359237 kg; CO-03 10-minute bouts → 11+11 using the stated `min/floor` formula.

Annex RIR `0..10` vs PRD `0–5`/`6_plus` is an annex/PRD conflict. The PRD wins. It is not a scientific contradiction.

---

## Sound decisions to keep

- Scan is not load, injury, or weakness authority; missing scan must still yield a general plan.
- Deterministic compiler as numerical authority; AI explains only approved numbers.
- Separate strength records from legacy week-1-to-3 corrective snapshots.
- Eligibility and symptoms outrank performance; no acknowledge-and-continue; coaches cannot clear acute/medical states with ordinary program edits.
- Decimal/fixed-point load, explicit load basis, plate-per-side vs per-hand, assistance not a negative kg.
- Two-exposure window, idempotent apply, consumed evidence, no increase from an unperformed target.
- Bodyweight/assistance excluded from the external-load percentage rule.
- Fail-closed catalog/media; no unlicensed bulk scrape; generated clips are not instruction.
- Offline/multi-device honestly phased; online identity required for athlete use.
- Heuristics labelled as versioned product policy, not proven optima.

---

## Next steps

1. Close BLOCK-1 and BLOCK-2 in the contract pack before any other Wave 1 worker implements schema.
2. Freeze the eligibility table, constraint object, and adult/pregnancy gates as fixtures; send wording to a clinician without blocking compiler stubs.
3. Tighten comparator, onboarding-load, `6_plus`, calibration-cap, and conditioning-ceiling rules into one `ProgressionDecisionV1` / `ConditioningDecisionV1` oracle file with the PR-02/PR-03/CO-03 outputs.
4. Freeze an 8-week, 2/3/4-day roster with equipment limits and reviewed media or explicit static fallback; compiler returns `needs_template_adjustment`, never invents lifts.
5. Treat annexes as evidence notes. Do not implement gap-audit RIR, 4-week-first, or coach-only self-service deferral.
6. Keep Wave 1A scan work on the strength path disabled until view-identity and metadata survive the adapter.
7. Re-audit after those contracts exist. Do not start a “clinical accuracy” or injury-prevention claim track.

This is an implementation-planning audit of the written contract. It is not a code review, not a literature review, and not clearance to treat the engine as clinically valid.
