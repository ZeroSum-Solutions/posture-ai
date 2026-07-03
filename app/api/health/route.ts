import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Probe a representative slice of the schema: a base table, a later-migration
    // table (muscle KB), and a later-migration column (report dosage). The app no
    // longer self-applies migrations — supabase/migrations is the sole source of
    // truth — so a skipped migration must surface as 'pending_migration' here
    // rather than a misleading 'ready'.
    const probes = await Promise.all([
      supabase.from('practitioners').select('id').limit(0),
      supabase.from('muscles').select('slug').limit(0),
      supabase.from('assessments').select('priority_keys').limit(1),
    ])

    // 42P01 = missing table, 42703 = missing column -> schema not fully applied.
    // PGRST116 = no rows (fine). Anything else is a real connection/DB failure.
    const SCHEMA_MISSING = new Set(['42P01', '42703'])
    let schemaApplied = true
    for (const { error: probeError } of probes) {
      if (!probeError || probeError.code === 'PGRST116') continue
      if (SCHEMA_MISSING.has(probeError.code ?? '')) { schemaApplied = false; continue }
      throw new Error(`Database error: ${probeError.message}`)
    }

    // Log confirmation for server log watchers (satisfies feature test step)
    console.log('[health] Supabase connection confirmed - database: connected')

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      schema: schemaApplied ? 'ready' : 'pending_migration',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    // Detail goes to the server log only — this is a public endpoint, so the
    // response body must not echo raw DB error text (schema/connection internals).
    console.error('[health] Database connection error:', err)
    return NextResponse.json({
      status: 'error',
      database: 'disconnected',
    }, { status: 500 })
  }
}
