-- Fixes for Supabase advisor findings (2026-06-12 run).
-- 1. handle_new_user is a SECURITY DEFINER trigger function; clients must not
--    be able to call it directly via PostgREST.
-- 2. RLS policies re-evaluated auth.uid() per row (init-plan warning); the
--    (select auth.uid()) form evaluates once per statement.
-- 3. Covering indexes for unindexed foreign keys flagged by the performance
--    advisor.
-- Note: api_rate_limits intentionally has RLS enabled with no policies —
-- it is service-role-only by design.

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS practitioners_self ON practitioners;
CREATE POLICY practitioners_self ON practitioners FOR ALL USING (id = (select auth.uid()));

DROP POLICY IF EXISTS clients_own ON clients;
CREATE POLICY clients_own ON clients FOR ALL USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS assessments_own ON assessments;
CREATE POLICY assessments_own ON assessments FOR ALL USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS findings_own ON assessment_findings;
CREATE POLICY findings_own ON assessment_findings FOR ALL USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS captures_own ON captures;
CREATE POLICY captures_own ON captures FOR ALL USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS reports_own ON reports;
CREATE POLICY reports_own ON reports FOR ALL USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS recommendations_own ON exercise_recommendations;
CREATE POLICY recommendations_own ON exercise_recommendations FOR ALL USING (practitioner_id = (select auth.uid()));

CREATE INDEX IF NOT EXISTS idx_captures_practitioner ON captures(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_exercise_recs_exercise ON exercise_recommendations(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_recs_practitioner ON exercise_recommendations(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_reports_assessment ON reports(assessment_id);
CREATE INDEX IF NOT EXISTS idx_reports_compared_to ON reports(compared_to_assessment_id);
