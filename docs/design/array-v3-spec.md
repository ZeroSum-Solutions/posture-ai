# Array v3 — full specification

Source: the Sonnet 5.5 redesign proposal (2026-10-07), merged with the measured
UI audit and the HIG / Material 3 / WCAG brief, with the owner-level decisions
below applied. `DESIGN.md` is the contract; this document holds the detail
(component anatomy, props, states, screen layouts, motion physics). Where they
disagree, `DESIGN.md` wins.

## Decisions taken on the proposal's open questions

1. **Disclaimer:** a one-line `footnote` at the end of each page's scroll content
   (not in fixed chrome), and once on the You tab. It is not removed from any screen.
2. **Navigation:** five docked, labelled tabs with a raised centre Capture action.
3. **Ambient field:** the gradient glow replaces the photograph.
4. **Camera:** only the chrome around the live camera changes; capture logic is
   untouched. Physical-device check after deploy.
5. **Workouts hub:** Saved · Builder · Library (exercises + muscles) under one tab;
   existing URLs keep working.
6. **Haptics:** `navigator.vibrate` only (Android); no iOS workaround.
7. **No feature flag:** each slice lands directly once its tests pass.

---


## Amendments adopted from the Kimi K3 critique (2026-10-07)

These override the sections below where they conflict.

1. System font stack (SF Pro / Roboto), no web font; same roles and sizes.
2. ActionBar is solid (`--surface-solid` + hairline), never glass.
3. ActionBar pads the safe area only when it is the bottom-most chrome.
4. Results hero container height `clamp(340px, 44dvh, 460px)` (container only; the 3D renderer is untouched).
5. BlobLoader is transform-only: two counter-rotating rounded squares + heartbeat core + specular streak.
6. Press/state feedback may use CSS `linear()` spring easing; framer-motion for layoutId, drag and presence.
7. Selected FilterChip = accent tint + accent ring + check, not a white fill.
8. Capture tab: visible label; raise included in `--chrome-bottom`; 48px circle below 360px.
9. Direction-aware route transitions.
10. Pull-to-refresh: `overscroll-behavior-y: contain`; gesture off on iOS by default; visible Refresh button always.
11. SegmentedControl has one selected idiom: white thumb.
12. Toasts clear the virtual keyboard.
13. Gaps closed: route focus + announcer, Android back for sheets/dialogs, autofill/selection/caret tokens, ChunkLoadError reload-once, reduced-data pauses the field drift, reorder has Move up/down menu items, dirty forms confirm discard, hint banners are `role="note"` and persisted, immersive chrome tested at 200% text.
14. Delight: conic edge-light on glass borders, optional pointer sheen on the hero card, ProgressRing → check morph, tab-indicator jelly, shutter "ready" pulse, haptic on detent snap.

---

## 1. Design principles

1. **One screen, one question, one primary action.** Each screen answers "what do I do next?" with a single filled button in the bottom third. Everything else is secondary or lives behind a row, sheet or tab. (Audit #1, #6: seven `*Button` families, duplicated severity labels.)
2. **Legibility is a budget, not a preference.** Body text is 16px at weight 400 or heavier. Nothing readable is under 12px. Every text tier clears 4.5:1 against the *worst* glass backdrop, not the nicest one. The 0.3-alpha "quiet" tier is deleted. (Audit #3: 40 failing nodes; brief §1, §5.)
3. **Glass is chrome, not content.** Blur lives only on the tab bar, top bar, sheets, toasts and one hero card per screen. List rows and form fields are solid. At most 2 blurred layers are visible at once. This keeps glassmorphism on mid-range Android and protects contrast.
4. **Tokens or nothing.** Components read from one token layer: 12 type roles, a 4px spacing scale, 4 radii, 5 text/surface colors. A stylelint rule fails the build on a raw font-size, color or radius literal. This replaces today's 44 font-size, 119 color and 15 radius literals.
5. **Every control is touchable and never covered.** Targets are 48px by hit area with an 8px gap. Nothing floats over scrolling content. The tab bar is docked, and screens reserve its exact height. Sheets, bars and the keyboard never hide the focused field.
6. **Motion is physics, and it is interruptible.** Every transition is a named spring, retargetable mid-flight, with a hard ceiling of about 450ms. Loaders are the signature "springy" element. With reduced motion, everything degrades to a 150ms crossfade.
7. **Say what it is, in words.** Tabs always show labels. Severity is word + icon + color. A measurement always shows its reference range. Empty and error states say what happened and offer one action. Vocabulary stays screening-only.

---

## 2. Tokens v3

### 2.1 Type scale

Font: Roboto (keep `--font-ui`), with `system-ui` fallback and `font-synthesis: none`. All sizes are in `rem` (1rem = 16px) so OS text scaling reflows. Weight 300 is allowed only at ≥28px. Weight 100 is retired.

| Role | Token | px / rem | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|---|
| Display | `--t-display` | 34 / 2.125 | 300 | 40 | −0.02em | Large title in TopBar, sign-in hero, results headline |
| Title 1 | `--t-title1` | 28 / 1.75 | 300 | 34 | −0.015em | Empty/error state titles, hero stat headings |
| Title 2 | `--t-title2` | 22 / 1.375 | 500 | 28 | −0.01em | Card titles, sheet titles, collapsed TopBar title (17 there) |
| Headline | `--t-headline` | 17 / 1.0625 | 500 | 22 | 0 | List row primary line, section headers, button-lg label |
| Body | `--t-body` | 16 / 1 | 400 | 24 | 0 | All prose, input text, instructions, button label (md) |
| Callout | `--t-callout` | 15 / 0.9375 | 400 | 22 | 0 | Row secondary line, helper text |
| Subhead | `--t-subhead` | 14 / 0.875 | 400 | 20 | 0.005em | Metadata (timestamps, "9 findings"), tab labels |
| Footnote | `--t-footnote` | 13 / 0.8125 | 400 | 18 | 0.005em | Disclaimers, units, reference ranges |
| Caption | `--t-caption` | 12 / 0.75 | 500 | 16 | 0.01em | Badges, chip counts, tab-bar labels, axis labels. **Floor.** |
| Overline | `--t-overline` | 12 / 0.75 | 500 | 16 | 0.08em, uppercase | Section kickers only (was .16em/400). Max 1 per screen |
| Readout XL | `--t-ro-xl` | 56 / 3.5 | 300 | 56 | −0.03em | One hero score per screen |
| Readout L | `--t-ro-lg` | 28 / 1.75 | 400 | 32 | −0.02em | Stat tiles |
| Readout M | `--t-ro-md` | 20 / 1.25 | 500 | 24 | −0.01em | Inline measurements, rep/set counters |
| Readout S | `--t-ro-sm` | 15 / 0.9375 | 500 | 20 | 0 | Row-trailing values, deltas |

- All readouts use `font-variant-numeric: tabular-nums`.
- Button labels are Body/500 (md) and Headline/500 (lg).
- **Glass text rule:** on any blurred surface, add `text-shadow: 0 1px 2px rgba(0,0,0,.35)` to Footnote and Caption only.
- **Max measure:** `max-width: 38rem` on prose.
- **Inputs:** exactly 16px, which stops iOS focus-zoom. This removes the "14px + locked viewport" workaround in `globals.css`.
- **Headings:** the global `h1,h2,h3 { weight 300 }` rule goes. Heading elements get their role class, never a weight by tag.
- **Dynamic text:** layouts must survive 200% text. Rows use `min-height`, never `height`. Tab-bar labels may truncate with an ellipsis, but icons stay.

### 2.2 Spacing

4px base. Scale: `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64` as `--s-0 … --s-64`. The 6px, 10px and 14px values are retired.

| Rule | Value |
|---|---|
| Screen margin (inline) | 16px (20px at ≥600px; content column max 480px, centered) |
| Card padding | 16px (hero card 20px) |
| Inside a component (icon↔text, label↔field) | 8px; 4px for tight pairs |
| Between rows in a list | 0 (rows divided by hairline) or 8px (separate cards) |
| Between cards | 12px |
| Between sections | 24px (section header sits 8px above its content) |
| Between page groups | 32px |
| Tap target | ≥48×48 hit area, ≥8px gap between adjacent targets, 12px between a destructive and a non-destructive target |
| List row height | 56 (1 line), 64 (2 lines), 72 (2 lines + avatar 40). Never under 48 |
| Control heights | Button md 48 / lg 56 / sm 40 (hit area padded to 48); Input 52; Chip 36 (hit 48); Segmented 44 |
| Top bar | 52 + `safe-area-top` collapsed; large title area 96 |
| Tab bar | 56 + `safe-area-bottom` |
| Action bar | 80 + `safe-area-bottom` (button 56 + 12 + 12) |

**Bottom clearance:** `--chrome-bottom` is set by the shell to tab-bar height, plus action-bar height if one is mounted. Scroll containers use `padding-bottom: calc(var(--chrome-bottom) + 16px)`. This replaces the fixed `--island-clearance: 92px` guess, and the 150px fade is deleted.

### 2.3 Radius

Four families plus full:

| Token | px | Use |
|---|---|---|
| `--r-sm` | 8 | Thumbnails, small badges, skeleton lines |
| `--r-md` | 14 | Inputs, selects, segmented control container, banners |
| `--r-lg` | 20 | Cards, rows-as-cards, toasts |
| `--r-xl` | 28 | Sheets (top corners), dialog, hero card |
| `--r-full` | 9999 | Buttons, chips, avatars, tab-bar active pill, icon buttons |

Concentric rule: inner radius = outer − padding, clamped to `--r-sm`. The `999px` spelling and `23px/15px` values go.

### 2.4 Color

The field is `#000`. The measured effective background is a glass-over-field worst case of `#1C1C1E` (see §2.5).

**Text tiers** (white at alpha, composited over a `#1C1C1E` worst-case surface; ratios are computed with the WCAG formula, rounded):

| Token | Value | On #000 | On #1C1C1E | Use |
|---|---|---|---|---|
| `--text-1` | `rgba(255,255,255,.95)` | 18.7:1 | 15.2:1 | Titles, row names, values |
| `--text-2` | `rgba(255,255,255,.72)` | 10.6:1 | 8.6:1 | Body prose, row secondary |
| `--text-3` | `rgba(255,255,255,.58)` | 7.0:1 | 5.7:1 | Metadata, helper, placeholders |
| ~~`--text-quiet`~~ | deleted | | | Alias to `--text-3` for one release |

- **Disabled:** content at 38% opacity (exempt from contrast), plus a reason line above in `--text-2`.
- **Inverse:** `--text-on-action: #000` on white action (21:1).

**Surfaces:**

| Token | Value |
|---|---|
| `--bg` | `#000` |
| `--surface-flat` | `rgba(255,255,255,.07)` (rows, tiles; no blur) |
| `--surface-flat-pressed` | `rgba(255,255,255,.12)` |
| `--surface-field` | `rgba(255,255,255,.08)` + 1px `--border-field` |
| `--border` | `rgba(255,255,255,.12)` |
| `--border-field` | `rgba(255,255,255,.38)` (3:1 on field for WCAG 1.4.11; **was .10, which fails**) |
| `--hairline` | `rgba(255,255,255,.10)` |

**Accent and action:**

| Token | Value | Notes |
|---|---|---|
| `--action` | `#FFFFFF` | Primary fill |
| `--accent` | `#4DB2FF` | 9.1:1 on #000, 7.4:1 on #1C1C1E. Links, focus ring inner, progress fill, selected-state tint, spinner |
| `--accent-tint` | `rgba(77,178,255,.16)` | |
| `--capture` | `#34D399` | Only the Capture button and capture-ready states |

Replace `info #0A83C9` with `--accent`, which is stronger on black (`#0A83C9` is ~5:1 on #000, ~4:1 on glass).

**Severity** (text or icon color ≥4.5:1 on #1C1C1E; fills are always tint + ring + icon + word):

| Band | Fg | Tint (16%) | Ring (42%) | Icon | Word | Fg on #1C1C1E |
|---|---|---|---|---|---|---|
| Maintain | `#34D399` | `rgba(52,211,153,.16)` | `rgba(52,211,153,.42)` | `check-circle` | "Maintain" | ≈9:1 |
| Monitor | `#FBBF24` | `rgba(251,191,36,.16)` | `rgba(251,191,36,.42)` | `eye` | "Monitor" | ≈10:1 |
| Review | `#FF7A7A` | `rgba(255,122,122,.16)` | `rgba(255,122,122,.42)` | `flag` | "Review" | ≈6.3:1 |
| Neutral | `--text-2` | surface-flat | border | `minus-circle` | "Not rated" | |

Lighter Maintain/Monitor/Review than v2's `#10B981/#F59E0B/#EF4444` so that small text clears AA on glass. The old hexes survive only as chart fills ≥3:1 on black. Severity never appears as a solid block behind body text.

**Focus ring:** double ring, `0 0 0 2px #000, 0 0 0 4px #fff` (white outer is 21:1 on black; the black gap keeps it ≥3:1 over any glass). It is applied via `:focus-visible` on every interactive element. Offset is set by box-shadow, never `outline-offset` hacks.

**States:**

| State | Treatment |
|---|---|
| Hover (pointer:fine only) | +6% white overlay |
| Pressed | +12% overlay and scale .97 |
| Selected | accent tint + accent ring + icon change (never color alone) |
| Disabled | 38% opacity, no events, reason text |
| Error | `--review-fg` border + `alert` icon + text |
| Success | `--maintain-fg` + `check` icon + text |

### 2.5 Glass / material tiers

| Tier | Where | Recipe | Reduced-transparency / no-blur fallback |
|---|---|---|---|
| **M0 Flat** | List rows, tiles, fields, chips, stat tiles | `background: --surface-flat`; 1px `--hairline`; **no backdrop-filter** | Same (already solid) |
| **M1 Card glass** | Hero card (max 1, never 2, per screen), Surface `feature` | `background: rgba(24,24,28,.72)`; `backdrop-filter: blur(20px) saturate(1.3)`; 1px `--border`; inset top highlight `inset 0 1px 0 rgba(255,255,255,.14)`; shadow `0 16px 32px -12px rgba(0,0,0,.5)` | `#17171A` opaque, no blur |
| **M2 Chrome glass** | Tab bar, top bar (collapsed), toasts, sheet panel | `background: rgba(18,18,22,.78)`; `blur(24px) saturate(1.4)`; 1px top/bottom `--border` | `#141417` opaque |
| **Scrim** | Behind sheet and dialog | `rgba(0,0,0,.56)`, **no blur** | Same |

- **Fallback rules:** both fallbacks are in CSS: `@media (prefers-reduced-transparency: reduce)` and `@supports not (backdrop-filter: blur(1px))`. Under either, the fill becomes the solid color.
- **No-photo field:** the v2 photograph with `mix-blend-mode: screen` is the biggest legibility and perf risk. It can hit L≈0.09 under glass, which breaks the `--text-3` ratio. Replace it with `AmbientField` v3. This is two fixed radial gradients (accent at 12% top-left, violet `#6D4AFF` at 8% bottom-right) on `#000`, animated by a 30s transform drift on a promoted layer. A `max luminance ≤ #1C1C1E` test guards it. Photo mode is dropped. Under reduced motion the drift stops.
- **Over the live camera or video:** never rely on blur for contrast. Use a scrim of ≥.55 black behind any text. Capture and player controls use M2 with the fill raised to `rgba(0,0,0,.6)`.
- **Layer cap:** ≤2 blurred layers visible at once. Typical screens have tab bar + hero card. With a sheet open, the hero card's blur is suspended by `data-sheet-open` on `<body>`, giving tab bar + sheet.

### 2.6 Elevation and z-index

| Layer | z | Contents |
|---|---|---|
| Field | 0 | AmbientField |
| Content | 1 | Scrolling page |
| Sticky | 10 | TopBar collapsed, section sticky headers |
| Action bar | 20 | Pinned primary action |
| Tab bar | 30 | Docked nav |
| Scrim | 50 | |
| Sheet | 60 | |
| Dialog | 70 | |
| Toast | 80 | Above sheets, clear of the tab bar by 8px, or of the sheet bottom |
| Immersive | 100 | Capture/player (hides tab bar, field) |

Shadows are decorative only. Elevation reads through fill + border + highlight.

### 2.7 Safe areas and viewport

- `viewport-fit=cover`.
- CSS vars: `--sa-t/r/b/l: env(safe-area-inset-*, 0px)`.
- Every fixed element pads its touching edge: tab bar bottom, action bar bottom, top bar top, capture shutter bottom, sheets bottom, toasts above bar.
- Full-height surfaces use `100dvh`. `100vh` is banned by lint.
- In landscape, add `--sa-l/r` to the screen margins.
- Content column: `min(480px, 100%)`, centered. This drops the 430px lock and lets tablets breathe.

### 2.8 Motion

**Library:** framer-motion 12, via `LazyMotion` + `m.*`. Presets exported from `lib/motion.ts` (each is a `Transition`):

```ts
export const spring = {
  press:   { type: 'spring', stiffness: 520, damping: 24, mass: 0.7 },   // scale .97 → 1, tiny overshoot, ~160ms
  state:   { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 },   // chip, toggle, tab indicator, check, ~220ms
  layout:  { type: 'spring', stiffness: 320, damping: 30, mass: 1 },     // expand/collapse, reorder, FLIP, ~340ms
  sheet:   { type: 'spring', stiffness: 380, damping: 38, mass: 1 },     // present, ~380ms, no overshoot
  sheetOut:{ type: 'spring', stiffness: 440, damping: 44, mass: 1 },     // dismiss, inherits drag velocity
  page:    { type: 'spring', stiffness: 340, damping: 34, mass: 0.9 },   // route enter: x 24 → 0 + fade
  loader:  { type: 'spring', stiffness: 260, damping: 14, mass: 1 },     // springy indicators, visible bounce
  delight: { type: 'spring', stiffness: 300, damping: 20, mass: 1 },     // scan complete, first-run done
} as const
// Equivalent shorthand where you prefer it: layout ≈ { visualDuration: .34, bounce: .1 }; sheet ≈ { visualDuration: .38, bounce: 0 }
export const fade = { duration: 0.16, ease: 'easeOut' } as const         // scrim 0.2
export const reduced = { duration: 0.15, ease: 'easeOut' } as const      // replaces every spring
```

- **Ceiling:** no UI transition >450ms. Stagger 40ms per item, max 6 items.
- **Never animate** width, height, top or left. Use transform, opacity and `layout`.
- **Reduced motion:** `MotionConfig reducedMotion="user"` plus a `useSpring()` helper returning `reduced` and zero-offset variants. Rules: no overshoot, no parallax, no x-slide, only crossfades; loaders become a static ring with a 1.6s opacity pulse (0.6↔1). Haptics unaffected.
- **Retire** the CSS `150ms/300ms cubic-bezier` constants and the global `button, a { transition }` rule.

---

## 3. Component library

All live in `components/ui/` (keep `components/array/` as thin re-exports during migration). All are client components only where needed. Every interactive component forwards `ref`, accepts `className` for layout only (never for colors), and takes `data-testid`.

### 3.1 Button

- **Variants:**
  - `primary`: white fill, black text. One per screen.
  - `secondary`: M0 `--surface-field` fill + 1px `--border`, `--text-1`.
  - `tertiary`: no fill, `--accent` text. For "See all", "Cancel".
  - `danger`: *same shape as secondary* with `--review-fg` text and a `trash` icon. It appears only inside a confirm Dialog or sheet footer, never as a screen's lone CTA. This honors v2's "never a red button" spirit.
- **Sizes:** `sm` 40 (hit 48), `md` 48, `lg` 56. Pill. Label Body/500 (lg: Headline/500). Padding-inline 20 (sm 16). Icon 20px, gap 8.
- **`block`** makes it full width. In an ActionBar, `lg` + `block`.
- **States:**
  - Pressed: `m.button whileTap={{ scale: .97 }}` with `spring.press`, plus +12% overlay in 1 frame.
  - Focus: focus ring.
  - Disabled: 38% opacity, with an optional `disabledReason` rendered by the parent above the button. Uses `aria-disabled` (not `disabled`) when a reason is shown, so screen readers can still read it. Click is swallowed.
  - Loading: label cross-fades to `DotsBounce` (width locked via `min-width` measured at mount), `aria-busy="true"`, click ignored, visible ≥500ms.
- **A11y:** native `<button>` or `<Link>` (`href` prop switches element). Name is visible text; icon-only is the IconButton.

```ts
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  icon?: IconName            // leading
  trailingIcon?: IconName
  loading?: boolean
  disabledReason?: string    // rendered via <Button.Reason/> and aria-describedby
  href?: string              // renders next/link
  haptic?: 'tap' | 'success' | 'warn' | false
} & Omit<ComponentPropsWithoutRef<'button'>, 'className'>
```

**IconButton:** 48×48 hit area, visible 44 circle (`--r-full`) at `surface-field`. 24px icon. `label` is required and rendered as `aria-label`. Variants: `plain | glass | filled`. The glass variant sits on the camera/3D hero and uses M2 with scrim .6.

```ts
type IconButtonProps = { icon: IconName; label: string; variant?: 'plain'|'glass'|'filled'; badge?: number|boolean } & ButtonDomProps
```

### 3.2 TextField / Search / Textarea

- **Anatomy:** label (Subhead/500, `--text-2`, always visible above) → control (52px, `--r-md`, `--surface-field`, 1px `--border-field`, Body 16px) → help (Footnote `--text-3`) or error (Footnote, `alert` icon + `--review-fg`).
- **Required** marked with the word "Required" in the label's trailing slot, not an asterisk.
- **Focus:** border becomes `--text-1`, plus focus ring.
- **Error:** `aria-invalid`, `aria-describedby` → message, and scroll-into-view above the keyboard (see §7).
- **Disabled:** 38%.
- **Loading** (async validation): trailing Spinner 16.
- **Search:** same field, leading `search` icon, trailing clear IconButton (appears when non-empty), `enterKeyHint="search"`, debounce reused from `DebouncedSearchInput`.
- **Native-ish types:** `inputMode`, `autoComplete`, `autoCapitalize` are required props on TextField (typed), so keyboards are right (numeric for reps/weight).
- **No `backdrop-filter` on inputs.** The global `input,textarea,select {blur}` rule is removed; it blurred every field.
- **Select:** native `<select>` styled as a field with a trailing chevron. Long option lists (clients) use the Sheet picker instead (§3.5).

```ts
type TextFieldProps = { label: string; hint?: string; error?: string; required?: boolean; leading?: IconName; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>
type SearchFieldProps = { value: string; onChange(v: string): void; placeholder?: string; onClear?(): void; label: string /* sr-only */ }
```

### 3.3 SegmentedControl (2–4 options) and Tabs

- **SegmentedControl:** 44px high container (`--r-full`, `surface-field`), selected thumb is white at `--text-on-action`, or accent-tint when on busy backgrounds. It slides using `layoutId` and `spring.state`. Labels Subhead/500; a label may truncate; ≥2 chars. Use for **inline filters and mode toggles that change a view in place** (Front/Back, kg/lb, Exercises/Muscles).
- **Tabs** (wraps today's `TabStrip`, keeps its ARIA contract and IDs): same visual as Segmented but `role=tablist` with panels. Use for **content panes** (Findings | Program, client detail Overview | History). Max 3 on a phone (current rule was 4; 390px with 16px text allows 3 comfortably).
- **A11y:** arrow, Home and End keys, roving tabindex, `aria-controls`. Each segment ≥48 hit width.

```ts
type SegmentedProps<T extends string> = { options: {value:T; label: string; icon?: IconName}[]; value: T; onChange(v:T): void; label: string; size?: 'md'|'sm' }
// Tabs keeps TabStrip's props (idBase, options, value, onChange, label); no API change
```

### 3.4 Chip family

- **FilterChip:** 36 tall visual, hit area 48 via `::after { inset: -6px 0 }`. Padding-inline 14. Label Subhead/500. Optional count in Caption. `aria-pressed`. Selected: white fill/black text *and* a leading `check` icon (not color alone). Rows scroll horizontally in a single line with 8px gaps and edge fade masks (mask-image, no blur). **No wrapped chip rows**: that is where 184 pair-proximity flags came from.
- **InfoChip / Badge:** 24 tall, Caption, `--r-full`, `surface-flat`. Non-interactive.
- **Dismissible chip:** trailing `x` is a separate 48-hit button with an accessible name "Remove {label}".

```ts
type FilterChipProps = { label: string; count?: number; selected: boolean; onToggle(): void; icon?: IconName }
```

### 3.5 Surface / Card / ListRow / Section header

- **Surface** (keeps API: `tier: 'feature'|'tile'|'row'`; mapped as `feature→M1`, `tile/row→M0`). The 1px gradient shell becomes a single `border` plus a `::before` mask gradient. That removes the double wrapper div and the per-card gradient layer. Add `interactive` for press physics. `SurfaceLink` and `SurfaceButton` stay.
- **Card:** Surface + title (Title 2 or Headline) + content slot + optional footer action. Padding 16.
- **ListRow** (replaces ad-hoc client, workout and exercise rows):
  - Anatomy: leading (avatar 40 or icon tile 40) · text block (Headline name, Callout/Subhead secondary, max 2 lines) · trailing (value `Readout S`, SeverityChip or chevron).
  - Height 64 (72 with avatar). The whole row is one target. Dividers are hairlines, inset to text start. A group of rows is one Surface (M0), not one glass per row.
  - Swipe actions: optional, reveal ≥72px per action, commit at >35%, and *always* duplicated in a long-press/"…" IconButton for accessibility.
  - Pressed: scale .985 + overlay.
- **SectionHeader:** Headline (17/500) left, optional tertiary "See all" Button right (48 hit). 24px above, 8px below. Used instead of kicker+title combos.
- **A11y:** lists are `ul/li` with `aria-label`; rows are `a` or `button`, never a div with onClick.

```ts
type ListRowProps = { leading?: ReactNode; title: string; subtitle?: string; meta?: string; trailing?: ReactNode; href?: string; onPress?(): void; chevron?: boolean; busy?: boolean; swipeActions?: SwipeAction[] }
type SectionHeaderProps = { title: string; action?: { label: string; href?: string; onPress?(): void }; id?: string }
```

### 3.6 TopBar (large-title collapse)

- Two zones:
  1. A **large title** (Display 34/40) at the top of the scroll content.
  2. A **sticky collapsed bar** (52px + safe-top, M2 glass) whose centered title (Headline 17/500) fades in with a `state` spring once the large title's sentinel leaves the viewport. Implementation: `IntersectionObserver` on the sentinel, with scroll-driven CSS (`animation-timeline: scroll()`) as an enhancement behind `@supports`.
- Leading: back IconButton (labelled "Back to Clients") or nothing. Trailing: up to 2 IconButtons (including "More" → action sheet).
- **Backdrop blur only when collapsed.** Expanded, the bar is transparent, so there is no permanent blur layer.
- Top 12px below the status bar is non-interactive padding.

```ts
type TopBarProps = { title: string; subtitle?: string; back?: { href: string; label: string }; actions?: IconButtonProps[]; large?: boolean /* default true */ }
```

### 3.7 TabBar (replaces the island)

- **Docked**, full-width, M2 glass, 56px + `safe-area-bottom`, top hairline. It is not a floating pill, so it overlaps nothing; content ends exactly above it (`--chrome-bottom`).
- **Five slots, labels always visible:** Today · Clients · **Capture** · Workouts · You.
  - Each is a 48px-min target, icon 24 + Caption label (12/500).
  - Active state is icon swaps to a filled variant, label goes `--text-1`, and an accent 3px indicator pill slides between slots (`layoutId`, `spring.state`). It is never color alone.
  - Inactive is `--text-2`.
  - The visible label equals the accessible name (WCAG 2.5.3), and names match today's `aria-label`s, so e2e selectors keep working.
- **Capture** is the center slot: 56px circle, `--capture` fill with black icon, raised 10px above the bar. It is an action, so it never shows an "active" indicator (consistent with today's `islandPolicy`).
- **Hiding:** the bar is hidden (slide out with `spring.sheet`) on immersive routes, while the keyboard is open (`visualViewport` shrink >120px) and while a sheet is at the large detent. It is **never** scroll-hidden; the scroll-reveal logic in `IslandNav` goes away.
- **Policy reuse:** keep `islandPolicy` (slot lists per audience, hidden routes, active-slot matching), renamed `tabBarPolicy`, with its tests.

```ts
type TabBarProps = { audience: 'practitioner' | 'athlete'; pathname: string }  // slots from tabBarPolicy
```

### 3.8 Sheet (detents) and Dialog

- **Sheet:** bottom sheet, `--r-xl` top corners, M2 panel, grabber 36×5 at 8px top, header row (title Title 2 + 48px **Close** IconButton, always present), scrollable body, optional sticky footer actions.
- **Detents:** `compact` (content height, ≤50dvh), `medium` (62dvh), `large` (92dvh). Drag between detents with velocity snapping; dismiss by drag past 150px or flick, scrim tap, Escape, or Close button.
- **Motion:** present with `spring.sheet`, dismiss with `spring.sheetOut`, both retargetable.
- **Scrim:** `rgba(0,0,0,.56)` that fades in with `fade`.
- **Behavior:**
  - Focus moves to the sheet title on open and is trapped. Escape and the Close button always exit. Focus returns to the trigger on close.
  - Body scroll is locked (`overscroll-behavior: contain` on the panel).
  - Content never sits under the home indicator (safe-bottom pad), and the sheet resizes with `visualViewport` so focused fields stay visible.
  - Uses `role="dialog" aria-modal="true" aria-labelledby`, `inert` on the rest of the app.
- **One implementation** replaces `ExerciseDetailSheet`, `WhyThisSheet` and `MuscleDetailModal`. A **Picker** variant (searchable list in a sheet) replaces long `<select>`s such as the client picker.
- **Dialog:** centered, `--r-xl`, max 340px wide, 20px padding, title + body + 2 stacked full-width buttons (primary above, secondary/danger below, 12px gap). Only for confirmations and blocking decisions. `role="alertdialog"` for destructive confirms. Never for browsing content.

```ts
type SheetProps = { open: boolean; onOpenChange(o: boolean): void; title: string; detents?: ('compact'|'medium'|'large')[]; defaultDetent?: 'compact'|'medium'|'large'; footer?: ReactNode; children: ReactNode; dismissible?: boolean; initialFocus?: RefObject<HTMLElement> }
type DialogProps = { open: boolean; onOpenChange(o:boolean): void; title: string; description?: string; confirm: { label: string; onConfirm(): void; tone?: 'primary'|'danger' }; cancel?: { label: string } }
```

### 3.9 Toast

- M2 glass, `--r-lg`, `min-height: 56`, width `min(100% − 32px, 400px)`. Icon (success/info/warn/error) + Callout text + optional action Button (tertiary, 48 hit).
- Position is bottom, 8px above the tab bar/action bar (or above safe-bottom if neither), centered, `role="status"` (error: `role="alert"`), `aria-live` polite.
- **Duration:** 4s; 7s with an action; errors that block a workflow persist until dismissed. Pausing on touch/focus is required.
- **Motion:** enter with `spring.state` from y +16 and fade. Swipe down dismisses.
- **Queue:** max 2 visible, stacked with 8px offset.

```ts
toast.success(msg, { action?: { label, onPress } }); toast.error(msg, { sticky: true })
```

### 3.10 Springy loader family

Details and physics are in §6.1. API:

```ts
<Spinner size={16|24|40} tone="accent|onAction|muted" label?: string />       // arc that breathes
<BlobLoader label="Analyzing posture…" steps?: string[] />                      // morphing 56px blob, hero loader
<DotsBounce size={6|8} />                                                       // button/inline
<Skeleton shape="line|row|card|avatar|thumb" lines?: number />                  // layout-matched
<ProgressBar value={0..1} label="Processing 3 of 4 views" />                    // linear 6px, spring fill
<ProgressRing value={0..1} size={48|72} />                                      // determinate + number
<PullToRefresh onRefresh={() => Promise<void>} />                               // wraps a scroll region
<RouteProgress />                                                               // 2px top bar on navigation
```

A11y contract for all: `role="status"` or `progressbar` with `aria-valuenow/min/max` (determinate), an accessible name via `label`, and `aria-busy` on the region. Delay 300ms before showing and keep visible ≥500ms (`useDelayedBusy(isBusy, {delay:300, min:500})`). Reduced motion gives the static pulse.

### 3.11 EmptyState and ErrorState

- **EmptyState:** centered in the content area. 56px icon tile (`surface-flat`, `--r-lg`) → Title 1 (28/300) or Title 2 → Body `--text-2` (≤2 lines, plain words) → one primary Button (+ optional tertiary). Always says why it's empty and the next step ("No clients yet. Add one to run your first scan.").
- **ErrorState:** same layout, `alert-circle` icon in `--review-fg` tint, Title 2, one sentence of what happened (never raw codes), **Retry** primary + "Contact support" tertiary, optional collapsed "Details" (Footnote). Variants: `inline` (inside a Card, e.g. "Photo not saved"), `page`, `blocking`.
- The legal-gate failure from the audit becomes `ErrorState blocking` with Retry and a status link, not a red sentence.
- **Photo placeholder:** a variant of EmptyState `inline`: image-off icon + "No photo for this view" + (if allowed) "Retake" tertiary.

```ts
type EmptyStateProps = { icon: IconName; title: string; body: string; primary?: ButtonProps & {label: string}; secondary?: {label:string; href?:string; onPress?():void}; variant?: 'page'|'inline' }
type ErrorStateProps = { title: string; body: string; onRetry?(): void; retrying?: boolean; details?: string; variant?: 'page'|'inline'|'blocking' }
```

### 3.12 Stat / Readout with reference range

- **Stat:** label (Footnote `--text-3`) / value (`Readout L` or `M`) / unit (Footnote) / optional DeltaChip (arrow + signed number + "vs last scan" for screen readers).
- **Readout with range** (every measurement):
  - Value line: `47.2°` in Readout M.
  - Caption line: `ref ≥ 53°` in Footnote `--text-3`.
  - Bar (6px, `--r-full`) with three zones and a 14px marker (marker has a 2px black outline, and a shape: circle=Maintain, diamond=Monitor, triangle=Review) so it is not color-only.
  - If no recorded reference: show "No reference yet" with an `info` icon rather than "not comparable", which reads as an error.
- `aria`: the whole readout is one `role="img"` with a sentence label: "Shoulder imbalance, 47.2 degrees, reference at least 53, Monitor".

```ts
type ReadoutProps = { label: string; value: number | null; unit?: string; reference?: { min?: number; max?: number; text: string }; band?: SeverityBand; delta?: { value: number; goodDirection: 'up'|'down' }; size?: 'xl'|'lg'|'md' }
```

### 3.13 SeverityChip / Badge

- Pill, 28 tall (md) / 24 (sm), tint fill + 42% ring, **icon + word** ("Monitor"), Caption/500 (md: Subhead/500).
- Replaces `Chip`, `GradeChip`, `DeltaChip` for severity. `GradeChip` becomes `GradeBadge`: 40px rounded-square `--r-md` showing the letter, with the band icon at the corner; it appears once per screen header, never repeated per row.
- **Never render the same band twice in one row.**
- `bandFromGrade` and `severity.ts` stay as the source.

```ts
type SeverityChipProps = { band: 'maintain'|'monitor'|'review'|'neutral'; size?: 'md'|'sm'; label?: string /* override word */ }
```

### 3.14 Stepper (wizard progress)

- **Capture wizard:** 3 labelled steps (Client · Capture · Review) as a segmented track at the top of the screen: a 4px bar split in 3 with the current segment springing to fill, plus "Step 2 of 3 · Capture" in Subhead. This replaces the circles-and-line row with truncated labels ("Processing", "Results" were near the edge at 390px).
- `role="progressbar"` with `aria-valuenow/max` and `aria-valuetext="Step 2 of 3, Capture"`. Completed segments are tappable only where going back is safe.
- Visible text always carries the step name, never color alone.

```ts
type StepperProps = { steps: {id:string; label:string}[]; current: string; onBack?(id:string): void }
```

### 3.15 Supporting primitives

- **ActionBar:** pinned primary-action container above the tab bar (or at the bottom when no tab bar). M2 glass only when content scrolls beneath it (otherwise transparent). Holds ≤2 Buttons (primary `lg block` and optional secondary `icon`). Measures itself and publishes `--chrome-bottom`. Includes a reason line slot above the button.
- **BottomFade removed.** A 1px hairline shows only when content is scrolled under it.
- **Avatar:** 40/48/72, initials, `--r-full`; grade ring optional.
- **Disclosure:** replaces "Accuracy & methodology ↓" glass cards. Row with 48px hit, chevron rotates with `spring.state`, content height animates with `layout`.
- **Switch/Checkbox/Radio:** 28×28 visual hit padded to 48; the label is part of the target. Checked state shows a check glyph.
- **Banner:** inline `info|warn|error` strip (`--r-md`, tint + icon + text).

---

## 4. Information architecture & navigation

### Nav slots (5, docked, labeled)
1. **Today**: inbox of what needs doing.
2. **Clients**: roster → client detail.
3. **Capture**: starts a scan (action).
4. **Workouts**: Programs hub with segmented `Saved | Builder | Library` (Library = Exercises + Muscles as an inner segmented control). This folds `/workouts`, `/workouts/manual*`, `/exercises`, `/muscles` into one mental home, and "Library" disappears as a separate, vaguely named slot.
5. **You**: Settings, practice info, privacy, sign out, help, first-run checklist.

### First screen after sign-in: Today
Large title "Today" with the date as subtitle. Order:
1. **Next-up hero (M1, the only glass card):** one sentence and one button, chosen by rule:
   - ≥1 report awaiting sign-off → "11 reports are waiting · Uma has waited longest" with **Review Uma first**.
   - else a client is due for re-scan → "Tara is due for a re-scan" with **Start scan**.
   - else → "Ready for your next client" with **Start scan**.
2. **Needs attention** (≤3 ListRows, "See all" → Clients filtered). Review queue and re-scans merge here.
3. **Recent scans** (≤3 ListRows).
4. One-line stats strip (Active · Scans/wk · Avg score) as Readout M, no card, at the bottom.

Cut from today: the three quick-action pills (Capture is in the bar; New client moves inside the capture flow and Clients; Workouts is a tab), the separate "Due for re-scan" card, and the stat-tile row that sat under the island.

### First-run (new user)
- **Checklist card** on Today for fresh accounts: "Get set up: 3 steps", with a ProgressRing 0/3: Add your first client → Run a first scan → Build a workout. Each step is a ListRow with its own CTA. The card collapses to a one-line "Setup 2/3" row, and disappears when done (`delight` spring on completion).
- The Today empty state is the checklist plus an EmptyState-style hero. The Clients empty state says "Add your first client" with one button.
- **Onboarding (legal gate):** one document per screen with a sticky "I agree" bar. Document fingerprint text is moved behind a "Document details" Disclosure (tertiary text ≥5.7:1). Progress is "1 of 3".
- Contextual first-use hints (max 3 ever) appear as a dismissible Banner on Capture ("Stand 2 m back, full body in frame") and on Results ("Tap a finding to see why").

### Primary job flows (fewest taps)

| Job | Flow | Taps |
|---|---|---|
| Add client → capture | Capture tab → *Client* step → "New client" (opens a Sheet with name + DOB + consent choice; saves and auto-selects) → Continue → camera | 3 taps + typing; no page change |
| Existing client scan | Capture tab → tap client row (search or recent 4) → Continue → camera | 3 |
| Capture → results | Auto-advances after the last view; the processing loader (BlobLoader + ProgressBar) is a state, not a step; lands on Results | 0 |
| Review results | Results hero → Findings tab (Review group first) → row → Sheet; **Approve / Share** in the ActionBar | 2 |
| Assign program | Results → Program tab → "Build from findings" primary in ActionBar → Builder (prefilled) → "Assign to {client}" | 3 |
| Run workout | Client detail or Saved → Start session (immersive player) | 2 |

### Merge, cut, split
- **Merge:** `AssessmentReview.module.css` + `AssessmentReviewStudio.module.css` into one `Results.module.css` (audit #5). The Dashboard review queue + re-scan card into "Needs attention". Workouts + manual routines + exercises + muscles into the Workouts hub. The 3 sheet/modal implementations into one `Sheet`. Marketing and app button systems into one `Button`.
- **Cut:** the island scroll-reveal logic; the 150px fade; the ambient photo; the capture wizard's separate "Processing" and "Results" steps; stat tiles on Today; "Show muscles on body" repeated in every finding row (becomes one control in the finding Sheet and one "Show on map" toggle in the hero toolbar); the nested `<main>` (page components become `<div>`; the shell owns `<main id="main">`, plus a skip link).
- **Split:** `/workouts` into a short "Saved" list (paginated, 10 + "Show more") and a separate Builder screen; the card wall of 25 "Guided corrective session" cards becomes a ListRow list with an overflow "…" per row (Regenerate copy / Archive move into that menu, since they were two full-width buttons per card). `/exercises` becomes a virtualized/paginated list with a sticky search + chip row.
- **Decide intentionally (audit finding on muscles vs. exercises):** muscle detail stays a page when it is deep content (anatomy, notes); exercise and finding detail stay Sheets, since they are quick lookups from a list. Rule: *quick lookup that preserves the list → Sheet; destination with its own content → page.*

---

## 5. Screen-by-screen redesign

(390×844 viewport. Safe area: ~47 top / 34 bottom on iPhone 15. Tab bar 56+34 = 90 at the bottom, leaving ~707px of scroll area. "ATF" = above the fold.)

**Today** (`/dashboard`)
- ATF: large title (96) → hero card (M1, ~210: one sentence + stacked avatars + **Review Uma first** lg button inside the card; this sits at y≈330–530, reachable) → "Needs attention" header → first 2 rows visible.
- Primary action: the hero button, plus the Capture FAB in the tab bar.
- Changes (audit): removes the nav overlapping stat tiles, the three pills, and the 0.5-alpha gray text. Row text is 16/15px (was 12). Footer disclaimer moves from page bottom to the "You" tab plus a one-line `Footnote` at the end of Results/Capture where it matters legally.

**Clients** (`/clients`)
- ATF: large title "Clients" + count subtitle → SearchField (52) → single-line scrolling FilterChips (All · Needs review · Overdue · Score ↓) → rows (64 each) ×5 (y 250→).
- Primary: the Capture tab; per-row tap opens detail. A "+" IconButton in the TopBar adds a client.
- Changes: the footnote "Recorded values can differ…" (a 3-line disclaimer in the list header) moves into a one-time Banner dismissed to a "ⓘ" IconButton in the bar. Sorting moves to a TopBar sort IconButton (Sheet picker), freeing a header row. The fade no longer dims rows because the list ends exactly at the docked bar. Row status shows an icon + word chip ("Overdue" in Monitor) instead of "→ first scan" arrows with no meaning. Row subtitle is one line max; "in review · overdue" becomes 1 SeverityChip + age. Filter chip hit 48 (was 34). Lists >50 rows paginate by 30 with a sticky "Show more" row (client count 171 in heavy fixtures).

**Client detail** (`/clients/[id]`)
- ATF: TopBar (back "Clients", More IconButton) → avatar 72 + name (Display) + consent status chip → ActionBar-style row: **New scan** (primary md block) + **Compare** (secondary) → Score card (hero M1: Readout XL 22 /100 + range bar) → Top findings rows.
- Tabs: Overview | History. "Latest assessment anatomy" becomes one ListRow in Overview; "Findings" and "Scan history" glass-card disclosures become the History tab (a list of scans with GradeBadge).
- Changes: back is 48 not 40 (audit #4); the primary pair stays in the upper half but is duplicated as a sticky ActionBar when scrolled past it; the consent warning gets a Banner with a "Send consent" action, rather than a small flag line; the island overlapped the lower disclosures.

**Capture: client step** (`/assessments/new`)
- ATF: TopBar "New assessment" (back) → Stepper (3 steps) → SearchField → "Recent" 4 rows + "Show all 28" → ActionBar pinned: **Continue** (disabled until selection, reason: "Choose a client to continue").
- "+ New client" is a tertiary button in the list header (opens the Sheet), not a white primary above the list, so there is one primary only (Continue).
- Changes (audit screenshot): the ghosted "Choose capture method" bar sat *under* the island at y≈860; now Continue sits in the ActionBar in the thumb zone (y≈ 760–816) above the tab bar (which hides here: the tab bar hides in the wizard to avoid two stacked bars). "DOB: …" subtitle is Subhead.

**Capture: method + camera**
- Method: 2 large selectable cards (Camera guided · Upload photos), each 96 tall, with a one-line explanation. ActionBar **Continue**.
- Camera (immersive, `data-immersive-surface` retained): full-bleed feed. Top: glass IconButton Close + a centered guidance pill (M2 + scrim .6, Callout 15/500: "Front view · stand 2 m back"). Middle: silhouette guide at 70% opacity (unchanged logic). Bottom: shutter 72 circle centered at safe-bottom + 24; left: thumbnail of previous capture (48); right: flip camera IconButton. View indicator: 3–4 dots with labels under the pill. After each capture: a `delight` micro-spring checkmark and an auto-advance to the next view; retake is a tertiary in a bottom card for 3s.
- Processing: full-screen BlobLoader with step text ("Reading front view… 2 of 4"), ProgressBar, and "You can leave this screen" with a secondary "Go to Today" (processing continues).

**Results** (`/assessments/[id]`)
- ATF: **3D map hero, unchanged component, full-bleed, `min-height: 56dvh`** (the 3D slot). Overlays use M2 glass IconButtons only (back, view toggle). The Front/Back/Reset/X-Ray controls stay with the 3D (out of scope) but sit on an M2 pill with 48 targets, gaps 8. GradeBadge + "22/100" Readout move out of the hero's top-left chip into the next section so the hero shows only the model.
- Below: sticky Tabs (Findings | Program 2). The `Launch session` button moves to the ActionBar (always at the bottom, y≈ 760).
- **Findings tab:** summary line ("5 findings: 1 Review · 2 Monitor · 2 Maintain") → grouped lists: Review first, then Monitor, Maintain collapsed. Each finding is a ListRow: Headline name + side/view in Subhead, trailing SeverityChip (once) and chevron; the range bar is *inside the Sheet*, not each row. Tapping opens the finding Sheet (medium): Readout + range, "Why this" text (Body), muscles chips with "Show on map", linked exercises.
- **Capture set** moves under a Disclosure "Photos (2 of 4)". Missing photos use the inline EmptyState ("No photo for this view").
- **Program tab:** PriorityProgram as ListRows with a "+" reorder drag handle and an overflow menu; `demote/promote/why-this` four buttons per item collapse into drag + one "…" menu.
- Methodology and Report/share become two Disclosure rows (Share has its own sheet).
- Changes: single stylesheet (audit #5); severity word appears once (audit #6); "not comparable" becomes "No reference yet"; the label hierarchy fixes the repeated "Show muscles on body" line; this screen drops from ~8,400px of scroll to ~2,500 by collapsing Maintain findings and photo cards.

**Workouts hub** (`/workouts`)
- ATF: TopBar "Workouts" → Segmented (Saved · Builder · Library) → for Saved: client filter (Picker field), list of sessions (ListRow 72: title, client, date, status chip; trailing "…") → 8 visible.
- Primary: ActionBar **New workout** (opens Builder). Pagination 10 + "Show more".
- **Builder:** client Picker → "Connect {client} to a training account" Banner (when needed; with one action) → template/day selector as chips → exercise ListRows with "+" IconButtons (48) → ActionBar **Save program**.
- Changes: the 11,075px wall of cards becomes a ~1,100px first screen; 42px header links are 48; the client `<select>` that brushed the island is a Sheet picker.

**Library** (Exercises, `/exercises`; Muscles, `/muscles`)
- ATF: SearchField → chip row (categories, single scrolling line) → ListRows with 56px thumbnail-less rows (name Headline, target/equipment Subhead, trailing **+** IconButton) → tapping a row opens the exercise Sheet (large) with steps and "Add to workout" in its footer.
- Virtualize (`content-visibility: auto` + `contain-intrinsic-size: 64px` on rows; paginate 30). The 279 exercises no longer render as 8,464px of full cards, each with a full-width white button.
- Muscles: grid of 2-col tiles (M0) with icon + name (tile height 96); detail stays a page.

**Workout session** (`/workouts/[sessionId]`, immersive)
- ATF: top: step counter "Exercise 3 of 8" (Subhead) + Close; middle: video/illustration; title (Title 2); `Readout XL`-style reps×sets (Readout L); bottom ActionBar: **Done set** primary lg block + "Skip" tertiary; rest timer is a ProgressRing 72 in the center with count-down. The player's `data-immersive-surface` stays.
- Changes: single-handed reachability (all controls in the bottom 220px); haptics on set done.

**Manual routines** (`/workouts/manual*`): list = ListRows in the Saved segment; editor = a vertical list of exercise rows with "−/+" steppers (each 48×48, 8 gap; the `.compactActions` pattern from the audit generalized), ActionBar **Save routine**. `font-weight: 650` retired.

**Settings / You** (`/settings`)
- TopBar "You" → profile card (Avatar 72, name, practice) → grouped rows (Practice info, Notifications, Privacy & data, Legal, Help) → "Sign out" as a danger-styled row at the bottom with a confirm Dialog.
- Includes the Setup checklist, if not finished, and the screening-support disclaimer once.

**Auth** (`/auth/*`): AuthFrame unchanged structurally; Display title, one TextField column (52px, 16px type), primary lg block button at the bottom of the content (not pinned) with a Footnote link row. Password reveal is a 48px IconButton. MFA: 6 single-digit boxes become one `autocomplete="one-time-code"` field with 28px tabular digits. Errors use Banner (icon + text).

**Landing** (`/`): uses the same `Button` (`lg`). Removes the separate `.primaryButton` recipe (audit #11) and the nested `<main>`. ATF: logo, Display headline, Body subhead, **Create account** (primary), **Sign in** (secondary).

**Onboarding** (`/onboarding`): see first-run above; the worst contrast offender (12 failing nodes) is fixed by the token change plus fingerprint Disclosure.

**Legal pages** (`/privacy`, `/terms`): Display title; readable column (Body, 16/24, measure 38rem); a TOC Disclosure; `heading-order` fixed by demoting the embedded document's headings relative to the page `h1` (render with a `headingBase` prop).

**Consent** (`/consent/[token]`, client-facing): no tab bar. Stepper "1 of 2 · Read · Sign". Body 16px, sticky ActionBar **I agree**; errors use ErrorState page. Stop polling: fetch once, then refetch only on window focus or after submit (audit #13), with exponential back-off if a status poll is required.

**Share** (`/s/[token]`, client-facing): no nav. Header: practice name + client first name (Title 1). List of exercises as ListRows; tap → Sheet with steps; sticky **Start workout** ActionBar → immersive player (reused). Cache the payload; no polling.

**Train** (`/train`): shares Workouts components, with athlete-audience tab bar slots (Today = My workouts; Capture hidden).

---

## 6. Fluid UI & delight

### 6.1 Springy loader family

All use `spring.loader` (stiffness 260, damping 14, mass 1) unless stated. All gated by `useDelayedBusy` (300ms in, 500ms min).

1. **Spinner (16/24/40).** An SVG ring where a 270° arc rotates linearly at 0.9s per turn while the arc *length* breathes between 25% and 70% of the circumference, driven by `animate(pathLength, [0.25, 0.7, 0.25], { ...spring.loader, repeat: Infinity })`. The spring overshoot makes the arc stretch and snap back rather than easing like a generic spinner. Stroke 2.5px (40px: 3), round caps, `--accent` (or `--text-on-action` inside a primary button).
2. **BlobLoader (56px hero loader).** One element that morphs its `border-radius` through four 8-value keyframe sets (e.g. `60% 40% 55% 45% / 50% 60% 40% 50%` → …) while scale pulses 1 → 1.08 with a `loader` spring and rotates slowly (12s). The fill is a conic gradient of `--accent-tint` with a 1px `--border` ring; a 14px white core "heartbeats" out of phase. It is a single composited layer (transform and border-radius on one element, `will-change: transform`). It is used for scan processing, the Today first load, and program generation. Below it: `Title 2` status text cross-fading through `steps` every 1.8s, and a ProgressBar when real progress exists.
3. **DotsBounce (6/8px, 3 dots).** Each dot `y: [0,-6,0]` with `{ type:'spring', stiffness:300, damping:10 }`, staggered 0.12s and repeating. It sits inside buttons (white-on-black), inline "Saving…", and toasts.
4. **Skeleton.** Shapes mirror final components (`ListRowSkeleton`: 40 avatar circle, two lines at 55% and 35% width, 64 tall; `CardSkeleton`). Shimmer is a 40%-wide gradient translated via `transform: translateX` over 1.4s (never `background-position`, so it stays off the paint path), at white 4%→9%. All skeletons on a screen share one animation clock (`animation-delay: calc(-1 * var(--skeleton-t))`) so they sweep together. They are shown for loads >300ms and replace spinners for any list or card (brief §4). Reduced motion: static `rgba(255,255,255,.06)`.
5. **ProgressBar/Ring.** Fill uses `spring { stiffness: 200, damping: 24 }`, so it chases `value` smoothly, and it never moves backward (monotonic guard). The ring shows a tabular number that counts up, and the label is announced politely every 25%. Completion triggers a `delight` pop (scale 1 → 1.12 → 1) plus a check glyph and success haptic.
6. **PullToRefresh** (Today, Clients, Saved only). Drag with resistance 0.5 after 12px; at 72px the indicator "arms": a 3-dot bar morphs into the Spinner ring using `layout` spring. Release springs the content to 56px while loading, then back with `spring.layout`. It is disabled when the list is not at `scrollTop === 0` and for `prefers-reduced-motion` (fall back to a visible "Refresh" tertiary button at the top of the list, always available for keyboard and VoiceOver users).
7. **RouteProgress.** 2px accent bar at the top, under the safe area, trickling with spring toward 85%, then completing on route commit. It shows only on navigations >300ms.
8. **Button loading.** The label slides up 6px and fades while `DotsBounce` fades in from below (`spring.state`); the button width stays locked.

### 6.2 Transitions
- **Route transitions:** use the platform: React `<ViewTransition>` / Next's view-transition support (verify the exact flag in `node_modules/next/dist/docs/` first; this Next version differs from training data). Default: 24px x-offset + fade with `spring.page`, with an exit that is *only* opacity (160ms). Reduced motion: opacity only.
- **Shared elements:** Clients row → Client detail: avatar and name morph (`view-transition-name: client-{id}-avatar`). Today hero → Results: grade badge. Finding row → Sheet: none (Sheet rises). Within a page, use framer `layoutId` for the tab-bar indicator, segmented thumb, chip selected state, and card expand/collapse. Fall back to a plain fade when the API is missing (Safari <18).
- **Sheet:** rises with `spring.sheet`; the page behind scales to 0.97 and dims to the scrim (only when the sheet is `large`, since it costs a layer); drag follows the finger 1:1 and flings by velocity.
- **List mutations:** add/remove rows with `layout` + `AnimatePresence` (`spring.layout`, height collapses via `layout`, not height). Max 6 simultaneous.
- **Scroll:** TopBar title collapse and tab-bar indicator only; no parallax on data.
- **First-run delight:** Checklist completion fires a 300ms confetti-free `delight` pop on the ProgressRing.

### 6.3 Press physics and feedback
- Every pressable gets `whileTap={{ scale: .97 }}` (rows .985, tab-bar icons .9) on `spring.press`, plus an overlay change within one frame (<100ms). Release overshoots slightly (damping 24 gives ≈4%), which is the "springy" feel.
- Drag-based elements (sheet, pull-to-refresh, swipe rows) follow the finger and add rubber-banding past limits (`resistance = 1 − 1/(1 + d/160)`).
- `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` (removes 300ms delay, double-tap zoom), and `user-select: none` on controls.
- **Haptics (progressive enhancement; never the only signal):** `lib/haptics.ts` maps `tap → 8ms`, `success → [10,40,10]`, `warn → 20`, via `navigator.vibrate` on Android/Chrome. iOS Safari exposes none; the widely used workaround (toggling a hidden `<input type="checkbox" switch>` label, iOS 17.4+) is unofficial and may break, so ship it behind a flag and treat it as optional. Respect a "Haptics" toggle in You → Preferences and `prefers-reduced-motion`. Fire only on: capture shutter, set done, scan processed, approve, destructive confirm.

### 6.4 Where glass is used, and where not

| Uses glass | Never glass |
|---|---|
| TabBar (M2) | List rows, tiles, stat blocks (M0 flat) |
| Collapsed TopBar (M2) | Inputs/selects (solid field) |
| Sheet panel, Toast (M2) | Chips, badges, buttons (secondary = field fill) |
| One hero card per screen (M1) | Text-heavy bodies: consent, legal, workout instructions (solid `#0E0E10` panel) |
| Capture overlays on the camera (M2 + .6 scrim) | Anything inside a scrolling list; any nested blur |
| | Dialog (solid `#161618` + scrim; it needs maximal legibility) |

### 6.5 Performance budgets

| Budget | Target |
|---|---|
| Concurrent `backdrop-filter` layers on screen | ≤2 (asserted in Playwright by counting computed `backdrop-filter !== none` elements intersecting the viewport) |
| Max blur radius | 24px |
| Interaction latency (INP, p75, 4× CPU throttle) | <200ms |
| Press visual feedback | <100ms |
| Frame rate during sheet drag, tab switch, scroll (Pixel 6a class) | ≥55fps; no layout during animation |
| Added client JS for the kit | ≤15KB gzipped over today: `LazyMotion` + `m.*` with `domAnimation` for most; `domMax` (needed for `layout`/`layoutId`) loaded async after first paint |
| Ambient field | one composited layer; 30s drift on `transform`; paused when `document.hidden` or `prefers-reduced-motion` |
| Lists | ≤30 DOM rows initially; `content-visibility: auto` on rows |
| CSS | total app CSS ≤ 70% of today's (the two 900-line review sheets merge) |
| Shipped fonts | Roboto 300, 400, 500 only (drop 100, 700); `font-display: swap`, preload 400 |
| LCP on Today (mid-tier Android, 4G) | ≤2.5s |

---

## 7. Accessibility & responsiveness rules

Each rule is checkable by Playwright, axe, or a lint rule.

**Contrast**
1. Every text node ≥4.5:1 (≥3:1 if ≥24px, or ≥19px at weight ≥700) against the composited background, computed by the audit's injected script; target **0 failures** (was 40). Sampled against the `#1C1C1E` worst-case glass backdrop *and* the field.
2. Non-text UI (field borders, icons, focus ring, chart marks) ≥3:1 vs. adjacent color. `--border-field` at .38 is the input boundary. Markers use shape + outline.
3. Meaning never relies on color alone: severity = word + icon; selection = icon/weight change; error = icon + text. CI check: grayscale screenshot diff on Results, Clients and a form error.
4. `AmbientField` luminance test: the max rendered luminance behind glass ≤ L 0.012 (`#1C1C1E`).

**Targets and spacing**
5. Every interactive element's *hit area* ≥48×48 (≥44 only for native checkbox/radio *including* their label, and a documented exception list); never <24×24. Test: bounding-box sweep (audit script) with `<44` count budget ≤10 (exceptions listed in-file); today 230.
6. Adjacent targets ≥8px apart (edge to edge, hit areas, not visuals); destructive vs. non-destructive ≥12px. Test from the audit's pair-proximity checker; target <10 pairs (inline text links excluded).
7. Remove the global `button, a { min-height: 44px }` (it stretches inline links). Targets come from components.

**Type and text**
8. No computed font-size <12px anywhere; no body or input text <16px; Caption (12) only in badges/labels/axes. Lint plus a runtime sweep.
9. Layout survives 200% text size (`font-size: 200%` on the root, via `page.addStyleTag`) and 400% zoom at 320px CSS: no horizontal scroll (`scrollWidth === clientWidth`), no clipped controls. Rows use `min-height`, labels wrap (tab-bar labels may ellipsize but icons remain, and each has a `title`/`aria-label`).
10. Line length ≤38rem; paragraphs ≤4 lines on phone where possible.

**Focus, keyboard and modals**
11. Visible double-ring focus on every control; never fully hidden by sticky chrome. Use `scroll-padding-top: 64px` and `scroll-padding-bottom: calc(var(--chrome-bottom) + 16px)` on the scroller (WCAG 2.4.11).
12. Tab order = visual order. A skip link ("Skip to content") is first. Exactly one `<main id="main">` per page (fixes the axe landmark trio on 21 screens); page components render `<div>`/`<section>`.
13. Sheet/Dialog: `role="dialog"`/`alertdialog`, `aria-modal`, labelled by title; initial focus on title (Sheet) or the safest button (Dialog: Cancel); focus trap with Tab/Shift-Tab; Escape closes; the Close button is always visible and 48px; background `inert`; focus restores to the invoker; body scroll lock; VoiceOver can reach the sheet's Close.
14. Icon-only controls require `label` (TypeScript enforces); `<Icon>` is `aria-hidden` by default.
15. Heading order is linear (one `h1` per page); embedded documents take a `headingBase`.
16. Live regions: toasts (`status`/`alert`), loaders (`role=status`), form errors summary (`role=alert`, focus on first invalid on submit).

**Reduced motion / transparency / contrast preferences**
17. `prefers-reduced-motion: reduce` → all springs become the 150ms `reduced` fade; no overshoot, parallax, drift or looping motion except a static pulse for loaders (verified by `matchMedia` emulation and animation-duration assertions).
18. `prefers-reduced-transparency: reduce` and `@supports not (backdrop-filter)` → all M1/M2 surfaces become solid (check: no element has computed `backdrop-filter`). `prefers-contrast: more` → `--text-2/3` step up to `.85/.70`, borders to `.55`.
19. Do not disable zoom (`maximum-scale` is not set). Inputs at 16px make the old "lock the viewport" workaround unnecessary.

**Responsiveness**
20. Test matrix: 320×568, 360×780, 390×844, 430×932, 768×1024, plus landscape 844×390. At 320: single column, tab-bar labels may ellipsize, Buttons wrap text rather than clipping, no horizontal scroll.
21. **Landscape:** tab bar becomes 48px high with icon-left labels; safe-left/right added; hero 3D takes `min-height: 70dvh`; the capture shutter moves to the right edge; sheets cap at 90dvh and scroll.
22. **Virtual keyboard:** use `interactive-widget=resizes-content` in the viewport meta plus a `visualViewport` handler. When the keyboard opens: hide the tab bar; ActionBar re-docks directly above the keyboard (so Continue/Save remain reachable); the focused field scrolls into view with 16px clearance; Sheets shrink to the visual viewport. Test: Playwright with `visualViewport` emulation of a 336px keyboard, assert focused-field `getBoundingClientRect().bottom ≤ visualViewport.height − 16`.
23. Use `100dvh`/`100svh`; `100vh` is banned by stylelint. `env(safe-area-inset-*)` on all fixed elements: lint rule flags a `position: fixed` rule without a `--sa-*` use.
24. Primary actions in the bottom third (viewport y ≥ 563 at 844): Playwright asserts `ActionBar` button center y ≥ 0.66×viewport height on the 6 primary screens, for 667/844/932 heights.
25. Pointer: under `@media (pointer: coarse)` targets are as above; under `pointer: fine` hover overlays appear and chips may be 32px.

**Screen reader content**
26. Readouts announce sentences (value + unit + reference + band); delta chips include "up/down N from last scan"; lists have counts ("28 clients"); the tab-bar `nav` has `aria-label="Primary"` and `aria-current="page"`.

---

## 8. Implementation plan

Relative effort in "t-shirt" units, with S ≈ 1–2 days, M ≈ 3–5, L ≈ 1–2 weeks, XL ≈ 2+ weeks.

**Phase 0 — Guardrails (S).** No visual change.
- Add `components/ui/` and a `/dev/kit` gallery route (internal, like `/dev/golden-ingest`) rendering every component in every state.
- Add stylelint rules (`declaration-property-value-disallowed-list`) for raw `font-size`, `font-weight`, `border-radius`, color literals and `100vh`, in **warn** mode with a baseline count in CI.
- Add a Playwright "audit sweep" spec that runs the audit's injected script (contrast, targets, font-size, blur-layer count) against the 10 key routes and records metrics (non-gating at first).
- Add the `data-testid` conventions and freeze e2e selectors (see below).
- *Proof:* baseline numbers captured in `docs/ui-metrics.json` (contrast 40, targets 230, font-sizes 44, colors 119, radii 15).

**Phase 1 — Token layer (M).** Pure CSS; most-visible, lowest-risk wins.
- Add Array v3 variables to `globals.css` `:root` and `@theme` (types, spacing, radii, colors, glass tiers, motion constants). **Alias** every old token to a new one (`--text-quiet → --text-3`, `--text-secondary → --text-2`, `--text-tertiary → --text-3`, `--radius-card → --r-lg`, etc.), so nothing breaks on day one.
- Raise inputs to 16px, remove the global `button, a { min-height: 44px }`, the `input, textarea, select {blur}` rule, and the global heading weights; add `.t-*` role classes (`.t-body`, `.t-headline`, …) and make them the only way to set type. Add `prefers-reduced-transparency` and `prefers-contrast` blocks. Replace the ambient photo with the gradient field.
- Fix the shell: a single `<main id="main">` plus a skip link (the axe landmark trio, audit #9).
- *Proof:* contrast failures → 0 (token change fixes all 40, since they trace to `--text-quiet`); axe moderate landmark violations → 0; input font-size sweep passes; screenshots diffed (expect small intended changes: text slightly larger and brighter).

**Phase 2 — Primitives (L).**
- Build in this order: `Button/IconButton` → `Spinner/DotsBounce/Skeleton/Progress` → `TextField/SearchField/Select` → `FilterChip/Chip/SeverityChip` (+ keep `Chip.tsx` exporting the old names as wrappers) → `Surface` (adapter: same props, new internals) → `ListRow/SectionHeader/Disclosure` → `Sheet/Dialog/Toast` → `SegmentedControl/Tabs` (wrap `TabStrip`) → `Stepper/Readout/EmptyState/ErrorState/ActionBar/TopBar`.
- Unit tests (Vitest + Testing Library): ARIA contract per component; keyboard; reduced-motion path (mock `matchMedia`); Sheet focus trap.
- Visual: gallery screenshots in Playwright (per component state, light flake tolerance).
- *Proof:* component tests green; gallery passes the audit sweep with 0 failures; bundle delta ≤15KB gz.

**Phase 3 — Shell and navigation (M).** Behind a feature flag (`NEXT_PUBLIC_UI_V3`, or a cookie for staged rollout).
- Add `TabBar` using `tabBarPolicy` (renamed `islandPolicy` with its tests ported); keep `IslandNav` until Phase 6. Introduce `--chrome-bottom` and the `ActionBar` context. Replace the footer disclaimer pattern per §5.
- Keep the nav `aria-label`s identical (Today, Clients, Capture, …) so e2e selectors work.
- *Proof:* the existing nav e2e passes; a new overlap spec (no fixed element's rect intersects a scroll-content element's rect at scroll end) passes; the last row on Clients is fully visible and unfaded.

**Phase 4 — Screen migrations (XL, split into slices; each one PR, each behind the flag until its sibling lands).** Order by traffic × pain:
1. Results (merge the two stylesheets into one; the 3D component untouched; severity once; Sheet for finding detail).
2. Today (hero + needs attention).
3. Clients list + Client detail.
4. Capture wizard (Stepper, ActionBar, processing BlobLoader). The camera screen is the highest-risk slice, since it cannot run headless: keep its logic untouched and swap only chrome, and verify on a physical iPhone and an Android before merge.
5. Workouts hub + Library (paginate, ListRows).
6. Manual routines, Settings, Muscles.
7. Auth, Onboarding, Legal, Consent, Share, Landing (the public pages; fix polling in `/s` and `/consent`).
- *Proof per slice:* audit sweep for the slice's routes (contrast 0, targets ≤ budget, font sizes ≤ allowed set), axe (serious/critical stay 0, moderate → 0), Playwright journeys for that screen (existing e2e passing), performance budgets (INP, blur-layer count), screenshot comparison against the approved mock.

**Phase 5 — Motion and delight (M).** Shared-element transitions, PullToRefresh, haptics, first-run checklist, BlobLoader polish. Feature-flagged within the shipped screens; ship after the layout work lands so regressions are separable.
- *Proof:* 55fps trace on a mid-range Android; reduced-motion spec passes; no animation >450ms (a test wraps `m.*` transitions and asserts).

**Phase 6 — Cleanup and enforcement (S–M).**
- Delete `IslandNav`, `AssessmentReviewStudio.module.css`, the three old sheets, `.a-primary/.a-secondary` and the marketing button recipe; turn the stylelint rules from warn to **error**; update `DESIGN.md` to v3 (and run `design.md lint`); update the RUNBOOK.
- *Proof:* distinct font sizes ≤12, weights ≤4 (300/400/500, plus 600 if needed), radii ≤5, raw color literals outside tokens <20, CSS bytes ≤70% of baseline.

**Keeping e2e selectors stable**
- Before Phase 2, grep `e2e/` for CSS-module class selectors and structural selectors (`.a-primary`, nth-child). Convert them to `getByRole(name)` / `getByTestId` in a **separate prep PR** that passes against the *current* UI, so selector churn is isolated from visual churn.
- Components default `data-testid` from a required `testId` prop where today's markup has a stable id; preserve existing `aria-label`s, visible text, route paths and `id`s (`tabId` pattern).
- Preserve text for buttons that tests click ("Launch session", "Start scan", "Review {name} first"); copy changes go in a later pass.
- Keep `data-immersive-surface` and the `app-island` hook (map to the TabBar) until Phase 6.
- Keep the axe budget (serious/critical = 0) and *tighten* it to moderate = 0 after Phase 1.

---

## 9. Where this deliberately diverges from Array v2

| Array v2 | v3 | Why |
|---|---|---|
| Body 12px Light 300, "never above 14px" | Body 16/24 at 400; 300 only ≥28px; min 12px for Caption | Brief §1, §7; thin type on dark glass fails; 12px text was the most common size (83 uses) and the cause of the contrast failures |
| `text-quiet` (.3), `tertiary` .48, secondary .60 | Three tiers .95 / .72 / .58, computed on worst-case glass | A 2.46:1 token carried real text; hierarchy is preserved without a failing tier |
| 44px minimum | 48px hit area, 8px gap | Brief §3 (Apple 44 / M3 48); audit #4 and #12 |
| Floating island with 150px fade, active-only labels | Docked, labeled tab bar; Capture raised in the center | The island covered content on 4 screens, dimmed rows, and hid what the other icons meant |
| Pill inputs with backdrop blur | 14px-radius solid fields, 16px type | Blur per field is wasteful and hurts legibility; 16px prevents iOS zoom; multiline fields can't be pills |
| Two surface tiers via gradient-shell double wrapper | Three materials (flat / card glass / chrome glass) via one border + pseudo-element | The tiers are the same idea (v2's "no tier 3 — pinned bar or island" is the chrome tier), but the DOM is lighter and the chrome tier is explicit and constrained |
| Ambient photograph with `mix-blend-mode: screen` | Bounded-luminance gradient field | Photo made worst-case contrast unpredictable and was a GPU cost |
| 150/300ms cubic-bezier motion; masked headline reveal | Named springs (press, state, layout, sheet, page, loader, delight); reveal only on first-run/Results | Owner wants springy and fluid; springs are interruptible; per-screen word reveals were slow on repeat visits |
| Overline 12px/400/.16em | 12px/500/.08em, max one per screen | Wide-tracked 12px light caps failed legibility |
| "Never bold a headline" | Headlines are 500 (≤22px); Light only for ≥28px display | 300 at 20px on glass is below the legibility floor |
| 7 type roles | 12 roles | v2's 7 roles were not enough to fit 44 sizes into; roles map to named HIG/M3 steps, and the lint enforces them, so the larger set is *more* uniform in practice |
| 4px base with 6/14 steps | 4px base, scale without 6/10/14 | One scale, no off-scale values |
| Tabs max 4 | Tabs max 3 (Segmented 2–4) | 16px labels at 390px |
| Severity `#10B981/#F59E0B/#EF4444` for text | Lighter fg set for text, original hues only for charts | `#EF4444` is ~4.0:1 on glass |
| Info `#0A83C9` | Accent `#4DB2FF` | Contrast on glass; used as the one interactive accent |

**Kept from v2:** pure black field, white pill primary (one per screen), "blocked actions dim and state why", never a red primary button, 3 severity bands, measurement-with-reference-range, `Surface` API, `TabStrip` ARIA contract, one-line disclaimers, immersive screens hiding chrome, tabular numerals, Solar linear icons (24px in controls; filled variants for the active tab only).

---

## 10. Risks & open questions for the owner

1. **Disclaimer placement.** I propose to move the "Screening support only" footer from every page to the "You" tab plus the screens where it matters legally (capture, results, share, consent). Is that acceptable to your legal-governance setup (the PR-05 legal documents), or must it stay visible on every screen? If every screen, I'd make it a 1-line Footnote inside the scroll end, not in the tab bar.
2. **Five tab slots with a raised Capture.** It keeps the app's main job one tap away, but it breaks the pure HIG "tabs are not actions" rule. The alternative is four tabs plus an extended FAB on Today and Clients only. I recommend the raised slot; confirm.
3. **Ambient photo removal.** The photograph gave Array its look, but it is the largest threat to contrast and perf. Are you OK with a generated gradient field, or should I prototype a lower-luminance (≤#1C1C1E) photo treatment before deciding?
4. **Camera capture changes cannot be tested headless.** I would restyle only the chrome around the camera and the processing step. Who can verify on a physical iPhone and a mid-range Android before each camera-related PR lands (the guidance pill, shutter, thumbnails, and the removal of the separate Processing/Results wizard steps)?
5. **Merging Workouts, Library and manual routines under one tab.** This changes URLs' meaning but not their paths; deep links stay. It does assume practitioners think of "Library" as part of "Workouts". Is the muscle knowledge base used often enough that it should be a top-level destination instead?
6. **Haptics on iOS.** There is no official web API; the hidden-switch trick is unofficial. Do you want it shipped (behind a flag, easily disabled) or Android-only?
