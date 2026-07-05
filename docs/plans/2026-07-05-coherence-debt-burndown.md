# Coherence-Debt Burn-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the 30 exercise×finding incoherent pairs in `KNOWN_DEBT` (and resolve the hamstrings/trunk_lean role contradiction) via literature-backed per-category decisions, shrinking the ratchet toward `[]`.

**Architecture:** Two resolution mechanics exist per pair: **(R) re-score** — add a `scored: true` muscle link to the finding in `content/muscles/<slug>.ts` so the exercise's target muscle becomes coherent (this also changes the 2D/3D map + ranker, so it needs a regenerated seed + forward-only migration); or **(U) unmap** — remove the finding key from the exercise's `primaryDeviationKeys` in `content/exercises/<slug>.ts` (pure content, no migration) when the exercise already serves another passing key. Each resolved pair is then deleted from `KNOWN_DEBT` in `lib/program/coherence.test.ts`; the ratchet fails if a listed pair becomes coherent, which is the burn-down signal.

**Tech Stack:** TypeScript content modules, Vitest (`lib/program/coherence.test.ts`, `content/content.test.ts`), `scripts/generate-muscle-seed.ts` → Supabase forward-only migration.

**Evidence base:** Per-category PubMed/PMC brief (2026-07-05), summarized inline per task. Decision record: Devin chose the two-stage approach (safe unmaps first, then evidence-reviewed re-scoring) on 2026-07-05. Full audit context: `docs/qa/AUDIT.md`; pair root-causes: `docs/coherence-debt.md`.

## Global Constraints

- Screening vocabulary ban in all content copy (`rationale`, `citation`): no `diagnos`, `treat`, `cure`, `patient`, `prescri` stems — enforced by `content/content.test.ts` + `lib/ui-vocabulary.test.ts`.
- `primaryDeviationKeys` must stay non-empty (schema) — never unmap an exercise's only key without first adding a replacement key.
- The grade-distribution test `content/content.test.ts:277` pins total scored links; **any re-score changes that count** — update the pinned expectation in the same commit.
- Forward-only migrations, next free timestamp after `20260707030000` (use `20260708000000`, `…010000`, … in task order). Local Supabase only (`supabase status` = 127.0.0.1).
- Regenerate the seed with `npx vite-node scripts/generate-muscle-seed.ts` — never hand-edit the generated SQL. After any content re-score, the migration is the regenerated seed diff.
- Confidence grades are exactly `high` | `medium` | `low` (DB check constraint). Every new link needs a non-empty `citation`.
- One feature branch per task (or per category) → `~/bin/zs-land`. Never commit to main.

---

## Disposition table (all 30 pairs + role contradiction)

Derived from the literature brief. **U** = unmap (safe, no migration), **R** = re-score (add scored link + migration), **O** = orphan (single-key; needs a second key or bank removal — product decision), **S** = safety removal.

| Category | Pairs | Literature verdict | Disposition |
|---|---|---|---|
| pelvic_axial_rotation | 12 | Q1: transverse 2D metric unreliable (ICC 0.52–0.61); **no healthy-adult evidence** for oblique / deep-hip-ER links to static rotation → **do NOT re-score** | 5× **U** (multi-key), 7× **O** (single-key) |
| posterior_imbalanced_shoulders | 5 | Q2: RCT + EMG support **middle-trapezius weak (MEDIUM)**; rhomboids **weak (LOW)** | 5× **R** (add mid-trap+rhomboid weak links) |
| knee_extension_back_knee | 6 | Q3: gastroc-soleus **LOW-MEDIUM** (mechanistic); quadriceps **LOW** (ratio, direction unclear); popliteus insufficient; **hamstring stretch CONTRAINDICATED** | 1× **S** (hamstring stretch), 2× **U** (calf, multi-key), 3× mixed **R/O** |
| pelvic_obliquity | 3 | Q4: glute-max/hip-flexor evidence is **sagittal-plane**, not lateral tilt → **do NOT re-score** | 3× **U** (all multi-key) |
| forward_head_posture | 2 | Q5: add **pec-minor tight (MEDIUM)** + **thoracic-ES under-active/weak (MEDIUM)** | 2× **R** (or 1× U + 1× R) |
| genu_varum_valgum | 2 | (not in brief scope) gastroc-soleus↔knee-alignment link uncited in content | 1 exercise (2 keys) — **O** (single exercise, both genu keys are its only keys) |
| **hamstrings / trunk_lean** | role | Q6: sway-back hamstrings are **short/overactive, NOT weak**; current `weak` coding is inverted; stretch is fine, strengthen is contraindicated | **recode tight** + re-home strengthen exercises |

---

## Task 1 (Stage 1 — safe unmaps, no migration): pelvic_axial_rotation multi-key exercises

**Files:**
- Modify: `content/exercises/bird-dog.ts`, `side-plank-knees.ts`, `side-plank.ts`, `single-leg-glute-bridge.ts`, `supine-crossover-stretch.ts` (remove `'pelvic_axial_rotation'` from `primaryDeviationKeys`)
- Modify: `lib/program/coherence.test.ts` (delete the 5 corresponding `KNOWN_DEBT` entries)

**Interfaces:**
- Consumes: nothing. Produces: 5 pairs removed from the debt list; each exercise still serves its other passing key (verified below).

- [ ] **Step 1: Confirm each exercise's surviving key**

Run: `grep -A2 "primaryDeviationKeys" content/exercises/{bird-dog,side-plank-knees,side-plank,single-leg-glute-bridge,supine-crossover-stretch}.ts`
Expected: each lists `pelvic_axial_rotation` AND at least one of `trunk_lean` / `pelvic_obliquity` / `knee_extension_back_knee`. (Per `docs/coherence-debt.md`: bird-dog→trunk_lean; side-plank(-knees)→pelvic_obliquity; single-leg-glute-bridge→trunk_lean+knee; supine-crossover-stretch→pelvic_obliquity.)

- [ ] **Step 2: Remove the key from each exercise**

In each file, delete `'pelvic_axial_rotation'` from the `primaryDeviationKeys` array (leave the surviving key(s)). Example — `bird-dog.ts`:

```ts
  primaryDeviationKeys: ['trunk_lean'],   // was ['trunk_lean', 'pelvic_axial_rotation']
```

- [ ] **Step 3: Delete the 5 debt entries**

In `lib/program/coherence.test.ts`, remove these lines from `KNOWN_DEBT`:

```
'bird-dog [strengthen] × pelvic_axial_rotation',
'side-plank-knees [strengthen] × pelvic_axial_rotation',
'side-plank [strengthen] × pelvic_axial_rotation',
'single-leg-glute-bridge [strengthen] × pelvic_axial_rotation',
'supine-crossover-stretch [stretch] × pelvic_axial_rotation',
```

- [ ] **Step 4: Run the gate**

Run: `npx vitest run lib/program/coherence.test.ts content/content.test.ts`
Expected: PASS. `newlyFixed` is empty because the 5 pairs no longer exist AND are no longer listed; `newlyBroken` is empty because unmapping removes pairs, never adds them. (No grade-count change — no links touched.)

- [ ] **Step 5: Full suite (catch program-generation fallout)**

Run: `npx vitest run`
Expected: PASS. If `buildProgram` snapshot tests reference these exercises under `pelvic_axial_rotation`, update the snapshots (they were never reachable — the finding is sub-reliability-floor — so any change is inert).

- [ ] **Step 6: Commit**

```bash
git add content/exercises/*.ts lib/program/coherence.test.ts
git commit -m "fix(content): unmap pelvic_axial_rotation from 5 multi-key exercises (burn-down 30→25)"
```

---

## Task 2 (Stage 1 — safe unmaps): pelvic_obliquity (3) + knee calf-stretch (2)

**Files:**
- Modify: `content/exercises/glute-bridge-march.ts`, `kneeling-hip-flexor-stretch.ts`, `single-leg-rdl.ts` (drop `pelvic_obliquity`); `bent-knee-calf-stretch.ts`, `wall-calf-stretch.ts` (drop `knee_extension_back_knee`)
- Modify: `lib/program/coherence.test.ts`

**Interfaces:**
- Produces: 5 more pairs removed. Each survives via `trunk_lean` (all five already serve it per `docs/coherence-debt.md`).

- [ ] **Step 1: Verify surviving keys**

Run: `grep -A2 "primaryDeviationKeys" content/exercises/{glute-bridge-march,kneeling-hip-flexor-stretch,single-leg-rdl,bent-knee-calf-stretch,wall-calf-stretch}.ts`
Expected: each retains `trunk_lean` (single-leg-rdl also keeps `knee_extension_back_knee`).

- [ ] **Step 2: Remove the keys** (pattern as Task 1 Step 2 — drop `'pelvic_obliquity'` from the first three, `'knee_extension_back_knee'` from the two calf stretches).

- [ ] **Step 3: Delete these 5 `KNOWN_DEBT` entries:**

```
'glute-bridge-march [strengthen] × pelvic_obliquity',
'kneeling-hip-flexor-stretch [stretch] × pelvic_obliquity',
'single-leg-rdl [strengthen] × pelvic_obliquity',
'bent-knee-calf-stretch [stretch] × knee_extension_back_knee',
'wall-calf-stretch [stretch] × knee_extension_back_knee',
```

- [ ] **Step 4:** `npx vitest run lib/program/coherence.test.ts` → PASS (30→20 across Tasks 1–2).
- [ ] **Step 5:** `npx vitest run` → PASS (update inert snapshots if any).
- [ ] **Step 6: Commit**

```bash
git commit -am "fix(content): unmap pelvic_obliquity (3) and knee calf-stretch (2) from exercises that pass via trunk_lean (burn-down 25→20)"
```

---

## Task 3 (Stage 1 — SAFETY): remove the contraindicated hamstring stretch pairing

**Files:**
- Modify: `content/exercises/seated-hamstring-stretch.ts`
- Modify: `lib/program/coherence.test.ts`

**Interfaces:**
- Produces: the hamstring-stretch/hyperextended-knee pair removed. **This is a safety fix, not just hygiene.**

**Evidence (Q3):** In genu recurvatum, hamstring muscle-tendon length is abnormally *long* at initial contact ([PMID 20308923]); stretching an already-elongated hamstring for a hyperextended knee is contraindicated. `seated-hamstring-stretch` currently maps to `knee_extension_back_knee` where hamstrings are the sole `weak` scored muscle — and stretching a *weak* muscle is itself incoherent (the reason it's in `KNOWN_DEBT`). Both the coherence gate and the clinical literature point the same way: this pairing should not exist.

- [ ] **Step 1: Determine `seated-hamstring-stretch`'s keys**

Run: `grep -A2 "primaryDeviationKeys" content/exercises/seated-hamstring-stretch.ts`
Per `docs/coherence-debt.md` this is `knee_extension_back_knee` **only** — so it is an orphan. Removing the only key violates the non-empty schema.

- [ ] **Step 2: Decision point (recommended default recorded)**

The exercise's clinical purpose (stretching hamstrings) is contraindicated for the *one* finding it serves. Recommended resolution: **remove `seated-hamstring-stretch` from the exercise bank** (delete the file + its registry entry), since re-homing a hamstring stretch onto another finding where hamstrings are tight (e.g. a future anterior-pelvic-tilt finding) is not currently available. If Devin prefers to keep the file for future use, mark it `informational` (excluded from `candidatesFor` by the `category !== 'informational'` filter in `buildProgram.ts:106`) instead of deleting.

- [ ] **Step 3a (default — remove):** delete `content/exercises/seated-hamstring-stretch.ts` and its line in `content/exercises/registry.ts` (or wherever `ALL_EXERCISES` is assembled — `grep -rn seated-hamstring-stretch content/`).

- [ ] **Step 3b (alternative — neutralize):** change `category: 'stretch'` → `category: 'informational'` in the file; leave the key.

- [ ] **Step 4: Delete the debt entry**

```
'seated-hamstring-stretch [stretch] × knee_extension_back_knee',
```

- [ ] **Step 5:** `npx vitest run` → PASS (20→19). If removed, confirm no test references the slug: `grep -rn seated-hamstring-stretch . --include='*.ts' --include='*.snap'`.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(content): remove contraindicated hamstring-stretch for hyperextended knee (safety; PMID 20308923) (burn-down 20→19)"
```

---

## Task 4 (Stage 2 — re-score): posterior_imbalanced_shoulders +middle-trapezius / +rhomboids

**Files:**
- Modify: `content/muscles/middle-trapezius.ts`, `content/muscles/rhomboids.ts` (add a `posterior_imbalanced_shoulders` weak link each)
- Modify: `content/content.test.ts` (bump the pinned grade count by +2)
- Modify: `lib/program/coherence.test.ts` (delete 5 entries)
- Regenerate: `supabase/migrations/20260708000000_posterior_shoulder_regrade.sql`

**Interfaces:**
- Produces: `middle-trapezius` (weak, MEDIUM) and `rhomboids` (weak, LOW) scored links on `posterior_imbalanced_shoulders`. Makes all 5 exercises (band-rear-delt-row, band-reverse-fly, prone-t-raise, prone-w-raise, rear-deltoid-stretch) coherent.

**Evidence (Q2):** RCT [PMID 36833034] + EMG [PMID 30660072] establish middle/lower-trapezius weakness as a modifiable driver of rounded-shoulder posture; rhomboids retract the scapula but the resting-position correlation is weaker and confounded by glenoid depression [PMC4961314] → LOW.

- [ ] **Step 1: Add the middle-trapezius link**

In `content/muscles/middle-trapezius.ts`, append to `links`:

```ts
{
  imbalanceKey: 'posterior_imbalanced_shoulders',
  role: 'weak',
  confidence: 'medium',
  scored: true,
  rationale: 'Middle-trapezius under-activation is a modifiable contributor to a rounded-shoulder pattern; retraction strengthening improves resting scapular position.',
  citation: 'Alghadir 2023 Int J Environ Res Public Health (RCT); Castelein 2019 EMG',
},
```

- [ ] **Step 2: Add the rhomboids link**

In `content/muscles/rhomboids.ts`, append to `links`:

```ts
{
  imbalanceKey: 'posterior_imbalanced_shoulders',
  role: 'weak',
  confidence: 'low',
  scored: true,
  rationale: 'Rhomboids assist scapular retraction; the link is anatomically coherent though the resting-position association is less direct than for middle-trapezius.',
  citation: 'Kang 2016 (shoulder retractor EMG)',
},
```

- [ ] **Step 3: Run the vocab + schema tests, then bump the pinned count**

Run: `npx vitest run content/content.test.ts`
Expected: FAIL on the count assertion (was 42, now 44). Update `content/content.test.ts:277` (and any `high/medium/low` sub-counts) to the new totals: +1 medium, +1 low. Re-run → PASS. Confirm citations pass the vocab screen (no banned stems — they don't).

- [ ] **Step 4: Delete the 5 debt entries**

```
'band-rear-delt-row [strengthen] × posterior_imbalanced_shoulders',
'band-reverse-fly [strengthen] × posterior_imbalanced_shoulders',
'prone-t-raise [strengthen] × posterior_imbalanced_shoulders',
'prone-w-raise [strengthen] × posterior_imbalanced_shoulders',
'rear-deltoid-stretch [stretch] × posterior_imbalanced_shoulders',
```

Note: `rear-deltoid-stretch` is a **stretch** targeting mid-trap/rhomboids, which we just added as **weak**. Stretch-of-weak is incoherent. Verify the coherence rule: if it still fails, this pair is **U** not R — unmap `posterior_imbalanced_shoulders` from `rear-deltoid-stretch` instead of deleting its debt line via re-score. Run the gate to see which; follow the gate.

- [ ] **Step 5: Regenerate the seed migration**

```bash
npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/20260708000000_posterior_shoulder_regrade.sql
```
Verify the diff adds exactly the two new INSERT rows: `git diff --stat` + `grep -c "middle-trapezius\|rhomboids" supabase/migrations/20260708000000_*.sql`.

- [ ] **Step 6: Apply locally + verify**

```bash
supabase db reset   # or: psql "$LOCAL_DB_URL" -f the new migration
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from muscle_imbalance_links where imbalance_key='posterior_imbalanced_shoulders' and scored;"
```
Expected: count increased by 2.

- [ ] **Step 7: Gate + full suite + commit**

Run: `npx vitest run` → PASS (19→14, or 19→15 if rear-deltoid-stretch is unmapped).

```bash
git add content/muscles/middle-trapezius.ts content/muscles/rhomboids.ts content/content.test.ts lib/program/coherence.test.ts supabase/migrations/20260708000000_posterior_shoulder_regrade.sql
git commit -m "feat(content): score middle-trapezius(weak/med) + rhomboids(weak/low) for posterior shoulder imbalance (RCT+EMG) (burn-down)"
```

---

## Task 5 (Stage 2 — re-score): forward_head_posture +pec-minor / +thoracic-ES

**Files:**
- Modify: `content/muscles/pectoralis-minor.ts` (add FHP tight link), `content/muscles/thoracic-erector-spinae.ts` (add FHP weak link)
- Modify: `content/content.test.ts`, `lib/program/coherence.test.ts`
- Regenerate: `supabase/migrations/20260708010000_fhp_regrade.sql`

**Evidence (Q5):** FHP co-occurs with thoracic kyphosis and rounded shoulders [PMID 29097952]. Thoracic-ES shows *selective under-activation* in slouched thoracic posture [PMID 25463688]; pec-minor tightness is a rounded-shoulder component correctable by stretching [PMID 36833034]. `cat-cow` (thoracic-ES mobility) and `thoracic-extension` (pec stretch) become coherent.

- [ ] **Step 1: Add pec-minor tight link** (in `pectoralis-minor.ts`):

```ts
{
  imbalanceKey: 'forward_head_posture',
  role: 'tight',
  confidence: 'medium',
  scored: true,
  rationale: 'Pectoralis-minor shortening accompanies the rounded-shoulder pattern that co-occurs with a forward-head position; lengthening it supports upright carriage.',
  citation: 'Singla 2017 J Chiropr Med (review); Alghadir 2023 RCT',
},
```

- [ ] **Step 2: Add thoracic-ES weak link** (in `thoracic-erector-spinae.ts` — note this muscle already carries a `trunk_lean` weak link from Task 6 of Plan 2; add a second link for FHP):

```ts
{
  imbalanceKey: 'forward_head_posture',
  role: 'weak',
  confidence: 'medium',
  scored: true,
  rationale: 'Thoracic erector spinae shows selective under-activation in slouched thoracic posture; waking it up supports the extension that offsets a forward-head position.',
  citation: 'Lee 2014 J Phys Ther Sci PMID 25463688',
},
```

- [ ] **Step 3: Check coherence direction for each exercise**

`cat-cow` is `mobility` → coherent with any scored muscle for the finding (thoracic-ES now qualifies). `thoracic-extension` is `mobility` targeting pec-major/pec-minor (stretch) → pec-minor is now scored `tight`, and mobility passes against any scored muscle. Both should now pass. Confirm with the gate rather than assuming.

- [ ] **Step 4: Bump pinned count (+2 medium), delete debt entries:**

```
'cat-cow [mobility] × forward_head_posture',
'thoracic-extension [mobility] × forward_head_posture',
```

- [ ] **Step 5: Regenerate seed → `20260708010000_fhp_regrade.sql`; apply locally; verify +2 scored rows for `forward_head_posture`.**
- [ ] **Step 6:** `npx vitest run` → PASS (burn-down −2). Commit:

```bash
git commit -am "feat(content): score pec-minor(tight/med) + thoracic-ES(weak/med) for forward head posture (EMG+RCT) (burn-down)"
```

---

## Task 6 (Stage 2 — mixed): knee_extension_back_knee remaining 3

**Files:** `content/muscles/gastrocnemius-soleus.ts`, exercise files `standing-calf-raise.ts` / `standing-quad-stretch.ts` / `seated-tibial-rotation.ts`, tests, migration `20260708020000_knee_regrade.sql`.

**Evidence (Q3):** gastroc-soleus↔knee-hyperextension is mechanistically sound (equinus drives recurvatum, [PMID 16311192, 20442674]) → upgrade to **LOW-MEDIUM scored**. Quadriceps: only a strength-*ratio* association, direction unclear → **do not score** a single-direction quad link. Popliteus: mechanistic-only → **keep `scored: false`**.

- [ ] **Step 1: Score gastroc-soleus for knee_extension_back_knee**

The content already links gastroc-soleus to this finding as `scored: false` (per `docs/coherence-debt.md`). Flip it to `scored: true`, set `confidence: 'low'`, ensure a `citation`:

```ts
// in gastrocnemius-soleus.ts, the knee_extension_back_knee link:
role: 'tight', confidence: 'low', scored: true,
citation: 'Kerkum 2016 (equinus→recurvatum); Klotz 2010 J Pediatr Orthop B PMID 20442674',
```

This makes `standing-calf-raise` (strengthen — wait: strengthening a *tight* muscle is incoherent). **Follow the gate:** `standing-calf-raise [strengthen] × knee_extension_back_knee` and `standing-quad-stretch [stretch]` and `seated-tibial-rotation [activation]` each need their category checked against the new scored set:
  - `standing-calf-raise` strengthen vs gastroc-soleus tight → **still incoherent** → resolve by **U** (unmap; but it's single-key per doc — becomes **O**) or by accepting the calf as `tight` means the coherent exercise is a *stretch* not a strengthen. Recommended: **remove `standing-calf-raise`'s knee key** if it has another; else orphan (Task 7).
  - `standing-quad-stretch` stretch vs quadriceps — we chose NOT to score quads → **remains debt** unless unmapped; single-key → orphan (Task 7).
  - `seated-tibial-rotation` activation vs popliteus (kept unscored) → **remains debt**; single-key → orphan (Task 7).

- [ ] **Step 2:** Only `wall-calf-stretch`/`bent-knee-calf-stretch` (already unmapped in Task 2) and any *stretch* targeting gastroc-soleus become coherent from the gastroc re-score. Delete only the debt entries the gate confirms fixed. Bump pinned count +1 low. Regenerate seed → `20260708020000_knee_regrade.sql`.
- [ ] **Step 3:** `npx vitest run` → PASS. Commit. The three single-key exercises above flow to Task 7.

---

## Task 7 (Stage 3 — orphans): single-key exercises for unscoreable/unscored findings

**Context:** These exercises have a finding key as their **only** key, where that finding is not scoreable (pelvic_axial_rotation — 7 exercises) or the target muscle is deliberately unscored (standing-quad-stretch, seated-tibial-rotation, standing-calf-raise, wall-ankle-dorsiflexion-rock). They can never be selected into a program today (finding is sub-reliability-floor or muscle is unscored), so they are inert bank entries.

**Files:** the 7 pelvic_axial_rotation single-key files + up to 4 knee/genu single-key files; `lib/program/coherence.test.ts`; possibly `content/exercises/registry.ts`.

**Decision point (Devin, per-exercise or bulk):** For each orphan, choose:
- **(a) Assign a second, coherent finding key** where the exercise's target muscle IS scored (e.g. `pallof-press`/`side-plank`-family obliques → if a future scored trunk/anti-rotation finding exists). Only viable where such a finding exists — today it largely does not for the transverse-plane exercises.
- **(b) Mark `category: 'informational'`** — keeps the exercise in the library as reference content, excludes it from `candidatesFor` (the `category !== 'informational'` filter), and the coherence gate ignores informational pairs. This neutralizes the debt without deleting authored content. **Recommended default.**
- **(c) Remove from the bank** — delete file + registry entry. Cleanest but discards authored exercise copy.

- [ ] **Step 1: List the orphans and their target muscles** — `grep -A6 "primaryDeviationKeys" content/exercises/{band-lying-hip-internal-rotation,figure-four-stretch,half-kneeling-band-chop,open-book-stretch,pallof-press,standing-band-trunk-rotation,tall-kneeling-anti-rotation-hold,standing-quad-stretch,seated-tibial-rotation,standing-calf-raise}.ts`
- [ ] **Step 2: Apply the chosen disposition per exercise** (default (b): set `category: 'informational'`). If informational, verify the coherence test excludes informational pairs — if it does not, add that filter to `coherence.test.ts`'s pair enumeration (informational exercises are not prescriptive, so they carry no coherence obligation) and document it in `docs/coherence-debt.md`.
- [ ] **Step 3: Delete the corresponding `KNOWN_DEBT` entries** for every neutralized/removed orphan.
- [ ] **Step 4:** `npx vitest run` → PASS. The wall-ankle-dorsiflexion-rock genu pair (Task's genu category) resolves here too if made informational. Commit per disposition batch.

---

## Task 8 (Stage 2 — role contradiction): hamstrings / trunk_lean recode

**Files:** `content/muscles/hamstrings.ts`, the hamstring-strengthen exercises currently mapped to `trunk_lean`, `content/content.test.ts`, `docs/coherence-debt.md` (mark RESOLVED), migration `20260708030000_hamstring_trunk_lean_recode.sql`.

**Evidence (Q6):** Sway-back / posterior trunk-lean hamstrings are **short/overactive**, not weak ([PMC5836359] Kendall classification; [PMID 28744050] EMG). The current `weak` coding is inverted. Recode to `tight`. Consequence: hamstring-*strengthen* exercises mapped to trunk_lean become incoherent (strengthening a tight muscle) and must be re-homed or unmapped; hamstring-*stretch* exercises become coherent.

- [ ] **Step 1: Flip the role**

In `content/muscles/hamstrings.ts`, the `trunk_lean` link: `role: 'weak'` → `role: 'tight'`, keep `scored: true`, `confidence: 'low'`, and rewrite the citation to support short/overactive hamstrings in sway-back:

```ts
citation: 'Czaprowski 2018 Scoliosis Spinal Disord PMC5836359 (sway-back: hamstrings shortened); Tokunaga 2017 J Phys Ther Sci PMID 28744050',
```

- [ ] **Step 2: Find the dependent strengthen exercises**

Run: `grep -rln "hamstrings" content/exercises/ | xargs grep -l "trunk_lean"` then inspect each for `role: 'strengthen'` on hamstrings. For each hamstring-strengthen exercise that serves `trunk_lean`: it is now incoherent. Re-home (assign a finding where hamstring weakness is scored — e.g. `knee_extension_back_knee` retains hamstrings weak) or unmap `trunk_lean` if it serves another passing key. Follow the gate per exercise.

- [ ] **Step 3: Update `docs/coherence-debt.md`** — move the hamstrings/trunk_lean row from **OPEN** to **RESOLVED** with the recode rationale + citation.

- [ ] **Step 4: Bump pinned counts if role change alters sub-totals (tight vs weak counts), regenerate seed → `20260708030000_hamstring_trunk_lean_recode.sql`, apply locally, verify the row's role flipped.**

- [ ] **Step 5:** `npx vitest run` → PASS. Confirm the 2D/3D map now renders hamstrings as tight for trunk_lean (spot-check via a seeded assessment). Commit:

```bash
git commit -am "fix(content): recode hamstrings tight for trunk_lean (sway-back evidence PMC5836359); re-home strengthen exercises (resolve role contradiction)"
```

---

## Self-Review Notes

- **Coverage:** all 30 pairs mapped in the disposition table; Stage 1 (Tasks 1–3) clears 15 with no migration; Stage 2 (Tasks 4–6, 8) re-scores where evidence supports it; Stage 3 (Task 7) handles the inert single-key orphans. Every deletion from `KNOWN_DEBT` is gated by the ratchet.
- **The gate is the oracle:** several steps say "follow the gate" — because re-scoring can convert a pair from incoherent-for-reason-A to incoherent-for-reason-B (e.g. stretch-of-weak). Never delete a `KNOWN_DEBT` line the gate still reports as failing; if re-score doesn't fix it, fall back to unmap.
- **Count discipline:** every re-score MUST update `content/content.test.ts`'s pinned grade totals in the same commit, or the suite goes red.
- **Landing order:** Stage 1 tasks are independent and safe to land first (fast burn-down, no DB). Stage 2 tasks each carry a migration — land one per branch so a bad seed regen is easy to revert.
- **Non-goals:** this plan does not add new *findings* (e.g. an anterior-pelvic-tilt finding that would rehome several orphans) — that is a product-scope expansion tracked separately.
