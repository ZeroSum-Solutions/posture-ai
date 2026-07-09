# Pipeline Accuracy v2 — Plan 2 (Muscle Map + Exercises) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the muscle map and exercise program provably earn their claims — every imbalance→muscle link carries a graded, cited confidence that the UI and program ranking consume, and every prescribed exercise is machine-verified to target a muscle its finding actually implicates.

**Architecture:** Extends the approved spec (`docs/plans/2026-07-05-pipeline-accuracy-v2-design.md` §4–§5). Phase A grades all muscle links (evidence tier + citation), threads that grade through the DB reseed → API → 2D/3D map, and renders low-confidence muscles as "possible involvement." Phase B adds a CI coherence gate proving the finding→muscle→exercise chain holds for all pairs, ranks exercises by link evidence, screens for red flags before a session, and exposes a one-tap "why this" rationale.

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript / Zod content schemas / Supabase (Postgres, forward-only SQL migrations) / Vitest / Playwright e2e. Pure inline styles in assessment/workout components (no Tailwind there).

## Global Constraints

- **Screening vocabulary only.** No `diagnos*` / `treat*` / `cure*` / `patient*` / `prescri*` in any user-facing copy, content rationale, citation, or UI string. Enforced by `npm run lint:vocab` (Zod `screeningText` refinements + `lib/ui-vocabulary.test.ts`). Use "consider" not "treat", "movement / activity" not "exercise prescription", "reading" not "diagnosis".
- **Forward-only migrations.** Never edit an applied migration. New file per change, `YYYYMMDDHHMMSS_<name>.sql`, idempotent (`IF NOT EXISTS` / `ON CONFLICT`).
- **Local Supabase only.** Verify `NEXT_PUBLIC_SUPABASE_URL` points at `127.0.0.1` before any `db reset` / seed. Production project `dhrkezfypzutiwtmcmof` is untouchable in this plan.
- **Stored v1.3 assessments immutable.** Legacy imbalance keys (`t1_tilt_backward`, `anterior_pelvic_shift`) still resolve in display maps; do not remove them.
- **No new runtime deps.** Content and program logic stay pure TS.
- **Determinism preserved.** `selectPriorities` and `buildProgram` output must stay a pure function of inputs — any new tie-break is deterministic (no `Date.now()` / `Math.random()`).
- **Never commit to main directly.** One task = one branch + `~/bin/zs-land` (except where a task note says to share a branch). `git reset --hard` is blocked — use `git branch -f`.
- **e2e requires port :3100 free** (Playwright reuses an existing server there).

## Corrected baseline (reconcile spec §4 numbers before starting)

The spec §4 says "88 links, 61 ungraded." The registry as coded holds **42 links across 8 imbalance keys** — **27 already graded** (`confidence` present: 8 high / 13 medium / 6 low), **15 ungraded**, plus **3 display-only links** (`scored: false`, the knee-hyperextension trio) and `pelvic_axial_rotation` intentionally at **0 links**. This plan grades the **42** real links (39 scored + 3 display-only), not 88. The intent — every link graded with a rationale that names its citation — is unchanged. Counts below use the real numbers.

Per-key link counts (registry): `trunk_lean` 9, `anterior_imbalanced_shoulders` 8, `forward_head_posture` 6, `genu_varum_valgum_left` 4, `genu_varum_valgum_right` 4, `knee_extension_back_knee` 4 (1 scored + 3 display-only), `pelvic_obliquity` 4, `posterior_imbalanced_shoulders` 3, `pelvic_axial_rotation` 0.

Engine v2.0.0 emits 9 finding keys; `pelvic_axial_rotation` is emitted but confidence-gated and carries no links (map shows nothing for it — correct).

---

## File Structure

**Phase A (muscle map earns confidence):**
- `content/muscles/types.ts` — add `citation` field to `muscleLinkSchema`; update the confidence JSDoc.
- `content/muscles/<slug>.ts` (29 files) + `content/muscles/registry.ts` — fill `confidence` + `citation` on every link.
- `content/content.test.ts` — assert grading completeness.
- `scripts/generate-muscle-seed.ts` + new `supabase/migrations/*_muscle_kb_regrade_seed.sql` — populate `link_evidence` / `scored` / `exclusion_reason`.
- `app/assessments/[id]/findingsToMuscleStates.ts` + `.test.ts` — carry `confidence` into `MuscleStateInput`.
- `app/assessments/[id]/MuscleModel3D.tsx` — intensity = severity × evidence weight.
- `app/assessments/[id]/MuscleBodyMap.tsx` + `muscleMap.ts` — "possible involvement" tier + legend.

**Phase B (exercises earn their claim):**
- `lib/program/coherence.test.ts` (new) — finding→muscle→exercise gate over all pairs.
- `content/exercises/<slug>.ts` — fix any incoherent pairs the gate finds.
- `lib/program/buildProgram.ts` + `.test.ts` — evidence-aware candidate ranking.
- `lib/program/evidenceWeight.ts` (new) — shared high/medium/low → weight map.
- `supabase/migrations/*_session_runs_red_flag.sql` + `app/workouts/_player/WorkoutPlayer.tsx` + `app/api/workouts/route.ts` — red-flag pre-session screen.
- `app/assessments/[id]/WhyThisSheet.tsx` (new) + `PriorityProgram.tsx` — rationale UI.

---

## Task 1: Add `citation` field to the muscle-link schema

**Files:**
- Modify: `content/muscles/types.ts` (`muscleLinkSchema`, ~lines 69–103; JSDoc ~75–78)
- Test: `content/content.test.ts`

**Interfaces:**
- Consumes: existing `muscleLinkSchema` with `role`, `confidence` (optional `'high'|'medium'|'low'`), `scored` (optional bool), `rationale` (required 80–600 chars), `exclusionReason` (optional).
- Produces: `muscleLinkSchema` gains `citation: z.string().min(8).max(240)` (screening-gated), optional at the schema level. Grading completeness is enforced by the content test in Task 2, not by making the Zod field required (so partially-graded intermediate commits still parse).

- [ ] **Step 1: Write the failing test.** Append to `content/content.test.ts`:

```ts
describe('muscle link citation field', () => {
  it('citation, when present, passes screening vocabulary', () => {
    for (const link of ALL_MUSCLE_LINKS) {
      if (link.citation) {
        expect(() => muscleLinkSchema.parse(link)).not.toThrow()
        expect(link.citation).not.toMatch(/\b(diagnos|treat|cure|patient|prescri)/i)
      }
    }
  })

  it('schema accepts a citation field', () => {
    const sample = { imbalanceKey: 'trunk_lean', role: 'tight',
      confidence: 'medium', rationale: 'x'.repeat(90),
      citation: 'Kendall 2005, Muscles: Testing and Function (textbook inference).' }
    expect(() => muscleLinkSchema.parse(sample)).not.toThrow()
  })
})
```

(Use whatever `ALL_MUSCLE_LINKS` accessor `content.test.ts` already uses to enumerate links; if it iterates the registry, reuse that.)

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run content/content.test.ts -t "schema accepts a citation field"`
Expected: FAIL — Zod strips or rejects the unknown `citation` key.

- [ ] **Step 3: Add the field.** In `content/muscles/types.ts`, inside `muscleLinkSchema`, after the `rationale` field:

```ts
    /**
     * One-line source naming the evidence for this link's grade. A study
     * (author year, journal) for high/medium; the textbook basis
     * (e.g. "Kendall 2005 textbook inference") for low. Screening-gated.
     */
    citation: screeningText(z.string().min(8).max(240)).optional(),
```

Use the same `screeningText(...)` wrapper the `rationale` field uses (match its exact call form in this file).

- [ ] **Step 4: Update the confidence JSDoc** (~lines 75–78) to reflect that grading is now expected, not deferred:

```ts
    /**
     * Evidence tier for this link. Every scored link is graded (Plan 2 §4);
     * consumed by the map intensity, the possible-involvement tier, and
     * program ranking. high = consistent EMG/RCT/review support;
     * medium = plausible mechanism + partial/indirect evidence;
     * low = textbook inference without corroborating studies.
     */
    confidence: z.enum(['high', 'medium', 'low']).optional(),
```

- [ ] **Step 5: Run to verify pass.**

Run: `npx vitest run content/content.test.ts -t "citation"`
Expected: PASS (both new tests).

- [ ] **Step 6: Commit.**

```bash
git add content/muscles/types.ts content/content.test.ts
git commit -m "feat(content): add citation field to muscle-link schema"
```

---

## Task 2: Grade and cite every muscle link

**This is the research-heavy task. The controller drives a `research-literature` sweep per imbalance key and hands the implementer the verdicts; the implementer transcribes graded values into content and makes the completeness test green. Do not invent citations — every high/medium grade names a real study; low names the textbook basis.**

**Files:**
- Modify: `content/muscles/<slug>.ts` (every muscle file with links) and/or `content/muscles/registry.ts` (wherever link objects are literally defined — the implementer confirms which by reading `registry.ts`)
- Test: `content/content.test.ts`

**Interfaces:**
- Consumes: `citation` field (Task 1); the rubric high/medium/low (spec §4.1).
- Produces: every **scored** link (39) has `confidence` ∈ {high,medium,low} AND `citation`. The 3 **display-only** links (`scored: false`) keep their `exclusionReason` and also get `confidence` + `citation` (they still render in the possible-involvement/excluded legend). `pelvic_axial_rotation` has 0 links — nothing to grade.

- [ ] **Step 1: Write the failing completeness test.** Append to `content/content.test.ts`:

```ts
describe('muscle link grading completeness (Plan 2 §4)', () => {
  it('every link has a confidence tier and a citation', () => {
    const ungraded = ALL_MUSCLE_LINKS.filter(l => !l.confidence || !l.citation)
    expect(ungraded.map(l => `${l.imbalanceKey}/${l.role}`)).toEqual([])
  })

  it('grade distribution is recorded (guards accidental mass-regrade)', () => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const l of ALL_MUSCLE_LINKS) counts[l.confidence!]++
    expect(counts.high + counts.medium + counts.low).toBe(42)
  })
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run content/content.test.ts -t "grading completeness"`
Expected: FAIL — 15 ungraded links (missing confidence) + all 42 missing `citation`.

- [ ] **Step 3: Apply the graded verdicts.** The controller supplies, per link, a `{ confidence, citation }` verdict from the literature sweep (evidence files under `.superpowers/sdd/lit/`). For each link object, set `confidence` and add `citation`. Example (trunk_lean thoracic erector spinae, tight):

```ts
{ imbalanceKey: 'trunk_lean', role: 'tight',
  confidence: 'medium',
  citation: 'Roghani 2017 (Aging Clin Exp Res) — thoracic erector overactivity with kyphotic lean.',
  rationale: '<existing rationale unchanged>' },
```

Rules: keep every existing `rationale` and `scored`/`exclusionReason` byte-for-byte; only add `confidence` (if absent) and `citation`. Low-grade citation names the textbook basis, e.g. `'Kendall 2005, Muscles: Testing and Function — textbook inference, no corroborating study.'`

- [ ] **Step 4: Run completeness + full content suite.**

Run: `npm run lint:vocab`
Expected: PASS — all `content/` tests green, including both grading tests and the vocabulary refinements on the new citations.

- [ ] **Step 5: Commit.**

```bash
git add content/muscles/
git commit -m "feat(content): grade and cite all 42 muscle-imbalance links"
```

**Controller note:** dispatch one `research-literature` agent per imbalance key (8 keys) BEFORE the implementer, collect verdicts into a single handoff file, and pass that file to the implementer. Reject radiographic-only or non-transferable evidence (same transferability rule used in Plan 1 Task 11). A "no citable study" result → grade `low` with a textbook-inference citation; that is a valid outcome, not a failure.

---

## Task 3: Reseed the DB with evidence columns populated

**Files:**
- Modify: `scripts/generate-muscle-seed.ts`
- Create: `supabase/migrations/20260707000000_muscle_kb_regrade_seed.sql` (generated output)
- Test: manual verification via `psql` (no unit test — this is a data migration; the seeder's output is asserted by inspection)

**Interfaces:**
- Consumes: graded content (Task 2); table `muscle_imbalance_links` with columns `link_evidence TEXT CHECK IN ('high','medium','low')`, `scored BOOLEAN NOT NULL DEFAULT true`, `exclusion_reason TEXT` (added by `20260628010000`).
- Produces: a seed migration where every inserted link row carries `link_evidence` = its content `confidence`, `scored` = its content `scored` (default true), `exclusion_reason` = its content `exclusionReason`. **Display-only links (`scored:false`) are now INCLUDED** (the current generator skips them) so the possible-involvement/excluded tier has data.

- [ ] **Step 1: Read the current generator.** `scripts/generate-muscle-seed.ts` (confirmed against source) iterates `ALL_MUSCLES` and, in the links loop, **skips `l.scored === false`** (`continue`), then per link does `lines.push(`INSERT INTO muscle_imbalance_links (muscle_slug, imbalance_key, role, rationale_text) VALUES (...);`)`. It already has an escaping helper `const q = (s: string | null) => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`)` — REUSE `q`; do not add a new one. A `DELETE FROM muscle_imbalance_links;` precedes the loop (full refresh). NOTE: this generator also reseeds `muscles`, `exercises`, and `exercise_muscles` — regenerating produces a full-KB seed, which is fine (all upserts/refreshes are idempotent); the new migration is a whole-KB reseed, not links-only.

- [ ] **Step 2: Extend the links INSERT.** In the links loop only: (a) delete the `if (l.scored === false) continue` line so display-only links are emitted too, and (b) widen the INSERT to the seven columns. Replace the per-link `lines.push(...)` with:

```ts
lines.push(
  `INSERT INTO muscle_imbalance_links (muscle_slug, imbalance_key, role, rationale_text, link_evidence, scored, exclusion_reason) VALUES (` +
    [
      q(m.slug), q(l.imbalanceKey), q(l.role), q(l.rationale),
      q(l.confidence ?? null),
      l.scored === false ? 'false' : 'true',
      q(l.exclusionReason ?? null),
    ].join(', ') +
    `);`
)
```

`q` renders `NULL` for `null` and a single-quote-escaped literal otherwise; `?? null` coerces `undefined` → `null`. Update the code comment above the loop (currently says display-only links are "kept OUT of the scored seed") to reflect that they are now included with `scored=false`. Leave the `muscles`, `exercises`, and `exercise_muscles` sections untouched.

- [ ] **Step 3: Generate the migration.**

Run: `npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/20260707000000_muscle_kb_regrade_seed.sql`
Expected: a file whose INSERT lists 42 links (39 scored true + 3 scored false) with non-null `link_evidence` on every row.

- [ ] **Step 4: Verify locally.** Confirm local Supabase, then reset:

```bash
grep NEXT_PUBLIC_SUPABASE_URL .env.local   # must be 127.0.0.1
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "SELECT count(*) total, count(link_evidence) graded, count(*) FILTER (WHERE scored=false) display_only FROM muscle_imbalance_links;"
```

Expected: `total=42 graded=42 display_only=3`.

- [ ] **Step 5: Commit.**

```bash
git add scripts/generate-muscle-seed.ts supabase/migrations/20260707000000_muscle_kb_regrade_seed.sql
git commit -m "feat(db): reseed muscle links with evidence grades and display-only links"
```

---

## Task 4: Flow link confidence DB → API → type → 3D intensity

**This task owns the shared confidence pipeline that Task 5 also consumes.** Confidence originates in the DB (`muscle_imbalance_links.link_evidence`, populated by Task 3), must be carried onto the `MuscleLink` type and surfaced by the assessments API, then threaded through `findingsToMuscleStates` into the 3D viewer intensity.

**Files:**
- Modify: `app/assessments/[id]/muscleMap.ts` (the `MuscleLink` interface, line 21)
- Modify: `app/api/assessments/[id]/route.ts` (the muscle-links query ~line 60 and `linkMap` builder ~line 76–80)
- Modify: `app/assessments/[id]/findingsToMuscleStates.ts`
- Modify: `app/assessments/[id]/MuscleModel3D.tsx`
- Test: `app/assessments/[id]/findingsToMuscleStates.test.ts`

**Confirmed current state (against source):**
- `MuscleLink` (muscleMap.ts:21) is exactly `{ slug: string; name: string }` — no confidence.
- The API (`app/api/assessments/[id]/route.ts:60`) selects `'imbalance_key, role, muscle_slug, muscles(name)'` and the `linkMap` builder (76–80) pushes `{ slug, name }`. It does NOT read `link_evidence` or `scored`.
- **REGRESSION GUARD:** before Task 3, display-only (`scored:false`) links were absent from the DB, so the map never colored them. Task 3 now inserts them (`scored=false`). This API query returns ALL rows for the keys, so it MUST filter `scored === false` out of the colored `tight`/`weak` link lists to preserve current map behavior. Display-only links are for the future excluded-legend, not the colored map — keeping them out here is the correct, behavior-preserving choice (documented scope boundary; wiring the excluded legend is not in this plan).
- `findingsToMuscleStates` dedups per slug and picks ONE winning `Candidate` by severity (`bySlug` map → `best(role)` → winner). There is no field-merge; confidence must ride on `Candidate` and the state takes the MAX confidence across that slug's candidates.

**Interfaces:**
- Produces: `MuscleLink` gains `confidence?: 'high' | 'medium' | 'low'`. The API attaches `confidence` (from `link_evidence`) to each SCORED link and excludes `scored:false` links from `tight`/`weak`. `MuscleStateInput` gains `confidence?` = the highest-graded confidence among the slug's contributing links. `MuscleModel3D` maps it to highlight intensity.

- [ ] **Step 1: Extend the `MuscleLink` type + write the failing test.** In `app/assessments/[id]/muscleMap.ts:21`:

```ts
export interface MuscleLink {
  slug: string
  name: string
  confidence?: 'high' | 'medium' | 'low'
}
```

Then in `findingsToMuscleStates.test.ts` (construct the finding literal directly — the `AssessmentFinding` shape is `{ zone, severity_pct, imbalance_key?, tight_muscles?, weak_muscles?, tight_muscle_links?, weak_muscle_links? }`):

```ts
it('carries the max link confidence onto the muscle state', () => {
  const result = findingsToMuscleStates([
    { zone: 'danger', severity_pct: 80, imbalance_key: 'trunk_lean',
      tight_muscle_links: [
        { slug: 'iliopsoas', name: 'Iliopsoas', confidence: 'high' },
        { slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'low' },
      ], weak_muscle_links: [] },
  ])
  expect(result.states.find(s => s.slug === 'iliopsoas')?.confidence).toBe('high')
  expect(result.states.find(s => s.slug === 'latissimus-dorsi')?.confidence).toBe('low')
})

it('takes the highest confidence when a slug appears in two findings', () => {
  const result = findingsToMuscleStates([
    { zone: 'warning', severity_pct: 40, imbalance_key: 'a',
      tight_muscle_links: [{ slug: 'upper-trapezius', name: 'Upper Trapezius', confidence: 'low' }], weak_muscle_links: [] },
    { zone: 'danger', severity_pct: 80, imbalance_key: 'b',
      tight_muscle_links: [{ slug: 'upper-trapezius', name: 'Upper Trapezius', confidence: 'high' }], weak_muscle_links: [] },
  ])
  expect(result.states.find(s => s.slug === 'upper-trapezius')?.confidence).toBe('high')
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run "app/assessments/[id]/findingsToMuscleStates.test.ts" -t "confidence"`
Expected: FAIL — `confidence` is `undefined` on every state.

- [ ] **Step 3: Surface `link_evidence` + filter display-only in the API.** In `app/api/assessments/[id]/route.ts`:
  - Line ~60 select: add the two columns → `.select('imbalance_key, role, muscle_slug, link_evidence, scored, muscles(name)')`.
  - The `linkMap` builder (76–80): widen the row type to include `link_evidence` + `scored`, SKIP display-only rows, and attach confidence:

```ts
const linkMap: Record<string, { tight: MuscleLink[]; weak: MuscleLink[] }> = {}
for (const row of (linkRes.data ?? []) as unknown as {
  imbalance_key: string; role: 'tight' | 'weak'; muscle_slug: string
  link_evidence: 'high' | 'medium' | 'low' | null; scored: boolean; muscles: { name: string } | null
}[]) {
  if (row.scored === false) continue // display-only links stay off the colored map
  const entry = (linkMap[row.imbalance_key] ??= { tight: [], weak: [] })
  entry[row.role].push({ slug: row.muscle_slug, name: row.muscles?.name ?? row.muscle_slug, confidence: row.link_evidence ?? undefined })
}
```

  Import `MuscleLink` into this route (from the `muscleMap` module — match the file's existing relative-path convention; or mirror the inline shape if that reads cleaner). Keep everything else in the route unchanged.

- [ ] **Step 4: Thread confidence through `findingsToMuscleStates`.**
  - Add `confidence?: 'high' | 'medium' | 'low'` to the `MuscleStateInput` interface (line ~15).
  - Add `confidence?: 'high' | 'medium' | 'low'` to the `Candidate` interface (line ~84).
  - In the link → candidate push (line ~105), add `confidence: l.confidence`.
  - Add a rank helper near the top and, in the per-slug loop where `states.push(...)` happens (line ~163), compute the max confidence across the slug's group:

```ts
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const
const higherConf = (a?: 'high'|'medium'|'low', b?: 'high'|'medium'|'low') =>
  !a ? b : !b ? a : (CONF_RANK[a] >= CONF_RANK[b] ? a : b)
// ...in the loop, after `group` is known:
const maxConf = group.reduce<'high'|'medium'|'low'|undefined>((acc, c) => higherConf(acc, c.confidence), undefined)
states.push({ slug, role: winner.role, severity: winner.severity, confidence: maxConf })
```

  The legacy-names path (`f.tight_muscles` strings) has no confidence — those candidates get `confidence: undefined`, which is correct.

- [ ] **Step 5: Consume in `MuscleModel3D`.** Where states are mapped to the viewer payload, compute intensity = `clamp01(severity/100) × EVIDENCE_WEIGHT`, where `EVIDENCE_WEIGHT = { high: 1.0, medium: 0.7, low: 0.4 }[confidence] ?? 0.7` (ungraded → 0.7 so nothing disappears). Add an `intensity` field to each state the viewer receives; the viewer ignores unknown fields, so this is additive. Inline the 3-value weight map here — do NOT import from `lib/program/evidenceWeight` (that file is created later in Task 7 for a different layer; the tiny duplication keeps task order independent and is fine per DRY's "extract on the second real need").

- [ ] **Step 6: Run tests + typecheck.**

Run: `npx vitest run "app/assessments/[id]/findingsToMuscleStates.test.ts"` then `npm run typecheck`
Expected: PASS (both new confidence tests) and typecheck clean.

- [ ] **Step 7: Commit.**

```bash
git add "app/assessments/[id]/muscleMap.ts" "app/api/assessments/[id]/route.ts" "app/assessments/[id]/findingsToMuscleStates.ts" "app/assessments/[id]/findingsToMuscleStates.test.ts" "app/assessments/[id]/MuscleModel3D.tsx"
git commit -m "feat(map): flow link evidence DB→API→3D intensity"
```

---

## Task 5: "Possible involvement" tier on the 2D body map

**Approved design decision (2026-07-04):** the 2D map is flipped to **links-first** so it reads the confidence-carrying graded links (the KB is now seeded — the condition the legacy fallback was waiting for). This unifies it with the 3D map, which is already links-first (`findingsToMuscleStates`). A **divergence report** on seeded QA data makes any change to existing assessments' rendered muscles visible.

**Files:**
- Modify: `app/assessments/[id]/muscleMap.ts` (`ResolvedMarker` + `ResolvedMarkers` types, `regionsFromLinks`, `regionsForRole`, `resolveMarkerRegions`)
- Modify: `app/assessments/[id]/MuscleBodyMap.tsx`
- Test: `app/assessments/[id]/muscleCoverage.test.ts`

**Confirmed current state (against source):**
- `MarkerInput = { tightMuscles: string[]; weakMuscles: string[]; tightLinks?: MuscleLink[]; weakLinks?: MuscleLink[] }`. `MuscleLink = { slug, name, confidence? }` (confidence added by Task 4). `ResolvedMarker = { source: string; region: MuscleRegion }`. `ResolvedMarkers = { frontTight, frontWeak, backTight, backWeak, hasAny }`.
- `regionsForRole(names, links)` is currently **legacy-first**: `names.length > 0 ? regionsFromLegacy(names) : regionsFromLinks(links)`. In prod `tightMuscles`/`weakMuscles` are always non-empty (from `imbalance_definitions`), so the link branch (and its confidence) is inert. THIS is why possible-involvement can't render today — the flip below fixes it.
- `regionsFromLinks` currently drops confidence (`{ source: l.slug, region: getMuscleRegionBySlug(l.slug) }`).

**Interfaces:**
- Produces: `ResolvedMarker` gains `confidence?: 'high'|'medium'|'low'`. `ResolvedMarkers` gains `frontPossible` + `backPossible`. `regionsForRole` becomes links-first. A marker with `confidence === 'low'` (from either role) is routed to `*Possible` and NOT drawn as tight/weak; high/medium/undefined stay in their role bucket.

- [ ] **Step 1: Extend the types + write the failing tests.** In `muscleMap.ts`, add `confidence?: 'high' | 'medium' | 'low'` to `ResolvedMarker` (line ~33) and add `frontPossible: ResolvedMarker[]` + `backPossible: ResolvedMarker[]` to `ResolvedMarkers` (line ~38). Then add these tests to `muscleCoverage.test.ts` (import `resolveMarkerRegions` from `./muscleMap`):

```ts
it('is links-first: uses graded links over legacy name strings when links present', () => {
  const r = resolveMarkerRegions({
    tightMuscles: ['suboccipitals'],       // legacy name (would render if legacy-first)
    weakMuscles: [],
    tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'high' }],
    weakLinks: [],
  })
  const sources = [...r.frontTight, ...r.backTight].map(m => m.source)
  expect(sources).toContain('latissimus-dorsi')   // link won
  expect(sources).not.toContain('suboccipitals')  // legacy ignored
})

it('routes low-confidence links to possible-involvement, not tight/weak', () => {
  const r = resolveMarkerRegions({
    tightMuscles: [], weakMuscles: [],
    tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'low' }],
    weakLinks: [],
  })
  expect([...r.frontPossible, ...r.backPossible].map(m => m.source)).toContain('latissimus-dorsi')
  expect([...r.frontTight, ...r.backTight]).toHaveLength(0)
})

it('keeps high/medium links in their role bucket', () => {
  const r = resolveMarkerRegions({
    tightMuscles: [], weakMuscles: [],
    tightLinks: [{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'high' }],
    weakLinks: [],
  })
  expect([...r.frontTight, ...r.backTight].map(m => m.source)).toContain('latissimus-dorsi')
  expect([...r.frontPossible, ...r.backPossible]).toHaveLength(0)
})
```

- [ ] **Step 2: Run to verify they fail.**

Run: `npx vitest run "app/assessments/[id]/muscleCoverage.test.ts" -t "links-first"`
Expected: FAIL — legacy-first still wins (`suboccipitals` present), and `frontPossible`/`backPossible` are undefined.

- [ ] **Step 3: Flip to links-first + carry confidence + split low.** In `muscleMap.ts`:

```ts
function regionsFromLinks(links: MuscleLink[]): ResolvedMarker[] {
  return links
    .map((l) => ({ source: l.slug, region: getMuscleRegionBySlug(l.slug), confidence: l.confidence }))
    .filter((x): x is ResolvedMarker => x.region !== null)
}

// Links-first: the graded knowledge base is the source of truth now that it is
// seeded; legacy name arrays are the fallback for rows with no links.
function regionsForRole(names: string[], links: MuscleLink[]): ResolvedMarker[] {
  return links.length > 0 ? regionsFromLinks(links) : regionsFromLegacy(names)
}

export function resolveMarkerRegions(input: MarkerInput): ResolvedMarkers {
  const tight = regionsForRole(input.tightMuscles, input.tightLinks ?? [])
  const weak = regionsForRole(input.weakMuscles, input.weakLinks ?? [])
  const isLow = (m: ResolvedMarker) => m.confidence === 'low'
  const possible = [...tight.filter(isLow), ...weak.filter(isLow)]
  const shownTight = tight.filter((m) => !isLow(m))
  const shownWeak = weak.filter((m) => !isLow(m))
  const front = (a: ResolvedMarker[]) => a.filter((r) => r.region.view === 'front')
  const back = (a: ResolvedMarker[]) => a.filter((r) => r.region.view === 'back')
  const frontTight = front(shownTight), backTight = back(shownTight)
  const frontWeak = front(shownWeak), backWeak = back(shownWeak)
  const frontPossible = front(possible), backPossible = back(possible)
  return {
    frontTight, frontWeak, backTight, backWeak, frontPossible, backPossible,
    hasAny: frontTight.length > 0 || frontWeak.length > 0 || backTight.length > 0 ||
            backWeak.length > 0 || frontPossible.length > 0 || backPossible.length > 0,
  }
}
```

(`regionsFromLegacy` is unchanged — its markers carry no confidence, so they never route to possible.)

- [ ] **Step 4: Render the possible tier + legend in `MuscleBodyMap`.** After the existing tight/weak ellipse groups, add the possible group — a neutral dashed gray so it reads "unconfirmed" (do not invent a hue):

```tsx
{[...regions.frontPossible, ...regions.backPossible].map((r, i) => (
  <ellipse key={`p${i}`} cx={r.region.cx} cy={r.region.cy} rx={r.region.rx} ry={r.region.ry}
    fill="#71717A22" stroke="#A1A1AA" strokeWidth={1} strokeDasharray="3,3" />
))}
```

Add a small legend entry near the map: a dashed gray swatch labeled **"Possible involvement"** (screening-safe copy). If `MuscleBodyMap` has no legend today, add a compact one covering tight / weak / possible.

- [ ] **Step 5: Divergence report (the safety net for the flip).** The flip changes which muscles the 2D map draws for EXISTING assessments (graded-link coverage vs legacy name-string coverage). Write a throwaway `vite-node` scratch script (do NOT commit it) that, for each of the 8 imbalance keys, builds a `MarkerInput` from the seeded QA data both ways — legacy-first (old) vs links-first (new) — and prints the per-key symmetric difference of rendered muscle slugs. Paste that diff table into the task report. This makes the blast radius visible per the approved decision. If any key loses a clinically-important muscle from the render, note it as a concern for controller review (do not silently ship it).

- [ ] **Step 6: Run tests + vocab + typecheck.**

Run: `npx vitest run "app/assessments/[id]"` then `npm run lint:vocab` then `npm run typecheck`
Expected: PASS all (the 3 new tests + existing `muscleCoverage`/`findingsToMuscleStates` still green — note `findingsToMuscleStates` is already links-first, so it should be unaffected).

- [ ] **Step 7: Commit.**

```bash
git add "app/assessments/[id]/MuscleBodyMap.tsx" "app/assessments/[id]/muscleMap.ts" "app/assessments/[id]/muscleCoverage.test.ts"
git commit -m "feat(map): links-first 2D map with possible-involvement tier"
```

**Controller note:** `MuscleLink.confidence` is already populated end-to-end by Task 4 (type + API). This task only consumes it. The links-first flip is the approved design decision — the divergence report (Step 5) is mandatory and goes to the controller for the merge decision.

---

## Task 6: Coherence gate — finding → muscle → exercise (CI test)

**Files:**
- Create: `lib/program/coherence.test.ts`
- Modify: `content/exercises/<slug>.ts` (only the pairs the gate fails on)

**Interfaces:**
- Consumes: `ALL_EXERCISES` (73 entries; each `{ slug, category, primaryDeviationKeys, muscles: [{ muscleSlug, role: 'stretch'|'strengthen' }] }`); the scored muscle-link set per imbalance key (tight slugs / weak slugs) from the registry.
- Produces: a passing CI test asserting every (exercise, primaryDeviationKey) pair is coherent. No production code — this locks the content invariant forever.

**Gate rule (spec §5.1):** for each exercise and each `key` in its `primaryDeviationKeys`:
- `category === 'stretch'` → exercise must have ≥1 `muscles[].role==='stretch'` whose `muscleSlug` is in `key`'s **tight** scored set.
- `category === 'strengthen'` or `'activation'` → ≥1 `muscles[].role==='strengthen'` in `key`'s **weak** scored set.
- `category === 'mobility'` → ≥1 targeted muscle in **either** set.
- `category === 'informational'` → exempt (no muscle claim).

**Accessor note (confirmed against source):** there is NO pre-built links-by-key export. `ALL_MUSCLES` and `ALL_EXERCISES` both come from `content/index` (relative `../../content` from `lib/program/`). A link object does NOT carry its own `muscleSlug` — the slug lives on the parent `MuscleContent.slug`. Build the per-key tight/weak sets by iterating `ALL_MUSCLES` and reading each muscle's `.links`. Exercise targets are `ex.muscles: { muscleSlug, role: 'stretch'|'strengthen', progressionLevel }[]`.

- [ ] **Step 1: Write the gate test.**

```ts
import { describe, it, expect } from 'vitest'
import { ALL_EXERCISES, ALL_MUSCLES } from '../../content'

// Scored tight/weak muscle slugs for an imbalance key, derived from the graded
// links on each muscle (the link's muscle is its parent MuscleContent.slug).
function scoredSets(key: string) {
  const tight = new Set<string>()
  const weak = new Set<string>()
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.imbalanceKey !== key || l.scored === false) continue
      if (l.role === 'tight') tight.add(m.slug)
      else if (l.role === 'weak') weak.add(m.slug)
    }
  }
  return { tight, weak }
}

describe('exercise coherence gate (Plan 2 §5.1)', () => {
  const failures: string[] = []
  for (const ex of ALL_EXERCISES) {
    if (ex.category === 'informational') continue
    for (const key of ex.primaryDeviationKeys) {
      const { tight, weak } = scoredSets(key)
      const targets = ex.muscles ?? []
      const hitsTight = targets.some(m => m.role === 'stretch' && tight.has(m.muscleSlug))
      const hitsWeak = targets.some(m => m.role === 'strengthen' && weak.has(m.muscleSlug))
      let ok = false
      if (ex.category === 'stretch') ok = hitsTight
      else if (ex.category === 'strengthen' || ex.category === 'activation') ok = hitsWeak
      else if (ex.category === 'mobility')
        ok = targets.some(m => tight.has(m.muscleSlug) || weak.has(m.muscleSlug))
      if (!ok) failures.push(`${ex.slug} [${ex.category}] × ${key}`)
    }
  }

  it('every exercise targets a coherent muscle for each of its findings', () => {
    expect(failures).toEqual([])
  })
})
```

(Confirm the real registry accessor name — `MUSCLE_LINKS_BY_KEY` is illustrative; read `registry.ts` and use what exists, or derive the grouping inline from the flat link list.)

- [ ] **Step 2: Run to see real failures.**

Run: `npx vitest run lib/program/coherence.test.ts`
Expected: FAIL listing the incoherent pairs (unknown count until run — this is the gate's whole point).

- [ ] **Step 3: Fix failing content pairs.** For each listed pair, either the exercise targets the wrong-role muscle or is mapped to a `primaryDeviationKey` it doesn't serve. Fix in `content/exercises/<slug>.ts` — correct the `muscles[].role`/`muscleSlug` or remove the wrong `primaryDeviationKeys` entry. Do NOT weaken the gate to pass. If a pair is genuinely correct but the link set lacks the muscle, that is a Task-2 grading gap — surface to the controller, don't paper over it.

- [ ] **Step 4: Run gate + full content suite.**

Run: `npx vitest run lib/program/coherence.test.ts && npm run lint:vocab`
Expected: PASS (`failures` empty) and content green.

- [ ] **Step 5: Commit.**

```bash
git add lib/program/coherence.test.ts content/exercises/
git commit -m "test(program): add finding→muscle→exercise coherence gate; fix incoherent pairs"
```

---

## Task 7: Evidence-aware exercise ranking

**Files:**
- Create: `lib/program/evidenceWeight.ts`
- Modify: `lib/program/buildProgram.ts`
- Test: `lib/program/buildProgram.test.ts`

**Interfaces:**
- Consumes: `buildProgram(...)` candidate selection (zone gate `candidatesFor`, capability ladder `applyCapability`, category caps `{ mobility:1, stretch:3, activation:1, strengthen:2 }`); per-exercise target muscles; the scored link set per key with `confidence`.
- Produces: `evidenceWeight(confidence): number` = `{ high: 1.0, medium: 0.7, low: 0.4 }[c] ?? 0.7`; and a deterministic tie-break in candidate ranking so that, all else equal, a candidate whose targeted muscles carry higher-evidence links for the active finding is chosen before a lower-evidence candidate. **Zone gate, category caps, capability dial, and existing primary ordering are unchanged** — this is strictly a tie-break appended after them and before cap truncation.

- [ ] **Step 1: Create the weight helper.** `lib/program/evidenceWeight.ts`:

```ts
export type LinkEvidence = 'high' | 'medium' | 'low'
const WEIGHT: Record<LinkEvidence, number> = { high: 1.0, medium: 0.7, low: 0.4 }
/** Evidence weight for a link grade; ungraded defaults to medium-equivalent. */
export function evidenceWeight(confidence?: LinkEvidence): number {
  return confidence ? WEIGHT[confidence] : 0.7
}
/** Max evidence an exercise carries for a finding: the best-graded link among
 * the finding's muscles that the exercise targets. 0 if it targets none. */
export function exerciseEvidenceForKey(
  targetSlugs: string[],
  keyLinks: Array<{ muscleSlug: string; confidence?: LinkEvidence }>,
): number {
  let best = 0
  for (const l of keyLinks) {
    if (targetSlugs.includes(l.muscleSlug)) best = Math.max(best, evidenceWeight(l.confidence))
  }
  return best
}
```

**API-shape note (confirmed against source):** `buildProgram` returns a `ProgramReport`, NOT a `{ items }` object. Selected exercises live at `report.priorities[i].steps[j]` with `.slug` and `.baseSlug` (baseSlug = the auto-selected slug pre-swap — the selection key). The finding→program entry point tests use is `buildProgramFrom(findings: Finding[], overallGrade: string, overrides?)`. The category-cap truncation happens in `buildSteps` (buildProgram.ts:153–166): candidates are `applyCapability`-collapsed to one exercise per `(category, primaryMuscle)`, then `core.sort` orders by `CATEGORY_ORDER` then `slug.localeCompare`, then the cap loop keeps the first `CATEGORY_CAP[category]` per category. The evidence tie-break goes INTO that `core.sort`, between the category-order key and the slug key.

- [ ] **Step 2: Write the failing helper test (always meaningful).** In `buildProgram.test.ts`, test the pure helper directly — this fires regardless of whether current content has a cap-collision:

```ts
import { exerciseEvidenceForKey, evidenceWeight } from './evidenceWeight'

it('exerciseEvidenceForKey returns the best-graded targeted muscle', () => {
  const keyLinks = [
    { muscleSlug: 'pectoralis-minor', confidence: 'high' as const },
    { muscleSlug: 'anterior-deltoid', confidence: 'low' as const },
  ]
  expect(exerciseEvidenceForKey(['pectoralis-minor'], keyLinks)).toBe(1.0)
  expect(exerciseEvidenceForKey(['anterior-deltoid'], keyLinks)).toBe(0.4)
  expect(exerciseEvidenceForKey(['unrelated'], keyLinks)).toBe(0)
  expect(evidenceWeight(undefined)).toBe(0.7) // ungraded → medium-equivalent
})
```

- [ ] **Step 3: Run to verify it fails.**

Run: `npx vitest run lib/program/buildProgram.test.ts -t "best-graded targeted muscle"`
Expected: FAIL — `./evidenceWeight` and its exports do not exist yet.

- [ ] **Step 4: Insert the tie-break in `buildSteps`.** In `buildProgram.ts`:
  1. Add imports: `import { exerciseEvidenceForKey, type LinkEvidence } from './evidenceWeight'` and add `ALL_MUSCLES` to the existing `import { ALL_EXERCISES } from '../../content'` line.
  2. Add a module-level helper (near `candidatesFor`) that gathers the scored `{ muscleSlug, confidence }` links for a set of imbalance keys, deriving each link's slug from its parent muscle:

```ts
function linksForKeys(keys: string[]): Array<{ muscleSlug: string; confidence?: LinkEvidence }> {
  const out: Array<{ muscleSlug: string; confidence?: LinkEvidence }> = []
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.scored === false || !keys.includes(l.imbalanceKey)) continue
      out.push({ muscleSlug: m.slug, confidence: l.confidence })
    }
  }
  return out
}
```

  3. In `buildSteps`, compute `const keyLinks = linksForKeys(priority.keys)` once (before the `core.sort`), then extend the existing `core.sort` (buildProgram.ts:153–158) with the evidence key between the category key and the slug key:

```ts
  core.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9
    const cb = CATEGORY_ORDER[b.category] ?? 9
    if (ca !== cb) return ca - cb
    const ea = exerciseEvidenceForKey(a.muscles.map((m) => m.muscleSlug), keyLinks)
    const eb = exerciseEvidenceForKey(b.muscles.map((m) => m.muscleSlug), keyLinks)
    if (ea !== eb) return eb - ea // higher link evidence survives the category cap first
    return a.slug.localeCompare(b.slug) // deterministic fallback unchanged
  })
```

  Do NOT touch `candidatesFor`, `applyCapability`, `CATEGORY_CAP`, or the cap loop.

- [ ] **Step 4b: Report the real-content effect.** After the tie-break lands, determine whether it actually changes any current program output — i.e. does any `(key, category)` have more `applyCapability`-distinct candidates than its cap, decided by differing evidence? Add a temporary `console.log` or a scratch assertion over `buildProgramFrom` for each engine finding key, and record in the report: (a) whether output changed for any key, and (b) if yes, add a permanent integration assertion pinning that program's ordering; if no, note that the tie-break is correct-but-latent (fires once content grows) — that is an acceptable, honest outcome, not a failure. Do NOT fabricate a fixture that forces a collision the content doesn't have.

- [ ] **Step 5: Run builder tests.**

Run: `npx vitest run lib/program/buildProgram.test.ts lib/program/selectPriorities.test.ts`
Expected: PASS — the helper test plus all existing determinism/cap tests still green (determinism preserved: the tie-break is total, slug remains the final fallback).

- [ ] **Step 6: Commit.**

```bash
git add lib/program/evidenceWeight.ts lib/program/buildProgram.ts lib/program/buildProgram.test.ts
git commit -m "feat(program): rank exercises by muscle-link evidence within category"
```

---

## Task 8: Red-flag pre-session screen

**Files:**
- Create: `supabase/migrations/20260707010000_session_runs_red_flag.sql`
- Modify: `app/workouts/_player/WorkoutPlayer.tsx`
- Modify: `app/api/workouts/route.ts`
- Test: e2e `tests/e2e/workout.spec.ts` (or the existing workout spec) + a component-level unit test if the player has one

**Interfaces:**
- Consumes: `WorkoutPlayer` state machine (`phase: 'idle' | 'intro' | ...`; `StartCard` renders at idle/intro; `begin()` dispatches `START` then `ADVANCE`); `session_runs` insert at `app/api/workouts/route.ts` (~line 117).
- Produces: a nullable `red_flag_acknowledged BOOLEAN` column on `session_runs`; a one-question screen shown before `begin()` can proceed; the answer recorded on the run row at mint or via the run PATCH.

**Copy (screening vocabulary — exact):** Question: *"Before you start — are you feeling any sharp or worsening pain right now?"* Options: *"No, I feel okay"* (proceeds) / *"Yes"* → a calm stop card: *"Let's pause here. Sharp pain is worth checking with a movement professional before continuing."* with a single dismiss that ends the session politely. No `diagnos*`/`treat*`/etc.

- [ ] **Step 1: Migration.** `20260707010000_session_runs_red_flag.sql`:

```sql
-- Plan 2 §5.4: record the pre-session red-flag acknowledgement on the run.
-- Nullable; existing/older runs stay NULL (screen not shown = no record).
ALTER TABLE session_runs
  ADD COLUMN IF NOT EXISTS red_flag_acknowledged BOOLEAN;
```

- [ ] **Step 2: Verify migration locally.**

Run: `grep NEXT_PUBLIC_SUPABASE_URL .env.local` (127.0.0.1) then `npx supabase db reset`
Then: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d session_runs" | grep red_flag`
Expected: `red_flag_acknowledged | boolean`.

- [ ] **Step 3: Add the gate to `WorkoutPlayer`.** Add local state `redFlag: 'unasked' | 'clear' | 'stopped'` (default `'unasked'`). While `phase` is idle/intro AND `redFlag === 'unasked'`, render the question card instead of `StartCard`'s begin button (or before it). "No" → `setRedFlag('clear')` (then the normal StartCard/begin path is available). "Yes" → `setRedFlag('stopped')` and render the stop card; dismiss navigates away / ends. `begin()` is unreachable until `redFlag === 'clear'`.

- [ ] **Step 4: Record the answer.** When `begin()` runs after a clear, include `red_flag_acknowledged: true` in the run creation payload (extend the POST body consumed at `app/api/workouts/route.ts` line ~117 insert) — or PATCH the run via the existing run route. A "stopped" session creates no run (nothing to record) — acceptable; the screen's purpose is the safety pause, not analytics.

- [ ] **Step 5: e2e.** Add/extend a Playwright test: load a session page, assert the red-flag question renders before the player controls, click "No, I feel okay", assert the session begins; in a second flow click "Yes", assert the stop card and that no player timeline appears.

Run: `PORT=3100` free, then `npx playwright test tests/e2e/workout.spec.ts`
Expected: PASS (both flows). Note any pre-existing unrelated flake.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/20260707010000_session_runs_red_flag.sql "app/workouts/_player/WorkoutPlayer.tsx" app/api/workouts/route.ts tests/e2e/workout.spec.ts
git commit -m "feat(workout): red-flag pre-session screen with run acknowledgement"
```

---

## Task 9: "Why this" rationale sheet

**Files:**
- Create: `app/assessments/[id]/WhyThisSheet.tsx`
- Modify: `app/assessments/[id]/PriorityProgram.tsx`
- Test: `app/assessments/[id]/PriorityProgram.test.tsx` (or a new `WhyThisSheet.test.tsx`)

**Interfaces:**
- Consumes: the `ExerciseDetailSheet` dialog pattern (fixed backdrop `inset:0 z-index:120`, bottom panel `role="dialog" aria-modal maxHeight:85vh`, ESC listener); `PriorityProgram`'s per-exercise row + its `onOpenDetail(slug, name)` wiring (button at ~line 143); each program item's `slug`, `primaryDeviationKey`/finding, and its targeted muscles with `confidence`.
- Produces: `WhyThisSheet({ open, onClose, exercise, finding, muscles })` rendering the chain **finding → implicated muscle(s) with evidence grade → what this movement does for it**; opened by a "Why this?" affordance on each exercise row.

- [ ] **Step 1: Write the failing test.**

```ts
it('renders the finding→muscle→movement chain with evidence grades', () => {
  render(<WhyThisSheet open exercise={sampleExercise} finding={sampleFinding}
    muscles={[{ slug: 'latissimus-dorsi', role: 'tight', confidence: 'medium' }]} onClose={()=>{}} />)
  expect(screen.getByText(/trunk lean/i)).toBeInTheDocument()
  expect(screen.getByText(/latissimus/i)).toBeInTheDocument()
  expect(screen.getByText(/moderate|medium/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run app/assessments/[id] -t "finding.*muscle.*movement"`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Build `WhyThisSheet`.** Reuse the `ExerciseDetailSheet` structure (copy its backdrop + panel + ESC handling; do not import its body). Render three labeled blocks: the finding name; a list of implicated muscles each with a plain-language evidence badge (`high→"Well supported"`, `medium→"Moderately supported"`, `low→"Possible / textbook-based"`); and the exercise's role sentence ("This movement lengthens / strengthens …"). Screening vocabulary only.

- [ ] **Step 4: Wire the affordance in `PriorityProgram`.** Add a small "Why this?" text button on each exercise row (near the existing detail button ~line 143) that sets `whyThis: { slug }` state and renders `<WhyThisSheet .../>` (mirror how `ExerciseDetailSheet` is conditionally rendered at ~line 442). Provide it the item's finding + resolved muscles+confidence.

- [ ] **Step 5: Run tests + vocab + typecheck.**

Run: `npx vitest run app/assessments/[id] && npm run lint:vocab && npm run typecheck`
Expected: PASS all.

- [ ] **Step 6: Commit.**

```bash
git add "app/assessments/[id]/WhyThisSheet.tsx" "app/assessments/[id]/PriorityProgram.tsx" "app/assessments/[id]/WhyThisSheet.test.tsx"
git commit -m "feat(program): add why-this rationale sheet with evidence grades"
```

---

## Acceptance (spec §6)

| Stage | Done when |
|---|---|
| §4 Muscles | 42/42 links graded with rationale + citation (Task 2); DB reseed carries `link_evidence`/`scored`/`exclusion_reason` (Task 3); 3D intensity + 2D possible-involvement consume confidence (Tasks 4–5) |
| §5 Exercises | coherence gate green over all pairs, content fixed (Task 6); evidence-aware ranking deterministic (Task 7); red-flag screen records on run (Task 8); why-this rationale UI (Task 9) |

Full-suite gate before final review: `npm run lint && npm run typecheck && npm run lint:vocab && npx vitest run && npm test -w @posture-ai/engine && npm run golden && npm run build`, plus workout e2e on :3100.

## Self-review notes (author)

- **Spec coverage:** §4.1 grading → T1–T2; §4.1 DB mirror → T3; §4.2 intensity → T4; §4.2 possible-involvement → T5; §4.2 `findingsToMuscleStates` carries confidence → T4; §4.3 binary coding unchanged (no task — correctly untouched). §5.1 coherence gate → T6; §5.2 evidence ranking → T7; §5.3 dosage severity-blind (no task — explicitly unchanged, documented in T7 note that caps/dial are untouched); §5.4 red-flag → T8; §5.5 why-this → T9.
- **Number correction:** 42 links not 88; 15 ungraded not 61 — reconciled at the top. Flag to human before execution.
- **Cross-task seam:** T5 depends on the page API surfacing `link_evidence` as `confidence` — called out in T5 controller note as the one seam to verify.
- **Determinism:** T7 tie-break is appended after existing keys and before the slug tiebreak — order stays total and pure.
