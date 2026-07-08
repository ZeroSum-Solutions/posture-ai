# Plumbline — Marketing Homepage Composition Spec

## Global Art Direction: Engineered Calm
The rhythm of this page is dictated by expansion and compression. Whitespace (`128px` section gaps) acts as the primary signal of luxury, separating dense, highly structured data panels. The page is asymmetric but anchored: the signature **plumb line**—a `1.5px` vertical hairline in `primary` (`#243B6B`)—recurs throughout the scroll. It acts as a left-border in editorial blocks, a timeline connecting body domains, and the central axis of the hero visual. We never use drop shadows to separate page sections; depth is achieved strictly through tonal stepping (`background` `#F6F4EF` → `surface` `#FFFFFF` → `border` `#E2DED4`). 

---

## 1. Outcome Hero
**Layout Geometry:**
*   **Grid:** 12-column, fluid gutters (`clamp(20px, 4vw, 56px)`), max-width `1360px`.
*   **Alignment:** Asymmetric 5:7 split. Left 5 columns for copy (vertically centered). Right 7 columns for the point-cloud visual, bleeding slightly off the right edge.
*   **Spacing:** `96px` top padding, `48px` gap between headline and body, `32px` below body for the CTA group.

**Full Copy Draft:**
*   *Headline:* See what’s pulling your posture out of alignment — then fix it with a plan built for your body.
*   *Body:* A clinical-grade screening platform for movement professionals and their clients. Measure alignment drivers, prioritize corrections, and track retestable progress.
*   *Primary CTA:* Run a posture scan
*   *Secondary CTA:* See a sample report

**Typographic Treatment:**
*   *Headline:* `display` (Schibsted Grotesk, 64px, 700, line-height 1.02).
*   *Body:* `body-lg` (Hanken Grotesk, 18px, 400).
*   *Primary CTA:* `label-md` (Hanken Grotesk, 14px, 600) inside `button-primary`.
*   *Secondary CTA:* `label-md` inside `button-secondary`.

**Color Usage:**
*   Background is `background` (`#F6F4EF` Porcelain).
*   Text is `text-primary` (`#161D2B` Ink).
*   Primary CTA is `primary` (`#243B6B`) fill with `#FFFFFF` text. Secondary CTA is transparent with `primary` text and a 1px `primary` border.

**Deliberate Premium Detail (The Craft Move):**
The right-side visual is a static SVG point-cloud constellation (~2,000 dots, `primary-tint` `#E4E9F3`). Bisecting the figure is the 1.5px `primary` plumb line. A single CSS scan-line sweep bounded by the silhouette's mask moves top-to-bottom on load (480ms, `--ease-reveal`). The animation pauses entirely under `prefers-reduced-motion`. Angle arcs sit quietly off the joints, labeled in `data-sm` with slashed zeros (e.g., `12.4°`).

---

## 2. Trust Strip
**Layout Geometry:**
*   **Grid:** Single-row horizontal flex, centered.
*   **Spacing:** `96px` below the hero CTA. Items separated by `32px` gaps.

**Full Copy Draft:**
*   `On-device processing via MediaPipe BlazePose`
*   `Clinician-reviewed corrective protocols`
*   `Zero cloud storage of landmark data`

**Typographic Treatment:**
*   All items set in `data-sm` (IBM Plex Mono, 12.5px, 400).

**Color Usage:**
*   Text is `text-secondary` (`#4A5568`).
*   Dividers between items are 14px-tall vertical hairlines in `copper` (`#8A5537`).

**Deliberate Premium Detail (The Craft Move):**
Setting the trust strip in `data-sm` (Plex Mono) rather than a sans-serif makes it read like a technical spec sheet rather than a marketing boast. The subtle `copper` hairlines introduce warmth without competing for interaction.

---

## 3. Signal → Plan (3 Steps)
**Layout Geometry:**
*   **Grid:** 3-column equal split.
*   **Spacing:** `128px` top margin. `32px` gap between columns. `16px` between step number, title, and body.

**Full Copy Draft:**
*   *01 / Scan:* Identify alignment drivers. Map your baseline against clinical reference angles in seconds.
*   *02 / Plan:* Corrective routine. Follow a daily, prioritized sequence targeting the muscular drivers of your posture.
*   *03 / Retest:* Measure the delta. Run a follow-up scan to visualize structural progress over time.

**Typographic Treatment:**
*   *Step Numbers (01, 02, 03):* `data-xl` (IBM Plex Mono, 56px, 300, `font-feature-settings: "zero" 1`).
*   *Titles:* `headline-sm` (Schibsted Grotesk, 21px, 600).
*   *Body:* `body-md` (Hanken Grotesk, 16px, 400).

**Color Usage:**
*   Step numbers are `primary-tint` (`#E4E9F3`), sitting quietly behind/above the text.
*   Titles are `text-primary` (`#161D2B`).
*   Body is `text-secondary` (`#4A5568`).

**Deliberate Premium Detail (The Craft Move):**
No bounding boxes or cards. The structure is entirely typographical. The `data-xl` step numbers function as architectural watermarks, providing massive scale contrast against the `body-md` text.

---

## 4. Body-Domain Modules
**Layout Geometry:**
*   **Grid:** Asymmetric sticky-scroll. Left 4 columns hold the sticky section title. Right 8 columns hold a vertical stack of 5 domain cards.
*   **Spacing:** `128px` top margin. Cards have `24px` internal padding and `24px` margins between them.

**Full Copy Draft:**
*   *Section Title:* The body domains
*   *Card 1 (Head & neck):*
    *   Grade: `D` | `18th percentile`
    *   Signal: `Forward head posture · +4.2°`
    *   Meaning: `Mild anterior shift. Increases cervical load and upper trapezius tension.`
    *   Next action: `Deep neck flexor activation.`
*   *(Cards 2-5 follow identical syntax for Shoulders, Trunk, Pelvis, Knees).*

**Typographic Treatment:**
*   *Section Title:* `headline-lg` (Schibsted Grotesk, 40px).
*   *Grade Letter:* `headline-md` (Schibsted Grotesk, 28px). Percentile: `data-sm` (Plex Mono).
*   *Signal/Meaning/Next:* `label-md` for the key term, `body-sm` for the explanation.
*   *Degrees (+4.2°):* `data-md` (Plex Mono, 16px).

**Color Usage:**
*   Cards are `surface` (`#FFFFFF`) sitting on the `background` (`#F6F4EF`), with a 1px `border` (`#E2DED4`).
*   The "D" grade tile uses `warning-tint` (`#F3EAD8`) background and `warning` (`#8F5B12`) text.
*   The plumb line connecting the cards vertically uses `border-strong` (`#C9C4B8`).

**Deliberate Premium Detail (The Craft Move):**
The "Score Cluster" rule is strictly enforced: the scary grade (`D`) is never presented alone. It is instantly contextualized horizontally by the exact driver in Plex Mono, the plain-language meaning, and the exact physical next action. A 1.5px vertical line runs through the left side of the cards, threading them together like vertebrae.

---

## 5. Progress Proof
**Layout Geometry:**
*   **Grid:** Centered editorial lockup, 8 columns max width.
*   **Spacing:** `128px` top margin. `48px` gap between the editorial quote and the data tiles below it.

**Full Copy Draft:**
*   *Editorial Accent:* *A baseline is only useful if it moves.*
*   *Headline:* Visualizing the delta.
*   *Body:* Progress isn't a feeling. It’s a measurable shift in resting alignment. Track adherence streaks and watch priority angles return to optimal ranges.
*   *Data Tile:* `Trunk inclination · −3.1° since 22 May`

**Typographic Treatment:**
*   *Editorial Accent:* Source Serif 4 Italic (28px) — *The only use of the marketing serif accent on the page.*
*   *Headline:* `headline-lg` (Schibsted Grotesk, 40px).
*   *Body:* `body-lg` (Hanken Grotesk, 18px).
*   *Data Tile Output:* `data-xl` for the "-3.1°" (Plex Mono, 56px, 300).

**Color Usage:**
*   Editorial accent is `copper-large` (`#9C6644`).
*   Data tile readout is `maintain` (`#1F6E62`) because the angle has improved.
*   Data track uses a 1px `border` with a `maintain` fill segment.

**Deliberate Premium Detail (The Craft Move):**
The "Risk Bar" component: a delicate, 1px horizontal hairline track. Only a small segment is filled in the `maintain` color, terminating exactly at the Plex Mono readout. The bar is visual garnish; the data is the hero. 

---

## 6. Coaching Layer
**Layout Geometry:**
*   **Grid:** 2-column offset (Image left 6 cols, Text right 5 cols, 1 col center gap).
*   **Spacing:** `128px` section gap. `24px` internal UI layout spacing.

**Full Copy Draft:**
*   *Headline:* The corrective engine as your daily guide.
*   *Body:* Turn your screening results into an actionable routine. With clinician-reviewed education boundaries, you know exactly what to stretch, what to strengthen, and when a finding requires professional referral.
*   *Feature label:* `Targeted activation protocols`

**Typographic Treatment:**
*   *Headline:* `headline-lg` (Schibsted Grotesk, 40px).
*   *Body:* `body-lg` (Hanken Grotesk).
*   *Feature label:* `label-md` (Hanken Grotesk).

**Color Usage:**
*   Text is `text-primary`.
*   UI abstraction container is `surface` (`#FFFFFF`) with `border-control` (`#8D897E`) outlines representing the daily routine checklist.

**Deliberate Premium Detail (The Craft Move):**
Zero performant motion or "AI" hype. The visual abstraction of the coaching layer is just a clean stack of 10px-radius control buttons ("Complete routine") and `label-md` checkmarks. It looks like a clinical adherence tool, not a sweaty fitness app.

---

## 7. Sample Report Deep-dive
**Layout Geometry:**
*   **Grid:** Full-bleed container, center-aligned content.
*   **Spacing:** `128px` top margin. `96px` top/bottom padding inside the sunken container.

**Full Copy Draft:**
*   *Headline:* Clinical-grade reporting, generated in seconds.
*   *Body:* A report that looks like it came from a $7,000 clinic rig. Hand your clients a comprehensive, printed breakdown of their structural baselines.
*   *Disclaimer rendering:* `Screening purposes only. Not a medical diagnosis.`

**Typographic Treatment:**
*   *Headline:* `headline-lg` (Schibsted Grotesk).
*   *Body:* `body-lg` (Hanken Grotesk).
*   *Disclaimer:* `body-sm` (Hanken Grotesk, 14px).

**Color Usage:**
*   Section background changes to `background-sunken` (`#EFECE3`) full-bleed.
*   The report card itself is `surface` (`#FFFFFF`).
*   Shadow on the report card is `rgba(22, 29, 43, 0.10)` (ink-tinted, soft, large-radius).

**Deliberate Premium Detail (The Craft Move):**
The tonal step down to `#EFECE3` makes the pure `#FFFFFF` of the sample report paper visually "lift" off the screen. Inside the rendered report graphic, the non-diagnostic disclaimer is explicitly visible set in `body-sm` `text-secondary`, turning a legal requirement into a signal of clinical credibility.

---

## 8. Final CTA
**Layout Geometry:**
*   **Grid:** Centered, 6 columns max width.
*   **Spacing:** `128px` top margin, `96px` bottom margin to footer. `32px` gap between headline and button. `16px` down to the privacy text.

**Full Copy Draft:**
*   *Headline:* Run your first posture scan.
*   *Button:* Run a posture scan
*   *Microcopy:* No credit card required. On-device processing keeps your landmarks private.

**Typographic Treatment:**
*   *Headline:* `headline-lg` (Schibsted Grotesk, 40px).
*   *Button:* `label-md` (Hanken Grotesk, 14px, 600).
*   *Microcopy:* `body-sm` (Hanken Grotesk, 14px).

**Color Usage:**
*   Button is `primary` (`#243B6B`) fill, `#FFFFFF` text.
*   Microcopy is `text-secondary` (`#4A5568`).
*   The word "first" in the headline features a 2px `copper` (`#8A5537`) underline.

**Deliberate Premium Detail (The Craft Move):**
The `copper` underline under the word "first" is the only colored typographical accent on the screen. It draws the eye directly to the center of the viewport, resting cleanly above the primary action button, reinforcing the "engineered calm" by using space and a single warm accent rather than screaming urgency.
---

# ART-DIRECTOR CORRECTIONS (normative, override the spec above where they conflict)

1. HERO HEADLINE: display headline is "Movement, measured." (Schibsted 700, 64px).
   Subhead (body-lg): "See what's pulling your posture out of alignment — and fix
   it with a plan built for your body." The long sentence is NOT the display headline.
2. TRUST STRIP COPY (replaces the three items — the "zero cloud storage" claim is
   factually false for this product):
   - "Pose estimation · MediaPipe BlazePose"
   - "Clinician-reviewed exercise & muscle content"
   - "Explicit consent before every capture"
3. REPORT CARD (§7): NO drop shadow (DESIGN.md law: no shadows on cards). The lift
   comes from the sunken background (#EFECE3) + white surface + 1px border-strong
   hairline. Delete the rgba shadow.
4. SAMPLE DATA: the D-grade domain card (§4) and the −3.1° delta (§5) must carry a
   small "SAMPLE DATA" label in data-sm secondary — we never imply real user proof.

# IMPLEMENTATION REQUIREMENTS

- Modify app/page.tsx: KEEP the Supabase auth check; signed-in users still
  redirect to /dashboard; anonymous users render the marketing homepage instead
  of redirecting to sign-in.
- Marketing page lives in app/_components/marketing/ (server component + one CSS
  module; a small client component only for the point-cloud SVG generation).
- The page provides its own light marketing header (icon.svg mark + "Posture AI"
  + right-aligned "Sign in" link → /auth/sign-in + compact primary CTA). Modify
  components/NavBar.tsx to return null when pathname === '/'. The existing dark
  root-layout footer stays (deliberate dark end-cap).
- Point cloud: client component, deterministic mulberry32 seed (NO Math.random),
  ~1,600–2,000 dots forming a standing side-profile figure, dots in primary-tint
  family on porcelain, 1.5px primary plumb line, two angle-arc annotations with
  Plex Mono degree labels. Reference implementation of the segment/capsule dot
  sampler exists in docs/brand/assessment-results-mockup.html (dark version —
  adapt colors/opacity for light mode: dots #243B6B at 0.10–0.45 opacity mixed
  with #8A5537 copper at ~8% frequency).
- Scan sweep: one CSS animation, a horizontal hairline sweeping down the figure
  once on load (~1.4s total using --ease-reveal), fully disabled under
  @media (prefers-reduced-motion: reduce).
- Fonts: use existing CSS vars --font-display / --font-body / --font-data (loaded
  in layout). Source Serif 4: load via next/font/google in the marketing
  component module ONLY (italic 400, subset latin), used for the single §5 pull quote.
- Tokens: use the CSS custom properties from app/globals.css @theme block
  (--color-porcelain-*, --color-copper, motion vars). Do NOT hardcode new hex.
- Accessibility: semantic landmarks (header/main/section+aria-label/footer),
  headline hierarchy h1→h2, focus-visible states inherit globals, all text meets
  AA on porcelain (text-secondary #4A5568 passes), CTA touch targets ≥44px.
- Mobile: single column below 768px, hero figure below copy, no horizontal
  overflow at 360px.
- Verify: npm run typecheck && npm run build must pass. Do not touch any other
  routes or components beyond page.tsx, NavBar.tsx, and new marketing files.
