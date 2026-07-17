# Posture AI — Competitive Landscape & Market Research

**Date:** 2026-05-30
**Author:** Strategy research (5 parallel research streams, 30+ sources)
**Purpose:** Decide whether and how Posture AI can become a phone-only, ~$199 competitor to Moti-Physio and Vald HumanTrak.
**Method:** Public sources only (vendor sites, app stores, procurement docs, peer-reviewed validation studies, market reports). Marketing claims not independently verified are flagged `[unconfirmed]`. Inferred tech is flagged *in italics* with reasoning.

---

## Executive Summary

The movement-assessment market splits cleanly into two camps, and the gap between them is our entire opportunity:

1. **Hardware-dependent depth systems** — Moti-Physio ($6,950 one-time), Vald HumanTrak ($4.2K–$18.5K/yr on a 3-year lock-in), Kinetisense (LiDAR iPad/RealSense + ~$249/mo), DARI Motion (enterprise, dedicated room). These deliver genuine 3D accuracy (RMSE 3–7° vs Vicon) but are tethered to depth cameras, Windows laptops, and dedicated space. **None capture from a phone.**
2. **Software-only phone tools** — PostureScreen Mobile ($249/yr), Exer (enterprise), Sency/Kemtai (SDKs), Demotu ($13–$125/mo). These run on the practitioner's own device at near-zero marginal cost. **PostureScreen Mobile at $249/yr is the de-facto reference price and our most direct competitor** — and it is iOS-only for its real (computer-vision) features, leaving Android entirely unserved.

**The core finding:** A phone is now a clinically-defensible screening instrument *for the right metrics*. Single-camera markerless pose (MediaPipe / MoveNet) achieves ~5–10° error for in-plane, perpendicular-view angles (sagittal flexion/extension, craniovertebral angle, kyphosis, knee/hip sagittal, jump symmetry). It is **not** reliable for axial rotation, ankle kinematics, or any joint pointing toward the camera (25–85° observed error). We win by scoping claims tightly, capturing two views to beat depth ambiguity, pricing at **$199/year**, and being the one tool that fits in every practitioner's pocket and works on Android.

**What we cannot match at $199:** true metric 3D depth, force/kinetics estimation, and the published clinical-validation depth of Vald. We don't try — we reframe those as the expensive lab category and own the accessible screening category beneath it.

---

## Section 1 — Competitor Profiles

Grouped by core technology archetype, because that determines cost structure.

### Group A — Hardware-Dependent Depth Systems (our "expensive lab" foil)

#### **Moti-Physio** (en.motiphysio.com) — the user's named benchmark
- **Company:** MGsolutions Inc., Seoul, South Korea; founded 2017; seed-funded (Sopoong Ventures). 2,200+ centers, 70+ countries [en.motiphysio.com/MGsolutions_en].
- **Product:** Fixed-installation 3D posture analyzer (Mini / White / Pro tiers), same software + sensor, different stand/monitor. Static posture (10 criteria, 24 landmarks, 33 spinal tilt angles), 87-muscle tight/weak overlay (Janda / Anatomy Trains), overhead-squat + single-leg-stand dynamic modules, Moiré, Adam's test [humanasg.com; en.motiphysio.com/ResultAnalysis].
- **Hardware:** Orbbec Astra Pro RGB-D structured-light camera + Nuitrack skeleton middleware + Windows 11 PC (Core Ultra 5, USB 3). Indoor only, no sunlight, no mirrors, 50cm+ wall clearance, tight clothing. **Not a phone, not macOS, no web/mobile app** [en.motiphysio.com/FAQ_en; PMC10000598].
- **Price:** ~$6,950 one-time (US reseller); £7,637 EU; KRW 150K/mo rental in Korea. TCO Year 1 ≈ **$8,200–$9,500** incl. PC + Nuitrack license [360healthinternational.com; fiziosan.si].
- **Tech:** *Confirmed* Orbbec Astra Pro + Nuitrack + Windows + game-engine 3D render. *Inferred*: muscle map is a rule-based biomechanical model over the skeleton, not per-pixel ML. Depth-sensor dependent by design.
- **Validation:** One peer-reviewed study vs EOS X-ray (n=100): intra-rater ICC 0.69–0.84, but validity only **fair–moderate** (r 0.32–0.42), and **Q-angle showed no significant correlation** [PMC10000598]. Not yet an FDA/CE medical device.
- **Differentiation angle:** Moti-Physio is a $7K fixed rig in a dark room. We put 80% of its *static-posture* output on the phone the practitioner already owns, add portability (home visits, gym floor, sideline), and cost 97% less.

#### **Vald HumanTrak** (vald.com) — the user's second named benchmark
- **Company:** VALD (Brisbane, AU), founded 2015, ~$25M raised (FTV Capital 2024), 4,000+ elite teams/universities/defence. HumanTrak acquired 2017 [ftvcapital.com].
- **Product:** Markerless 3D movement analysis — 20+ tests (squat, single-leg squat, lunge, CMJ, drop jump, shoulder/hip/cervical ROM, balance), automatic L/R asymmetry, compensatory-movement detection, real-time biofeedback, force estimation via physics engine [valdhealth.com].
- **Hardware:** Azure Kinect DK (discontinued by MS in 2023) or Orbbec Femto Bolt depth camera + **4 wrist/ankle IMU pods** + a VALD-supplied **NVIDIA RTX Windows laptop** + tripod. iToF depth = **cannot be used outdoors in sunlight**. No phone capture (MoveHealth app is view-only) [support.vald.com; valdperformance.com].
- **Price:** Gated; 3-year subscription, hardware included. Estimates: ~$4,200–$5,000/yr (entry) up to **$18,450/yr** (verified university procurement, Mississippi State) [MSU sole-source notice]. TCO over term **$12,600–$55,000**.
- **Tech:** *Confirmed* Azure Kinect / Femto Bolt + IMU fusion @100Hz + VALD Hub cloud + RTX GPU (CUDA inference). *Inferred*: Azure Kinect Body Tracking SDK (ONNX/CUDA) pipeline + Kalman/EKF IMU fusion.
- **Validation:** Strongest in the field. Vs Vicon: RMSE **2.8–7.6°**, ICC 0.63–0.94; **hip extension poor**; healthy young samples (n=17–18) [Military Medicine 2025, PMC12588703; J Biomech 2024].
- **Differentiation angle:** Vald is the genuine accuracy leader and we should not claim parity on 3D joint angles. But it is a briefcase of depth cameras, IMU straps, and a gaming laptop that needs 5-min setup and dies in sunlight. We are zero-setup, sunlight-fine, pocket-sized, and ~1% of the cost — for screening-grade (not lab-grade) output.

#### **Kinetisense** / **DARI Motion** (context)
- **Kinetisense:** True 3D ROM/posture/gait — but requires **LiDAR iPad Pro or Windows + Intel RealSense D415** (RealSense discontinued 2021). ~$249/mo (360 tier) + $800–$1,200 hardware [bodystack.com; kinetisense.com/faq]. *Not phone-only — the "depth-sensor tax" embodied.*
- **DARI Motion:** FDA-cleared multi-camera (6–24 RGB) markerless in a dedicated room; enterprise/military/hospital; historically $300K+. Different category — relevant only as the regulatory-precedent ceiling.

### Group B — Software-Only Phone/Camera Tools (our actual competitive set)

#### **PostureScreen Mobile / PostureCo** (postureanalysis.com) — MOST DIRECT COMPETITOR
- **What:** The most clinically-validated phone posture app. Posture (2/4-view), spinal & shoulder ROM, movement screens (squat, push-up, single-leg), photographic body-comp (LeanScreen), telehealth (RemoteScreen), AI SOAP notes (PostureScribe.AI). 15+ years, chiropractor/PT installed base.
- **Hardware/Platform:** **iOS-only** for CV (needs A12+). Android "Lite" is **manual digitization only — no computer vision**. iPad+LiDAR unlocks limited 3D.
- **Price:** $59.99 entry + **$24.99/mo or $249/yr** (up to 10 iOS devices); Android $99/yr; PostureScribe.AI +$49.99/mo [postureanalysis.com/posturescreen_pricing].
- **Tech:** *Primarily 2D photographic CV + gyro/accelerometer ROM, on-device; proprietary pose (no BlazePose/MoveNet attribution found).* Multiple peer-reviewed validation studies — its real moat.
- **Differentiation angle:** This is the bullseye. We match its $249/yr (undercut to $199), beat it on **Android support** (its biggest gap), modern UX, and dynamic movement screens — without the $49.99/mo scribe upsell.

#### **Exer** (exer.ai)
- Phone-based clinical MSK/neuro/gait, 24-keypoint proprietary CNN, on-device, EHR-integrated, CMS RTM billing. **Enterprise-only** (no solo self-serve). **FDA warning letter Feb 2025** for diagnostic over-claiming on Parkinson's/CP — a cautionary tale on positioning.
- **Differentiation angle:** Exer proves phone-only clinical CV works, but locks it behind hospital contracts and tripped the FDA wire. We serve the solo/small-clinic market it ignores, in a clean wellness/screening lane.

#### **Sency** (sency.ai) & **Kemtai** (kemtai.com)
- **Sency:** On-device movement-assessment **SDK** (proprietary M-OS model, 60fps, 8 mobility/MSK tests). $99.99/mo (≤100 MAU) → usage-based. Developer infra, not a practitioner app.
- **Kemtai:** Web-based rehab/exercise CV (111 points, validated vs 10-camera lab), FDA-listed/CE-marked, **enterprise/API** quote-based.
- **Differentiation angle:** Both are *components* we could license or rebuild, not products practitioners buy. They validate on-device CV economics ($0 inference) more than they threaten us.

#### **Demotu** (demotuapp.com)
- Phone-only "3D" movement screen (6 patterns: jump, OH squat, single-leg balance, hip hinge, lateral, press) + AI program builder + client mgmt. $12.99–$124.99/mo. Newer, thin validation, single-camera "3D" claims *technically suspect*.
- **Differentiation angle:** Our closest *phone-only performance* analogue. We out-credential it by adding validated static posture + ROM and honest accuracy scoping.

#### Adjacent / non-threats
- **Sportsbox AI, Onform** — phone 3D **golf-only**; great single-camera 3D proof, wrong domain.
- **Physitrack** — exercise prescription, **no pose analysis** (the layer practitioners already pair with assessment).
- **OpenCap** — free, 2-phone, research-grade; cloud batch; a future disruptor if it productizes.
- **Movella/Xsens** — IMU suit, $4,590+; not camera-based.

---

## Section 2 — Problem Landscape

### What problem is each competitor actually solving?
All of them solve **the subjectivity problem**: practitioners assess movement by eye, and the eye is unreliable.
- Visual posture assessment is used by **98% of chiropractors** yet "is known to lack validity and reliability" [PMC12732692].
- Visual single-leg-squat scoring: inter-rater **ICC 0.58** (range 0.00–0.95) [PMC6579566].
- Goniometer shoulder ROM: inter-rater **ICC 0.64–0.69** [eumotus.com].

On top of objectivity, the buyers' real jobs-to-be-done are:
1. **Defensible documentation** — insurance/medico-legal proof ("flexion 95°→155° over 8 sessions"), a hard purchasing trigger for chiros/PTs.
2. **Client buy-in / the "wow factor"** — clients who *see* their asymmetry pre-pay for correction programs. Assessment is a sales-conversion tool.
3. **Progress tracking** — longitudinal deltas justify continued care and anchor recurring subscriptions.
4. **Time efficiency** — automate a 5–15 min manual goniometry workflow down to ~3 min.
5. **Practice differentiation** — "precision diagnostics" as a marketing edge; assessments billed at $30–$120 each.

The hardware players (Moti, Vald) layer on a **6th job: lab-grade credibility** — the depth sensor *is* the trust signal for elite/clinical buyers.

### What problem are WE solving?
The **same** objectivity + documentation + buy-in jobs — but for the ~majority of the market the hardware players structurally cannot reach:
- The solo physio, chiro, athletic trainer, S&C coach, or PT who will **never** spend $7K–$55K or dedicate a dark room.
- The **mobile** practitioner: home visits, sports sidelines, gym floor, travel, telehealth — exactly where iToF depth cameras fail (sunlight) and Windows rigs can't go.
- The **Android** practitioner PostureScreen abandoned.

We are not selling lab accuracy. We are selling *"objective enough, documented, portable, on the phone you already own, for $199."*

### How do we do it faster and cheaper — phone only?
- **Faster:** on-device inference (no upload), 2-view capture in <60s, instant report. No camera/IMU/laptop setup.
- **Cheaper:** the practitioner's phone *is* the BOM. Inference cost ≈ $0 (Apache-2.0 models run locally). No hardware to manufacture, ship, or service.

---

## Section 3 — Feature & Pricing Matrix

| Product | Core assessment | Hardware | Platform | Price | 3D? | Phone-only? | Validation |
|---|---|---|---|---|---|---|---|
| **Moti-Physio** | Static posture + 87 muscles + 2 dynamic | Orbbec RGB-D + Nuitrack + Win PC | Windows desktop | **$6,950 one-time** (~$8–9.5K TCO) | True 3D (depth) | ❌ | 1 study, fair–moderate (r 0.32–0.42) |
| **Vald HumanTrak** | 20+ movement/ROM, asymmetry, force | Azure Kinect/Femto + 4 IMUs + RTX laptop | Windows desktop | **$4.2K–$18.5K/yr**, 3-yr lock | True 3D (depth+IMU) | ❌ | Strong, RMSE 3–7° vs Vicon |
| **Kinetisense** | 3D ROM/posture/gait/balance | LiDAR iPad Pro or RealSense+PC | iPad Pro / Windows | ~$249/mo + HW | True 3D (depth) | ❌ | Vendor claims vs Vicon |
| **PostureScreen Mobile** | Posture + ROM + movement + body-comp | None (phone) | **iOS** (Android=manual) | **$249/yr** ($24.99/mo) | 2D (+iPad LiDAR) | ✅ (iOS) | Multiple peer-reviewed |
| **Exer** | Clinical MSK/neuro/gait | None (phone) | iOS+Android+web | Enterprise (gated) | 2D CNN | ✅ | Mayo; **FDA warning 2/2025** |
| **Demotu** | 6 movement-pattern screen | None (phone) | iOS+Android | $12.99–$124.99/mo | "3D" *(suspect)* | ✅ | Thin |
| **Sency (SDK)** | Mobility/MSK screen SDK | None (phone) | iOS+Android SDK | $99.99/mo→usage | 2D on-device | ✅ | Proprietary |
| **Kemtai** | Rehab exercise CV | None (any cam) | Web/API | Enterprise | 2D | ✅ | Validated vs lab |
| **🎯 Posture AI (target)** | **Static posture + sagittal ROM + movement screen (SLS/OHS/jump symmetry)** | **None (phone)** | **iOS + Android** | **$199/yr** | **2D + 2-view + est. depth** | **✅** | **Scoped, cite-backed claims** |

### Pricing reality check (reasoning backward from price)
- Hardware players' BOM forces their price: depth camera ($350–$400) + Windows/RTX laptop + IMUs + cloud + sales/procurement → $4K–$55K/yr. Margin lives in the hardware+lock-in.
- **Our BOM is ~$0** (phone is the customer's). Cost structure: App Store cut (15% Small Business Program = ~$30 on $199) + infra (~$0.07/user/mo) + Apple/Google dev fees. **At $199/yr, gross margin is ~$160+/user/yr.** $199 is not a stretch — it's comfortable.
- **$199/year, not $199 one-time** (see Section 5).

---

## Section 4 — Technology Stack Analysis

### Competitor stacks (confirmed / *inferred*)
- **Moti-Physio:** Orbbec Astra Pro + Nuitrack + Windows + *game-engine render*; *rule-based muscle model*. Depth-dependent.
- **Vald HumanTrak:** Azure Kinect/Femto Bolt + 4 IMUs + RTX laptop + VALD Hub cloud; *Azure Body Tracking SDK (ONNX/CUDA) + EKF fusion*. Depth+inertial.
- **PostureScreen:** *2D photographic CV + IMU-sensor ROM, on-device, proprietary pose.*
- **Exer/Sency/Kemtai:** proprietary on-device CNNs (24/M-OS/111-point).

### The on-device pose landscape (what we'd build on)
| Model | Keypoints | 2D/3D | Mobile latency | License | iOS | Android | Web |
|---|---|---|---|---|---|---|---|
| **MediaPipe Pose Landmarker (BlazePose GHUM)** | 33 | 2D + world-3D | ~8ms GPU | **Apache 2.0** | ✅ | ✅ | ✅ (WASM) |
| MoveNet Thunder | 17 | 2D | <10ms | Apache 2.0 | ✅ | ✅ | ✅ |
| Apple Vision 3D (iOS 17+) | 17 | 3D (metric w/ LiDAR) | frame-rate | free (iOS) | ✅ | ❌ | ❌ |
| ML Kit Pose | 32 | 2D+z | 15–30fps | Apache 2.0 | ✅ | ✅ | ❌ |
| YOLOv8-pose | 17 | 2D | 30–60fps | **AGPL-3.0 ⚠️** | export | export | ❌ |

**Recommendation: MediaPipe Pose Landmarker Full** — 33 landmarks incl. metric `worldLandmarks`, Apache 2.0 (free commercial), cross-platform, $0 inference. Avoid YOLOv8 (AGPL forces open-source or paid license). Apple Vision 3D is a strong iOS-only *fallback*.

### Accuracy reality (the honesty section — non-negotiable for clinical trust)
Single-camera markerless, from peer-reviewed studies:
- **Defensible (~5–10° RMSE):** sagittal shoulder/hip/knee flexion-extension (perpendicular lateral view), craniovertebral / forward-head angle (ICC 0.71–0.99), thoracic kyphosis (ICC 0.81–0.96), shoulder abduction (frontal), jump/landing vertical symmetry (ICC 0.84–0.95), gait spatiotemporal (ICC 0.81–0.98) [PMC11679233; PMC5446097; eumotus.com; PMC11175331].
- **NOT defensible:** axial rotation (shoulder/hip IR-ER), wrist, **ankle kinematics (ICC as low as −0.39)**, any joint pointing at the camera (25–85° error), elbow flexion in some setups (RMSE 25°). MediaPipe's z is *model-estimated, not measured* (MPJPE ~78–121mm).
- **Mitigation:** capture **two views (front + side, one phone, sequential)** and compute each angle from its correct plane → 30–47% error reduction. Standardize 3m distance, camera at joint height, tripod, 1× lens. Capture 3–5s clip, Butterworth-filter, report stable median ± SD, gate confidence <0.7.

### Architecture verdict (current stack vs. recommended)
**Current build = Next.js 16 web/PWA + `@mediapipe/tasks-vision` (WASM) + pure-TS posture engine + Supabase + react-pdf.** The existing PRD chose web *because ZeroForge could self-verify it* — a build-tooling reason, not a product reason.

**The web/PWA capture path is disqualifying for a phone-only product:**
1. **iOS Safari does not persist camera permission for PWAs** — re-grant every session (dealbreaker for ~60–70% of practitioners).
2. WASM/WebGL inference is **3–5× slower** than native on phones (5–15fps for the accurate model).
3. No reliable background/native video capture; aggressive tab suspension; weak store presence for a paid product.

**Recommended: React Native + Expo + VisionCamera V5 + react-native-fast-tflite + MediaPipe Pose Landmarker Full.** VisionCamera V5 frame processors run native (2–5ms/frame, JSI worklets). On-device, offline, App Store + Play Store, **iOS and Android from one codebase**.

**Keep (high-value reuse):** the **pure-TS `posture-engine`** (geometry → severity → grade/percentile, no DOM/network) drops straight into React Native unchanged — it's our genuine IP. Keep **Supabase** (RLS, auth, storage). Repurpose the **Next.js app as the web report-portal/dashboard** (shareable client reports, trends, billing) — not the capture surface.

---

## Section 5 — Differentiation & Cost Strategy

### What $199 *can* buy (achievable parity)
- ✅ Static posture battery (we already compute 10 imbalances — reusable engine).
- ✅ Sagittal ROM (shoulder/hip/knee flexion-extension, cervical) via 2-view capture.
- ✅ Movement screens: single-leg squat scoring, overhead squat, jump/landing **vertical symmetry** (LSI) — the highest-demand, lowest-subjectivity-fix items.
- ✅ Asymmetry % (L/R) for frontal-plane and vertical metrics.
- ✅ Auto PDF reports, progress trends, client management, exercise recommendations.
- ✅ iOS **and** Android.

### What $199 *cannot* buy (be honest)
- ❌ Metric 3D depth / true triaxial joint angles (needs depth sensor — Vald/Moti/Kinetisense moat).
- ❌ Force/kinetics estimation (no force plate, no physics engine claim).
- ❌ Axial rotation, ankle kinematics, transverse-plane reliability.
- ❌ The published-validation depth of Vald on day one (we build it over time; cite single-camera literature meanwhile).

**Strategy: don't fake parity — reframe the category.** Position the depth systems as "the lab" and Posture AI as "the pocket screen that flags who needs the lab." This is honest, defensible, and FDA-safe.

### Cost strategy
- **On-device inference = $0/assessment.** Infra ~$0.07/user/mo (Supabase). Dominant cost is the 15% App Store cut.
- **Phone-only eliminates the entire hardware cost line** that forces competitors to $4K–$55K. That single architectural choice *is* the "fraction of the cost."

### Pricing recommendation
- **$199/year subscription** (≈$16.58/mo), with a ~$24.99/mo monthly option. Undercuts PostureScreen's $249/yr by 20%, sits in the practitioner-SaaS comfort zone, funds cloud + updates.
- **Avoid $199 one-time:** no recurring revenue for infra/updates, signals "disposable/abandonware," and bait-and-switch risk if you later add a subscription.
- **Free tier:** first 5 assessments free → behavioral lock-in at $0 CAC, convert on demonstrated value.
- Tiering: Free (5/mo) · **Solo $199/yr** · Clinic $399/yr (multi-seat, cloud, BAA, branded reports) · Enterprise custom.

### Recommended MVP feature set (for the PRD)
1. Native iOS+Android capture (front+side, guided framing, on-device MediaPipe).
2. Reuse pure-TS engine → static posture battery + sagittal ROM.
3. One dynamic screen in MVP: **single-leg squat** (highest subjectivity-fix value, ICC 0.58 today) **or** overhead squat.
4. Auto report (on-screen + PDF) with confidence flags + non-diagnostic disclaimer.
5. Client management + progress trends (reuse Supabase schema).
6. **Local-storage mode** (sidesteps HIPAA BAA for solo tier).
7. Wellness/screening positioning copy throughout.

### Regulatory & privacy (must-haves, not features)
- **Stay non-device:** "movement & posture **screening**, not diagnosis." Banned language: "diagnose," "rehabilitation evaluation" (DARI's 510(k) indication), "detects injury/disease." Exer's Feb-2025 FDA warning is the cautionary precedent.
- **HIPAA:** if you store client video/PII in the cloud you become a Business Associate (need BAAs, AES-256, TLS, audit logs). **Local-storage-only mode = no BAA obligation** — ship that for the $199 solo tier; reserve cloud sync + BAA for the Clinic tier.

---

## Strategic Q&A (the brief's explicit questions)

**Q: What are they actually offering?**
Objective, documented, client-legible movement/posture data that replaces the unreliable human eye — plus, for the hardware tier, lab-grade credibility via a depth sensor.

**Q: What problems are they solving?**
Subjectivity (ICC 0.58 SLS, 0.64–0.69 goniometry), medico-legal documentation, client buy-in, progress tracking, time, and practice differentiation.

**Q: What problems are WE solving?**
The same jobs, for the larger, mobile, price-sensitive, Android-inclusive practitioner segment that $4K–$55K hardware structurally locks out — on the phone they already carry.

**Q: How do we do it faster and cheaper, phone-only?**
On-device inference ($0, no upload), 2-view <60s capture, zero hardware/setup. The phone is the BOM, so we deliver screening-grade output at ~1% of competitor cost — and we honestly *don't* claim the lab-grade 3D/force metrics we can't produce.

---

## Sources (selected)
Moti-Physio: en.motiphysio.com, /MGsolutions_en, /FAQ_en, /ResultAnalysis; PMC10000598; 360healthinternational.com; fiziosan.si. Vald: vald.com, valdhealth.com, support.vald.com, valdperformance.com/products/humantrak; PMC12588703 (Military Medicine 2025); J Biomech 2024; MSU procurement notice; ftvcapital.com. Phone tools: postureanalysis.com/posturescreen_pricing; exer.ai (+FDA warning 699218); sency.ai/pricing; kemtai.com; demotuapp.com; bodystack.com (Kinetisense); kinetisense.com/faq. Tech: ai.google.dev MediaPipe Pose Landmarker; PMC11679233; PMC11644880; PMC5446097; PMC11175331; eumotus.com; mrousavy.com VisionCamera; github.com/mrousavy/react-native-vision-camera. Market/regulatory: healthcare.digital digital-MSK forecast; GlobeNewswire 2025; FDA General Wellness Policy; DARI 510(k) K180880; PMC6579566 (SLS ICC); PMC12732692 (chiro posture survey).
