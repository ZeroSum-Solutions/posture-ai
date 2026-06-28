# Wave 3 — Move #5: Layer-1 Measurement-Validation Study Protocol

**Date:** 2026-06-27
**Status:** DRAFT pre-registration (v2, post adversarial review) — NOT approved. Clinician + biostatistician sign-off is a downstream gate before any participant is enrolled or any threshold is promoted to clinical use.
**Scope:** Establish the reliability, concurrent validity, measurement error, and provisional sample distributions of the Posture AI scoring engine's scored metrics, so each engineering-default threshold can be replaced by an evidence-backed boundary — held for a larger study — or honestly retired.
**Engine under test:** `@posture-ai/engine` `ENGINE_VERSION 1.2.0` (frozen), `pose_landmarker_lite`. Repo `wiggdevin/posture-ai` @ `f5db66c`.
**Author:** Devin + Claude. Reporting target: GRRAS (Kottner 2011) + COSMIN (Mokkink 2010).

> **Revision note (v2).** This draft was hardened against an adversarial biostatistics review. The
> material changes from v1: reliability is modelled with variance components (not "engine as a fixed
> rater"); the production-like analysis unit is defined; the sample size is presented as
> feasibility-bounded with explicit precision and an INDETERMINATE/HOLD disposition rather than
> overclaiming a lower-CI guarantee; app frames are captured marker-free; the two identical-vector
> metrics are governed by a family rule; promotion rules are made exhaustive; and the percentile
> "normatives" are demoted to provisional sample distributions.

---

## 0. Why this study exists (the honest problem statement)

Posture AI computes ten postural-deviation angles from MediaPipe BlazePose landmarks via a
deterministic geometry engine and **scores nine** (the tenth, `pelvic_axial_rotation`, is measured but
held below the reliability floor and never scored). After the Wave 2 provenance audit
(`packages/posture-engine/src/thresholds.ts`),
exactly **one** of those metrics carries a peer-reviewed cut-point — `knee_extension_back_knee`
(recurvatum: Loudon 1998 >5°, Kawahara 2012 >10°). **Every other zone boundary is a tuned
engineering default.** The engine has never been validated against any clinical reference.

The literature review folded into this protocol (§12) surfaced three uncomfortable facts this study
must confront rather than paper over:

1. **Several metric names are misnomers for what the engine computes.** The engine produces
   *lean-from-vertical* and *line-tilt* proxies, not the named clinical constructs:
   - `forward_head_posture` measures the **shoulder→ear** vector from vertical, not the
     craniovertebral angle (CVA = C7→tragus from horizontal). Different base anchor (acromion vs C7,
     ~5–10 cm apart) **and a different reference axis** (vertical vs horizontal), so the two are not
     even on the same scale — a transformation is required before they can be compared (§5).
   - `t1_tilt_backward` measures the **shoulder→hip** vector from vertical. "T1 tilt" is a specific
     radiographic cervicothoracic parameter not computable from a shoulder landmark; this is a global
     trunk-lean angle.
   - `anterior_pelvic_shift` measures the **shoulder→hip** vector from vertical — the *identical*
     geometry to `t1_tilt_backward` (same landmarks, same vector, same angle; the two differ only in
     direction labels). Neither measures anterior pelvic **tilt** (APT), which needs ASIS/PSIS
     landmarks BlazePose does not provide. **These two findings are one measurement** and are governed
     by a family rule (§8.4) so the study cannot promote the same number twice under two names.
2. **The BlazePose "hip" landmark is a hip-joint-centre estimate**, anatomically ~5–8 cm inferior to
   the iliac crest / ASIS a clinician palpates for `pelvic_obliquity`. Pooled coronal hip-tilt
   validity in the smartphone-posture meta-analysis is only ICC 0.46 (Karbalaeimahdi 2025). This is a
   **structural** mismatch, not mere noise.
3. **Frontal knee alignment has no feasible non-radiographic gold standard.** Surface goniometry
   explains only ~25 % of radiographic hip–knee–ankle (HKA) variance (Riddle 2012), and a full-limb
   radiograph cannot be ethically justified for asymptomatic screening volunteers.

This study is therefore **not** an exercise in confirming the metrics deserve their clinical names. It
is a falsifiable measurement-validation study whose pre-registered outcome, per metric, is one of:
**PROMOTE**, **KEEP screening-only**, **HOLD (indeterminate → confirmatory study)**, or
**RETIRE/DEMOTE** (the disposition `pelvic_axial_rotation` already has). The decision rules are
pre-specified in §8.4 so results cannot be rationalised after the fact.

**Regulatory motivation.** PostureScreen Mobile was published with the conclusion that it "should not
be used in research or clinical applications when accurate postural assessments are necessary"
(Hopkins 2019). The smartphone-posture meta-analysis found 27.6 % of studies had high selection bias,
69 % unclear blinding, and **zero** reported a minimal clinically important difference (Karbalaeimahdi
2025). This protocol is designed to clear that bar.

---

## 1. Objectives & hypotheses

All hypotheses and acceptance thresholds are fixed **before** data collection and are not revised post
hoc (GRRAS planning items; COSMIN Box H). The unit of analysis is defined in §3.1.

### 1.1 Primary objectives

- **P1 — Reliability (capture → detection → engine).** For each scored metric, the production-like app
  score is reliable across captures and sessions.
  *H1:* the reliability coefficient (ICC derived from the §8.1 variance-components model) point estimate
  ≥ 0.80, with its 95 % CI reported and used in the disposition rule (§8.4).
- **P2 — Concurrent validity vs the closest feasible clinical reference.** For each metric with a
  feasible, scale-aligned reference (§5), the app score agrees with the reference.
  *H2:* Bland–Altman bias within ±MDC₉₅ and 95 % LoA within the metric's pre-specified clinical bound
  (§5), with no clinically material proportional bias (§8.2).

### 1.2 Secondary objectives

- **S1 — Measurement error.** SEM and MDC₉₅ (degrees) per metric, estimated from variance components
  (§8.3), reported for both the single-capture and 3-capture-mean scores.
- **S2 — Provisional sample distributions.** Mean, SD, and 5th/50th/95th sample percentiles of each app
  score **in this cohort only** — explicitly *not* population normatives (the sample is purposive and
  too small; §8.3, §10).
- **S3 — Reference reliability ceiling.** Inter-rater ICC(2,1) for every manual reference, so the
  validity ceiling √(reliability_app · reliability_reference) is quantified.
- **S4 — Subgroup robustness & feasibility.** Landmark-detection success and error by sex, BMI band,
  and Fitzpatrick skin-type band; detection failure is an informative, reportable outcome (§8.5).
- **S5 — Capture-protocol sensitivity.** Reliability delta between the standardized rig and an
  unconstrained handheld capture, each with its own repeated captures (§8.5).

### 1.3 Out of scope (explicit)

- Any change to engine math, grade/percentile model, exercise content, or muscle KB.
- Validation of `pelvic_axial_rotation` as a *scored* metric — confirmed-excluded (§3, §5).
- Diagnostic-accuracy, treatment-efficacy, or longitudinal-outcome claims — Layer-1 is measurement only.

---

## 2. Design

Prospective, single-cohort **method-comparison + reliability study** (cross-sectional for validity;
two-session, multi-capture repeated-measures for reliability), reported per GRRAS and self-audited
against COSMIN boxes B (reliability), C (measurement error), and H (criterion/concurrent validity).

- **Index:** the frozen Posture AI capture→engine pipeline (`ENGINE_VERSION 1.2.0`, §4 protocol).
- **References:** per-metric clinical references (§5), each acquired by **raters blinded** to the app
  output and to each other, in a **separate setup from the marker-free app capture** (§4.1).
- **Blinding:** app operator, reference rater A, reference rater B are separate people; physical-exam
  order randomized; analysis runs locked scripts with blinded QC where method identity is not
  structurally obvious.
- **Self-capture arm (generalizability):** a subset also performs an **unassisted self-capture** so the
  study reports reliability under the *actual product use condition*, not only same-operator lab use
  (§4.3, §8.5). The lab/same-operator result is reported as the upper bound; self-capture as the
  product-realistic estimate.
- **Optional clinical knee sub-study** vs radiographic HKA in patients already imaged for care (§5, §9).

---

## 3. The metric-by-metric matrix (the spine of the study)

"Plane test" applies the single-camera principle (Wade 2023; Rode 2025): single-camera 2D is
defensible only for angles lying **in the image plane**, perpendicular to the optical axis;
out-of-plane / axial / depth angles are not. The final column is the **primary risk under test** — a
neutral statement of the hypothesis being falsified, not a predicted outcome.

| # | Engine key | View | What it actually computes | Closest clinical construct | Construct match | Plane test | Primary risk under test |
|---|---|---|---|---|---|---|---|
| 1 | `forward_head_posture` | side | shoulder→ear vs vertical | CVA (C7–tragus) | Partial (anchor + axis differ) | ✅ in-plane | scale-transform validity vs CVA |
| 2 | `anterior_imbalanced_shoulders` | front | shoulder-line tilt vs horizontal | shoulder-height asymmetry | Partial (shoulder ≈ acromion) | ✅ in-plane | no validated degree cut-point exists |
| 3 | `posterior_imbalanced_shoulders` | back | shoulder-line tilt vs horizontal | shoulder-height asymmetry | Partial | ✅ in-plane | same as #2; back-view detection |
| 4 | `t1_tilt_backward` | side | shoulder→hip vs vertical | global trunk lean (NOT "T1 tilt") | No to name; partial to lean | ✅ in-plane | family-shared vector (see #6) |
| 5 | `pelvic_obliquity` | front | hip-line tilt vs horizontal | pelvic obliquity (iliac crest) | No (hip-JC ≠ crest, structural) | ⚠️ landmark-offset | crest-line agreement is structurally bounded |
| 6 | `anterior_pelvic_shift` | side | shoulder→hip vs vertical (= #4) | global forward lean (NOT APT) | No to name; = #4 geometry | ✅ in-plane | identical to #4 — family rule applies |
| 7 | `pelvic_axial_rotation` | front | hip-z asymmetry | transverse rotation | n/a (already unscored) | ❌ out-of-plane | confirm exclusion |
| 8 | `genu_varum_valgum_left` | front | 180−∠(hip,knee,ankle) | HKA / mechanical axis | Partial (2D proj ≠ HKA) | ✅ projection only | 2D projection vs true mechanical axis |
| 9 | `genu_varum_valgum_right` | front | 180−∠(hip,knee,ankle) | HKA / mechanical axis | Partial | ✅ projection only | as #8; left/right clustered |
| 10 | `knee_extension_back_knee` | side | 180−∠(hip,knee,ankle), posterior-gated | recurvatum (**already cited**) | Good (direct) | ⚠️ ±6–25° LoA at 0–15° | is 5° detectable on a 2D photo at all |

### 3.1 Unit of analysis (defined before any data are seen)

The engine, given one frame, is deterministic; all measurement variance comes from re-posing and
re-detection, so **the engine is not a "rater."** The reliability target is the *process*. We define:

- **Per view, per session:** 3 captures, the subject **stepping off the mat and repositioning between
  each** (this is what makes reliability measure pose + detection, not pixel noise).
- **Production-like score (PRIMARY analysis unit):** the **single first valid capture** per view —
  because production submits one capture per view. All primary reliability/validity results use this.
- **3-capture-mean score (SECONDARY):** the within-session mean, reported to quantify the precision the
  product *could* buy by averaging. If a metric promotes only under the mean (not the single capture),
  that promotion is conditional on the product adopting multi-capture averaging.
- A capture is "valid" if all landmarks the metric uses clear the engine's confidence floor; failures
  are handled and counted per §8.5 (they are an outcome, not silently dropped).

---

## 4. Standardized capture protocol (the index measurement)

Fixed and version-pinned; mirrors the engine's tilt/aspect-correction design
(`docs/plans/2026-06-12-capture-correctness-tilt-framing-design.md`).

### 4.1 Capture order (prevents marker contamination of the markerless test)

App frames must be captured **marker-free**, because high-contrast skin markers placed near joints can
bias BlazePose landmarking and would invalidate the blind markerless test:

These three steps happen in **one continuous standing bout** (the subject does **not** step off the mat
between them), so the app↔reference *validity* comparison is on the same posture instance — the
marker-free app frames are captured first, then markers are applied while the subject holds the stance:

1. **App capture (marker-free):** standardized rig, all views, 3 captures/view (§3.1). The first valid
   marker-free capture is the app angle used in the concurrent-validity comparison.
2. **Marker placement** by a trained rater, subject holding the same stance.
3. **Reference measurements:** photographic-reference photos (marker-visible) + physical references
   (PALM, inclinometer, goniometer) by blinded raters, physical-exam order randomized.

(The *reliability* test, by contrast, deliberately re-positions between its 3 captures and 2 sessions —
§3.1. The residual posture-reset variance that step-2 marker application could still introduce into the
validity comparison is bounded by, and reported against, the §8.1 capture/session variance components.)

A **marker/no-marker equivalence check** (**≥20 subjects captured both ways, paired**) quantifies
residual marker effect on the app landmarks: per metric, compute paired app-angle differences
(markered − marker-free); the gate is that the **upper 95 % CI of the mean absolute shift < 0.5 ×** that
metric's §8.4.1 MDC-gate value. A metric failing this **cannot PROMOTE** (markers confounded its
reference comparison).

### 4.2 Rig & stance

- **Rig:** smartphone on tripod, optical axis horizontal, lens at the subject's mid-trunk height
  (~1.0–1.2 m), 2.5–3.0 m distance, 1× lens, portrait. Device model, lens, lighting, and distance are
  logged as covariates.
- **Tilt gate:** in-app `captureRollDeg`; shutter blocked >5°, amber 2–5°, green ≤2°; `normalizeFrame`
  de-rotates + aspect-corrects before scoring; frames carry `levelVerified = true`.
- **Views:** front + right-side mandatory; back for `posterior_imbalanced_shoulders`.
- **Stance:** Frankfort horizontal plane, feet shoulder-width, **barefoot**, arms relaxed, eyes
  forward, **comfortable (uninstructed) posture** (instruction shifts trunk angles ~20°, Xue 2020).
  Light, form-fitting clothing; hair clear of C7/acromia.
- **Sessions:** two, **48 h–7 d** apart, same rig; interval recorded.

### 4.3 Self-capture arm

A subset (**target ≥30 analysed**) repeats the front + side capture **unassisted** (subject positions
the phone per on-screen guidance), to estimate reliability under the real product-use condition (§8.5).
This separates "validated under same-operator lab capture" (upper bound) from "validated for self-serve
use." **Any self-serve product claim requires the self-capture reliability to pass the §8.4 gate
independently;** a lab same-operator PROMOTE is otherwise labelled "validated under assisted capture
only."

---

## 5. Reference standards (per metric, ranked by feasibility)

Each reference is the **closest feasible, scale-aligned** clinical anchor, with its own published
reliability so the validity ceiling is explicit. Acceptable LoA are clinical-relevance judgments fixed
now. Where the engine angle and the reference are on different scales, the **transformation and the
expected sign/direction are pre-specified here**, before any Bland–Altman.

| Metric(s) | Primary reference standard | Scale alignment (pre-specified) | Reference reliability (lit.) | Acceptable LoA | Honesty flag |
|---|---|---|---|---|---|
| `forward_head_posture` | Photographic CVA (C7→tragus vs horizontal; markers; same lateral view; Kinovea/ImageJ; blinded rater) | Different anchor (acromion vs C7) **and** axis (vertical vs horizontal) → **no fixed algebraic transform exists.** Pre-register a **cross-validated Deming regression** predicting photographic CVA from the app angle; validity criterion = **leave-one-out cross-validated RMSE of predicted CVA ≤ 5°** AND 95th-percentile absolute error ≤ 8° (not a transformed-LoA). The Deming spec + folds are frozen before unblinding. FHP is judged by this gate, **not** the generic §8.4(b) Bland–Altman gate. | photo CVA test–retest ICC ≈ 0.90; inter 0.83–0.99 | CV-RMSE ≤ 5° | Validate the proxy *as a proxy*; report systematic offset + the calibration. Do **not** import the <50° CVA cutoff. |
| `anterior_imbalanced_shoulders` / `posterior_imbalanced_shoulders` | Photographic Shoulder-Height Angle (acromion-line tilt, markers) + inclinometer on a bridging bar | same construct (line tilt vs horizontal); direct degree comparison | photo SHA ICC 0.80–0.98; inclinometer ICC 0.89–0.98, SEM 2–2.8° | ±3° | No validated *degree* cut-point in the general population (field works in mm). |
| `t1_tilt_backward` **(family head, see §8.4)** | Photographic trunk-lean (C7→greater-trochanter vs vertical; Hazar 2015) + upper-thoracic inclinometer | same construct (vector vs vertical); direct degree comparison | Hazar trunk-angle test–retest ICC 0.77, inter 0.99 | ±5° | Rename product copy to "trunk lean." |
| `pelvic_obliquity` | PALM on iliac crests (deg + mm) | **construct-offset comparison:** report app(hip-JC line) vs PALM(crest line) bias + its dependence on habitus; not assumed equal | intra ICC 0.97–0.98, inter 0.88; vs radiograph 0.90–0.92 | ±3° for *screening agreement*; promotion to a crest threshold requires a **stringent ±2°** | Structural mismatch: passing reliability supports screening/change-tracking only unless the stringent crest LoA is met. |
| `anterior_pelvic_shift` | **None of its own** — it is the §8.4 family alias of `t1_tilt_backward` (identical vector) | n/a (validated once, as the shared trunk-lean vector) | — | — | Not independently validated; retired or kept only as a labelled alias. |
| `pelvic_axial_rotation` | none — excluded | n/a | n/a | n/a | Single-camera depth error 2–3× in-plane (Rode 2025). Reported descriptively; confirms measure-but-not-score. |
| `genu_varum_valgum_left/right` | **Healthy:** 3D optical MoCap **frontal projection of the HKA** (specified in §5.1). **Clinical sub-study:** radiographic HKA. | the MoCap reference is the *same 2D frontal projection* the app computes — **not** a claim of true mechanical-axis HKA; the radiographic stream is the only true-HKA stream | 3D-MoCap vs radiograph rs ≈ 0.86–0.93; radiographic HKA ICC 0.92 | ±5° | **Two streams, reported separately, never pooled.** The healthy MoCap-projection stream proves only *algorithmic agreement* (same 2D construct) → it can support at most **KEEP screening-only**; a PROMOTE to a clinical alignment threshold requires the **radiographic** stream. Surface goniometry (~25 % HKA variance) is **not** a gold standard. Bilateral knees clustered (§8.2). |
| `knee_extension_back_knee` | Clinical goniometry of knee (hyper)extension, weight-bearing, blinded rater | same construct (sagittal knee angle); direct degree comparison | intra 0.85–0.98, inter 0.86–0.92; SEM 0.5–2.2°, MDC 3–6° | ±5° overall; **analysed in the 0–15° band** with a pre-set minimum n (§6.2) | Decisive test: at 0–15°, 2D-photo knee-extension LoA are ±6–25° (Naylor 2011). Detectability of 5°/10° is defined in §8.4. |

### 5.1 3D motion-capture HKA reference specification (metric 8/9, healthy stream)

To avoid an under-specified "gold standard": passive-marker optical system (≥8 cameras, calibrated to
< 1 mm residual), standing static trial, lower-limb marker set with hip-joint-centre by a published
regression (e.g. Harrington), knee/ankle joint centres by medial/lateral marker midpoints. The
reference angle is the **2D frontal projection** of the hip–knee–ankle line — i.e. the *same construct*
the app computes from a frontal photo, **not** the true 3D mechanical axis. True mechanical-axis HKA is
established only in the radiographic clinical sub-study. This is stated so the healthy-stream result is
not misread as radiographic-HKA validation. Accordingly, the healthy stream can support at most a
**KEEP screening-only / algorithmic-agreement** disposition for metrics 8/9 (§8.4); promotion to a
clinical alignment threshold is reserved for the radiographic stream.

---

## 6. Participants & sampling

- **Target n = 50** asymptomatic adults (≥40 analysed after attrition), purposive for **posture
  heterogeneity**: sex ≥40 % each; BMI strata (≥25 % combined overweight/obese); Fitzpatrick spread
  with deliberate IV–VI oversampling (the literature is light-skinned-biased and landmark visibility is
  the dominant failure mode).
- **Recurvatum enrichment:** screen-in **≥18 participants** with clinically apparent knee
  hyperextension so the 0–15° validity band is populated (§6.2) — without enrichment, an asymptomatic
  n=50 yields too few hyperextended knees to test the cited 5°/10° boundaries.
- **Inclusion:** 18–65; stands unsupported 5 min; consents in English.
- **Exclusion:** acute MSK pain preventing standardized standing; pregnancy; spinal/limb hardware;
  amputation; inability to expose marker sites with light clothing.
- **Clinical knee sub-study (separate):** patients already scheduled for full-limb standing radiographs
  for clinical care (e.g. pre-TKA); **no research-induced radiation.**

### 6.1 Sample-size justification (feasibility-bounded, stated honestly)

n=50 is a feasibility-bounded sample, not a number that *guarantees* a tight ICC lower bound. We state
what it buys and pre-commit to the consequence:

- **Reliability precision.** With n≈50 and the §3.1 replicate structure (3 captures × 2 sessions), the
  95 % CI half-width on an ICC near 0.85 is roughly ±0.08–0.12. This is enough to *separate* a good
  metric (point ≥0.85) from a poor one, but **may not push the lower 95 % CI above 0.75** for a metric
  whose true ICC is ~0.80. Such metrics receive the **HOLD (indeterminate)** disposition (§8.4) and a
  confirmatory study at **n ≈ 100–140** (Bonett 2002 for ω≈0.20, k=3), *not* promotion. We do not claim
  n=50 clears a 0.75 lower bound; we pre-register the indeterminate path instead.
- **Validity (LoA) precision.** The 95 % CI on each LoA limit is ≈ ±1.71·SD_diff/√n; at n=50 that is
  ≈ ±0.24·SD_diff. Per-metric, the LoA-CI must itself fall within a pre-set tolerance for a PROMOTE;
  otherwise the metric is HOLD, not PROMOTE.
- **Bilateral knees** are clustered by participant (§8.2), so 50 participants give ~80–100 knee
  observations but **not** 100 independent ones; the effective n is modelled, not assumed.

### 6.2 Knee sub-study & 0–15° band

- Clinical HKA sub-study: target **≥30 participants** (clustered knees), powered separately for an HKA
  LoA-width, not the asymptomatic n.
- Recurvatum 0–15° band: **≥25 knee-observations in 0–15° of reference hyperextension, from ≥18
  participants (clustered)**, before the §8.4 recalibration logic is applied; if not reached, the metric
  is HOLD for that band (no confirm/downgrade decision is made on an underpowered band).

---

## 7. Procedures (visit flow)

1. Consent; demographics (age, sex, BMI, Fitzpatrick); footwear removed; **app capture first
   (marker-free, §4.1)**.
2. Marker placement; **Session-1 references** (photographic + PALM/inclinometer/goniometer) by blinded
   raters A and B, physical-exam order randomized.
3. **Session 2** (48 h–7 d): standardized app capture repeated (reliability); self-capture arm (§4.3);
   reference re-measurement optional (powers reference test–retest).
4. **Knee sub-study visit:** standardized frontal app capture at the same visit as the clinical
   radiograph; radiographic HKA read by a blinded MSK radiologist.
5. Data handling per §9.

---

## 8. Statistical analysis plan

Pre-specified; locked, version-pinned R scripts (`irr`, `psych`, `blandr`, `lme4`/`nlme`), archived
with the data; blinded QC. The unit of analysis is §3.1 (production-like single capture, primary).

### 8.1 Reliability (P1, S3) — variance components, not "engine-as-rater"
- **Model.** A linear mixed / variance-components model per metric: random effects for **subject**,
  **session(subject)**, and **capture(session)**, fixed nothing. From the components estimate:
  - single-capture reliability ICC = σ²_subject / (σ²_subject + σ²_session + σ²_capture);
  - 3-capture-mean reliability via the Spearman–Brown / averaged-measures form.
  Report both, each with a 95 % CI (parametric-bootstrap or Satterthwaite).
- This replaces v1's incoherent "ICC(3,1) of a deterministic engine." Between-session systematic drift
  is captured by the session component (absolute-agreement sense).
- **Reference inter-rater:** ICC(2,1), two-way random, absolute agreement.
- Bands (Koo & Li 2016): <0.50 poor · 0.50–0.75 moderate · 0.75–0.90 good · >0.90 excellent.

### 8.2 Concurrent validity (P2)
- **Bland–Altman** of (app − transformed-reference, per §5): bias with 95 % CI; 95 % LoA = bias ±
  1.96·SD_diff, each limit with its 95 % CI (n=50 precision per §6.1). For **bilateral knees**, use a
  repeated-measures / cluster-robust LoA (Bland & Altman 1999) — left/right are not independent.
- **Proportional bias:** regress differences on means; the gate is **clinically material**, defined
  numerically as: the predicted bias change across the 5th→95th percentile of the means exceeds MDC₉₅
  (not mere statistical significance — a non-significant slope is not evidence of no bias, and a
  significant-but-trivial slope does not fail). If material, report regression-based LoA across the range.
- **Calibration vs agreement (corrected from v1).** Regression-based LoA address proportional bias /
  heteroscedasticity — **not** reference superiority. When we want a calibration mapping (e.g. forward
  head), use **Deming / errors-in-variables** regression as a separate calibration analysis; agreement
  is still judged by bias + LoA.
- **ICC/correlation are descriptive only.** App and reference are *fixed methods*, not random
  interchangeable raters, so a concurrent ICC(2,1) is reported for comparability with the literature but
  is **not** a validity gate. Validity is decided on bias, LoA, calibration error, and the reference
  ceiling (S3).

### 8.3 Measurement error & provisional distributions (S1, S2)
- **SEM_agreement** from the §8.1 within-subject variance (σ²_session + σ²_capture), **not**
  SD_pooled·√(1−ICC) (which entangles between-subject heterogeneity). MDC₉₅ = 1.96·√2·SEM. Report for
  the single-capture *and* 3-capture-mean scores (the product's actual scoring unit determines which
  MDC governs the gate).
- **Provisional distributions only.** Sample mean/SD/percentiles are reported with bootstrap CIs and
  labelled **provisional sample distributions, not population normatives** — the cohort is purposive and
  too small to set population cut-points. Any data-driven boundary is a *candidate* for a later
  representative normative study, not a shipped threshold on its own.

### 8.4 Disposition decision rules (exhaustive, mutually exclusive, falsifiable)

Each metric's `thresholds.ts` provenance (`{ warn, danger, source, citation }`) is set by the
following ordered rules. The reliability gate is checked first, so no metric falls through.

**Family rule (applied first).** `t1_tilt_backward` and `anterior_pelvic_shift` are one vector. Exactly
one (the head, `t1_tilt_backward`, re-labelled "trunk lean") proceeds through the rules; the other is
**RETIRED to a labelled alias** (same number, not independently scored). The same single-vector result
governs both UI findings or one is removed — never two independent promotions.

For each remaining metric, in order:

1. **Reliability gate.** Let L = lower 95 % CI of the §8.1 single-capture ICC (or 3-capture-mean ICC if
   the product adopts averaging).
   - **L < 0.50** → **RETIRE / DEMOTE** to measure-but-not-score (held below `RELIABILITY_FLOOR`,
     excluded from score/ranks) — the `pelvic_axial_rotation` disposition.
   - **0.50 ≤ L < 0.75** *(or point ≥0.80 but L below 0.75 from sampling)* → **HOLD (indeterminate)**:
     keep `source:'engineering'` unchanged, flag for a confirmatory n≈100–140 study; **no threshold
     change.** (This is the previously-missing case.)
   - **L ≥ 0.75** → proceed to validity (rule 2).
2. **Validity & resolvability gate** (only for L ≥ 0.75):
   - **PROMOTE → `validated`** (assign candidate data-driven warn/danger, `source` = this study) iff
     **all**: (a) a scale-aligned reference exists (§5); (b) Bland–Altman bias within ±MDC₉₅ and LoA —
     and the LoA's own CI (§6.1) — within the §5 bound, no uncorrected material proportional bias; and
     (c) the **MDC gate**: MDC₉₅ ≤ the *minimum clinically meaningful separation* the metric must
     resolve (defined per metric in §8.4.1 as a fixed degree value — **not** a post-hoc percentile gap,
     so it cannot be gamed by widening a zone).
   - **KEEP screening-only** (`source:'engineering'`, "screening-only / change-tracker, non-diagnostic"
     note) iff reliability passes (L ≥ 0.75) but (a/b/c) fails — i.e. reliable but no valid
     cross-sectional clinical anchor. Usable only for within-person change > MDC₉₅; no classification
     claim. (`pelvic_obliquity` is the expected home here unless the stringent ±2° crest LoA is met.)
   - **Metric 1 (`forward_head_posture`) constraint.** Its reference (CVA) is on a different scale, so
     FHP is **exempt from the generic (b) Bland–Altman transformed-reference gate** and instead must
     pass the §5 calibration gate — leave-one-out cross-validated **Deming RMSE of predicted CVA ≤ 5°**
     and 95th-percentile absolute error ≤ 8° — with reliability (rule 1) and the MDC gate (c) still
     required. The Deming spec and folds are frozen before unblinding.
   - **Metrics 8/9 (frontal knee) constraint.** The healthy 3D-MoCap stream is the *same 2D projection*
     the app computes, so it can establish only algorithmic agreement → metrics 8/9 cannot exceed **KEEP
     screening-only** on that stream alone. **PROMOTE for 8/9 requires the radiographic clinical
     sub-study LoA (§6.2) to pass**; absent it, 8/9 stay KEEP screening-only regardless of MoCap
     agreement.
3. **Special case `knee_extension_back_knee` (already `literature`).** Computed only if the §6.2 band
   minimum (≥25 clustered observations) is met; otherwise **HOLD**. Define **detectable@θ** ≔ (MDC₉₅ ≤ θ
   **and** the *upper 95 % CI of the clustered 0–15°-band LoA half-width* ≤ θ) — using the CI, not the
   point estimate, so an underpowered band cannot certify a boundary.
   - 5° **and** 10° detectable → retain 5°/10°, append this study's confirming citation.
   - 10° detectable, 5° **not** → **downgrade warn** to the smallest θ that is detectable@θ (≥ MDC₉₅),
     keep `danger` = 10° (`literature`), update the provenance note to record the photographic
     recalibration.
   - neither detectable → **HOLD**; the metric keeps display but its `literature` boundaries are flagged
     "not confirmed at 2D-photographic resolution," pending a higher-resolution method.

#### 8.4.1 Per-metric "minimum clinically meaningful separation" (the MDC gate target, fixed now)

| Metric | Min meaningful separation (deg) | Basis |
|---|---|---|
| forward_head / trunk-lean | 5° | CVA app SEM ≈ 1.8°, MDC literature 4.5–5.9° |
| shoulders / pelvic_obliquity | 3° | smallest engineering warn boundary (2–3°); below this is noise |
| genu varum/valgum | 5° | HKA normal band ±3°; goniometric MDC ~5° |
| knee recurvatum | per §8.4 rule 3 (5°/10°) | Loudon/Kawahara boundaries |

A metric whose MDC₉₅ exceeds its row value cannot resolve its own smallest zone and cannot PROMOTE
(it routes to KEEP screening-only at best).

### 8.5 Subgroup, feasibility, capture-sensitivity (S4, S5)
- **Detection failure as an outcome (operationalised).** Confidence gate = per-landmark visibility ≥
  `RELIABILITY_FLOOR` = **0.5** (the engine's actual floor). A capture is **failed** for a metric if any
  landmark that metric uses is < 0.5. Repeat limit = **max 3 retries per view**; if all fail, the view
  is "failed" for that session. A participant is **excluded for a metric** only if that metric has no
  valid capture in *either* session. **Failure rates are tabulated by sex × BMI × skin-type × view**;
  a metric whose absolute failed-capture rate in any subgroup exceeds the best subgroup by **> 10
  percentage points cannot PROMOTE** for the general population (routes to KEEP screening-only with the
  subgroup caveat). Missing data are reported, not silently dropped; sensitivity analyses use mixed
  models that tolerate imbalance.
- **S5 capture-sensitivity.** Standardized-rig vs unconstrained-handheld, **order counterbalanced**,
  each condition with its own ≥3 repeats, so condition-specific SEM/ICC are estimable; report the
  reliability delta.
- **Self-capture arm** (§4.3) reliability reported separately as the product-realistic estimate.

---

## 9. Ethics, consent, data handling

- Independent ethics committee / IRB approval **required before enrolment.**
- Informed consent covering photo/marker retention as research data, retention window, withdrawal;
  **no clinical advice given** (screening-only).
- **Incidental findings:** pre-specify that any concerning observation is communicated by the
  supervising clinician in non-diagnostic language with a recommendation to seek independent
  assessment; it is logged but not acted on by the study.
- **Radiographic knee sub-study:** only patients already receiving full-limb films for care; **no
  research-induced radiation.** Exposing asymptomatic volunteers to full-limb radiographs purely to
  validate a screening tool is pre-judged **ethically unjustifiable** (Kurihara 2023; ICRP) and excluded.
- Data: de-identified IDs; photos/markers encrypted, access-controlled, separated from identifiers,
  deleted at the retention window's end. **This research data handling is explicitly separate from the
  production system, which persists landmarks only and never stores photos.**
- Pre-registration deposited (OSF or equivalent) with the locked analysis plan **before** data
  collection; deviations reported.

---

## 10. Limitations (named, not buried)

1. **Construct mismatch is real and partly irreducible.** BlazePose lacks C7, tragus, ASIS/PSIS, and
   spinous-process landmarks; forward-head, trunk-lean, and pelvic-obliquity proxies measure different
   constructs than their clinical names. The study validates *what the engine computes* against the
   closest scale-aligned anchor and renames overclaiming metrics.
2. **Reference-standard ceiling.** Validity is bounded by √(reliability_app·reliability_reference); the
   reference's own reliability is reported (S3).
3. **No true gold standard for frontal knee or trunk** without radiographs; the healthy knee result is
   vs a 2D MoCap projection (not true HKA), with radiographic truth confined to the clinical sub-study.
4. **Single-plane 2D restriction.** Axial / out-of-plane / occluded-side angles are not recoverable
   (confirmed-excluded, not validated).
5. **Provisional distributions, not normatives.** n=50 purposive cannot set population cut-points; any
   data-driven boundary is a candidate for a later representative study.
6. **Generalizability of capture.** Same-operator lab reliability is the upper bound; the self-capture
   arm estimates the product-realistic condition, but a single-site, asymptomatic-skewed cohort still
   bounds external validity despite the S4 oversampling.
7. **Feasibility.** The full reference set (PALM, inclinometer, markered photogrammetry, 3D MoCap,
   radiologist reads, 2 sessions) requires a movement-lab partner; §11 names a minimum-viable fallback.
8. **Frozen artifact.** Results bind to `ENGINE_VERSION 1.2.0` + `pose_landmarker_lite` + this capture
   protocol; any engine/model change requires re-validation of the affected metrics.

---

## 11. Roles, feasibility, sign-off gate

- **Drafting (done):** this document (Wave 3 autonomous draft, v2 post adversarial review).
- **Sign-off (downstream gate, REQUIRED before enrolment):** a licensed clinician (physiotherapy /
  sports medicine) **and a biostatistician** review construct choices, references, acceptable-LoA
  bounds, the §8 model, and the rename/family decisions, and sign the pre-registration.
- **Equipment / site.** Full design needs a movement-analysis lab (3D MoCap), PALM + digital
  inclinometer + long-arm goniometer, a DSLR + Kinovea/ImageJ station, two trained raters, and (for the
  sub-study) a radiology partner. **Minimum-viable fallback** if a MoCap lab is unavailable: run
  reliability + the photographic/PALM/goniometric validity streams (metrics 1–6, 10), and **defer the
  knee frontal-alignment validity (8/9) entirely to the radiographic clinical sub-study** rather than
  substitute a weaker surrogate.
- **Rater training.** Raters are licensed clinicians or trained assessors; complete a calibration set
  (≥10 pilot subjects) to a pre-set inter-rater ICC ≥0.80 on each reference before live measurement;
  follow written SOPs; measure independently from the physical exam (not from each other's images).
- **Engine integration.** The report's per-metric dispositions are applied to `thresholds.ts` via the
  provenance model in a normal TDD + GPT-5.5 review + `zs-land` cycle; promoted boundaries cite this
  study; HOLD/KEEP metrics keep `source:'engineering'` with the appropriate note.

Until sign-off, **no participant is enrolled and no threshold is changed.** This draft makes that
sign-off a review of a complete, falsifiable plan rather than a blank page.

---

## 12. References

Statistics & reporting:
- Koo TK, Li MY. *J Chiropr Med* 2016;15(2):155–163 — ICC selection; bands; lower-CI decision.
- Shrout PE, Fleiss JL. *Psychol Bull* 1979;86(2):420–428 — ICC forms.
- McGraw KO, Wong SP. *Psychol Methods* 1996;1(1):30–46 — agreement vs consistency.
- Bonett DG. *Stat Med* 2002;21(9):1331–1335 — ICC sample-size (CI width).
- Walter SD, Eliasziw M, Donner A. *Stat Med* 1998;17(1):101–110 — reliability sample-size / design.
- Zou GY. *Stat Med* 2012;31(29):3864–3882 — sample-size with assurance.
- Bland JM, Altman DG. *Lancet* 1986;1(8476):307–310 — limits of agreement.
- Bland JM, Altman DG. *Stat Methods Med Res* 1999;8(2):135–160 — agreement with repeated measurements (clustered LoA).
- Kottner J, et al. *Int J Nurs Stud* 2011;48(6):661–671 — GRRAS.
- Mokkink LB, et al. *Qual Life Res* 2010;19(4):539–549 — COSMIN.

Forward head / CVA / trunk / pelvis:
- Karbalaeimahdi M, et al. *Sci Rep* 2025 — smartphone posture meta-analysis (CVA test–retest ICC 0.904; acromion alignment pooled ICC 0.603; hip tilt ICC 0.462).
- Oakley PA, et al. *J Clin Med* 2024;13(7):2149 — photographic FHP shares ~30 % variance with radiographic FHP.
- Gallego-Izquierdo T, et al. *IJERPH* 2020;17(18):6521 — CVA app validity ICC 0.85–0.88; SEM ~1.8°.
- Hazar Z, et al. *J Phys Ther Sci* 2015;27(10):3123–3126 — photographic trunk-angle (C7–trochanter) ICC 0.77/0.99.
- Azevedo DC, et al. *J Bodyw Mov Ther* 2014;18(2):210–214 — PALM sagittal pelvic reliability.
- Preece SJ, et al. *J Man Manip Ther* 2008;16(2):113–117 — pelvic bony morphology confounds APT (23° range).
- Xue R, et al. *BMC Musculoskelet Disord* 2020;21:696 — posture-instruction shifts trunk angles ~20°.

Frontal asymmetry / pelvis landmark:
- Petrone MR, et al. *JOSPT* 2003 — PALM accuracy (intra ICC 0.97–0.98; vs radiograph 0.90–0.92).
- Moharrami A, et al. *J Exp Orthop* 2023 — healthy pelvic obliquity median 2.0°, 95th pct 5.6°.
- Kim HJ, et al. *Eur Spine J* 2008 — healthy shoulder-height difference 7.5 ± 5.8 mm.
- Bazarevsky V, et al. (BlazePose), Google Research 2020 — landmarks 23/24 = hip joint centres.
- Colyer SL, et al. *Sci Rep* 2021 — pose-estimator hip systematic error 30–50 mm vs marker-based.

Knee:
- Riddle DL. *Man Ther* 2012;17(5):459–465 — goniometry ~25 % of HKA variance; SEM 3.4°, MDC68 5°.
- Navali AM, et al. *SMARTT* 2012;4:40 — surrogates vs radiographic HKA (goniometer r 0.67).
- da Rosa BN, et al. *J Chiropr Med* 2022 — HKA normatives (mean −0.2°; band −3°/+3°).
- Saiki Y, et al. *Sci Rep* 2023 — OpenPose HKA vs radiograph ICC 0.915.
- Ge F, et al. *Sci Rep* 2025 — OpenPose frontal HKA vs radiograph ICC 0.897, LoA ±3.2°.
- Loudon JK, Goist HL, Loudon KL. *JOSPT* 1998;27(5):361–367 — recurvatum >5° (clinical goniometry).
- Kawahara K, et al. *KSSTA* 2012;20(8):1479–1487 — frank recurvatum >10° (3D motion capture).
- Naylor JM, et al. *BMC Musculoskelet Disord* 2011 — 2D-photo knee extension validity LoA ±6–25°.
- Albano TR, et al. *J Bodyw Mov Ther* 2022 — knee-extension prone test, photogrammetry ICC 0.85–0.92.
- Jeon MR, et al. *Br J Radiol* 2017 — full-limb radiograph dose.
- Kurihara C, et al. *J Radiol Prot* 2023 — healthy-volunteer research radiation ethics.

Markerless precedent / designs / overclaiming:
- Wade L, et al. *PLoS One* 2023;18(11):e0293917 — 2D markerless plane-by-plane error (frontal ankle LoA ±23.8°).
- Rode D, et al. *Sci Rep* 2025 — 11-model benchmark; depth error 2–3× in-plane.
- Roggio F, et al. *Sensors* 2024;24(9):2929 — MediaPipe posture ICC 0.67–0.95 (knee valgus lowest).
- Goto G, et al. *Spine Surg Relat Res* 2024 — MoveNet vs X-ray (shoulder/trunk r 0.83–0.88; Cobb r −0.15 NS).
- Moreira A, et al. *Comput Methods Programs Biomed* 2021;214:106565 — PoseNet valid in frontal view.
- Ferreira EAG, et al. *Clinics* 2010 — SAPO validation (angular error ±0.11°); design template.
- Stoliński Ł, et al. *Scoliosis Spinal Disord* 2017;12:38 — standardized 2D photography normatives.
- Puig-Diví A, et al. *PLoS One* 2019 — Kinovea validity (ICC 1.00 at 90° perpendicular).
- Hopkins BB, et al. *J Manipulative Physiol Ther* 2019;42(2):132–140 — PostureScreen Mobile "should not be used… when accurate assessments are necessary."
- Hajduk K, et al. *Br J Sports Med* 2017 — unstandardized posture assessment Kendall's W ≈ 0.
