# QA Loop — Iteration 4 (PASS-04) — GLASS MATERIAL PASS

**Date:** 2026-07-10
**Scope:** Fusion-aligned neutral glass, localized spectral light, nested control depth,
responsive containment, and retained interaction behavior
**Verdict:** **BLOCKED-HANDOFF** for the complete product inventory; **PASS** for this
glass-material scope

## Reference comparison

- Fusion reference vs current production build:
  `~/Inbox/screenshots/posture-glass-pass/reference-vs-build.png`
- Opaque olive material vs current neutral glass:
  `~/Inbox/screenshots/posture-glass-pass/before-vs-after.png`
- Full revealed production page:
  `~/Inbox/screenshots/posture-glass-pass/after-home-revealed.png`
- Mobile production page at 390px:
  `~/Inbox/screenshots/posture-glass-pass/after-mobile-390.png`

The material recipe now uses a neutral `#0A0B0D` base, translucent
`rgba(10,11,13,.60–.62)` shells, near-black `rgba(5,5,6,.82–.90)` wells,
24–40px backdrop blur, and localized `#FF8A2A` / `#38D6FF` illumination. Color is
restricted to light transmission, faint edge grazing, and semantic/data signals.

## Independent adversarial verification

A separate verifier was instructed to try to fail the build and to treat ambiguity as a
failure. It inspected the running production build rather than trusting the diff.

| Criterion | Result | Evidence |
|---|---|---|
| No green/olive structural tint | PASS | Live preview fill `rgba(10,11,13,.60)`; header `rgba(8,9,11,.66)`; neutral pixel samples |
| Real transmission rather than opaque paint | PASS | Preview `blur(40px) saturate(1.6)`; header 28px; floating panel 24px |
| Localized orange/cyan light on black | PASS | Warm `rgba(255,138,42,.28)` and cool `rgba(56,214,255,.22)` beams; viewport sample `rgb(0,0,0)` |
| Directional edge lighting and shadow depth | PASS | White top inset, black bottom inset, warm/cool side grazing, three outer shadow layers |
| Inner controls are darker wells | PASS | Control fill `rgba(5,5,6,.90)`; sampled well `rgb(6,6,6)` |
| Tiered radii | PASS | Major preview 24px, section panels 22px, controls 13–14px |
| Responsive containment | PASS | `scrollWidth === clientWidth` at 390, 768, and 1440px |
| Whole marketing page remains coherent | PASS | All 12 reveal targets reached visible opacity; full-page visual inspection passed |
| Hover and reduced-motion parity | PASS | Hover lift/scale and border delta measured; reduced motion removes animation and reveals immediately |
| Fusion design-language alignment | PASS | Side-by-side confirms black canvas, spectral illumination, hairline edges, glass, and dark wells |

Final independent verdict: **PASS**.

## Mechanical gates

- `npm test -- --run`: PASS, 56 files / 564 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 22 existing warnings and 0 errors.
- `npm run build`: PASS; all 37 static pages generated.
- `git diff --check`: PASS.

## Limits

The physical-device camera, permission, low-power, and live workout/audio checks from
PASS-01 still require iPhone Safari and Android Chrome. Those items keep the overall QA
loop at **BLOCKED-HANDOFF**; the requested glass-material and responsive visual scope
passes.
