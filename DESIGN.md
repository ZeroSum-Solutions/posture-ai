---
version: 1
name: Posture AI Dark
description: >-
  A premium dark product system for clinical posture screening. Quiet depth,
  unmistakable actions, and readable evidence—not medical ornament.
---

# Posture AI design system

## Intent

Posture AI makes a practitioner's screening workflow feel focused, modern, and
substantial. The product is dark by default: neutral smoked glass, directional
highlights, and the same black, white, orange, and electric-cyan palette. The visual language borrows the cinematic
restraint, layered panels, and decisive composition of the Fusion AI reference
without copying its content, layout, assets, or code.

This is a screening product, not a diagnosis tool. Keep its language precise,
plain, and calm. Decorative graphics must never compete with a finding,
measurement, or decision.

## Core rules

- Black is the world; structural glass must stay neutral, never green or olive.
- Color is localized illumination behind glass, not an opaque panel fill.
- Use blue and orange/rust as deliberate, paired accent moments. Use the dark
  interior and gradient-rim treatment for primary actions.
- One primary action per screen. Secondary actions use a tonal surface or a
  hairline border.
- Glow indicates focus, progress, or an active action—not decoration.
- Never encode screening state in color alone; pair it with a label, icon, or
  grade.
- Use the 8-point grid. Keep air around major content and density inside data
  panels.
- Motion is short and purposeful: 120ms press, 180ms hover, 240ms state,
  320ms panels. Respect reduced motion.

## Tokens

### Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#000000` | Page canvas |
| `--surface` | `#0A0B0D` | Neutral panel fallback |
| `--surface-elevated` | `#0E0F12` | Raised neutral fallback |
| `--surface-strong` | `#17191D` | Pressed or selected wells |
| `--glass-fill` | `rgba(10,11,13,.62)` | Transmissive major panels |
| `--glass-well` | `rgba(5,5,6,.90)` | Controls nested inside glass |
| `--glass-border` | `rgba(255,255,255,.10)` | Neutral glass hairline |
| `--glass-highlight` | `rgba(255,255,255,.14)` | Directional top highlight |
| `--spectral-warm` | `#FF8A2A` | Localized warm beam |
| `--spectral-cool` | `#38D6FF` | Localized cool beam |
| `--border` | `#24262B` | Quiet separators |
| `--border-strong` | `#3C4048` | Inputs and active boundaries |

### Type and action

| Token | Value | Use |
| --- | --- | --- |
| `--text-primary` | `#FFFFFF` | Primary copy |
| `--text-secondary` | `#CCCCCC` | Supporting copy |
| `--text-muted` | `#949494` | Metadata |
| `--brand` | `#0098F3` | Electric-blue focus and active state |
| `--brand-warm` | `#FF8918` | Orange accent moment |
| `--brand-hot` | `#DA4E24` | Rust depth |
| `--brand-gradient` | orange → rust → black → blue | Gradient rim / atmosphere |

### Clinical state and data

| Token | Value | Use |
| --- | --- | --- |
| `--maintain` | `#5BD5AC` | Maintain state |
| `--warning` | `#FF8918` | Review state |
| `--danger` | `#DA4E24` | Significant state |
| `--data-blue` | `#0098F3` | Charts and active data |

## Typography

Inter carries every interface and headline: confident, legible, and compact
at small sizes. IBM Plex Mono is reserved for measurements, grades, timing,
and other numeric evidence. Use Inter 400, 500, 600, and 700; never use a
third family.

Use the following scale: 12, 14, 16, 20, 24, 32, 40, 56px. Display line height
is 1.0–1.12; body line height is 1.5–1.6. Keep body copy to 65 characters or
less when a comfortable measure is possible.

## Components

- **Primary button:** near-black interior with a restrained orange-to-blue
  gradient rim, white label, 10px radius, and 44px minimum height.
- **Secondary button:** graphite fill, quiet border, white label. It must never
  compete with the primary action.
- **Glass navigation:** neutral `rgba(8,9,11,.66)`, 1px white-alpha border,
  `blur(28px) saturate(145%)`, and a brighter top edge.
- **Panel:** neutral `rgba(10,11,13,.62)` over localized orange/cyan light,
  `blur(24–40px) saturate(140–160%)`, directional inner highlights, and layered
  black shadows. Use 20–24px radius for major panels and 12–14px for controls.
- **Nested control:** use a near-black well (`#050506`), visibly darker than
  its surrounding glass. Do not use cloudy white or colored structural fills.
- **Data readout:** IBM Plex Mono, tabular figures, direct labels, and at least
  3:1 graphical contrast.

## Composition

Marketing may use a slow abstract atmospheric field behind the hero and a
product-like report panel as the key visual. The authenticated product should
favor a persistent shell, direct navigation, clear page titles, and one
dominant task per view. A practitioner should understand a screen's next step
within three seconds.

### Authenticated application

- Treat the dashboard as a practitioner console, not a marketing page: lead with
  the next action, then the few measurements that orient the practitioner.
- Major dashboard sections use 22–24px neutral glass panels. Dense activity rows
  and filters sit in 12–14px near-black wells so scan targets remain distinct.
- Keep orange/cyan as localized illumination and data emphasis. Use semantic
  maintain, review, and alert colors only with a visible label.
- At desktop, persistent navigation and one primary action remain visible. At
  mobile, stack data panels and keep the primary action full width.

## Accessibility gates

- Normal text: at least 4.5:1 contrast; aim for 7:1 for critical reading.
- All controls: 44px minimum target and visible keyboard focus.
- Mobile layouts: test at 375px, 768px, 1024px, and 1440px with no horizontal
  scroll.
- Avoid auto-playing decorative motion; honour `prefers-reduced-motion`.
