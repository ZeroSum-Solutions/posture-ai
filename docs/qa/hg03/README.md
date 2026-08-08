# HG-03 clinician review packet

This packet is a review worksheet, not an approval or activation artifact. Kimi K3,
Codex, and other software reviewers cannot satisfy HG-03.

## Exact review target

- Inventory: `content/clinical-content-inventory.json`
- Inventory SHA-256:
  `74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4`
- Recommendation-algorithm item SHA-256:
  `bd496a9e79ee170bcec9a1ce8ff4b02a4eb1b955f246a2360d5e7084c1ca232e`
- Item count: 281
- Source branch: `codex/tighten-posture-ai`

Compared with the prior worksheet, the item count and 280 catalog-item hashes are
unchanged. The only changed row is `algorithm:recommendation-engine`, reflecting
changes within its governed source-file set. This hash change does not itself
approve clinical content.

## UI evidence

- Baseline mobile results:
  `docs/qa/evidence/UI-RESULTS-pass-01-mobile-clinical-before.png`
- Final mobile Summary:
  `docs/qa/evidence/UI-RESULTS-final-mobile-summary.png`
- Final mobile Findings:
  `docs/qa/evidence/UI-RESULTS-final-mobile-findings.png`
- Final desktop Summary:
  `docs/qa/evidence/UI-RESULTS-final-desktop-summary.png`
- QA result and fixed rubric:
  `docs/qa/passes/PASS-06.md`

The result presentation changed; the measured finding thresholds, exercise catalog,
muscle catalog, relationship records, contraindications, and report-copy records did
not change in this branch.

## Reviewer workflow

1. Confirm the inventory SHA-256 above matches the supplied canonical JSON.
2. Review every row in `review-items.csv`.
3. Set each `review_status` to exactly `approved` or `rejected`; do not leave rows
   blank in the signed artifact.
4. Record a note for every rejected item. If notes are stored separately, place
   their SHA-256 in `reviewer_note_sha256`.
5. Explicitly decide whether each surface may be enabled:
   recommendations, programs, workouts, and knowledge links.
6. Sign an itemized receipt that binds the exact inventory hash, item hashes and
   statuses, surface decisions, review timestamp, reviewer name, license
   jurisdiction, and license identifier.
7. Return the signed artifact and its SHA-256 to engineering. Do not place private
   contact information or unrelated clinical records in the repository.

Engineering will validate the returned item set, commit the exact release to
`content/clinical-review-ledger.json`, prepare a reviewed forward-only activation
migration, and follow `docs/RUNBOOK.md`. Until then, production remains
assessment-only and the source-controlled release ledger remains empty.

Regenerate the worksheet after any inventory change:

```bash
node scripts/generate-hg03-review-workbook.mjs
```
