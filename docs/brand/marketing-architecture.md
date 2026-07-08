# Posture AI — marketing site architecture

Date: 2026-07-06 · Status: adopted
Sources: Hermes competitive research pack (14-site scrape: WHOOP, Oura,
Eight Sleep, Levels, Lumen, Peloton, Bend, STRETCHIT, Hinge Health,
Sword Health, Kaia Health, Tonal, Future, Morpheus) synthesized into the
Plumbline design system (`/DESIGN.md`, which remains normative for all
tokens, type, and color).

## Decision log

- **2026-07-06 — Evolve Plumbline, don't pivot.** The research pack
  proposed a Levels-derived green-black palette. Rejected: our original
  research deliberately avoided health-green territory (Levels and the
  metabolic space own it), and the pack's own anti-pattern list warns
  against copying Levels' green directly. Plumbline's ink-blue /
  porcelain / copper identity and Schibsted / Hanken / Plex Mono stack
  stand. Adopted from the pack: motion tokens (now in DESIGN.md §Motion),
  the homepage architecture below, score-cluster data-viz rules, fluid
  gutters, and the marketing-only editorial serif accent (Source Serif 4).
- Positioning: **a private movement lab** — consumer-premium,
  body-literate, clinically calm. Not a rehab portal, not an AI startup,
  not a loud workout app. The narrative spine is *signal → plan*: a scan
  turns posture into visible drivers, prioritized corrections, and
  retestable progress.

## Homepage section order

Consensus frequencies are from the 14-site scrape; each section lists the
Posture AI translation.

1. **Outcome hero** (14/14) — the promise is the body outcome, never
   "AI": *"See what's pulling your posture out of alignment — then fix
   it with a plan built for your body."* Plumb-line scan visual with
   skeletal overlay above the fold (product-in-use: 12/14).
   Primary CTA "Run a posture scan"; secondary "See a sample report".
2. **Trust strip** (11/14) — before any deep explanation: clinician
   review of content, pose-model provenance (MediaPipe BlazePose),
   privacy posture (on-device landmarks), sample report link. No
   celebrity theater. Trust always sits above pricing.
3. **Signal → plan** (12/14) — the three-step mental model:
   Scan → identify alignment drivers → corrective routine → retest delta.
4. **Body-domain modules** (11/14) — anatomical cards, not feature
   cards: Head & neck, Shoulders, Trunk, Pelvis, Knees. Each card
   answers: what signal, what it means, what to do next.
5. **Progress proof** (10/14) — retest deltas, score trends, adherence
   streaks. Every claim labeled by evidence strength; nothing invented.
6. **Coaching layer** (7/14) — the corrective engine as daily guide,
   with clinician-reviewed education boundaries stated plainly.
7. **Sample report deep-dive** — Posture AI-specific: the client report
   is a brand asset ("came from a $7,000 instrument"); show it.
8. **Stories** (9/14) — only real, approved users; pair each quote with
   its before/after score delta.
9. **Plan / pricing** (9/14) — below proof, never above diagnosis.
10. **Final CTA** (10/14) — repeat the action: *"Run your first posture
    scan"* with no-credit-card / privacy reassurance in `body-sm`.

## Anti-patterns (from underperformer contrast)

- PostureZone (ecommerce-catalog feel) — posture as old clinic equipment.
- Upright Pose (countdown/discount hype, emoji feature icons) — trust
  collapses under direct-response pressure; we use evidence and calm.
- Kaia (employer-ROI framing) — too payer-oriented for a consumer product.

## Implementation notes (NotebookLM "Premium Design Systems" notebook, 2026-07-06)

- **Hero point cloud: static SVG is fine; animated needs WebGL.** The
  current ~2,000-circle constellation renders once and holds — no
  performance issue. If the homepage hero animates it (drift, scan
  sweep), move to a three.js points pipeline: cap device pixel ratio at
  1.5–2 (never raw `devicePixelRatio` — up to 9× GPU work on mobile),
  `pointer-events: none` on the canvas, and pause the render loop
  entirely under `prefers-reduced-motion` (static fallback image).
- **Dark elevation strategy confirmed** — surface stepping + hairline
  borders + hue-tinted ambient glows, never black drop shadows on
  `#0E1420`. This is already Plumbline law; no change.
- **OKLCH**: worth adopting *when* we need generated tint/shade ramps or
  P3 wide-gamut; not worth migrating the verified hex tokens today.

## Open items

- Build the homepage against this order using Plumbline Porcelain mode.
- Source Serif 4 needs adding to the marketing font pipeline (not the app).
- Story/testimonial section stays out until real user proof exists.
