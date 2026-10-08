---
version: 4
name: Posture AI — Kinetic Instrument
description: >-
  A dark, fluid instrument for reading posture on the gym floor. Near-black
  canvas under a slow aura, content set directly on the canvas with strong
  typographic hierarchy, one electric "volt" action colour, liquid glass only on
  floating chrome and one hero per screen, and spring physics on every state
  change. Signature object: the Lens — a living squircle that is the capture
  button, the loader and the scan-complete moment. Replaces Array v3.
colors:
  canvas: "#050608"
  surface-1: "#0E1013"        # solid raised: sheets, dialogs, hero fallback
  surface-2: "#16191D"        # fields, pressed rows, chart wells
  surface-3: "#1E2227"        # selected plates, thumbs
  hairline: "rgba(255,255,255,0.08)"
  edge: "rgba(255,255,255,0.14)"
  ink-1: "#F5F7F8"            # titles, values
  ink-2: "rgba(235,240,245,0.72)"  # body
  ink-3: "rgba(235,240,245,0.54)"  # metadata (≥4.5:1 on canvas)
  volt: "#D4FF3A"             # THE action colour: primary button, Lens, focus, "now" marker
  volt-ink: "#0B0D02"
  maintain: "#5EEAD4"
  monitor: "#FFC34D"
  review: "#FF6B5E"
  glass: "rgba(18,20,24,0.62) + blur(28px) saturate(160%)"
  scrim: "rgba(2,3,4,0.62)"
typography:
  family: "Geist (UI + numerals, tabular) · Geist Mono (micro labels, units, axes)"
  hero:     { size: "72px", lineHeight: "0.92", weight: 600, tracking: "-0.055em" }
  display:  { size: "40px", lineHeight: "42px", weight: 600, tracking: "-0.04em" }
  title:    { size: "28px", lineHeight: "32px", weight: 600, tracking: "-0.03em" }
  headline: { size: "19px", lineHeight: "24px", weight: 600, tracking: "-0.015em" }
  body:     { size: "16px", lineHeight: "24px", weight: 400, tracking: "-0.006em" }
  callout:  { size: "15px", lineHeight: "20px", weight: 500, tracking: "-0.005em" }
  label:    { size: "13px", lineHeight: "18px", weight: 500, tracking: "0" }
  micro:    { size: "11px", lineHeight: "14px", weight: 500, tracking: "0.08em", family: "Geist Mono", case: "upper" }
radius: { xs: 10, sm: 14, md: 20, lg: 28, xl: 36, pill: 999, squircle: "corner-shape: squircle where supported" }
spacing: [4, 8, 12, 16, 20, 24, 32, 40, 56, 72]
gutter: { default: 20, narrow-360: 16 }
motion:
  tap:    { stiffness: 700, damping: 32, mass: 0.5 }   # press feedback
  snap:   { stiffness: 520, damping: 38, mass: 0.8 }   # chips, toggles, selection
  morph:  { stiffness: 340, damping: 30, mass: 1 }     # shape morphs (pill→sheet, row→detail)
  glide:  { stiffness: 260, damping: 30, mass: 1 }     # pages, shared elements, sheets
  jelly:  { stiffness: 300, damping: 14, mass: 1 }     # loaders, Lens, celebration
  settle: { stiffness: 200, damping: 26, mass: 1 }     # drag release with velocity
---

# Kinetic Instrument (Array v4)

v3 was rejected as generic: every surface the same grey card, white pills,
paragraphs of explanation, tiny charts, no hero and no identity. v4 keeps the
routes, data and accessibility work and replaces the look, the motion and the
information architecture.

## Principles

1. **Show only what the practitioner needs now.** One question per screen, one
   answer at the top, one primary action. Explanations live behind a tap
   (sheet or "Why?"), not on the page. Merge sections that answer the same
   question.
2. **Content sits on the canvas.** Hierarchy comes from type size, weight and
   space — not from boxes. Cards exist only for objects you can act on as a
   whole (a waiting report, a saved workout). Lists are rows with hairlines.
3. **One hero per screen.** The hero may use liquid glass or a large numeral;
   nothing else competes with it.
4. **Volt means "do this".** The lime action colour appears on the single
   primary action, the Lens, focus rings and the "now" marker in charts —
   nowhere else. Severity colours appear only on severity encodings.
5. **Everything morphs; nothing pops.** A state change moves the thing that
   changed, from where the finger was, with a spring. Containers morph,
   their content crossfades.
6. **Every encoding is honest.** Values show units and dates. Severity is a
   word plus an ordinal bead count plus colour — never colour alone. Charts
   never imply change that a single scan cannot show.

## Type

Geist for everything, Geist Mono only for `micro` labels, units and chart axes.
Eight roles, no others: `hero`, `display`, `title`, `headline`, `body`,
`callout`, `label`, `micro` (classes `.t-*`, custom properties `--t-*`). Sizes
are rem so text scaling reflows. Numerals are tabular everywhere. A screen
uses at most four roles. Weight 600 is for headings and values; body is 400;
`callout`/`label` are 500. Inputs are 16px.

Hierarchy recipe per screen: `micro` eyebrow (date, context) → `display` or
`hero` answer → `headline` section heads → `body`/`callout` rows → `label`
metadata.

## Colour

Near-black canvas `#050608` under the **aura**: two large blurred radial
lights (deep ink-blue top-left, faint volt bottom-right) and 3% film grain.
The aura tints toward the current result's highest severity on Results.

Ink tiers `ink-1/2/3` carry all text. Surfaces are solid (`surface-1..3`);
glass is reserved (see Materials). Severity hues: Maintain teal, Monitor
amber, Review coral — saturated enough to read as signal on black, never used
as fills larger than a bead or a chart mark.

## Materials

- **Canvas** — content, lists, charts.
- **Solid** (`surface-1`) — sheets, dialogs, fields, chart wells.
- **Liquid glass** — the floating dock, the Island (toasts), the top bar once
  scrolled, and at most one hero object per screen. Glass = translucent fill,
  28px blur, a 1px gradient edge (brighter on top: the specular rim) and a
  soft inner highlight. Never stack two glass layers. Under
  `prefers-reduced-transparency` glass becomes `surface-1`.

## Shape

Controls are pills. Objects are squircles (`corner-shape: squircle` where the
browser supports it; plain radius elsewhere). Radii: 10 chips-in-fields,
14 fields, 20 rows-as-plates and cards, 28 hero and sheets, 36 the dock.
**Morph rule:** when a pill becomes a surface its radius tweens from pill to
28; when a surface collapses back it returns to its origin's radius.

## Spacing and layout

4px base: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Gutter 20px (16px at ≤360px).
Section gap 40px; row gap inside a section 0 (hairline rows) or 12px (cards).
Fixed chrome reserves its height through `--chrome-bottom`; nothing scrolls
under the dock without padding. Targets ≥44×44px, ≥8px apart.

## Navigation — the dock and the Lens

A floating glass capsule (height 64, radius 36, 12px above the safe area):
Today · Clients · **Lens** · Workouts · You. The active destination expands
into a pill with icon and label; the others are icon-only with accessible
names. The selection plate moves between them with `morph` and stretches in
the direction of travel. The **Lens** sits in the centre: a 52px volt
squircle with a scan reticle that breathes (`jelly`, 4s, paused under reduced
motion). Tapping it morphs the Lens into the capture viewfinder. On scroll
down the dock tightens (icons only, narrower); on scroll up it relaxes.

The top bar is transparent at rest with a large title in the content; once the
title scrolls away a compact glass bar with the small title fades in.

## Actions

- **Primary** — volt pill, 52px, `volt-ink` label, one per screen, in the
  thumb zone. Press: scale .96 (`tap`). Pending: the pill morphs to a 52px
  circle holding the Lens loader, then to a check, then back. Actions that
  open a surface morph into that surface.
- **Secondary** — glass pill with `ink-1` label.
- **Quiet** — text button, `ink-1`, with a trailing chevron or icon.
- **Destructive** — coral label; confirmation morphs out of the button.
- **Icon** — 44px circle, glass on media, transparent on canvas.

## Motion

Presets in `lib/motion.ts` (`tap`, `snap`, `morph`, `glide`, `jelly`,
`settle`). Rules:

1. Containers morph (layout/`layoutId`); their content crossfades — out in
   80ms, in 140ms after 60ms.
2. New things come from their cause: a sheet grows out of the row or button
   that opened it; a toast grows out of the Island.
3. Exits are faster than entrances (≈0.7×) and never bounce.
4. Animate transform, opacity, clip-path and radius only. No layout reads in
   animation frames. One blur layer animates at a time.
5. Presses respond within one frame (CSS `:active` on links; spring on
   buttons). Release overshoots slightly.
6. Values roll digit by digit to the recorded number in ≤500ms. They never
   animate between unrelated values.
7. Lists stagger 30ms per item, at most 8.
8. Gestures hand off velocity; overscroll and over-drag rubber-band
   (distance × 0.3). Every gesture has a tap equivalent.
9. `prefers-reduced-motion`: no transforms, no rolls, no breathing; opacity
   120ms only.

## Loaders

The Lens loader (a squircle morphing circle ⇄ rounded square while its
reticle rotates) for jobs over a second; shimmer skeletons that mirror the
final layout for content; button pending morph for actions. Loaders appear
after 300ms and stay at least 500ms. Never a lone spinner on an empty page.

## Severity and data

- **Beads** — three small dots; 1 filled = Maintain, 2 = Monitor, 3 = Review,
  filled in the severity colour, always beside the word.
- **Range readout** — a finding row: value with unit, name, beads + word, and
  a band strip (Maintain | Monitor | Review zones) with this scan's marker and
  hollow markers for earlier scans.
- **Score gauge**, **trend chart**, **age ladder** — see
  `docs/design/array-v4-dataviz.md`.

## Accessibility

WCAG 2.2 AA: text contrast ≥4.5:1 (`ink-3` is the floor), non-text ≥3:1,
focus ring 2px volt with 2px offset on every control, targets ≥44px, one
`<main>`, route focus to the `h1`, sheets trap focus and return it, Escape
and back close overlays, everything works at 360px and 200% text.

## The 3D posture map

`MuscleModel3D`, `public/muscle-viewer` and the anatomy viewer are out of
scope: rendering, animation and colours do not change. Only the chrome around
the canvas may change.

## Do / Don't

- Do let the type carry hierarchy. Don't wrap every block in a card.
- Do put explanations behind "Why?". Don't add banners and paragraphs.
- Do use volt once per screen. Don't use it for decoration.
- Do morph from the cause. Don't fade in from nowhere.
- Do show severity as beads + word. Don't use coloured pill backgrounds.
- Copy uses screening vocabulary only (never diagnose/treat/patient/
  prescribe/cure). Legal and consent document text never changes. The line
  "Screening support only — not a medical diagnosis." stays reachable.
