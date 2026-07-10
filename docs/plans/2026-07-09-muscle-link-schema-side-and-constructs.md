# Muscle-link schema: add `side`, separate length / activation / force

**Status:** Proposed — not implemented. Raised out of the 2026-07-09 hamstrings citation fix.
**Scope:** `content/muscles/types.ts` (`muscleLinkSchema`), the KB seed generator, `muscle_imbalance_links`, and every consumer of `role`.

## Problem

`muscleLinkSchema` models a muscle's relationship to an imbalance as a single enum:

```ts
role: z.enum(['tight', 'weak'])   // content/muscles/types.ts:71
```

That one field is doing the work of **three independent constructs**, and it carries **no laterality**. Both gaps are already producing observable defects.

### 1. `role` conflates three things

| Construct | Question it answers | Example evidence |
|---|---|---|
| **Length** | Is the muscle short or elongated at rest / initial contact? | Zwick 2010: hamstrings *abnormally long* in recurvatum |
| **Activation** | Is it over- or under-recruited, and *when*? | Zwick 2010: *prolonged* stance + *early* swing EMG |
| **Force capacity** | Can it produce force? | (no study, for any knee link) |

These vary independently. A muscle can be long **and** hyperactive **and** strong. `tight | weak` cannot say that.

**Live consequence — `hamstrings × knee_extension_back_knee`:** coded `role: 'weak'`, `confidence: 'medium'`, `scored: true`. The only supporting citation (Zwick 2010, PMID 20308923) measures **length** (abnormally long) and **activation timing** (prolonged/early) in 35 children with spastic cerebral palsy. It measures force capacity in nobody, and says nothing about healthy adults. Prior to 2026-07-09 the citation asserted "elongated, functionally insufficient hamstrings" — "functionally insufficient" was our wording, not the authors'.

The `weak` coding survives today only as a mechanical inference. It cannot be *expressed* more precisely, because the schema has no field for "elongated, and normally or over-activated."

**Live consequence — `hamstrings × trunk_lean`:** coded `tight`. Czaprowski 2018 Table 8 classifies sway-back hamstrings as **shortened AND hyperactive** — two constructs, one slot. `tight` happens to be a reasonable projection of both onto one axis. That is luck, not modelling.

### 2. `role` has no `side`

`gluteus-medius × pelvic_obliquity` is the only muscle/imbalance pair in the KB carrying **both** roles (verified 2026-07-09: 1 of 46 links):

```
gluteus-medius | pelvic_obliquity -> tight/low  AND  weak/high
```

This is not a contradiction — it is two *sides* of one client. The glute-med is short on the elevated-hip side and long/underactive on the dropped-hip side (`docs/evidence/muscle-links/HANDOFF.md:52-53`). The schema cannot say "which side," so the KB encodes both and lets the consumer guess. `findingsToMuscleStates.ts:174` resolves the collision by picking a **winner by severity**, which silently discards the other side.

`pelvic_obliquity` is also an inherently **signed** deviation (left-high vs right-high). Nothing in the link model consumes that sign.

## Evidence of drift this has already caused

- `content/muscles/types.ts:90-91` claims the knee links were graded such that "only hamstrings→weak cleared the asymptomatic-population evidence bar."
- `docs/evidence/muscle-links/knee_extension.md:10` states the opposite, correctly: *"Direct EMG/kinematic studies in asymptomatic adults are absent for all four links."*
- Meanwhile `popliteus × knee_extension_back_knee` is demoted to `scored: false` on the strength of an **adult** EMG study (Mann & Hagy 1977), while `hamstrings` stays `scored: true` / `medium` on a **pediatric CP** study. By the project's own stated bar, that ordering is inverted.

The grading rubric collapsed because "evidence for *this link*" is ambiguous when the link itself names three constructs at once.

## Proposed model (sketch — needs design review)

Replace the single `role` with an explicit triple plus laterality. Strawman:

```ts
{
  imbalanceKey: 'knee_extension_back_knee',
  side: 'bilateral' | 'ipsilateral' | 'contralateral',  // relative to the deviation's sign
  deviationSubtype?: string,                            // e.g. 'left_high' | 'right_high'
  length:   { state: 'shortened' | 'elongated' | 'neutral', confidence, citation }  | null,
  activation: { state: 'over' | 'under' | 'mistimed' | 'neutral', confidence, citation } | null,
  force:    { state: 'reduced' | 'normal', confidence, citation } | null,
}
```

Each construct is independently graded and independently citable, so a link can honestly say *"elongated (medium, Zwick 2010); activation mistimed (medium, Zwick 2010); force capacity unknown (no evidence)"* — which is the true state of the hamstrings knee link.

**Non-goal:** changing any current clinical output. A first cut should derive a legacy `role` from the triple (`shortened|over → tight`, `elongated|under|reduced → weak`) so the muscle map, program builder, and seed keep behaving exactly as they do now.

## Blast radius

Consumers of `role` that must be migrated or shimmed:

- `scripts/generate-muscle-seed.ts:32,66` — seed generation
- `muscle_imbalance_links.role` column + `app/api/assessments/[id]/route.ts:80,85` (groups into `tight`/`weak` buckets)
- `app/assessments/[id]/findingsToMuscleStates.ts:107,152,174` — the severity-winner collision resolver
- `app/muscles/[slug]/page.tsx:64-65` — tight/weak sections
- `app/assessments/[id]/WhyThisSheet.tsx:81`
- `lib/program/buildProgram.ts` — `weak → strengthen`, `tight → stretch`
- `content/content.test.ts:62-110` — the grading assertions

`exercise_muscles.role` is a *different* enum (`stretch | strengthen`) and is out of scope.

## Migration strategy

Forward-only, per repo convention. The muscle seed and its migrations are auto-generated from `content/` by `scripts/generate-muscle-seed.ts` — regenerate, never hand-edit. Suggested phasing:

1. Add the new columns nullable alongside `role`; backfill by projecting existing `role` into the triple.
2. Dual-write from the generator; keep `role` as a generated column or derived value.
3. Migrate consumers one at a time behind the derived `role`.
4. Drop `role` only once `content.test.ts` asserts the triple directly.

## Open questions for Devin

1. Is `side` best modelled as a per-link enum, or does `pelvic_obliquity` want to split into two signed imbalance keys (mirroring `genu_varum_valgum_left` / `_right`, which already took that route)?
2. Should `force: { state: 'reduced' }` be assertable **at all** without a force measurement in the target population? If not, `hamstrings × knee_extension_back_knee` loses its only basis for `weak` and should become display-only, matching popliteus.
3. Does the possible-involvement tier need to distinguish "no evidence" from "evidence of normality"? Today both are just absence.
4. Does `types.ts:90-91` get corrected now, or as part of this change? It currently asserts an evidence bar the project's own evidence base says was never met.

## Provenance

Recommendation to split the constructs and add `side` originated with GPT-5.6 Sol. The hamstrings citation audit that exposed it (PMID 28744050 miscited as Tokunaga; PMID 20308923 overstated) was verified against PubMed/PMC primary sources on 2026-07-09 and fixed in the same branch as this plan — see `content/muscles/hamstrings.ts` and `docs/evidence/muscle-links/knee_extension.md`.
