# Posture AI — Product Goal (2026-06-11)

Supersedes the vision statements in the v1 PRD (2026-05-29) and v2 mobile PRD (2026-05-30) as the single overarching goal. Direction decided 2026-06-11: **mobile-web first** — the native Expo app is deferred.

## The goal

**Posture AI** lets a movement practitioner photograph a client with nothing but a phone — front and side static posture photos in the browser, no hardware, no app install — and receive an objective postural screening in seconds.

From the photos, the system detects pose landmarks (MediaPipe), computes a clinical battery of 10 postural distortions (forward head posture, shoulder imbalances, T1 tilt, pelvic obliquity/shift/rotation, genu varum/valgum, knee hyperextension) with severity zones and an overall grade, and maps each distortion to the muscles likely **tight (needing stretching)** and **weak (needing strengthening)**, grounded in Janda/Kendall clinical reasoning.

The practitioner can drill into **every implicated muscle** — anatomy, function, why it becomes tight or weak in that specific distortion — and gets concrete, prescribable **stretches and strengthening progressions** for each, plus a branded client-ready PDF report and progress tracking across assessments.

## Positioning

- **Screening, not diagnosis.** Non-diagnostic vocabulary and disclaimers everywhere — a hard constraint, not a style preference (Exer's Feb 2025 FDA warning letter is the cautionary tale).
- Pocket alternative to $7K+ clinic rigs (MotiPhysio, Vald HumanTrak).
- Undercuts PostureScreen Mobile ($249/yr, iOS-only CV) at $199/yr with cross-platform browser delivery — works on iPhone *and* Android because it's the web.
- The moat is muscle-knowledge depth + practitioner workflow, not pose detection itself (static-photo pose scoring is commoditizing — see the competitive refresh).

## Current scope decisions (2026-06-11)

| Decision | Choice |
|---|---|
| Capture surface | Mobile-web (existing Next.js app); native Expo app deferred |
| Production finish line | Hardened core product + muscle knowledge base |
| Out of scope this push | Billing/Stripe, app-store submission, native mobile, video/dynamic movement |

See `2026-06-11-production-roadmap.md` for the execution plan.
