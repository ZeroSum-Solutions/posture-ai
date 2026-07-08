---
version: alpha
name: Plumbline
description: >-
  Design system for Posture AI, a clinical-grade posture screening
  platform for movement professionals. Ink on porcelain, engineered
  calm, the measurement as the hero.
colors:
  # ── Light mode (Porcelain) — default: reports, marketing, app light ──
  background: "#F6F4EF"
  background-sunken: "#EFECE3"
  surface: "#FFFFFF"
  text-primary: "#161D2B"
  text-secondary: "#4A5568"
  border: "#E2DED4"
  border-strong: "#C9C4B8"
  border-control: "#8D897E"
  primary: "#243B6B"
  primary-hover: "#1B2E56"
  primary-tint: "#E4E9F3"
  copper: "#8A5537"
  copper-large: "#9C6644"
  maintain: "#1F6E62"
  maintain-tint: "#E1EEEB"
  warning: "#8F5B12"
  warning-tint: "#F3EAD8"
  danger: "#9E3B33"
  danger-tint: "#F2E2E0"
  # ── Dark mode (Ink) — app UI dark theme, dark advertising ──
  background-dark: "#0E1420"
  surface-dark: "#161E2E"
  surface-elevated-dark: "#1D2740"
  text-primary-dark: "#E9E7E1"
  text-secondary-dark: "#9AA3B5"
  border-dark: "#252F44"
  primary-dark: "#8FA8D9"
  copper-dark: "#C58B62"
  maintain-dark: "#63BFA9"
  warning-dark: "#D9A44A"
  danger-dark: "#E38271"
typography:
  display:
    fontFamily: Schibsted Grotesk
    fontSize: 64px
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Schibsted Grotesk
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Schibsted Grotesk
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Schibsted Grotesk
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.65
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.3
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12.5px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.01em
  data-xl:
    fontFamily: IBM Plex Mono
    fontSize: 56px
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: -0.02em
    fontFeature: '"zero" 1'
  data-md:
    fontFamily: IBM Plex Mono
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: '"zero" 1'
  data-sm:
    fontFamily: IBM Plex Mono
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: '"zero" 1'
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  4xl: 96px
  section: 128px
  gutter: 24px
  container-app: 1200px
  container-marketing: 1360px
rounded:
  control: 10px
  card: 16px
  full: 9999px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    padding: 14px
    typography: "{typography.label-md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: 14px
  button-secondary-hover:
    backgroundColor: "{colors.primary-tint}"
  chip-maintain:
    backgroundColor: "{colors.maintain}"
    textColor: "#FFFFFF"
    rounded: "{rounded.full}"
    typography: "{typography.label-sm}"
  chip-warning:
    backgroundColor: "{colors.warning}"
    textColor: "#FFFFFF"
    rounded: "{rounded.full}"
    typography: "{typography.label-sm}"
  chip-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.full}"
    typography: "{typography.label-sm}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: 24px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-control}"
    rounded: "{rounded.control}"
    padding: 12px
---

# Plumbline — the Posture AI design system

## Overview

Posture AI turns a $7,000 clinic posture rig into a browser app. The brand
must do two jobs at once: look **clinically credible** on a report a
physical therapist hands to a client, and look **aspirational** in
advertising aimed at movement professionals. Plumbline resolves this with
one idea: *the measurement is the hero.* The plumb line — the reference
vertical used in posture assessment for over a century — is the brand's
signature motif: a fine vertical hairline, landmark dots, and angle arcs
drawn as designed assets, never as debug output.

Personality: **engineered calm.** Quietly confident, precise, humane.
Premium-clinical (Neko Health, Function Health register), not
performance-consumer (no black-and-neon, no athlete sweat). The energy
comes from whitespace, editorial type, and beautiful data — not from
saturation or motion.

Audience: physical therapists, chiropractors, athletic trainers, and
movement coaches — professionals whose own credibility rides on how our
report looks.

Voice: calm, declarative, sentence case. Screening vocabulary only
(maintain / warning / danger; optimal / mild / moderate / significant) —
never diagnostic language. Short sentences. No hype verbs ("unlock",
"elevate", "revolutionize").

Deliberately avoided territories: healthcare green (Hinge, Sword, AG1),
trust teal/mint (telehealth default), purple (consumer gadget),
black + neon (Whoop), electric cobalt on renders (Eight Sleep), and the
generic indigo `#6366F1` this system replaces.

## Colors

Two rooms, one house. **Porcelain** (warm paper light mode) is the default
world: reports, marketing, and the app's light theme. **Ink** (deep
blue-black dark mode) is the app's dark theme and the dark advertising
canvas. Nothing is pure white or pure black.

- **Ink (`#161D2B`, primary text)** — a warm writing-ink near-black. On
  porcelain it reads like print, 15.3:1 contrast.
- **Porcelain (`#F6F4EF`, background)** — warm paper, not sterile white.
  Cards sit on it in true `#FFFFFF` for a subtle tonal lift.
- **Primary (`#243B6B`)** — deep desaturated ink blue, far from corporate
  SaaS blue. The only interactive color: buttons, links, focus rings,
  selected states. 10.0:1 on porcelain. Dark-mode counterpart `#8FA8D9`.
- **Copper (`#8A5537` text / `#9C6644` large)** — the marketing warmth.
  Used sparingly in advertising and editorial moments (pull stats,
  underlines, campaign accents). Never used for UI interaction and never
  competes with risk colors. Dark-mode counterpart `#C58B62`.
- **Risk semantics** — the clinical triad, deliberately not Tailwind
  green/amber/red: **maintain** is deep sea-teal `#1F6E62`, **warning** is
  bronze ochre `#8F5B12`, **danger** is oxide brick `#9E3B33`. Each has a
  tint for chips/fills and a lightened dark-mode variant. All pass WCAG AA
  as text in both modes; white text passes on all light-mode fills.

Rules: one interactive accent (primary) per screen. Risk colors appear
only when they encode risk. Never encode a letter grade by color alone —
the letterform stays primary. Copper never appears inside the app's
assessment surfaces.

## Typography

Three voices, strictly cast. All fonts are SIL OFL, self-hostable.

- **Schibsted Grotesk (display, headlines)** — an editorial Nordic
  grotesque with confident ink traps. Headlines feel like a serious
  journal, not a supplement ad. Weights 600–700, tight tracking, sentence
  case. Never used below 21px.
- **Hanken Grotesk (body, UI, labels)** — humanist, warm, one of the most
  comfortable long-read sans faces available. Weights 400–600. Its digits
  are tabular-width by default (verified 560/em across 0–9 in the font
  binary), so inline numbers never jitter; still set
  `font-variant-numeric: tabular-nums` on numeric columns as belt and
  braces.
- **IBM Plex Mono (data)** — every measurement, angle, percentage, and
  clinical readout. Genuine lab heritage. Its default zero is dotted; the
  GSUB-verified `zero` feature (`font-feature-settings: "zero" 1`) swaps
  in the slashed zero, a clinical-legibility choice, not decoration. Large readouts are set
  Light (300) at 48–72px: delicate, instrument-like. `4.2°` in Plex Mono
  is the brand's most recognizable typographic gesture.

Hierarchy is carried by weight and color, not raw scale. Max two weights
of any family per screen. Uppercase is reserved for tiny data labels
(`data-sm` + secondary color), rationed like an instrument panel.

**Editorial accent (marketing only):** Source Serif 4 italic (SIL OFL,
self-hostable) may be used for short pull quotes and single emphasized
fragments on marketing surfaces — the Oura (`Editorial New`) / Levels
(`GT Sectra Fine`) pattern of pairing a precise grotesque with a serif
accent. Never inside the app, reports, or for anything longer than one
sentence. This is the fourth voice and it only speaks in ads.

## Layout

4px base unit. Spacing scale: 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96, with
128px between marketing sections. App content max-width 1200px; marketing
1360px; report/prose measure 65ch. Page gutters are fluid:
`clamp(20px, 4vw, 56px)` on marketing, fixed 24px inside the app.
12-column grid on desktop, single column below 768px.

Whitespace is the primary luxury signal: when in doubt, add space, not
boxes. Density belongs inside the data panels (assessment tables, angle
readouts), airiness everywhere else. Marketing layouts lean asymmetric —
split heroes, offset stats — anchored by the vertical plumb-line hairline
as a compositional device.

## Elevation & Depth

Tonal layers over shadows. Porcelain background → white cards → 1px
`border` hairlines. Shadows exist only for genuine overlays (modals,
popovers): soft, large-radius, ink-tinted (`rgba(22, 29, 43, 0.10)`),
never pure black. In dark mode, elevation is lightness: `background-dark`
→ `surface-dark` → `surface-elevated-dark`, hairlines in `border-dark`.

## Shapes

One documented radius rule: **controls 10px** (buttons, inputs, selects),
**cards and panels 16px**, **chips and status pills full-round**. Nothing
else. No mixed radii within a component family. The plumb-line motif is
always a 1px or 1.5px hairline; landmark dots are 6–8px filled circles;
angle arcs are 1.5px strokes with a small degree readout in Plex Mono.

## Motion

Engineered calm extends to time: motion confirms, it never performs.
Easing curves are drawn from the measured CSS of Oura, Levels, and WHOOP
production sites (2026-07 scrape), adapted to Plumbline restraint.

- `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)` — hover, color, focus.
- `--ease-enter: cubic-bezier(0.16, 1, 0.3, 1)` — panels, cards, toasts
  entering; a confident settle with no bounce.
- `--ease-exit: cubic-bezier(0.4, 0, 1, 1)` — dismissals; leave quickly.
- `--ease-reveal: cubic-bezier(0.87, 0, 0.13, 1)` — marketing section
  reveals only; never inside the app.

Durations: **120ms** press/focus · **180ms** hover · **240ms** card and
state changes · **320ms** panel entrance · **480ms** the scan-line sweep
(the one signature animation, marketing + capture screens only). Numbers
animate once on first reveal, then hold still — a readout that keeps
moving reads as uncertainty. `prefers-reduced-motion`: disable the scan
sweep, parallax, and number count-ups; keep opacity state changes.

## Components

- **Buttons** — primary: ink-blue fill, white text, 10px radius, 14px
  vertical padding, Hanken 600. Hover deepens fill and lifts 1px; active
  presses down (`scale 0.98`). Secondary: 1px primary border, primary
  text, transparent fill; hover fills with `primary-tint`. One primary
  action per screen. Labels 1–3 words, sentence case.
- **Risk chips** — full-round pills, risk-color fill, white text, 12.5px
  Hanken 600. In dark mode: 14% risk-tint surface with the risk color as
  text (white-on-fill fails contrast in dark mode — never do it).
- **Risk bars** — hairline track (no heavy filled background), risk-color
  fill segment, degree value in Plex Mono at the end. The value is the
  point; the bar is the garnish.
- **Grade badge (S–E)** — the letter set large in Schibsted 700 inside a
  16px-radius tile; percentile beneath in Plex Mono. Color follows risk
  mapping (S/A maintain, B/C neutral ink, D warning, E danger) but the
  letter always works in monochrome.
- **Stat tiles** — value in Plex Mono Light (large), label in Hanken
  secondary below. No boxes unless the tile group needs separation; then
  hairline dividers, not cards.
- **Inputs** — white surface, 1px `border-control` outline (3:1 against
  both white and porcelain, per WCAG 1.4.11), 10px radius, label
  above in `label-sm`, helper below, error in danger below. Focus: 2px
  primary ring, 2px offset. Never placeholder-as-label.
- **Charts** — Plumbline data-viz: ink lines 1.5px, band reference areas
  in risk tints at 40% opacity, dots at data points, axis labels in
  `data-sm`. No gradients under curves, no drop shadows.
- **Score cluster** — never present a single scary grade alone. A score
  always ships as a cluster: the grade, its top driver, and the retest
  delta (`B · driver: forward head · −3.1° since 22 May`). Every metric
  card answers three questions in order: what was measured, what it
  means in plain language, what to do next. A number without a next
  action is dead weight.
- **Overlay color roles** — in skeletal/angle visualizations: primary
  ink-blue is the measured line and landmarks, maintain marks
  within-range, warning marks priority regions, danger is reserved for
  findings that cross clinical-referral thresholds. Color is never the
  only channel: pair with label and shape/pattern (WCAG 1.4.1).
- **Report (PDF/print)** — porcelain paper, ink text, plumb-line rule
  down the left margin, angles in Plex Mono, the non-diagnostic
  disclaimer set in `body-sm` secondary on every page. The report is a
  brand asset: it must look like it came from a $7,000 instrument.

## Do's and Don'ts

- Do make the measurement overlay (plumb line, landmark dots, angle arcs)
  the hero visual in marketing — it is our Neko point-cloud.
- Do set every number that can change in IBM Plex Mono with slashed zero.
- Do keep one interactive accent per screen; risk colors only encode risk.
- Do use screening vocabulary; never "normal/abnormal" or "diagnosis".
- Don't use pure `#000000` or pure-white page backgrounds.
- Don't use healthcare green, trust teal, purple, or the old `#6366F1`.
- Don't put copper inside assessment or report surfaces.
- Don't encode grades or risk by color alone.
- Don't use Schibsted Grotesk below 21px or for body copy.
- Don't add shadows to cards; hairlines and tonal steps carry depth.
- Don't exceed two font weights per family per screen.
- Do lead marketing copy with the body outcome; "AI" is the mechanism,
  never the hero noun.
- Do keep trust content (privacy, pose-model provenance, clinician
  review) above pricing on marketing pages — diagnosis before invoice.
- Don't show a posture score without its driver and a next action.
- Don't use testimonials, clinician badges, or outcome claims unless
  they are real, approved, and labeled by evidence strength.
