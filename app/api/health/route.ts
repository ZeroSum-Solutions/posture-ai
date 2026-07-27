import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logEvent } from '@/lib/log'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'

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
      supabase.from('practitioners').select('id, role, access_status, invitation_id, session_valid_after').limit(0),
      supabase.from('muscles').select('slug').limit(0),
      supabase.from('assessments').select('priority_keys').limit(1),
      supabase.from('assessments').select('submission_id, submission_digest').limit(0),
      supabase.from('assessments').select('legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state').limit(0),
      supabase.from('captures').select('profile_side').limit(0),
      supabase.from('assessment_findings').select('observations').limit(0),
      supabase.from('practitioner_legal_acceptances').select('legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, accepted_at').limit(0),
      supabase.from('clinical_content_review_receipts').select('receipt_sha256').limit(0),
      supabase.from('clinical_content_releases').select('id, inventory_sha256, hg03_receipt_sha256').limit(0),
      supabase.from('clinical_content_release_items').select('release_id, item_id, item_sha256, review_status').limit(0),
      supabase.from('reports').select('report_scope, clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256').limit(0),
      supabase.from('workout_sessions').select('clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256').limit(0),
    ])

    // PostgreSQL and PostgREST surface missing schema through different codes:
    // 42P01 / PGRST205 = missing table, 42703 / PGRST204 = missing column.
    // These mean the connection works but migrations are behind. PGRST116 is
    // merely "no rows" and does not affect readiness.
    const SCHEMA_MISSING = new Set(['42P01', '42703', 'PGRST204', 'PGRST205'])
    let schemaApplied = true
    for (const { error: probeError } of probes) {
      if (!probeError || probeError.code === 'PGRST116') continue
      if (SCHEMA_MISSING.has(probeError.code ?? '')) { schemaApplied = false; continue }
      throw new Error(`Database error: ${probeError.message}`)
    }

    const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)

    // Log confirmation for server log watchers (satisfies feature test step)
    logEvent({ route: 'GET /api/health', outcome: 'ok', status: 200, detailCode: 'database_connected' })

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      schema: schemaApplied ? 'ready' : 'pending_migration',
      clinical_content: {
        status: Object.values(clinicalAccess.surfaces).some(Boolean) ? 'active' : 'assessment_only',
        reason: clinicalAccess.reason,
      },
      timestamp: new Date().toISOString(),
    })
  } catch {
    // Detail goes to the server log only — this is a public endpoint, so the
    // response body must not echo raw DB error text (schema/connection internals).
    logEvent({ route: 'GET /api/health', outcome: 'server_error', status: 500, detailCode: 'database_connection_failed' })
    return NextResponse.json({
      status: 'error',
      database: 'disconnected',
    }, { status: 500 })
  }
}
