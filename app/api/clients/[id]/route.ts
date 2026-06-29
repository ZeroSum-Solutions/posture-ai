import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { NextRequest, NextResponse } from 'next/server'

interface Params { id: string }

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say']
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

  const updates: Record<string, unknown> = {}

  // archived_at: archive / restore (string ISO timestamp or null)
  if (body.archived_at !== undefined) updates.archived_at = body.archived_at

  // first_name / last_name are NOT NULL — if provided they must be non-empty
  for (const k of ['first_name', 'last_name'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (typeof v !== 'string' || v.trim() === '') return bad(`${k} must be a non-empty string`)
      updates[k] = v.trim()
    }
  }

  // Nullable text fields (empty string is normalized to null to clear them)
  for (const k of ['date_of_birth', 'notes'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && typeof v !== 'string') return bad(`${k} must be a string or null`)
      updates[k] = v === '' ? null : v
    }
  }

  // sex_at_birth: nullable enum
  if (body.sex_at_birth !== undefined) {
    const v = body.sex_at_birth
    if (v !== null && !(typeof v === 'string' && SEX_VALUES.includes(v))) {
      return bad('sex_at_birth must be one of male, female, other, prefer_not_to_say, or null')
    }
    updates.sex_at_birth = v === '' ? null : v
  }

  // Nullable non-negative numeric measurements
  for (const k of ['height_cm', 'weight_kg'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        return bad(`${k} must be a non-negative number or null`)
      }
      updates[k] = v
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  console.log('[api/clients/[id]] PATCH: updating client', id, updates)
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .select()
    .single()

  if (error) {
    console.error('[api/clients/[id]] PATCH error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  console.log('[api/clients/[id]] PATCH: success, archived_at=', data.archived_at)
  return NextResponse.json({ client: data })
}

// Right-to-erasure: permanently purge a client's screening data (landmarks,
// findings, exercise recommendations, and generated report PDFs), redact the
// client + consent-signer PII in place, and leave a PII-free deletion-log
// tombstone for audit. The immutable consent EVENT (version/hash/timestamp/
// relationship) is retained as proof, with the signer name redacted.
export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { data: owned } = await supabase
    .from('clients').select('id').eq('id', id).eq('practitioner_id', user.id).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  let reason: string | null = null
  try { const b = await req.json(); reason = typeof b?.reason === 'string' ? b.reason : null } catch { /* no body */ }

  const service = createSupabaseServiceClient()

  const { data: assessments } = await service.from('assessments').select('id').eq('client_id', id)
  const assessmentIds = (assessments ?? []).map((a) => a.id)

  let capturesPurged = 0
  if (assessmentIds.length > 0) {
    const { count } = await service.from('captures').select('id', { count: 'exact', head: true }).in('assessment_id', assessmentIds)
    capturesPurged = count ?? 0

    const { data: reports } = await service.from('reports').select('storage_path').in('assessment_id', assessmentIds)
    const paths = (reports ?? []).map((r) => r.storage_path).filter((p): p is string => !!p)
    if (paths.length > 0) await service.storage.from('posture-reports').remove(paths)

    // Cascades: captures, assessment_findings, exercise_recommendations, reports.
    await service.from('assessments').delete().in('id', assessmentIds)
  }

  // Keep the immutable consent event for audit; redact the signer's name (PII).
  await service.from('consent_records').update({ signer_name: 'REDACTED' }).eq('client_id', id)

  // Redact the client row in place → tombstone.
  await service.from('clients').update({
    first_name: 'REDACTED',
    last_name: 'REDACTED',
    date_of_birth: null,
    sex_at_birth: null,
    height_cm: null,
    weight_kg: null,
    notes: null,
    deleted_at: new Date().toISOString(),
    deletion_reason: reason,
  }).eq('id', id)

  await service.from('client_deletion_log').insert({
    original_client_id: id,
    practitioner_id: user.id,
    reason,
    assessments_purged: assessmentIds.length,
    captures_purged: capturesPurged,
  })

  return NextResponse.json({ ok: true, assessments_purged: assessmentIds.length, captures_purged: capturesPurged })
}
