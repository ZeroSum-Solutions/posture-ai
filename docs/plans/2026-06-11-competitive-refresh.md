# Competitive Landscape Refresh (2026-06-11)

Light refresh of `2026-05-30-competitive-landscape.md`. Scope: material changes since ~May 2026 only. **Bottom line: the May-30 strategy survives fully intact, slightly strengthened.**

## 1. PostureScreen Mobile (PostureCo) — UNCHANGED

Pricing identical to baseline: $24.99/mo or $249/yr unlimited iOS assessments; Android version still explicitly "manual digitization only — no computer vision." Only delta: enterprise pricing published at $14.50/login/mo (1–49 users) and cloud storage dropped to $0.40/GB/mo effective Jan 1, 2026 — irrelevant to the solo segment. **The Android-CV gap (our wedge) remains open.**

Sources: [pricing](https://www.postureanalysis.com/posturescreen_pricing/), [AI features page](https://www.postureanalysis.com/posturescreen-posture-movement-body-composition-analysis-assessment/), [Google Play — PostureScreen Lite](https://play.google.com/store/apps/details?id=com.postureco.posturescreen&hl=en_US)

## 2. Exer (exer.ai) — UNCHANGED (no resolution, no pivot)

The Feb 10, 2025 FDA warning letter (Exer Scan marketed beyond its 510(k)-exempt category for Parkinson's/CP screening, plus design-control deficiencies) remains the last regulatory event — no close-out letter, no 510(k) clearance found. Marketing continues with scaled-back "motion assessment / patient monitoring" claims. No new funding since the 2022 Series A ($14.1M total). Still enterprise-only; not a threat in the solo lane. **Keeps reinforcing our screening-only positioning discipline.**

Sources: [FDA warning letter 699218](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/exer-labs-inc-699218-02102025), [exer.ai](https://www.exer.ai/), [CB Insights](https://www.cbinsights.com/company/exerai)

## 3. Demotu — CHANGED (material)

Two real changes from the baseline's "$12.99–$124.99/mo":

1. **Repriced upmarket** — Individual plan now starts at **$105/mo** (30 clients), with paid add-ons (branding +$20/mo, API +$150/mo) and a consumable "AI generation credits" model, plus Organization/Enterprise tiers.
2. **B2B2C distribution** — April 2026 partnership with VASA Fitness embeds Demotu's 3D assessment in a consumer PT app at ~$14.99/mo.

**Net effect: Demotu has vacated the sub-$100/mo solo-practitioner band — strengthening the case for Posture AI at $199/yr.**

Sources: [demotuapp.com/pricing](https://www.demotuapp.com/pricing), [VASA press release](https://vasafitness.com/press/vasa-fitness-launches-industry-first-personal-training-app-in-hvlp-category-redefining-coaching-at-scale/)

## 4. MotiPhysio — UNCHANGED

Still the fixed-installation Orbbec RGB-D + Windows rig; no phone/mobile capture app, no web product, no announced platform change. Same 87-muscle model / 37,000-person dataset marketing as in May.

Sources: [en.motiphysio.com](https://en.motiphysio.com/), [3DPostureAnalyzer](https://en.motiphysio.com/3DPostureAnalyzer_en)

## 5. New phone-only entrants — TWO MINOR, NEITHER A DIRECT THREAT

- **ePose** (epose.com, Japan, launched June 2025): tablet/phone photo-based AI posture scoring (12 posture types, /100 score) aimed at salons, chiro/osteo clinics, and gyms. Practitioner-facing and conceptually close to our static battery, but Japan-market, static-only, no ROM/movement screens. **Watch-list.** [epose.com/en](https://www.epose.com/en/), [launch news](https://www.epose.com/en/app-release-news-en/)
- **"Posture AI: Correct My Posture"** (postureai.app, iOS): consumer app that added a one-time **$99.99 "Practitioner Mode"**. Consumer-grade, no validation posture — but a **namespace collision with our product name**, worth noting for branding/SEO. [App Store](https://apps.apple.com/us/app/posture-ai-correct-my-posture/id6740040938), [postureai.app](https://postureai.app/)
- No credible new validated practitioner-grade phone-only entrant found in 2026 searches (APECS, SitSense etc. are pre-existing consumer tools).

## 6. MediaPipe / pose tooling — UNCHANGED in substance

`@mediapipe/tasks-vision` latest stable is **0.10.35** (nightlies at 0.10.36-rc; verified via npm registry 2026-06-11) — still the 0.10.x line, no breaking changes, no new pose model. Higher-accuracy research models (Meta Sapiens, ViTPose++) outperform BlazePose on benchmarks but have **no production-grade browser deployment path** — server-side ONNX territory only. **The MediaPipe Pose Landmarker recommendation stands; pin 0.10.35.**

Sources: npm registry dist-tags, [MediaPipe releases](https://github.com/google-ai-edge/mediapipe/releases), [Pose Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), [Roboflow model comparison](https://blog.roboflow.com/best-pose-estimation-models/)

## Implications for Posture AI

PostureScreen still hasn't shipped Android CV and still anchors the reference price at $249/yr, so the $199/yr + Android wedge is undamaged; Demotu's move to $105+/mo widens the affordable-solo gap beneath us rather than closing it. Exer's unresolved FDA situation keeps the "screening, not diagnosis" lane both differentiating and necessary. On tech, nothing newer beats MediaPipe tasks-vision 0.10.x for browser static-photo pose in mid-2026. The one strategic signal: ePose-style lightweight photo-posture tools are commoditizing the static battery — the moat must be muscle-knowledge depth + practitioner workflow (and later ROM/movement layers), not static posture scoring alone.
