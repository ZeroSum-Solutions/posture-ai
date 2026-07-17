---
title: "Clinical-Landmark Correction Layer: Go/No-Go Spike"
date: 2026-07-16
status: decision-pending
verdict: NO-GO (archive path) — ceiling is r=0.32 vs radiographic truth
lanes: [gpt-5.6-sol-xhigh, deepseek-reasoner]
verifiers: [claude-opus-4-8 (x2), gemini-3.1-pro-preview]
external_evidence: [motiphysio.com FAQ, Healthcare 2023;11(5):686 (PAViR vs EOS)]
supersedes_claims_in: mem0 5ef4ef3a-894f-4688-be99-4591eade3a15
---

# Verdict

**NO-GO on DeepLabCut.** **NO-GO on any correction layer trained against the Moti archive.**
The blocker is not model choice, licensing, or data volume.

Three findings end this. All three are verified — two against the repo, one against Moti's
own published documentation and the peer-reviewed validation of their device.

1. **The archive's target is Moti's software estimate. The vendor says so outright.**
2. **The shoulder numbers that justified the premise do not reproduce.**
3. **The ceiling is r = 0.32.** Moti's own pelvic-obliquity measurement correlates with
   radiographic ground truth at r = 0.32. A *perfect* correction layer — one that matched
   Moti exactly — would inherit that. It is the hard cap on this entire direction, and it
   is far below the r = 0.78 everyone assumed.

The archive can never yield clinical validity, at any sample size, with any model.

---

# 0. The ceiling: what chasing Moti's labels actually buys

[VERIFIED — [Healthcare 2023;11(5):686](https://www.mdpi.com/2227-9032/11/5/686), n=100
musculoskeletal-pain patients] Moti Physio's device is the **PAViR** (Posture Analyzing and
Virtual Reconstruction device, MGsolutions, Seoul). It has been validated against **EOS 3D
imaging** — a low-dose radiographic system, an actual gold standard. Results:

| PAViR parameter | validity vs EOS radiographic truth |
|---|---|
| C7-CSL | r = 0.42 |
| **pelvic oblique** | **r = 0.32** (p < 0.01) |
| forward head posture, asymmetric clavicle height | "slightly positive" |

The paper's own summary: *"fair-to-moderate validation"* against EOS, Q angles excepted.

**The measurement chain, end to end:**

```
EOS radiography  →  PAViR/Moti   r = 0.32   →  posture-ai   r = −0.067
(gold standard)      (RGB-D AI)                 (2D photo, vs Moti)
```

Moti's pelvic obliquity is **itself only weakly valid** against radiographic truth on the
exact metric posture-ai is failing. Training toward it chases a target that explains ~10% of
the variance in the thing clinicians actually care about (0.32² ≈ 0.10).

This is the number that ends the project. Not provenance, not data volume — the ceiling.

# 0b. The r = 0.78 mystery, solved — and it was reliability, not validity

[VERIFIED — [Moti Physio FAQ, "Accuracy of Moti Physio"](https://en.motiphysio.com/FAQ_en/?bmode=view&idx=14526603)]
Moti publishes, verbatim:

> "There is no human error in Moti Physio because of **no intervention of the practitioner**.
> And intra reliability is explained by a Pearson correlation coefficient. Its value is
> **0.6–0.8** in each parameter. This clinical trial was conducted on 100 people."

Two things fall out:

1. **The vendor states there is no practitioner involvement.** The provenance question both
   Opus runs raised is answered by Moti's own documentation: the landmarks are 100% software
   estimates. No palpation, and their marketing confirms "no need of radiation or **tangible
   markers**." No email required.
2. **`r = 0.78` is Moti's published *intra-reliability*** — the machine agreeing with *itself*
   across repeat scans — sitting squarely in the published 0.6–0.8 band. It was never
   clinician-vs-clinician agreement, and it was never evidence that the ground truth is sound.

**Reliability is not validity.** A ruler that always reads 3 cm short is perfectly reliable
and perfectly wrong. Moti is reliable at 0.6–0.8 and valid at 0.32 on pelvic obliquity. The
project mistook the first number for the second, and built the accuracy phase on it.

# 0c. The vendor confirms the clothing problem

[VERIFIED — Moti FAQ] *"Clothing fits are important for Moti Physio. We recommend wearing
tight clothing as much as possible. And you have to test in a space without sunlight to get
an accurate result."* Max error ≈ 1.5° on a rigid mannequin — i.e. the best case, with no
soft tissue, no clothing, no movement.

DeepSeek's occlusion concern [ESTIMATE] is corroborated by the vendor [VERIFIED]: even a
depth camera needs tight clothing. posture-ai has a single 2D photo, taken by clients in
whatever they are wearing, in uncontrolled lighting.

---

# 1. The ground truth is a machine, not a clinician

[VERIFIED — `scripts/moti-import/compare.ts:90`] Pelvic truth is
`session.extraData.pelvisObliquity` — a scalar Moti's software computed, decoded from the
field `pelvis_obliiquity` (sic) at `decode.ts:161`.

[VERIFIED — `compare.ts:106`] Shoulder truth is `shoulderAngleFromDebug(debugRecord)`,
computed over `acromialEnd` points inside `debugLandmarks`.

[VERIFIED — `decode.ts:12-34`] The archive's data model is a software estimator's output:

```
SkeletonJoint { type, confidence, real: Vec3, proj: Vec3 }
DebugRecord   { time, version, points, scalars }
```

Per-joint `confidence`, paired `real`/`proj` 3D vectors, and a `version` tag are the
signature of an automated tracker. A clinician palpating an ASIS does not emit a
confidence score or a version number.

[VERIFIED — direct inspection of `datasets/moti/clients/*.json`] The `adams` field settles
it. It is not a manual Adam's forward-bend test result; it is a **17-point 3D spinal curve**
in millimetres, with `z ≈ 1830` on every point — a subject standing ~1.83 m from a depth
sensor. `ribsAngle` is a 17-element array of computed angles aligned to those same points.

**Moti-Physio is a 3D scanning system. The archive is its output. There is no palpation
anywhere in it.**

## What this does to the project's founding story

The accuracy phase rests on: *"BlazePose's hip-center ≠ the ASIS a clinician palpates,
hence r = −0.05."* That story is an **unverified causal gloss on a software-vs-software
correlation**.

[VERIFIED] The real comparison is **BlazePose (single 2D photo) vs Moti (3D depth scanner)**.
That reframes r ≈ −0.05 entirely, and suggests a simpler, harsher explanation:
pelvic obliquity as a 3D scanner measures it **encodes depth**, and a single frontal 2D
photo cannot recover depth. If that is the dominant term, this is a **modality gap, not a
landmark gap** — and no landmark correction closes a modality gap.

[VERIFIED — consequence] Training a correction layer toward these targets would teach a 2D
photo model to imitate a 3D scanner. That is vendor-estimator distillation with **zero
clinical-validation value**. It also makes the earlier consolation prize false: "accurate
ASIS would make the 3°/6° thresholds more defensible" does not hold, because nothing here
establishes what a clinician would have measured.

# 2. The shoulder premise does not reproduce

[VERIFIED — `datasets/moti/comparison-report-{full,lite}.json`, regenerated Jul 16 17:51,
after the pairing fix in PR #123] Read directly:

| metric | claimed (handoff + mem0) | **actual** |
|---|---|---|
| `pelvic_obliquity` | ≈ −0.05 both models | full **−0.067** (n=133), lite **−0.052** (n=133) — matches |
| `anterior_imbalanced_shoulders` | lite **0.19**, full **0.38**, p=.073, n=135 | full **+0.014** (n=137), lite **−0.088** (n=137) |

The pelvic claim holds. **The shoulder claim is off by an order of magnitude and its sign is
unstable.** The `0.38 / 0.19 / p=.073 / n=135` figures appear nowhere in the current
artifacts. The most likely explanation: the shoulder correlation collapsed to ≈ 0 when debug
pairing was corrected in PR #123, and the pre-fix numbers were carried forward into the
handoff and mem0 unchanged.

Consequences:
- The premise *"`full` carries signal worth correcting toward"* **evaporates**. Both models
  are at ≈ 0 on shoulders.
- The decision *"do not switch lite→full yet"* is now **more strongly supported** than when
  it was made — there is no shoulder advantage at all, so the 9.4 MB / +20 ms cost buys nothing.
- [ESTIMATE] mem0 record `5ef4ef3a-894f-4688-be99-4591eade3a15` contains the stale figures
  and should be corrected. Flagged for Devin — not done autonomously.

# 3. DeepLabCut — rejected, but not for the reason first given

[VERIFIED — `page.tsx:291`, `frames.ts` `.strict()`] Submission POSTs landmarks only; image
bytes never leave the device.

My earlier framing — *"the privacy boundary makes DLC impossible"* — was **wrong**, and both
Gemini and Opus caught it independently:

- [VERIFIED — Gemini] A DLC-trained model could export to TF.js/WASM and run **client-side**,
  matching the current BlazePose architecture. The boundary is not breached.
- [VERIFIED — Opus] DLC used **offline**, to relabel archive images on this machine, never
  touches the production serving boundary at all. LGPL and the non-commercial SuperAnimal
  weights only bite on *shipping*.

The rejection stands on better ground:
- [VERIFIED] For a coordinate→coordinate correction, DLC is the wrong trainer — it learns
  image→landmark.
- [VERIFIED] Offline DLC relabelling would produce *another software estimator* with the same
  provenance defect this document is about.
- [ESTIMATE] Building custom client-side TF.js infrastructure for a niche coordinate swap is
  an ROI failure.

**Reject DLC on tool-fit and ROI. Not on impossibility.**

# 4. What the verifiers caught that the exploration lanes missed

- [VERIFIED — Gemini, arithmetic] **The R² ≥ 0.60 gate demands superhuman performance.** If
  clinician-vs-clinician agreement is r = 0.78, maximum explainable variance against a single
  clinician's labels ≈ 0.78² = **0.608**. DeepSeek's proposed "stop if R² ≥ 0.6" asks a model
  to hit the human ceiling exactly.
- [VERIFIED — Gemini + Opus, independently] **The proposed ~3,500-parameter MLP is
  statistically impossible here.** Effective n is **117 independent clients**, not 411
  detections — sessions from one client leak body shape. Ridge regression is not the cheap
  first step; it is the *maximum complexity this data can bear*.
- [VERIFIED — Opus] **The 20-photo overlay cannot answer the gate it was attached to.** A
  competent software estimator also lands points on plausible anatomy, so an overlay cannot
  distinguish estimation from palpation. Provenance is a documentation question, not a visual
  one.
- [VERIFIED — Opus] **Pairing is by date and file order, not exact image identifiers**
  (`compare-core.ts:83`) — an independent structural risk to every number above.
- [RESOLVED — see §0b] **The r = 0.78 claim is Moti's published intra-reliability**, not
  clinician agreement. Sourced to the vendor FAQ. It measures self-consistency and says
  nothing about clinical validity.

# 5. Recommendation

**Do not run any model against this archive.** Not a correction layer, not an MLP, not the
ridge baseline. Every one of them optimises toward a target that caps out at r = 0.32
against radiographic truth.

The provenance question is **closed** — Moti's FAQ answers it ("no intervention of the
practitioner"). No email needed. What remains is a positioning decision, not an engineering one.

Ordered:

1. **Correct the stale numbers** — mem0 `5ef4ef3a` and the handoff, so no future session
   re-derives a plan from `0.38 / 0.19` or from "r = 0.78 means the truth is sound."
2. **Re-examine the other two accuracy items.** Threshold re-anchoring and the FHP construct
   fix were justified partly by validation numbers this document has now overturned. FHP is
   notable: PAViR's own forward-head-posture validity vs EOS is only "slightly positive," so
   an FHP construct fix anchored to Moti inherits the same ceiling.
3. **Decide what the product claims to be.** This is Devin's call, and it is the real output
   of this spike:
   - **Screening / tracking tool** — measures *change over time* in its own consistent units.
     Reliability is what matters, validity against radiography does not. **This is defensible
     today** and needs no correction layer.
   - **Clinical measurement tool** — requires validity against a real gold standard (EOS,
     radiography, or instrumented palpation). Requires a prospective study against that
     standard. The Moti archive cannot support this claim, and neither can a single 2D photo.

## What would actually raise accuracy

If the goal is a better *screening* product, the leverage is not in landmark correction:
- **Reliability over validity** — optimise test-retest consistency (same client, same pose,
  same number). That is what tracking needs, and it is measurable with existing data.
- **Capture control** — Moti needs tight clothing and controlled lighting to hit 1.5° on a
  *mannequin*. posture-ai's capture gate (already built) is the higher-leverage surface.
- **Honest uncertainty** — the engine already compresses range (slopes 0.16–0.36). Reporting
  wider intervals is more defensible than a correction layer chasing a 0.32-valid target.

# 6. Open questions for Devin

1. **Positioning — the real question.** Screening/tracking (defensible now) or clinical
   measurement (needs a prospective study against a radiographic standard)? Everything else
   follows from this.
2. Do threshold re-anchoring and the FHP construct fix still stand, given both leaned on
   numbers this document overturned, and FHP inherits Moti's weak validity?
3. Was the Moti archive ever intended as clinical ground truth, or as a *comparison to a
   competitor device*? Those are different projects, and the second one is still viable —
   "we approximate a €30k scanner from a phone photo" is a real product claim, just not a
   clinical one.
4. [ESTIMATE] Is the 2D-vs-3D modality gap the dominant term in r = −0.067? Pelvic obliquity
   as Moti computes it uses depth; a single frontal photo has none. If so, no landmark work
   closes it — but this is now moot, because the ceiling in §0 kills the direction regardless.
