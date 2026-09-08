# Source inventory refresh review — 2026-09-07

Root regenerated the inventory using the existing script, verified only one item and the aggregate fingerprint changed, and independently ran 150 vocabulary/content checks and eight seed-provenance checks. The eight-test result was run locally but its log was not embedded in the external packet. The engine provenance source change was independently reviewed in checkpoint 8c0c96c; this follow-up reviews only generated hashes and local fixture bindings. No production approval or activation data was changed.

**ACCEPT** — inventory fingerprint rebind only. This is not a clinical approval.

The supplied diff matches the stated scope: one generated item hash, one aggregate inventory hash, and lockstep rebinding of existing local/test fixtures. Review status, fixture identity, receipt placeholders, and live approval/activation ledgers are not changed.

## Scope check

| Claim | Diff |
|---|---|
| Only `algorithm:recommendation-engine` item hash changes | Yes. `3a17eca1…066dc93d` → `e2ca7b44…b288dd0`. No other item id, kind, slug, or hash is edited. |
| Aggregate inventory hash changes | Yes. `114cb22a…cf19458b` → `a3cc0931…dd827d`. |
| Counts and item identities unchanged | Yes. No count block, no insert/delete of items. |
| Synthetic fixtures keep status/identity | Yes. Release id stays `clinical-content-test-fixture-v1`. Algorithm item stays `approved` at `2026-07-20T00:00:00Z` with `repeat('e', 64)`. Activation stays `true`, `local_test_fixture` / `local-test-seed-only`, receipt `repeat('f', 64)`. |
| No live approval or activation ledger | Yes. Touches are generated JSON, QA doc, local `seed.sql`, and SQL tests. |

Touched files match the packet list. No policy, runtime, catalog, or release-status code is in the diff.

Hash use is consistent: every old inventory literal becomes `a3cc0931…dd827d`; the algorithm literal appears only where the provenance test requires it (inventory JSON, seed item, QA doc). SQL tests that bind only the inventory hash do only that.

## Tests

`lint:vocab` evidence is attached: 12 files, **150/150**.

`qa-seed-clinical-provenance` log is not attached. The diff still matches that test’s contract:

- `seed.sql` binds current inventory hash on `public.clinical_content_releases` and `private.clinical_content_activation`, and the current algorithm hash on the recommendation-engine item.
- The four SQL/doc bindings listed in `governedBindings` now contain only the current generated hashes, not the old pair.

That is what an 8/8 pass of that file would require.

## WARN

1. This packet does not include the engine-types source delta. The inventory result is consistent with a change under `algorithmSourcePaths` (including `packages/posture-engine/src/types.ts`). It does **not** prove that change is limited to additive capture-provenance metadata. A behavioral edit in any governed source file would produce the same two-hash inventory update.
2. The algorithm item remains `approved` on the **new** fingerprint under the same fixture id. That is acceptable only because this is the synthetic `local_test_fixture` with `local_test_fixture_not_clinical_approval`. It is not a new review of the engine.

No **BLOCK**. Do not treat this rebind as clinical approval of the engine or of live content.
