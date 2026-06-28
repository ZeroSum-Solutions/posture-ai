# Wave 4 — Converged Design: Honest Confidence-Framed Muscle Map

**Date:** 2026-06-28
**Status:** APPROVED. Converged via Claude (UX/honesty) ↔ GPT-5.5 (efficiency/logic) adversarial review — 2 rounds (BLOCK → NOT-YET → CONVERGED), GPT-5.5 final verdict `CONVERGED`. All 3 owner decisions resolved (§3). Supersedes `docs/plans/2026-06-27-wave4-extended-muscle-tier-design.md` (BLOCKED by GPT-5.5 review).
**Goal (governing):** *Ship a muscle-imbalance screen that never presents more certainty than the underlying data supports.*
**Engine:** frozen at 1.2.0 — no scoring-math change. Predecessor honesty context: `docs/plans/2026-06-27-wave3-layer1-validation-protocol.md`.

All claims below are grounded (file:line) and were verified by both reviewers against the live code.

---

## 0. Why this replaces the original Wave 4 plan

The original "confidence-tiered scored expansion" had three structural faults (GPT-5.5 BLOCK, confirmed in code): (1) the confidence grade labeled the *muscle-link literature* but ignored the larger ungraded uncertainty — whether the metric was even measured validly (Wave 3: 9/10 metrics are not); (2) `confidence` and `scored` are orthogonal fields, not one ladder; (3) the body-map *markers* render off legacy `imbalance_definitions` JSONB, not the normalized links, so confidence-on-links never reaches them. The converged design fixes all three plus a category-error class GPT-5.5 surfaced: muscle literature often supports a clinical construct the app does **not** measure (e.g. `anterior_pelvic_shift` is the same vector as `t1_tilt_backward` and measures neither pelvic shift nor APT).

---

## 1. The two-uncertainty + disposition honesty model (Deliverable 1)

Two uncertainties, **never fused into one number**, plus a per-metric gate and an orthogonal exclusion flag.

### Stored fields
1. **`assessment_findings.metric_validity`** ∈ `{VALIDATED, LITERATURE_CITED, SCREENING_ONLY}` — the dominant frame. **Stored per finding at scoring time** (NOT render-derived), so a future Wave-3 promotion never rewrites historical reports. Engine emits it per finding from threshold provenance (`packages/posture-engine/src/thresholds.ts:57–69`); the POST route already maps findings→rows and stores `scoring_engine_version` (`app/api/assessments/route.ts:96,124`) — so PR2 just adds the column. (Current schema lacks it: `supabase/migrations/20260101000000_initial_schema.sql:54`.)
2. **`muscle_inference_disposition`** ∈ `{SHOW, SUPPRESS}` — per `imbalance_key`; a static, engine-versioned config const. **Default SUPPRESS.** A metric earns SHOW only when (a) its muscle inferences are **construct-matched** to what the metric physically measures, (b) owner/clinician ratifies, and (c) any direction-conditioning is implemented.
3. **`muscle_imbalance_links`** gains DB columns: **`link_evidence`** ∈ `{high,medium,low}` (promotes content-only `confidence`), **`scored boolean`** (default true), **`exclusion_reason text`**, **`direction_applicability`** ∈ `{varum, valgum, both, null}` (new — fixes the genu mismatch). Today the table has only `muscle_slug, imbalance_key, role, rationale_text` (`20260612010000_muscle_knowledge_base.sql:22–29`).

### Rules (Blocker 1 + 2 fixes)
- **Disposition gate:** a `SUPPRESS` finding shows **no muscle names or markers on any surface** (screen, API payload, client report, PDF) — geometry + screening note only.
- **Hard rendering invariant** (replaces a numeric min): for a `SHOW` finding, *no muscle may render with diagnostic / high-confidence language or styling unless its finding's `metric_validity` permits it.* The `link_evidence` token is always subordinate to the `metric_validity` frame.
- **Orthogonality (Blocker 2):** `scored:false` ⇒ excluded from render regardless of `link_evidence`; `exclusion_reason` records why; grade is meaningful only when `scored:true`. (gastroc/popliteus/quadriceps stay excluded — `content.test.ts:70`.)
- **Explicit grade tokens:** every visible link shows one of `High | Medium | Low | Not graded` — never silent absence.
- **Direction-conditioning:** links filtered by `direction_applicability` against the finding's `direction` (engine emits `Varum`/`Valgum`, `metrics.ts:185`). A valgum finding never shows a varum-only muscle.

### Per-metric disposition table (RATIFIED — owner decision 1 = adopt as converged)
| imbalance_key | metric_validity (today) | disposition | condition / reason |
|---|---|---|---|
| `knee_extension_back_knee` | LITERATURE_CITED | **SHOW (now)** | construct-matched (hamstrings); frame adds 2D-detectability caveat (Naylor 2011) |
| `forward_head_posture` | SCREENING_ONLY | **SHOW (now)** | construct-matched (head-forward pattern); frame: "lean proxy, not CVA" |
| `anterior_imbalanced_shoulders` | SCREENING_ONLY | **SHOW after copy rename** | copy must read "shoulder-line / asymmetry", not "rounded-shoulder diagnosis" |
| `posterior_imbalanced_shoulders` | SCREENING_ONLY | **SHOW after copy rename** | same |
| `t1_tilt_backward` | SCREENING_ONLY | **SHOW after rename** | rendered as "trunk lean", never "T1 tilt" (misnomer) |
| `genu_varum_valgum_left/right` | SCREENING_ONLY | **SUPPRESS until direction-conditioned** | then SHOW; varum/valgum links gated by `direction_applicability` |
| `pelvic_obliquity` | SCREENING_ONLY | **SUPPRESS** | hip-JC ≠ iliac crest structural mismatch (Wave 3 §0; protocol:139) |
| `anterior_pelvic_shift` | SCREENING_ONLY | **SUPPRESS** | duplicate vector of t1_tilt; not APT; retire per family rule (protocol:353; `registry.ts:144`) |
| `pelvic_axial_rotation` | (unscored) | n/a | already `confidence 0.3 < 0.5`, no finding (`metrics.ts:153`) |

### What renders where — gated from ONE source (the API payload)
| Surface | Behavior |
|---|---|
| `/api/assessments/[id]` payload | applies disposition + direction filter; SUPPRESS → strip muscle names/links; SHOW → emit links + `metric_validity` + `link_evidence` + `reviewed_at` |
| Results body-map markers + chips | render from the gated payload; link-driven, slug-keyed; chips degrade to plain text when `reviewed_at` is null |
| `/muscles/[slug]` related findings | show `metric_validity` frame + `link_evidence` per link; omit for SUPPRESS |
| Practitioner/client PDF (`app/api/reports/route.ts`) | **same gated source**; SUPPRESS → no muscles; SHOW → **carries the metric-validity frame label** (owner decision 2) |

---

## 2. Sequenced PR plan (Deliverable 2)

**PR1 — Exact-neutral link-driven map refactor (architectural; NO new claims).**
- Build `MUSCLE_REGIONS_BY_SLUG` from an **explicit, tested `legacy-name → slug` map** (incl. `tensor fasciae latae`→`tfl-it-band`, `vastus medialis (vmo)`→`quadriceps`, and the non-slug names like `gastrocnemius`→`gastrocnemius-soleus`). `MuscleBodyMap` gains a slug-keyed link-driven marker path and link-aware `hasMuscles`/`hasAny` — but **legacy arrays remain the ACTIVE source for existing assessments**; the link path is exercised by tests only. Zero visible change.
- Acceptance: current production rendering is byte-identical for all 10 keys; a route-level test proves markers CAN render from `muscle_imbalance_links` with EMPTY legacy arrays; the accordion opens on links-only data. Ships invisibly; does not become the user-facing source until PR2.

**PR2 — Two-uncertainty + disposition model, gated at the API source.**
- Migrations: `assessment_findings.metric_validity`; `muscle_imbalance_links.{link_evidence, scored, exclusion_reason, direction_applicability}`. Seed generator emits all link columns (stops dropping `confidence`; emits `scored:false` rows WITH `exclusion_reason`; route filters `scored=true`). Push via Management-API runbook; verify `/api/health`.
- Engine emits `metric_validity` per finding; POST route stores it. Disposition config as an engine-versioned const.
- **API gate (the honesty chokepoint):** both `app/api/assessments/[id]/route.ts` and `app/api/reports/route.ts` apply disposition + direction filter; SUPPRESS strips muscles; SHOW selects `muscles(name, reviewed_at)` + link columns + threads `metric_validity` for the frame label (incl. into the PDF — owner decision 2).
- Render: dominant `metric_validity` frame badge per SHOW finding; subordinate explicit `link_evidence` token per muscle (`High/Medium/Low/Not graded` — owner decision 3 allows `Not graded` live); flip markers to link-driven (PR1 path goes live); chip degradation via `reviewed_at`; `/muscles/[slug]` parity; a11y visible grade **text** + SVG accessible names.
- Copy: rename `t1_tilt_backward` → "trunk lean"; shoulders → "shoulder-line / asymmetry" (required to keep them SHOW).
- Acceptance + tests (catch every named regression): markers render from link rows (not just chips); `hasMuscles` opens links-only; a SUPPRESS metric emits **no muscles in API AND PDF**; a SCREENING_ONLY SHOW finding never emits high-confidence styling even with a `high` link (invariant test); `scored:false` rows never render; a valgum finding never shows a varum-only link (direction test); route select carries `link_evidence/scored/reviewed_at`; a11y asserts text/ARIA per `validity × evidence` combo, not CSS classes.

**PR3+ — Literature-graded content expansion (region-staged), ONLY after PR2.**
- ~28 new muscles / ~68 new links; each `link_evidence`-graded, `scored`-decided, `direction_applicability`-set by a foreground `research-literature` pass; new slugs get coordinate entries; everything inherits the disposition gate and ships SUPPRESS-by-default until its metric earns SHOW. Genu's direction-conditioning lands here (or a dedicated PR2.5) to flip genu to SHOW.

---

## 3. Owner decisions — RESOLVED
1. **Disposition table:** ✅ Adopt as converged (§1 table). SUPPRESS default; SHOW earned.
2. **PDF for SHOW metrics:** ✅ Carry the metric-validity frame label into the PDF now (consistent end-to-end; PR2 threads `metric_validity` into `app/api/reports/route.ts`). SUPPRESS metrics show no muscles regardless.
3. **`Not graded` live policy:** ✅ Allow explicit `Not graded` tokens to ship; full grading backfills in PR3+.

---

## 4. Blocker/Major → resolution map (the "done" check)
| Item | Resolved by |
|---|---|
| BLOCKER 1 — confidence labeled wrong uncertainty | PR2: stored `metric_validity` frame + construct-match disposition + hard rendering invariant |
| BLOCKER 2 — confidence ⟂ scored fused | PR2: separate DB columns; `scored:false` excluded; `link_evidence` only when scored |
| BLOCKER 3 — markers off legacy arrays | PR1 (refactor) + PR2 (flip to link-driven, gated) |
| MAJOR — PDF honesty hole | PR2 API-source gating + frame label in PDF (owner decision 2) |
| MAJOR — partial-grading "neutral" | explicit `Not graded` token (owner decision 3) |
| MAJOR — `/muscles/[slug]` no confidence | PR2 parity render |
| MAJOR — chip degradation needs `reviewed_at` | PR2 select `muscles(name, reviewed_at)` + degrade |
| MAJOR — a11y underspecified | PR2 visible grade text + SVG accessible names + assertions |
| MAJOR — tests wouldn't catch regression | PR1 + PR2 named test inventory |
| Round-2 — genu direction mismatch | PR2/PR3 `direction_applicability` filter; genu SUPPRESS until then |
| Round-2 — gate at source not per-surface | PR2 API-payload gate feeds screen + report + PDF |
