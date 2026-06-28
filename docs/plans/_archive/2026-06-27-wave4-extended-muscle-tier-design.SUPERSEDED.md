# Wave 4 — Confidence-Graded Extended Muscle Tier (Design)

**Date:** 2026-06-27
**Status:** Design approved (brainstorm); pending implementation plan (writing-plans).
**Engine:** frozen at 1.2.0 — this wave does **not** touch scoring math.
**Predecessor:** `docs/plans/2026-06-27-wave3-layer1-validation-protocol.md` (Wave 3) established that the engine's deviation metrics are largely **unvalidated** (metric-name misnomers, hip-joint-centre ≠ iliac crest, no knee gold standard). This wave is designed to *expand muscle inferences without expanding clinical overclaim*, by making each inference's evidentiary strength explicit and visible.

---

## 1. Goal

Grow the muscle knowledge base from **29 muscles / ~46 muscle→imbalance links** to an **extended ~57-muscle / ~114-link tier**, and surface every link on the results-page body map **visually weighted by an evidence-confidence grade**. The confidence grade itself — not a hide-until-reviewed gate — is the honesty mechanism (radical transparency: show the inference, label its strength).

This is the Wave 4 web sub-project. The other Wave 4 backlog item, **iOS native + LiDAR, is out of scope** here and is a deferred Phase-2 effort requiring its own explicit go-ahead (see §9).

## 2. Locked decisions (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| Intent | What the extended tier is | **Confidence-tiered scored expansion** — all ~114 links surfaced, visually weighted by confidence (not educational-only, not map-over-existing-only). |
| Grading | Where each link's grade comes from | **Literature-graded to the Wave 2/3 bar** — `research-literature` agents (PubMed + Consensus), asymptomatic-population evidence, per-link audit trail. `high` reserved for direct support. |
| Launch | Production-exposure policy | **Ship live; confidence label + disclaimer are the gate.** No clinician-review gate on the map. Deep `/muscles/[slug]` pages stay `reviewed_at`-gated; unreviewed chips degrade to plain text (no link, no 404). |
| Confidence UI | How confidence is encoded | **Single unified map: graded weight (solid/dashed/faint) + always-visible explicit grade text + a11y label.** Honesty never rests on styling alone. |
| Scope edges | Which surfaces are touched | **Map + chips + `/muscles` pages only.** Exercise recommendations, priority program, and PDF are **unchanged** (they key off imbalance findings, not muscle confidence). |
| Sequence | Build order | **Approach A — plumbing first, then expand.** PR1 plumbs confidence over existing content; PR2+ adds literature-graded content, region-stageable. |
| Decision A | PR1 grading completeness | **Partial grades.** PR1 ships confidence *where already present*; ungraded links render neutral (no false "high"). Full grading lands in PR2+. |
| Decision B | The `scored:false` display-only links | **Keep excluded.** `scored:false` is a distinct "evidence says no → exclude" determination, NOT downgraded to `confidence:'low'`. Resurfacing failed-the-bar links as "low" would be *less* honest. |

## 3. Confidence model — the four outcomes

The literature pass assigns each candidate muscle→imbalance link exactly one disposition:

- **`confidence: 'high'`** — direct asymptomatic-population evidence. Rendered prominently (solid marker, bold chip, `· high`).
- **`confidence: 'medium'`** — indirect / inconsistent (e.g. mixed EMG). Rendered mid-weight (`· medium`).
- **`confidence: 'low'`** — mechanism-only / contested but real support. Rendered faint + dashed, explicitly labeled `· low`. **Still shown.**
- **`scored: false` (fails the bar)** — evidence is absent or contradicts the inference. **Excluded** from the scored seed and the map (current behavior, preserved). The relationship may still live in the muscle's own anatomy/screening prose, but it is not presented as an assessment finding.

`confidence:'low'` ("weak but present support, shown") and `scored:false` ("evidence says no, excluded") are deliberately different states. This preserves the Wave 2 evidence-reconciliation integrity (e.g. the knee-hyperextension calf/quadriceps/popliteus links stay excluded; only hamstrings→weak cleared the bar).

## 4. Architecture & data flow

Confidence becomes a first-class attribute of each `muscle_imbalance_links` row, threaded through one clean path with **no assessment backfill** (links are joined fresh at fetch time):

```
content/muscles/*.ts          links[].confidence: 'high'|'medium'|'low' (optional; absent = ungraded)
  └─ scripts/generate-muscle-seed.ts   emit confidence in the INSERT (skip scored:false, unchanged)
       └─ muscle_imbalance_links.confidence   NEW nullable column, TEXT CHECK (in 'high','medium','low')
            └─ app/api/assessments/[id]/route.ts   add `confidence` to the .select on muscle_imbalance_links
                 └─ MuscleLink { slug, name, confidence? }   (results page type)
                      └─ <MuscleBodyMap> markers + chips   graded weight + explicit grade text + a11y label
```

Untouched by this path: the engine (`packages/posture-engine`), `app/api/reports/route.ts` (PDF reads `imbalance_definitions` JSONB names only), exercise recommendations, and the priority program.

## 5. PR 1 — Confidence plumbing (existing content; ships first)

Goal: convert the dormant `confidence` field into a shipped, visible map attribute over **today's** 29 muscles / 46 links, de-risking the migration + render path before the large research effort.

1. **Migration** (`supabase/migrations/<ts>_muscle_link_confidence.sql`):
   `ALTER TABLE muscle_imbalance_links ADD COLUMN confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high','medium','low'));` — nullable; absent = ungraded. RLS unchanged (public read). Applied locally first; pushed to prod via the RUNBOOK Management-API step; `/api/health` verified `{status:ok, database:connected, schema:ready}`.
2. **Seed generator** (`scripts/generate-muscle-seed.ts`): emit `confidence` in the `muscle_imbalance_links` INSERT (NULL when absent). `scored:false` links remain skipped (Decision B). Regenerate the seed migration; never hand-edit it.
3. **Results route** (`app/api/assessments/[id]/route.ts`): add `confidence` to the `.select('imbalance_key, role, muscle_slug, muscles(name)')` on `muscle_imbalance_links`; carry it into `linkMap` and the `MuscleLink` objects.
4. **Component extraction + render**: extract `MuscleBodyMap` and the muscle→coordinate map out of the 1199-line `app/assessments/[id]/page.tsx` into `components/MuscleBodyMap.tsx` (targeted isolation improvement, since we are modifying it). Render confidence as: solid (high) / dashed (medium) / faint (low) SVG markers, and chips reading `tight · high`. Every graded item carries an a11y label (confidence not conveyed by styling/color alone). **Ungraded links render neutral — no weighting, no implied "high".**
5. **Chip-degradation fix** (lands here so PR2 content is safe to expose): a chip whose target `/muscles/[slug]` is gated (unreviewed) in the current environment renders as plain text instead of a link — no 404.
6. **Tests**: content contract + vocabulary lint stay green; new render test asserting high/medium/low/ungraded produce distinct, labeled output; axe budget on the results page.

**PR1 interim state (Decision A):** the existing 46 links are only partially graded, so the first shipped map shows grades where present and neutral elsewhere — an honest interim, not a regression.

## 6. PR 2+ — Literature-graded content expansion (region-stageable)

1. **Content:** ~28 net-new muscle files under `content/muscles/` (→ ~57) with matching `registry.ts` entries, plus ~68 net-new link rationales (→ ~114), each carrying a `confidence` grade (or marked `scored:false` per the four-outcome model). Re-run `scripts/generate-content-index.mjs`, then regenerate the seed.
2. **Body-map coordinates:** ~28 new entries in the muscle→coordinate map (now in `components/MuscleBodyMap.tsx`), front/back + region.
3. **Research method:** foreground **parallel `research-literature` agents** (PubMed + Consensus connectors — kept foreground so the claude.ai MCP connectors stay authenticated; not a background workflow). One scan per candidate link against asymptomatic-population evidence; the agent returns a disposition + citation(s). `high` only for direct support. A per-link audit trail (claim → citations → grade) is captured in the PR description / an appendix.
4. **Review gate:** new muscles ship `reviewedBy: null`; their `/muscles/[slug]` deep pages stay gated in prod (chips degrade to text via the PR1 fix). The map inferences themselves ship live (labels-as-gate).
5. **Staging:** by region (head/neck → shoulder → trunk → hip → knee) so each PR is coherent and reviewable; plumbing is not re-touched.

## 7. Honesty / safety

- The explicit grade text + a screening disclaimer carry the honesty burden (labels-as-the-gate). The `low` marker is unmistakable: faint + dashed + literal "low" + a11y label.
- Banned-terms vocabulary lint (`diagnose/treat/cure/patient/prescribe`) and screening-only framing apply to all ~68 new rationales (enforced by `content/content.test.ts` + `lib/ui-vocabulary.test.ts`).
- Each PR passes **GPT-5.5 adversarial review to SHIP** (Codex OAuth, read-only), same discipline as Waves 2–3, before `~/bin/zs-land`.

## 8. Testing & verification (per PR)

- TDD: failing test → minimal impl. Migration applied to the local Supabase stack first.
- Content contract extended: every link carries a valid `confidence` OR is intentionally `scored:false`; registry/content slug parity maintained.
- Render test: distinct, labeled output per grade; ungraded → neutral.
- a11y: axe budget on the results page (confidence has a non-visual signal).
- Gate to land: `eslint` + `tsc --noEmit` + `npx vitest run` + `next build` all green; GPT-5.5 review = SHIP.

## 9. Out of scope (this wave)

- **iOS native + LiDAR** (Wave 4 item c) — deferred Phase-2; needs explicit go-ahead. Note for that effort: LiDAR depth could unlock the axial-rotation / out-of-plane angles Wave 3 proved a single 2D camera cannot recover — a strong reason it is a separate platform phase, not a web increment.
- Exercise recommendations, priority program, PDF — unchanged (confidence is a muscle-map presentation layer only).
- Engine scoring math — frozen at 1.2.0.
- Resurfacing `scored:false` links — explicitly rejected (Decision B).

## 10. Open parameters for the implementation plan

- The specific ~28 net-new muscle list (proposed by anatomy coverage of the 10 imbalance keys + the literature pass; reviewed before content generation, mirroring the P4a slug-mapping gate).
- Exact SVG weighting values (opacity/stroke-dash) for high/medium/low — finalized against the existing dark design system during PR1.
- Whether to lightly grade the existing 46 links opportunistically inside PR1 if a region's research is already in hand (default: no — keep PR1 plumbing-only).
