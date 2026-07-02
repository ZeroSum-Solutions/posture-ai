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

  // Service-role write (authenticated DB writes on regulated tables are revoked).
  // Re-confirm ownership and refuse edits to a tombstoned (erased) client so a
  // PATCH can't repopulate PII after a right-to-erasure deletion.
  const service = createSupabaseServiceClient()
  const { data: existing } = await service
    .from('clients').select('deleted_at').eq('id', id).eq('practitioner_id', user.id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (existing.deleted_at) {
    return NextResponse.json({ error: 'This client has been deleted and can no longer be edited.' }, { status: 409 })
  }

  // Log field NAMES only — the values are client PII and must not be at rest in logs.
  console.log('[api/clients/[id]] PATCH: updating client', id, Object.keys(updates))
  const { data, error } = await service
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .is('deleted_at', null)
    .select()
    .single()

  if (error) {
    console.error('[api/clients/[id]] PATCH error:', error.message)
    return NextResponse.json({ error: 'Failed to update client.' }, { status: 500 })
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

  // Right-to-erasure must be FAIL-CLOSED: if any purge/redaction step errors we
  // return 500 and do NOT claim success, so the practitioner retries instead of
  // believing data was erased while remnants remain. Order matters — remove report
  // files BEFORE the cascade delete (their paths live on the rows we're deleting) —
  // and every write is scoped by practitioner_id since service-role bypasses RLS.
  const fail = (where: string, e?: { message?: string } | null) => {
    console.error(`[api/clients/[id]] DELETE failed ${where}:`, e?.message)
    return NextResponse.json(
      { error: `Erasure incomplete (${where}); nothing further was changed — please retry.` },
      { status: 500 },
    )
  }

  // Tombstone the client FIRST: redact PII + set deleted_at. Once this commits,
  // the assessments_reject_deleted_client trigger blocks any NEW assessment for
  // this client and the consent RPCs refuse it, so the data enumerated below
  // can't grow under us, and any consent inserted in the lock race is still caught
  // by the redaction here.
  const { error: clErr } = await service.from('clients').update({
    first_name: 'REDACTED',
    last_name: 'REDACTED',
    date_of_birth: null,
    sex_at_birth: null,
    height_cm: null,
    weight_kg: null,
    notes: null,
    deleted_at: new Date().toISOString(),
    deletion_reason: reason,
  }).eq('id', id).eq('practitioner_id', user.id)
  if (clErr) return fail('redacting client', clErr)

  // Remove consent links, then redact the immutable consent events (signer PII).
  const { error: tErr } = await service.from('consent_tokens').delete().eq('client_id', id).eq('practitioner_id', user.id)
  if (tErr) return fail('removing consent links', tErr)
  const { error: cErr } = await service.from('consent_records').update({ signer_name: 'REDACTED' }).eq('client_id', id).eq('practitioner_id', user.id)
  if (cErr) return fail('redacting consent records', cErr)

  // Enumerate the now-frozen assessment set to purge report files, then delete by
  // client_id (cascades captures, findings, recommendations, reports) so nothing
  // created up to this point is missed.
  const { data: assessments, error: aErr } = await service
    .from('assessments').select('id').eq('client_id', id).eq('practitioner_id', user.id)
  if (aErr) return fail('enumerating assessments', aErr)
  const assessmentIds = (assessments ?? []).map((a) => a.id)

  let capturesPurged = 0
  if (assessmentIds.length > 0) {
    const { count, error: capErr } = await service
      .from('captures').select('id', { count: 'exact', head: true }).in('assessment_id', assessmentIds)
    if (capErr) return fail('counting captures', capErr)
    capturesPurged = count ?? 0

    const { data: reports, error: rErr } = await service
      .from('reports').select('storage_path').in('assessment_id', assessmentIds)
    if (rErr) return fail('listing report files', rErr)
    const reportPaths = (reports ?? []).map((r) => r.storage_path).filter((p): p is string => !!p)
    if (reportPaths.length > 0) {
      const { error: remErr } = await service.storage.from('posture-reports').remove(reportPaths)
      if (remErr) return fail('purging report files', remErr)
    }

    const { error: delErr } = await service.from('assessments').delete().eq('client_id', id).eq('practitioner_id', user.id)
    if (delErr) return fail('deleting assessments', delErr)
  }

  const { error: logErr } = await service.from('client_deletion_log').insert({
    original_client_id: id,
    practitioner_id: user.id,
    reason,
    assessments_purged: assessmentIds.length,
    captures_purged: capturesPurged,
  })
  if (logErr) return fail('writing deletion log', logErr)

  return NextResponse.json({ ok: true, assessments_purged: assessmentIds.length, captures_purged: capturesPurged })
}
