# PR-09 performance operations

PR-09 adds bounded client and assessment reads, one search RPC, and two supporting indexes. It does not authorize a production migration or deployment. Promote the reviewed migrations through the normal release process after CI passes.

## Evidence classes

`npm run performance:local` proves that the harness works against local Supabase and a production Next.js build. It labels every result `LOCAL_ONLY_NOT_OFFICIAL`.

Only `.github/workflows/performance.yml` can produce official budget receipts. That workflow uses the frozen Ubuntu 24.04, Node 22, Chromium, network, fixture, and observation-count contract. Query-plan `before` evidence is a retrospective reconstruction: the harness drops the new indexes inside a transaction, records plans, rolls the transaction back, and verifies that both indexes returned. It binds the reconstructed SQL to hashes of the current routes, RPC migration, and index migration.

## Compatibility window

The client-list and assessment-history endpoints keep one deployed-version compatibility branch. A parameterless client-list request receives the complete legacy directory response. An assessment-history caller that omits `limit` receives the complete oldest-to-newest history. Current clients always send `limit` and use keyset pagination.

Remove both compatibility branches only after the release team deploys one app version containing PR-09 and the supported client fleet moves to that version. The removal change must delete both legacy route branches and their compatibility tests, then rerun the critical contracts and official performance workflow.

## Server-rendered evidence dates

The seeded client-detail response renders recorded assessment, consent, and
record-creation calendar dates in UTC on both the server and browser. The exact
timestamps remain unchanged in the underlying records. This explicit projection
prevents a server/browser time-zone difference from changing evidence text
during hydration or showing the same stored timestamp as two calendar dates.

Do not replace this with the browser's implicit local time zone. If practitioner-
local calendar dates become a product requirement, first add a governed
organization/practitioner time-zone source and bind both server and browser
formatting to that value.

## Index rollback

The indexes are additive. Do not remove them because a single query plan changes. First confirm a sustained write-cost, lock, storage, or planner regression in production telemetry and capture the affected query plan.

If the owner approves rollback, add a reviewed forward migration that runs these statements outside a transaction:

```sql
drop index concurrently if exists public.clients_active_practitioner_created_id_idx;
drop index concurrently if exists public.assessments_complete_client_practitioner_assessed_id_idx;
```

Do not run these statements by hand in production. `DROP INDEX CONCURRENTLY` cannot run inside a transaction, so the release operator must verify the migration runner's transaction behavior. Keep the bounded API contract during an index rollback. Re-run the 1,000-record query-plan capture and latency workflow before deciding whether to restore or replace either index.

## Search RPC rollback

Keep `list_owned_clients_page` while any deployed client uses the paginated client list. If the RPC must be replaced, ship the replacement and its caller first. Remove the old RPC only after the supported client fleet no longer calls it. RLS and `practitioner_id = auth.uid()` remain required in any replacement.
