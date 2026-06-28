/**
 * Next.js Instrumentation: runs once on server startup.
 *
 * Smoke-checks Supabase connectivity and that the migrated schema is present.
 * It does NOT apply migrations — `supabase/migrations` is the sole source of
 * truth (local: `supabase db reset`; cloud: Supabase Management API). This is
 * observational logging only; readiness is reported by /api/health.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      // Representative tables across the whole migration chain — including the
      // muscle KB and rate-limit tables added by later migrations — so a skipped
      // migration shows up in the logs instead of silently degrading the app.
      const tableNames = [
        'practitioners', 'clients', 'assessments', 'assessment_findings',
        'captures', 'reports', 'imbalance_definitions', 'exercises',
        'exercise_recommendations', 'muscles', 'muscle_imbalance_links',
        'exercise_muscles', 'api_rate_limits',
      ]
      // head-only is the lightest table-existence probe — no rows or count scan,
      // works for any table regardless of its columns (42P01 if the table is missing).
      const checks = await Promise.all(
        tableNames.map((t) => supabase.from(t).select('*', { head: true }))
      )

      let allOk = true
      for (let i = 0; i < checks.length; i++) {
        const { error } = checks[i]
        if (error && error.code !== 'PGRST116') {
          console.error(`[instrumentation] Table ${tableNames[i]} error: ${error.code} ${error.message}`)
          allOk = false
        }
      }

      if (allOk) {
        console.log(`[instrumentation] ✅ All ${tableNames.length} tables verified in Supabase`)
        console.log('[instrumentation] Supabase connection confirmed - database: connected')
      }

      // Check seed data
      const { data: defs } = await supabase.from('imbalance_definitions').select('key')
      const { data: exs } = await supabase.from('exercises').select('slug')
      console.log(`[instrumentation] Seed data: ${defs?.length || 0} imbalance_definitions, ${exs?.length || 0} exercises`)

    } catch (err) {
      console.error('[instrumentation] Error:', err)
    }
  }
}
