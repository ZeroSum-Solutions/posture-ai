/**
 * Next.js Instrumentation: runs once on server startup
 * Auto-applies Supabase database migrations and verifies DB health
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Use relative path instead of @ alias - Turbopack doesn't resolve @ in dynamic imports
      const { applyMigrations } = await import('./lib/db/migrations')
      await applyMigrations()

      // Verify the tables after migration by querying a few
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      const checks = await Promise.all([
        supabase.from('practitioners').select('count').limit(0),
        supabase.from('clients').select('count').limit(0),
        supabase.from('assessments').select('count').limit(0),
        supabase.from('assessment_findings').select('count').limit(0),
        supabase.from('captures').select('count').limit(0),
        supabase.from('reports').select('count').limit(0),
        supabase.from('imbalance_definitions').select('count').limit(0),
        supabase.from('exercises').select('count').limit(0),
        supabase.from('exercise_recommendations').select('count').limit(0),
      ])

      const tableNames = ['practitioners','clients','assessments','assessment_findings',
        'captures','reports','imbalance_definitions','exercises','exercise_recommendations']
      let allOk = true
      for (let i = 0; i < checks.length; i++) {
        const { error } = checks[i]
        if (error && error.code !== 'PGRST116') {
          console.error(`[instrumentation] Table ${tableNames[i]} error: ${error.code} ${error.message}`)
          allOk = false
        }
      }

      if (allOk) {
        console.log('[instrumentation] ✅ All 9 tables verified in Supabase')
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
