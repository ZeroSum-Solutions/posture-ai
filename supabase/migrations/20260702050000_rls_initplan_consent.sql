-- Perf: wrap auth.uid() in a scalar subselect on the three regulated-table RLS
-- policies the Supabase linter flags (auth_rls_initplan). Bare auth.uid() is
-- re-evaluated per row; (select auth.uid()) is evaluated once per query and the
-- result reused. Same predicate, same access — purely a query-plan improvement,
-- matching the pattern already used on the base tables (advisor_fixes) and the
-- consent_records insert policy (regulatory_hardening_v2). Idempotent.

DROP POLICY IF EXISTS consent_records_read_own ON consent_records;
CREATE POLICY consent_records_read_own ON consent_records FOR SELECT
  USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS consent_tokens_own ON consent_tokens;
CREATE POLICY consent_tokens_own ON consent_tokens FOR ALL
  USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS client_deletion_log_read_own ON client_deletion_log;
CREATE POLICY client_deletion_log_read_own ON client_deletion_log FOR SELECT
  USING (practitioner_id = (select auth.uid()));
