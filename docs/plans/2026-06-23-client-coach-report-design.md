# Client + Coach Report — Design Spec

**Date:** 2026-06-23
**Status:** For review (pre-implementation)
**Scope:** The assessment report's information architecture and corrective-program model — the client-facing shareable report (top-3 priorities + a 3-week corrective progression) and the coach in-app enrichments that produce it.

> **Screening vocabulary is a hard constraint throughout.** Use `maintain | warning | danger` and `optimal | mild | moderate | significant`. Never `normal/abnormal/diagnose/treat/patient/cure`. A non-diagnostic disclaimer appears on every client surface. All exercise slugs, schema fields, and table names below were verified against the live repo.

---

## 1. Goal & surfaces

Two faces of one assessment:

- **Coach (in-app, `/assessments/[id]`)** — the practitioner working view. Full clinical detail (all 10 findings, degrees, direction, confidence, Janda tight/weak muscle pairs), plus the new priority labeling, the 3-week ramp the client will receive, and a small override surface.
- **Client (shareable report)** — a plain-language report led by the **top 3 priority focuses**, each with a **3-week corrective progression** performed in the correct order, with sets / reps / duration. **PDF first** (extend the existing `@react-pdf/renderer` pipeline in `lib/pdf/report.tsx`), with the IA structured so the same content can become a shareable web page in a later phase.

The practitioner is the only logged-in user; the client receives the PDF out-of-band (a v2 client-portal token is stubbed but out of scope here).

### Locked decisions (confirmed with stakeholder, 2026-06-23)
1. **Capability dial ships in v1** — a per-client `regression | standard | progression` setting (default `standard`) that seeds each exercise's starting variant. One DB field + one coach control.
2. **W3 "Connect" integrative step is kept** — an `isIntegrative` flag on a small set of compound exercises; omitted cleanly where no integrative item exists for a priority.
3. **`reps` is a `{ min, max }` range** (nullable), printed to the client as e.g. "8–12 reps".

---

## 2. Top-3 priority selection (deterministic)

A pure function `selectPriorities(findings: Finding[]) → Priority[]` (max 3), run once per assessment and persisted. Operates on `AssessmentResult.findings` (`packages/posture-engine/src/types.ts`).

**Step 1 — Eligibility.** Keep a finding only if `reliable === true` AND `zone !== 'unreliable'` AND `zone !== 'maintain'`. (`maintain` = "working well" — never a corrective priority.)

**Step 2 — Bilateral collapse (before ranking).** If both `genu_varum_valgum_left` and `genu_varum_valgum_right` are eligible **with the same signed direction** (both "Valgum" or both "Varum"), merge into one synthetic slot rendered "Knee Alignment (both legs)," dosed once, performed both sides. The higher-`severityPct` side sets the slot's zone/severity. **Opposite directions are not merged** (bow-leg vs knock-knee need different emphasis).

**Step 3 — Rank** eligible items by this total order, descending:
1. **Zone weight** — `danger` → +1000, `warning` → 0. (`severityPct ∈ 0–100` can never cross the 1000 gap, so every `danger` outranks every `warning`.)
2. **`severityPct`** (the rankable field).
3. **`confidence`** (`Finding.confidence`, 0–1) — breaks severity ties.
4. **Higher `Math.abs(deviation)`**.
5. **Region priority** using the **actual engine enum** `Finding.region`: `head_shoulders` > `spine` > `pelvis` > `leg`. *(Do NOT use the muscle-KB `REGIONS` enum — it is a different 5-value set.)*
6. **`IMBALANCE_KEYS` declaration order** (`content/muscles/types.ts:17`) as the final unique tiebreak → fully reproducible.

Take the top 3.

**Step 4 — Fewer than 3 eligible.** Show only the real ones (1 or 2 cards). Never pad with maintain/unreliable items. Lean harder on the "you're mostly maintaining" positive in the overview. If a 4th reliable warning exists, surface it only as a muted "one more to watch" line.

**Step 5 — Zero eligible.** Render no priority cards and no 3-week plan; produce a **Maintenance report** (positive overview, a short general "keep moving" mobility note, disclaimer). Unreliable findings → one muted footnote ("A few areas couldn't be read clearly — re-capture front/side photos for a fuller picture"), never alarming.

**Labeling.** Each priority is a **"Priority Focus"** (never "problem/diagnosis"). Severity printed as `optimal | mild | moderate | significant` paired with the zone word. Raw degrees are hidden behind the plain label or footnoted — never the headline.

---

## 3. The 3-week progression model

A 3-week block sits **inside the neural/motor-learning window**, so the honest, stated goal is **"learn and own the pattern,"** not "fix posture." The **same fixed exercises run all three weeks; only the numbers move.**

| | **Week 1 — Learn & Own** | **Week 2 — Reinforce** | **Week 3 — Consolidate** |
|---|---|---|---|
| Theme | Awareness + control, quality over quantity | "Same moves, a touch more" | "Make it automatic, finish strong" |
| What changes | Baseline dose on the locked menu | Reps/holds nudge up; stretch adds a set | Reps/holds reach top of band; *one* allowed set-add on dynamic strengthen; W3 "Connect" item appears |
| Guardrail | — | ≤10% weekly volume increase | Set added **at most once across the block**; stretch volume **never** escalated past W2 (≈8 min/muscle/week ceiling) |

**Capability dial (v1).** At plan generation, a per-client capability (`regression | standard | progression`, default `standard`) selects which `progressionLevel` variant seeds the *fixed* menu — e.g. a deconditioned client starts the deep-cervical-flexor track at `supine-chin-nod` (L1); a fit client at `chin-tuck-head-lift` (L3). The exercise then **stays fixed for all 3 weeks**; only dose ramps. This is the coach's primary lever and the main safety floor (prevents over-facing). Where a track lacks the requested level, fall back to the nearest available level (deterministic: clamp to `[minAvailable, maxAvailable]`).

**Self-pacing off-ramp (client safety, not a clinical gate).** Each priority shows a plain line: *"If last week felt hard, repeat the same numbers before moving up."* The W1→W2→W3 numbers are a *suggested* path, not a mandate. No "2-for-2 readiness gate" language on the client surface (reads as a therapy protocol).

**Re-assessment cadence (protects the screening framing).**
- **Day 21:** a **qualitative check-in only** — "does this feel easier / more automatic?" plus a self-rated 0–10 "how automatic does this feel?" captured W1 vs W3 so the client sees their own trend. **No posture re-scan at day 21** (it would only show noise).
- Recommend a **second 3-week block**, with the **formal posture re-screen at ~6 weeks** and a comprehensive re-scan at **8–12 weeks**. State plainly that visible/measurable change is a 6–12-week outcome.
- The app **recommends** cadence; the practitioner owns timing (non-diagnostic).

---

## 4. Session order — the correct order to perform the recommendations

The fixed, evidence-based NASM/Janda continuum (Inhibit → Lengthen → Activate → Integrate). Within **each** of the top-3 priorities, exercises are sorted deterministically by `category`:

| # | Step (client words **bold**) | Category | Rationale |
|---|---|---|---|
| 1 | **Warm up** (Prepare) | 1–2 min general movement (copy only) | Warm tissue lengthens/activates more safely; low-friction on-ramp aids adherence. |
| 2 | **Loosen** (Release) | `mobility` | Lower tension in the overactive antagonist first (reciprocal inhibition). |
| 3 | **Lengthen** (Stretch) | `stretch` | Restore length/ROM of the tight muscles — precondition for the weak muscle to fire. |
| 4 | **Wake up & strengthen** | `activation` then `strengthen` | With the antagonist released, retrain the inhibited muscle; activation precedes loaded work so the right muscle leads. |
| 5 | **Connect** (Integrate, W3 only) | `strengthen` where `isIntegrative` | Cement the correction into whole-body movement; last so the body can't fall back on compensation. |

**Client-facing collapse.** The client report narrates this as **three buckets — "Loosen → Strengthen → Connect"** in one plain line: *"Loosen and lengthen what's tight, then wake up and strengthen what's weak, then tie it together — the order is what makes it stick."* The full 5-step continuum vocabulary, tempo notation, and `progressionLevel` live in the **coach view only**.

**Integrate (Step 5) without a real category.** There is no `integrate` category. Tag a small set of standing/compound `strengthen` items (`split-squat`, `single-leg-rdl`, `single-leg-glute-bridge`, `wall-angels`) with `isIntegrative: true` and pin the tagged item last in W3. **Deterministic fallback:** if a priority has no integrative-tagged exercise (e.g. pure forward-head), Step 5 is **omitted** and W3 copy reads "keep going, focus on quality" — never an empty or padded slot.

---

## 5. Dosage model — numbers, ramp, and the reps/dosageType decision

**Add a structured `reps {min,max}` field** (the brief requires showing reps; 18 exercises already embed inconsistent rep counts in prose). Backfill from prose as an **explicit per-exercise table reviewed by the clinical author** — not a regex parse (counts appear as "10–12", "8–12", "6–8 per side").

**Add an explicit `dosageType` flag** (`hold | dynamic`) — do **not** infer isometric-vs-dynamic from `holdSeconds`. Verified mislabels under a numeric cutoff: `pallof-press` (`hs=10`, a dynamic anti-rotation *press*) and `supine-chin-nod` (`hs=10`, activation) would wrongly render as "Hold 10s." The flag is authored once and audited across all 54 exercises.

**Dosage table** — a report-layer constant `lib/program/dosage.ts`, keyed by `category × week`. It reads `sets`/`holdSeconds`/`reps` from content as anchors and applies the ramp. Stretch hold **honors the authored `holdSeconds`** (e.g. `suboccipital-release` = 60s stays 60s) and ramps *sets*, not seconds — no silent flatten.

| Category | Week 1 | Week 2 | Week 3 | Frequency | Notes |
|---|---|---|---|---|---|
| **stretch** (`hold`) | 2 × authored hold | 3 × authored hold | 3 × authored hold (capped) | 5–7×/wk | reps = null; never add seconds past W2 |
| **mobility** (dynamic) | 1 × 8 (or 30s continuous) | 2 × 8 | 2 × 10 | daily | SMR items: 1–2 passes × 30–60s dwell, flat |
| **activation** | 2 × 10 | 2 × 12 | 2 × 15 | 3→4→4 ×/wk | "squeeze 2 counts at the top" |
| **strengthen — dynamic** | 2 × 10 | 2 × 12 | 3 × 15 (single set-add lands here) | 3→4→4 ×/wk | "lower slowly (≈4 counts)" |
| **strengthen — hold** | 2 × 20s | 2 × 30s | 2 × 40s (cap = `min(authored hs, 60)`) | 3→4→4 ×/wk | reps = null; render "Hold Ns × N sets" |

**Global guardrails (encoded).** ≤10% weekly volume increase; sets added at most once (W3 dynamic strengthen only); stretch never escalated past W2; every increase is rep/hold/frequency-led, not set-stacked. **Severity does NOT scale dosage** — a `danger` item is not dosed harder than a `warning` item; severity drives selection and order only. This keeps an unvalidated screening tool conservative. A coach may apply a *frequency*-only "emphasize this" bump (+1 day/week) inside the guardrails.

**Client-surface jargon strip.** Never print "isometric," "tempo," or "4/2/1" on the client PDF — only plain cues ("lower slowly," "squeeze for 2 counts"). Those terms stay coach-side.

---

## 6. Client report IA (PDF-first, web-portable)

~6th–8th-grade reading level; short, chunked sentences; good-news-first; every red zone paired with a next step; disclaimer on the surface.

1. **Hero / plain-language overview** — one warm paragraph; lead with what's *working* (maintain-zone wins); restate `overallGrade` in human terms ("Overall: a few things to work on," never the bare letter); set the 3-week expectation ("these 3 weeks are about learning a few simple movements — visible change is a longer, 6–12 week journey"); non-diagnostic line present.
2. **Your Top 3 Priority Focuses** — up to 3 cards (fewer per §2; bilateral knees = one card). Each: plain label (10-key translation lookup), "what this means in everyday terms," "what it can feel like," severity in screening words only, a *specific* reassurance ("forward head is common from desk work and responds well to these"). Degrees footnoted, never headline.
3. **Your Plan & the Right Order** — the one-line principle ("Loosen → Strengthen → Connect"), then each priority's fixed exercises in session order with dose as "N sets × N reps" or "N sets × Ns hold" + a "days/week" tag; hold items clearly labeled "Hold."
4. **Your 3-Week Ramp** — *the headline artifact.* Per priority, a compact 3-column **Week 1 / Week 2 / Week 3** table showing only the numbers that grow ("Strengthen 2×10 → 2×12 → 3×15"), framed as milestone wins (Learn & Own → Reinforce → Consolidate). Carries the "repeat a week if it felt hard" off-ramp line. Total session time-boxed ("~15 min/day").
5. **What "Better" Feels Like** — concrete, non-medical sensory signs per priority ("your head sits more over your shoulders; less end-of-day neck tightness") to build self-efficacy.
6. **Track Your Progress** — a tickable weekly session checklist (self-monitoring) + the Day-21 "how automatic does this feel? (0–10)" self-rating; recommends a second block and a re-screen at ~6 weeks (not day 21).
7. **Safety & When to See a Pro** — the required non-diagnostic disclaimer (`DISCLAIMER` already in `lib/pdf/report.tsx`), "stop if it hurts," "see a qualified professional if X."

**Tone DO:** positives first; screening vocab only; every issue paired with its plan; reassurance specific to the finding; explain *why* each exercise helps; realistic timeline up front.
**Tone DON'T:** normal/abnormal/diagnose/treat/patient/cure; raw degrees as headline; a wall of all 10 findings; a red zone without a next step; generic motivational filler.

---

## 7. Coach in-app enrichments (`/assessments/[id]`) — minimal

Today the page derives recommendations via `deriveExerciseRecommendations` (zone ≥ `minZone`). Add, minimally:

1. **Priority labeling** — render `selectPriorities()`: the ordered top-3 highlighted among all findings, with zone + severity word. Full clinical detail stays (degrees, direction, confidence, Janda tight/weak muscle pairs).
2. **The same 3-Week Ramp table** the client receives, so the coach sees exactly what was sent.
3. **A defined override surface** (not free-form): the coach can (a) set the **client capability** (`regression/standard/progression`); (b) **swap one exercise** within a category for a priority; (c) **demote a priority to "monitor only — no program."** Overrides persist alongside the priority order so the client PDF regenerates deterministically.
4. **Unreliable findings** shown in a muted clinical section (not promoted to the client).

Everything else (tempo, continuum phase labels, capability rationale) is coach-only.

---

## 8. Data-model changes — minimal & deterministic

**Content schema (`content/muscles/types.ts → exerciseContentSchema`):**
- `reps: z.object({ min: z.number().int().min(1).max(30), max: z.number().int().min(1).max(30) }).nullable()` — null for `stretch`/`informational` and any `dosageType: 'hold'` item. (`max ≥ min` enforced.)
- `dosageType: z.enum(['hold','dynamic'])` — authored per exercise, audited across all 54.
- `isIntegrative: z.boolean().default(false)` — tag `split-squat`, `single-leg-rdl`, `single-leg-glute-bridge`, `wall-angels`.
- `superRefine`: `reps` null ⇔ (`dosageType === 'hold'` OR category ∈ {stretch, informational}); non-null otherwise.

**Seed/backfill:** add `reps` + `dosageType` (+ `isIntegrative` where relevant) to the 25 strengthen + 6 activation + 4 mobility files; `reps = null`, `dosageType = 'hold'` on the 19 stretch files. Backfill reps from the clinical-author table (not regex).

**DB migration:** `ALTER TABLE exercises ADD COLUMN reps_min INT, ADD COLUMN reps_max INT, ADD COLUMN dosage_type TEXT, ADD COLUMN is_integrative BOOLEAN NOT NULL DEFAULT false;` Mirror in the page's `Exercise` interface and `lib/pdf/report.tsx`'s `PdfExercise`.

**Top-3 + plan persistence:** persist the ordered priority on the assessment (`priority_keys TEXT[]`, storing the real `genu_*` keys plus a client-side collapse helper — **avoid** a synthetic key not in `IMBALANCE_KEYS`). The existing **`exercise_recommendations` table already has `triggering_imbalance_key` + `sort_order`** — reuse it to persist the ordered, capability-resolved plan. **No new ProgressionPlan table is needed**: exercises are fixed across weeks, so the whole 3-week program is derivable from `(priority_keys + recommendation filter + capability + DOSAGE_TABLE + week)`.

**Client capability persistence:** one field on the client (or per-assessment) row, `capability TEXT DEFAULT 'standard'`.

**New report-layer modules (no DB):**
- `lib/program/selectPriorities.ts` — pure fn over `findings`.
- `lib/program/dosage.ts` — `DOSAGE_TABLE` + render helpers + guardrail logic.
- `content/report/imbalance-copy.ts` — 10-key plain-language lookup `{ plainLabel, whatItMeans, whatItCanFeel, whatBetterLooksLike, reassurance }`, run through the existing `BANNED_TERM_PATTERNS` guard.

---

## 9. Worked example

**Client findings (illustrative):** Forward Head Posture — `zone: danger`, `severityPct 78`, reliable; Anterior Pelvic Shift — `zone: warning`, `severityPct 64`; Anterior Imbalanced Shoulders — `zone: warning`, `severityPct 52`. (Plus a `maintain` knee finding, excluded.) Capability = `standard`.

**Top-3 (`selectPriorities` → ranked):**
1. **Forward Head Posture** — *significant / danger* (the +1000 danger offset puts it first).
2. **Anterior Pelvic Shift** — *moderate / warning* (severity 64 > 52).
3. **Rounded Shoulders (Anterior)** — *mild–moderate / warning*.

**Priority 1 — Forward Head Posture** (no integrative item → no W3 "Connect"; W3 copy = "keep going, focus on quality"):

| Step | Exercise | Cat / type | W1 | W2 | W3 |
|---|---|---|---|---|---|
| Loosen | `thoracic-extension` | mobility / dynamic | 1×8 | 2×8 | 2×10 |
| Lengthen | `suboccipital-release` | stretch / hold | 2×60s | 3×60s | 3×60s |
| Lengthen | `neck-lateral-stretch` (upper-trap, L2) | stretch / hold | 2×20s | 3×20s | 3×20s |
| Lengthen | `sternocleidomastoid-stretch` | stretch / hold | 2×15s | 3×15s | 3×15s |
| Wake up | `supine-chin-nod` (deep-cervical-flexors, L1) | activation / dynamic | 2×10 | 2×12 | 2×15 |
| Strengthen | `chin-tucks` (L2) | strengthen / dynamic | 2×10 | 2×12 | 3×15 |
| Strengthen | `prone-y-raise` (lower-trap) | strengthen / dynamic | 2×10 | 2×12 | 3×15 |

*Stretch 5–7×/wk; activation/strengthen 3→4→4×/wk.*

**Priority 2 — Anterior Pelvic Shift** (integrative → W3 "Connect"):

| Step | Exercise | Cat / type | W1 | W2 | W3 |
|---|---|---|---|---|---|
| Loosen | `cat-cow` | mobility / dynamic | 1×8 | 2×8 | 2×10 |
| Lengthen | `kneeling-hip-flexor-stretch` | stretch / hold | 2×20s | 3×20s | 3×20s |
| Wake up | `supine-pelvic-tilt` | activation / dynamic | 2×10 | 2×12 | 2×15 |
| Strengthen | `glute-bridge` | strengthen / dynamic | 2×10 | 2×12 | 3×15 |
| Strengthen | `dead-bug` | strengthen / dynamic | 2×10 | 2×12 | 3×15 |
| **Connect** (W3) | `single-leg-rdl` (`isIntegrative`) | strengthen / dynamic | — | — | 2×10 |

**Priority 3 — Rounded Shoulders (Anterior)** (Connect via `wall-angels`):

| Step | Exercise | Cat / type | W1 | W2 | W3 |
|---|---|---|---|---|---|
| Lengthen | `doorway-pec-stretch` | stretch / hold | 2×20s | 3×20s | 3×20s |
| Wake up | `shoulder-blade-squeeze` | activation / dynamic | 2×10 | 2×12 | 2×15 |
| Strengthen | `seated-band-row` | strengthen / dynamic | 2×10 | 2×12 | 3×15 |
| Strengthen | `band-pull-apart` | strengthen / dynamic | 2×10 | 2×12 | 3×15 |
| **Connect** (W3) | `wall-angels` (`isIntegrative`) | strengthen / dynamic | — | — | 2×10 |

*(`doorway-pec-stretch` and `wall-angels` are `minZone: maintain`, so they pass the warning-zone gate.)*

---

## 10. Deferred / out of scope (recorded, not built in v1)

- **Share-link snapshotting** — derive the report on-read for v1 (already reproducible). Defer a `program_plan JSONB` snapshot on the `reports` table until a public web share-link exists and dosage constants might drift.
- **Client-portal web page** — IA is designed to port, but the routing/auth (client-portal token) is a later phase.
- **Backfill ownership** — the per-exercise `reps` + `dosageType` table (18 files with prose counts, ~36 needing authored values) must be **signed off by the clinical author** (presentation-prescriptive; must match Janda/Kendall reasoning). This is a content task tracked alongside implementation, gated by the existing `reviewed_by`/`reviewed_at` convention.

---

## Verified-fact notes for the implementer

- `Finding.region` is genuinely `head_shoulders | spine | pelvis | leg` — use it for the region tiebreak, **not** the muscle-KB `REGIONS` enum (a different 5-value set).
- The "no upper-trapezius stretch" gap is overstated — `neck-lateral-stretch` tags `upper-trapezius` at L2 and is a valid lengthener.
- Forward Head has a real L1→L2→L3 weak-muscle ladder (`supine-chin-nod` → `chin-tucks` → `chin-tuck-head-lift`), which is why the capability dial works for it.
- `reps` truly does not exist anywhere yet (content schema, DB, page interface) — the migration is required.
- `exercise_recommendations` already exists with `sort_order` / `triggering_imbalance_key`; reuse it rather than adding a plan table.
- Only ~10 of 31 muscle/role tracks have a full L1→L2→L3 ladder (mostly `strengthen`) — this is why the design ramps dose on a fixed menu rather than swapping variants weekly.
