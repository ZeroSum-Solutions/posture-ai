---
version: 2
name: Posture AI — Array
description: >-
  Mobile-first glass console for posture screening on the gym floor. Pure black
  field, gradient-shell glass cards, Roboto Light headlines, white pill actions,
  and a floating island nav. Replaces "Posture AI Dark" (v1) entirely.
  Derived from the Vision Engine — Scan Console contract.
colors:
  background: "#000000"
  surface-glass: "rgba(0,0,0,0.30)"
  shell-gradient: "linear-gradient(135deg, rgba(255,255,255,.40), rgba(255,255,255,.05) 46%, rgba(255,255,255,.10))"
  action: "#FFFFFF"
  action-text: "#000000"
  text-primary: "rgba(255,255,255,0.95)"
  text-secondary: "rgba(255,255,255,0.60)"
  text-tertiary: "rgba(255,255,255,0.45)"
  hairline: "rgba(255,255,255,0.10)"
  maintain: "#10B981"
  monitor: "#F59E0B"
  review: "#EF4444"
  info: "#0A83C9"
typography:
  font: "Roboto"
  headline-lg: { size: "30px", weight: 300, lineHeight: 1.12, tracking: "-0.025em" }
  headline-sm: { size: "20px", weight: 300, lineHeight: 1.2,  tracking: "-0.025em" }
  readout-xl:  { size: "64px", weight: 100, tracking: "-0.03em", numeric: "tabular" }
  readout-lg:  { size: "24px", weight: 300, tracking: "-0.025em", numeric: "tabular" }
  readout-md:  { size: "20px", weight: 300, tracking: "-0.025em", numeric: "tabular" }
  title-md:    { size: "14px", weight: 400, tracking: "0.01em" }
  body-md:     { size: "12px", weight: 300, lineHeight: 1.62 }
  label-md:    { size: "12px", weight: 500, lineHeight: "16px" }
  kicker:      { size: "12px", weight: 400, tracking: "0.16em", transform: "uppercase" }
radius:  { sm: "12px", md: "15px", lg: "16px", card: "23px", shell: "24px", frame: "48px", full: "9999px" }
spacing: { base: "4px", scale: [4, 6, 8, 12, 14, 16, 20, 24, 32, 48], screen-x: "16px", prose-x: "24px", card: "20px", tile: "14px" }
blur:    { card: "40px", tile: "24px", ambient: "4px" }
---

## What changed from v1

v1 ("Posture AI Dark") stacked one glass recipe at one elevation across every
panel, so a hero, a metric and a list row read at the same weight. It also
carried eleven type sizes with no scale and used IBM Plex Mono for every number.
v2 fixes those three things specifically: **two** surface tiers instead of one,
**seven** type roles instead of eleven, and numerals set in Roboto Light with
tabular figures rather than a monospace face.

Do not reintroduce: `--glass-*` tokens, the orange→black→cyan border gradient,
`backdrop-filter` on list rows, or IBM Plex Mono.

## Field

Every screen is pure `#000` with the ambient photograph behind the content and a
legibility veil over it — the same treatment as the source console.

```
ambient:  <img> photo, object-fit: cover, scale(1.1)
          → opacity: .6; mix-blend-mode: screen; filter: blur(4px) saturate(.85)
veil:     linear-gradient(to bottom, rgba(0,0,0,.5), rgba(0,0,0,.1) 45%, rgba(0,0,0,.8))
```

Immersive screens (capture, player) skip the photo — their background is the
live camera / video frame. The ambient carries the mood; content stays neutral.

## Surfaces — two tiers only

**Tier 1 — feature card.** One per screen, maximum two. Gradient shell, 24px
outer radius, 1px padding, 23px inner radius, `blur(40px)`, `rgba(0,0,0,.30)`.

```html
<div style="position:relative;border-radius:24px;padding:1px;overflow:hidden;
            box-shadow:0 25px 50px -12px rgba(0,0,0,.4)">
  <div style="position:absolute;inset:0;background:<shell-gradient>;opacity:.7"></div>
  <div style="position:relative;backdrop-filter:blur(40px);border-radius:23px;
              padding:20px;background:rgba(0,0,0,.30)">…</div>
</div>
```

**Tier 2 — tile / row.** Everything else. Same shell at `opacity:.5–.6`, 16px
outer / 15px inner radius, `blur(24px)`, 14px padding, no drop shadow.

There is no tier 3. If something needs to sit above a tier 1 card, it belongs in
the pinned action bar or the island, not in a new surface.

## Type

Roboto only. Headlines are Light (300) at `-0.025em` — the tracking is what makes
them read as considered rather than default. Body is Light 12px; labels are
Medium 12px. Never bold a headline; never set body above 14px.

Numbers are content, not chrome: Roboto Light with `font-variant-numeric:
tabular-nums`, sized by importance (64 / 24 / 20 / 14). A measurement is always
shown with its reference range — `47.2°` next to `ref ≥ 53°` — never alone.

## Severity

Three bands, mapped from the engine grade. This is the one semantic state added
beyond the source contract's emerald/red pair, and it exists because a screening
grade is a ramp, not a pass/fail.

| Band     | Colour    | Grades | Means                        |
|----------|-----------|--------|------------------------------|
| Maintain | `#10B981` | A, B   | Inside range, keep going     |
| Monitor  | `#F59E0B` | C      | Outside range, not urgent    |
| Review   | `#EF4444` | D, E   | Flag and address             |

Colour appears as a 16%-tint chip with a 42% ring, a 4px progress fill, or a
7px dot. Never as a filled block behind body text.

## Actions

- **Primary:** white fill, black text, `label-md`, full radius (pills) or 16px
  (bars), `0 10px 15px -3px rgba(0,0,0,.3)`. One per screen.
- **Secondary:** `rgba(0,0,0,.5)` + `blur(24px)` + 1px inset white hairline.
- **Destructive/blocked:** never a red button. Blocked actions dim to `.45` and
  state the reason directly above them.
- Minimum target 44px. Bottom bars sit above a 150px `to-top` black fade.

## Island navigation

Fixed pill, 6px padding, `rgba(0,0,0,.55)` + `blur(40px)`, gradient ring.
Five slots: Today, Clients, **Capture**, Library, Profile. The active tab expands
into a white labelled pill (44px tall, 16px inline padding); inactive tabs are
44px circles at `rgba(255,255,255,.5)`. Capture is always an emerald-tinted
circle — it is an action, not a destination, and never expands.

Immersive screens (capture, player) hide the island and show only the home
indicator.

## Iconography

Solar linear, via `iconify-icon`. 20px in nav and controls, 18px in tiles, 14px
inline with text. Never filled, never two-tone, never emoji.

## Motion

Moderate. 150ms for state, 300ms for layout, `cubic-bezier(0.4, 0, 0.2, 1)`.
Masked word reveal on headlines (`power4.out`, 0.05 stagger); cards rise 44px on
scroll entry; the island scales 0.96→1 on tab change. No parallax on data, ever.

## Do / Don't

**Do** state a measurement with its reference range. Do gate an action and say
why, rather than warning and allowing. Do keep one primary action per screen.
Do write disclaimers as one line.

**Don't** add a fourth radius family, a third surface tier, or an accent outside
the five roles. Don't repeat a value in two places on one screen (the v1 grade
appeared as a ring and again in the dock). Don't let a tab bar wrap. Don't use
`backdrop-filter` on more than two nested levels — it compounds and muddies.
