---
version: 3
name: Posture AI — Array v3
description: >-
  Mobile-first glass console for posture screening on the gym floor. Pure black
  field under a slow gradient glow, flat legible content, glass only on chrome
  and one hero card per screen, white pill primary actions, a docked labelled tab
  bar with a raised Capture button, and spring physics on every interaction.
  Replaces Array v2. Full rationale and component specs: docs/design/array-v3-spec.md.
colors:
  background: "#000000"
  text-1: "rgba(255,255,255,0.95)"
  text-2: "rgba(255,255,255,0.72)"
  text-3: "rgba(255,255,255,0.58)"
  surface-flat: "rgba(255,255,255,0.07)"
  surface-flat-pressed: "rgba(255,255,255,0.12)"
  surface-field: "rgba(255,255,255,0.08)"
  border: "rgba(255,255,255,0.12)"
  border-field: "rgba(255,255,255,0.38)"
  hairline: "rgba(255,255,255,0.10)"
  glass-card: "rgba(24,24,28,0.72)"
  glass-chrome: "rgba(18,18,22,0.78)"
  scrim: "rgba(0,0,0,0.56)"
  action: "#FFFFFF"
  text-on-action: "#000000"
  accent: "#4DB2FF"
  capture: "#34D399"
  maintain: "#34D399"
  monitor: "#FBBF24"
  review: "#FF7A7A"
typography:
  font: "system (SF Pro on Apple, Roboto on Android)"
  display:   { size: "34px", weight: 300, lineHeight: "40px", tracking: "-0.02em" }
  title-1:   { size: "28px", weight: 300, lineHeight: "34px", tracking: "-0.015em" }
  title-2:   { size: "22px", weight: 500, lineHeight: "28px", tracking: "-0.01em" }
  headline:  { size: "17px", weight: 500, lineHeight: "22px" }
  body:      { size: "16px", weight: 400, lineHeight: "24px" }
  callout:   { size: "15px", weight: 400, lineHeight: "22px" }
  subhead:   { size: "14px", weight: 400, lineHeight: "20px", tracking: "0.005em" }
  footnote:  { size: "13px", weight: 400, lineHeight: "18px", tracking: "0.005em" }
  caption:   { size: "12px", weight: 500, lineHeight: "16px", tracking: "0.01em" }
  overline:  { size: "12px", weight: 500, lineHeight: "16px", tracking: "0.08em", transform: "uppercase" }
  readout-xl: { size: "56px", weight: 300, lineHeight: "56px", tracking: "-0.03em", numeric: "tabular" }
  readout-lg: { size: "28px", weight: 400, lineHeight: "32px", tracking: "-0.02em", numeric: "tabular" }
  readout-md: { size: "20px", weight: 500, lineHeight: "24px", tracking: "-0.01em", numeric: "tabular" }
  readout-sm: { size: "15px", weight: 500, lineHeight: "20px", numeric: "tabular" }
radius:  { sm: "8px", md: "14px", lg: "20px", xl: "28px", full: "9999px" }
spacing: { base: "4px", scale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64], screen-x: "16px", card: "16px", card-hero: "20px", section: "24px", group: "32px" }
blur:    { card: "20px", chrome: "24px" }
---

# Array v3

Array v3 keeps what made v2 recognisable — the black field, white pill primaries,
three severity bands, a measurement always shown with its reference range — and
fixes what made it hard to use: 12px Light body text, a 2.46:1 "quiet" text tier,
44 font sizes in the wild, a floating island that covered content, no shared
Button/Input/Sheet, and glass on every row. The long-form spec (every component's
anatomy, props and states, every screen's layout, the motion physics) lives in
`docs/design/array-v3-spec.md`. This file is the contract; when the two disagree,
this file wins.

## Principles

1. **One screen, one question, one primary action.** The primary action is a single
   white pill in the bottom third (the ActionBar). Everything else is secondary.
2. **Legibility is a budget.** Body is 16px/400. Nothing readable is under 12px.
   Every text tier clears 4.5:1 against the worst glass backdrop (`#1C1C1E`).
3. **Glass is chrome, not content.** Blur only on the tab bar, collapsed top bar,
   sheets, toasts and at most one hero card per screen. Never more than two blurred
   layers visible at once. Rows, fields, chips and text bodies are flat.
4. **Tokens or nothing.** Components read type, spacing, radius, colour and motion
   from tokens. No raw font-size, colour or radius literals in component CSS.
5. **Every control is touchable and never covered.** 48px hit areas, 8px gaps.
   Fixed chrome reserves its exact height (`--chrome-bottom`); nothing floats over
   scrolling content.
6. **Motion is physics, and it is interruptible.** Named springs only, ≤450ms
   settle, and a 150ms crossfade under `prefers-reduced-motion`.
7. **Say what it is, in words.** Tabs show labels. Severity is word + icon + colour.
   Empty and error states say what happened and offer one action. Screening
   vocabulary only.

## Type

The platform system font: SF Pro on Apple devices (HIG), Roboto on Android (M3);
no web font is shipped. Weights 300/400/500 only. Use the role classes (`.t-display`, `.t-title-1`,
`.t-title-2`, `.t-headline`, `.t-body`, `.t-callout`, `.t-subhead`, `.t-footnote`,
`.t-caption`, `.t-overline`, `.t-readout-xl|lg|md|sm`) or the matching `--t-*`
custom properties; never set font-size or weight by hand. Sizes are rem so OS text
scaling reflows. Light (300) is allowed only at 28px and above. Headings take their
role class, never a weight by tag. Readouts use tabular numerals. Inputs are exactly
16px (no iOS focus zoom). Prose max width 38rem. Layouts survive 200% text.

## Colour

Three text tiers only: `--text-1` (.95) titles and values, `--text-2` (.72) body
and secondary, `--text-3` (.58) metadata, hints, placeholders. The v2 `--text-quiet`
(.30) tier is gone. Disabled content is 38% opacity with a reason line above it.

`--accent` (#4DB2FF) is the one interactive accent: links, focus inner ring,
progress fills, selected tints, spinners. `--capture` (#34D399) belongs to the
Capture button and capture-ready states only.

Severity is never colour alone: a chip is tint (16%) + ring (42%) + icon + word.

| Band     | Fg        | Icon         | Grades | Means                     |
|----------|-----------|--------------|--------|---------------------------|
| Maintain | `#34D399` | check-circle | A, B   | Inside range, keep going  |
| Monitor  | `#FBBF24` | eye          | C      | Outside range, not urgent |
| Review   | `#FF7A7A` | flag         | D, E   | Flag and address          |

The v2 hues (`#10B981/#F59E0B/#EF4444`) survive only as chart fills. A severity
band appears once per row, never twice.

Focus ring: `0 0 0 2px #000, 0 0 0 4px #fff` on `:focus-visible`, every control.

## Materials — three, no more

| Material | Where | Recipe | Fallback |
|---|---|---|---|
| **Flat** | rows, tiles, fields, chips, stat blocks, text bodies | `--surface-flat` + 1px `--hairline`, no blur | same |
| **Card glass** | one hero card per screen, max | `--glass-card` + `blur(20px) saturate(1.3)` + 1px `--border` + inset top highlight | `#17171A` |
| **Chrome glass** | tab bar, collapsed top bar, sheets, toasts, camera overlays | `--glass-chrome` + `blur(24px) saturate(1.4)` | `#141417` |

The ActionBar is solid (`--surface-solid` + top hairline), never glass, so a
scrolled screen never stacks three blurred layers. Glass edges are lit by a conic
edge-light gradient border rather than a flat line.

Scrim behind sheets and dialogs: `--scrim`, no blur. Dialogs are solid
(`#161618`). Over the live camera or video, text sits on ≥.6 black, never on blur
alone. Fallbacks apply under `prefers-reduced-transparency: reduce` and
`@supports not (backdrop-filter: blur(1px))`.

The field is `#000` with the `AmbientField` glow: two fixed radial gradients
(accent top-left, violet `#6D4AFF` bottom-right, both low alpha) that drift slowly
on a composited transform. Its brightest point stays at or below `#1C1C1E`. The v2
photograph is retired. Immersive screens (capture, player) have no field.

## Spacing and layout

4px base; the scale is 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`--s-*`). Screen
margin 16px; content column `min(480px, 100%)`, centred. Card padding 16 (hero 20).
8px inside a component, 12px between cards, 24px between sections, 32px between
page groups. List rows 56 / 64 / 72 tall (never under 48). Controls: Button sm 40
(hit 48) / md 48 / lg 56; TextField 52; Chip 36 (hit 48); Segmented 44.

Radii: `--r-sm` 8 (thumbs, badges), `--r-md` 14 (fields, segmented, banners),
`--r-lg` 20 (cards, rows-as-cards, toasts), `--r-xl` 28 (sheets, dialog, hero),
`--r-full` (buttons, chips, avatars). Inner radius = outer − padding.

Every fixed element pads its touching edge with `env(safe-area-inset-*)`.
Full-height surfaces use `100dvh`; `100vh` is banned. The shell publishes
`--chrome-bottom` (tab bar + ActionBar heights); scroll content pads by it + 16px.

## Navigation

A docked, full-width tab bar (chrome glass, 56px + safe area) with five labelled
slots: **Today · Clients · Capture · Workouts · You**. Capture is a raised 56px
`--capture` circle with a visible "Capture" label in the centre — an action, never
an active tab; its raise counts toward `--chrome-bottom`, and it shrinks to 48px
below 360px wide. The active tab
shows a filled icon, `--text-1` label and a sliding accent indicator. The bar hides
on immersive routes, while the virtual keyboard is open, and under a large sheet.
It never hides on scroll. The ActionBar adds the safe-area inset only when it is
the bottom-most chrome. On every route change focus moves to the page `h1` and a
live region announces the page; Android back closes an open sheet or dialog. Workouts holds Saved · Builder · Library (exercises and
muscles); You holds settings, privacy, legal and sign-out.

Each screen starts with a TopBar: a large title (`display`) that collapses into a
52px chrome-glass bar with a centred `headline` title once scrolled. Back is a 48px
IconButton with a named label ("Back to Clients").

## Actions

- **Primary:** white fill, black text, pill, one per screen, in the ActionBar.
- **Secondary:** `--surface-field` fill + 1px `--border`, `--text-1` label.
- **Tertiary:** no fill, `--accent` label ("See all", "Cancel").
- **Danger:** secondary shape with `--review` text and an icon, only inside a
  confirm dialog or sheet footer. Never a red primary.
- Blocked actions dim to 38% and state the reason directly above them.
- Sizes sm 40 / md 48 / lg 56. Labels are `body`/500 (lg: `headline`/500).

## Motion

Springs live in `lib/motion.ts` and are the only transitions components use:

| Preset | Use | Params |
|---|---|---|
| `press` | button/row press | stiffness 520, damping 24, mass 0.7 |
| `state` | chip, toggle, tab indicator | stiffness 420, damping 32, mass 0.9 |
| `layout` | expand, collapse, reorder | stiffness 320, damping 30, mass 1 |
| `sheet` / `sheetOut` | sheet present / dismiss | 380/38 · 440/44, mass 1 |
| `page` | route enter | stiffness 340, damping 34, mass 0.9 |
| `loader` | springy loaders | stiffness 260, damping 14, mass 1 |
| `delight` | scan complete, setup done | stiffness 300, damping 20, mass 1 |

Press = scale .97 (rows .985) plus a pressed overlay within one frame. Route
transitions are direction-aware (forward from the right, back from the left). Animate only
transform and opacity (and framer `layout`). No transition settles slower than
450ms; stagger 40ms, max 6 items. Loaders appear after 300ms and stay ≥500ms. Under
reduced motion every spring becomes a 150ms fade and loaders become a static pulse.

## Loaders

Springy is the signature: `Spinner` (an arc whose length breathes on the loader
spring), `BlobLoader` (two counter-rotating rounded squares with a specular glass
streak — transforms only — for scan processing and long jobs),
`DotsBounce` (inside buttons), `Skeleton` (layout-matched, one shared shimmer
clock), `ProgressBar`/`ProgressRing` (spring-chased, never backwards), and
`RouteProgress`. Lists and cards load with skeletons, never a lone spinner.

## Components

All shared UI lives in `components/ui/` and is shown in every state at `/dev/kit`.
Button, IconButton, TextField, SearchField, Select, SegmentedControl, Tabs,
FilterChip, Badge, SeverityChip, GradeBadge, Surface, Card, ListRow,
SectionHeader, Disclosure, TopBar, TabBar, ActionBar, Sheet, Dialog, Toast,
Banner, EmptyState, ErrorState, Stat, Readout, Stepper, Avatar, Switch/Checkbox,
and the loader family. Screens compose these; they do not restyle them.

## Accessibility

Contrast 4.5:1 text / 3:1 large text and non-text, measured on the composited
background. Hit areas ≥48px, 8px apart. One `<main id="main">` per page with a skip
link. Sheets and dialogs trap focus, close on Escape and a visible 48px Close, make
the rest of the page inert, and restore focus. Icon-only controls require a label.
One `h1` per page and linear heading order. Live regions for toasts, loaders and
form errors. Zoom is never disabled. Layouts hold at 320px wide and at 200% text.

## The 3D posture map

The Three.js posture map (`public/muscle-viewer`, `MuscleModel3D`) and the scan
animation are out of scope: do not change their rendering or animation. Only the
chrome around them (controls, buttons, overlays) follows this system.

## Do / Don't

**Do** show a measurement with its reference range ("No reference yet" when none).
Do gate a blocked action and say why. Do keep one primary action per screen. Do
write disclaimers as one line at the end of the scroll.

**Don't** add a fourth material, a sixth radius, an off-scale space, or a colour
outside the tokens. Don't put blur on rows, fields or anything inside a scrolling
list. Don't show the same value twice on one screen. Don't let a chip row wrap —
scroll it. Don't use a red primary button.
