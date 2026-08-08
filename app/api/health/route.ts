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

    // Probe a representative slice of the schema plus the exact RPC signatures
    // used by current application paths. RPC probes use HEAD and an epoch snapshot,
    // so PostgREST resolves the named arguments without returning or matching live
    // application rows. The app no longer self-applies migrations —
    // supabase/migrations is the sole source of truth — so a skipped migration must
    // surface as 'pending_migration' here rather than a misleading 'ready'.
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
      supabase.rpc('list_owned_clients_page', {
        p_search: '',
        p_snapshot_at: '1970-01-01T00:00:00.000Z',
        p_after_at: '1970-01-01T00:00:00.000Z',
        p_after_id: '00000000-0000-0000-0000-000000000000',
        p_limit: 1,
        p_filter: 'all',
      }, { head: true }),
      supabase.rpc('owned_client_directory_summary', {
        p_snapshot_at: '1970-01-01T00:00:00.000Z',
      }, { head: true }),
      supabase.rpc('owned_client_longest_since_scan', {
        p_snapshot_at: '1970-01-01T00:00:00.000Z',
      }, { head: true }),
    ])

    // PostgreSQL and PostgREST surface missing schema through different codes:
    // 42P01 / PGRST205 = missing table, 42703 / PGRST204 = missing column, and
    // 42883 / PGRST202 = missing function signature. These mean the connection
    // works but migrations are behind. PGRST116 is merely "no rows" and does not
    // affect readiness.
    const SCHEMA_MISSING = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
    let schemaApplied = true
    for (const { error: probeError } of probes) {
      if (!probeError || probeError.code === 'PGRST116') continue
      if (SCHEMA_MISSING.has(probeError.code ?? '')) { schemaApplied = false; continue }
      throw new Error(`Database error: ${probeError.message}`)
    }

    const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)

    const responseStatus = schemaApplied ? 200 : 503
    logEvent({
      route: 'GET /api/health',
      outcome: schemaApplied ? 'ok' : 'server_error',
      status: responseStatus,
      detailCode: schemaApplied ? 'database_connected' : 'schema_pending_migration',
    })

    return NextResponse.json({
      status: schemaApplied ? 'ok' : 'error',
      database: 'connected',
      schema: schemaApplied ? 'ready' : 'pending_migration',
      clinical_content: {
        status: Object.values(clinicalAccess.surfaces).some(Boolean) ? 'active' : 'assessment_only',
        reason: clinicalAccess.reason,
      },
      timestamp: new Date().toISOString(),
    }, { status: responseStatus })
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
