# QA Loop — Iteration 3 (PASS-03) — MOTION SYSTEM PASS

**Date:** 2026-07-10
**Scope:** Scroll reveals, hover/focus feedback, sticky navigation, ambient motion, dynamic content, and reduced-motion parity
**Verdict:** **BLOCKED-HANDOFF** for the complete product inventory; **PASS** for this motion-system scope

## Reference findings

The supplied Fusion MHTML preserves the rendered `fusionai.framer.website` page. Its hero
uses a static aurora-gradient image plus a looping abstract light-trail video, rather than a
live WebGL scene. Its load-bearing motion pattern is a sticky navigation anchor, grouped
viewport reveals, restrained hover translation, and richer chromatic movement contained
inside product-showcase frames.

Posture AI keeps its low-power WebGL field as a subtle site atmosphere and translates the
reference pattern into one-shot section reveals, 55 ms group staggers, 1–4 px hover lifts,
moving border light, and a slow hero orbit. No source assets, copy, or animation code were
copied.

## Evidence

| Criterion | Result | Evidence |
|---|---|---|
| Reference motion inspected as a timeline | PASS | `~/Inbox/misc/posture-motion-pass/fusion-reference-scroll-hover.webm` and `frames-fusion/frames/` |
| Local before/after timelines inspected | PASS | `public-scroll-hover.webm`, `app-scroll-hover.webm`, and `public-scroll-hover-after.webm` |
| Public sections reveal on first viewport entry | PASS | Playwright computed-style capture: opacity 0 → 1, transform settles to identity |
| Feature-card hover has restrained feedback | PASS | Computed hover transform `translateY(-4px)` with border and shadow change |
| Dense application rows remain quieter | PASS | Computed hover transform `translateY(-1px)` with border-light change |
| Navigation anchors long marketing scroll | PASS | Computed position is `sticky` |
| Dynamically loaded panels receive motion | PASS | Settings: 8 targets; assessment results: 14 targets |
| Large scroll jumps never leave skipped content hidden | PASS | Results page hidden targets: 10 before jump, 0 after jump |
| Reduced-motion removes reveal blur/translation | PASS | Runtime values: opacity 1, transform none, filter none; WebGL guard retained |
| Desktop/mobile overflow and console safety | PASS | 18 authenticated route/viewport combinations: no horizontal overflow, no console errors |

## Independent verification

A separate verifier re-ran all nine criteria against the final production build. It found
and rejected an initial one-pixel marketing overflow at 390px while left/right reveals were
offscreen. The main motion boundary now uses `overflow-x: clip`; the verifier retested the
page before, during, and after reveals and at a bottom jump, with `scrollWidth 390 /
clientWidth 390` in every state. Final independent verdict: **PASS**.

## Mechanical gates

- `npm test -- --run`: PASS, 56 files / 564 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 22 existing warnings and 0 errors.
- `npm run build`: PASS; all 37 static pages generated.
- `git diff --check`: PASS.

## Limits

The physical-device camera, permission, low-power, and live workout/audio checks from
PASS-01 still require iPhone Safari and Android Chrome. Those items keep the overall QA loop
at **BLOCKED-HANDOFF**; the requested desktop/mobile motion scope passes.
