# Evidence base

**Status:** Reference record. AI-assisted literature reviews — **not** clinical sign-off.

This directory holds the source evidence behind two sets of clinical judgments that reach
users. It exists so a grading can be traced back to the study that justifies it, and so a
reviewer can tell an evidence-backed transcription apart from an unsupported assertion.

Until 2026-07-09 these files lived only in `.superpowers/sdd/lit/` and
`.superpowers/sdd/lit-p2/`, which are gitignored scratch. They were therefore present on
exactly one machine, with no history and no backup, while the TypeScript derived from them
was tracked — which made the content *look* auditable when its basis was not. The local
copies are retained (task briefs still reference those paths); the copies here are canonical.

## What maps to what

| Directory | Backs | Consumed by |
|---|---|---|
| `thresholds/` | Per-metric warn/danger cut-points in degrees, and whether a published value exists at all | `packages/posture-engine/src/thresholds.ts` (`source: 'literature' \| 'engineering'`) |
| `muscle-links/` | Confidence tier + citation for each muscle↔imbalance link | `content/muscles/<slug>.ts` (`confidence`, `citation`) |

`muscle-links/HANDOFF.md` is the adjudicated verdict sheet for all 42 links —
**16 high / 15 medium / 11 low** — and is the sheet that was transcribed into the muscle KB.
The per-key files beside it hold the full working notes for each finding.

Across all 12 files: **75 unique PMID/PMC citations**. The tracked muscle KB carries 21
inline, so most of the provenance lives here and nowhere else.

## These are recommendations, not decisions

A review in `thresholds/` recommends a cut-point. Whether the product **adopted** it is a
separate, later adjudication, recorded in `docs/plans/2026-07-05-threshold-literature-review.md`.
Most recommendations were not adopted. Read this table before concluding the engine is wrong:

| Review | Recommended | Adopted? | Engine ships |
|---|---|---|---|
| `thresholds/forward_head_posture.md` | `danger = 12°` | **No** | `eng(5, 15)` — Moon 2024 is n=145 adolescents; no adult 2D-photo normative dataset |
| `thresholds/imbalanced_shoulders.md` | no citable value | — | `eng(2, 6)` |
| `thresholds/trunk_lean.md` | no citable value | — | `eng(3, 8)` |
| `thresholds/pelvic_obliquity.md` | `warn = 3°`, `danger = 6°` | **Yes** | `lit(3, …)` / `lit(6, …)` — Bibrowicz 2023 |
| `thresholds/genu_varum_valgum.md` | no citable value | — | `eng(5, 15)` |

`eng(...)` marks an engineering default; `lit(...)` marks a boundary a published study
supports. Only pelvic obliquity earned `lit(...)` from this sweep. A gap between a review's
verdict and the shipped threshold is expected and deliberate — not a bug to "fix."

## How this evidence was produced

Literature agents searched PubMed/PMC (via WebSearch/WebFetch against
`pubmed.ncbi.nlm.nih.gov` and `pmc.ncbi.nlm.nih.gov`) and Consensus, wrote the reviews in
this directory, and a human transcribed the verdicts into `content/` and the SQL seeds.

Two things follow from that, and both matter:

- **These are not a clinical review.** Clinical review is tracked separately by the
  `reviewed_by` column; content with `reviewed_by = null` stays hidden in production.
  Nothing in this directory changes that gate.
- **A "low" confidence tier is a real finding, not a gap to be filled.** Several links are
  graded low precisely because the reviews found no construct-specific study — only
  textbook classification. `muscle-links/HANDOFF.md` says so per link. Do not silently
  upgrade a tier without new evidence recorded here.

## Reading cost

This is the densest concentration of biomedical text in the repo. Anthropic's Fable 5 model
runs a safety classifier over the whole request context that refuses on "the majority of
biology, chemistry, and life sciences queries" and switches the conversation to a fallback
model for its remainder. Pulling these files into context will usually trigger it.

Treat `docs/evidence/**` as **opt-in**: read a specific file when you need to check a
specific citation. Do not bulk-load the directory, and do not include it in routine
repo-wide searches. If you need a summary, have a subagent read it and report back.
