import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// Self-serve organization compliance settings: the HIPAA covered-entity flag and
// Business Associate Agreement status that drive `practitionerGate`'s BAA gate.
//
// Deliberately does NOT call practitionerGate: that gate 403s a covered-entity
// practitioner whose BAA is unsigned, which would lock them out of the very
// screen they need to record the BAA. We require only an authenticated
// practitioner row here.
//
// Org writes use the service-role client because `organizations` has no write
// RLS policy. There is no IDOR surface: the target org id is always derived from
// the caller's own practitioner row (or a freshly created org we link only to
// them) — it is never accepted from the request body.

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    is_covered_entity: z.boolean().optional(),
    baa_status: z.enum(['not_required', 'pending', 'signed']).optional(),
    baa_signed_at: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), 'must be a valid date')
      .nullable()
      .optional(),
  })
  .strict()

const ORG_FIELDS = 'id, name, is_covered_entity, baa_status, baa_signed_at'

type PractitionerRow = {
  id: string
  organization_id: string | null
  practice_name: string | null
  display_name: string | null
}

async function loadPractitioner(
  supabase: SupabaseClient,
  userId: string,
): Promise<PractitionerRow | null> {
  const { data } = await supabase
    .from('practitioners')
    .select('id, organization_id, practice_name, display_name')
    .eq('id', userId)
    .maybeSingle()
  return (data as PractitionerRow) ?? null
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prac = await loadPractitioner(supabase, user.id)
  if (!prac) {
    return NextResponse.json({ error: 'Practitioner access required.' }, { status: 403 })
  }
  if (!prac.organization_id) {
    return NextResponse.json({ organization: null })
  }

  const { data: org } = await supabase
    .from('organizations')
    .select(ORG_FIELDS)
    .eq('id', prac.organization_id)
    .maybeSingle()

  return NextResponse.json({ organization: org ?? null })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prac = await loadPractitioner(supabase, user.id)
  if (!prac) {
    return NextResponse.json({ error: 'Practitioner access required.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: `Invalid payload: ${issue?.path?.join('.') || 'body'} — ${issue?.message || 'malformed'}` },
      { status: 422 },
    )
  }
  const input = parsed.data
  const now = new Date().toISOString()

  // Normalize the signed timestamp to the BAA status so the two never drift:
  // signed ⇒ has a date (the supplied one, or now); any other status ⇒ null.
  const signedAt =
    input.baa_status === 'signed'
      ? new Date(input.baa_signed_at ?? now).toISOString()
      : input.baa_status !== undefined
        ? null
        : undefined

  const service = createSupabaseServiceClient()

  // Bootstrap a personal org on first save so self-serve compliance has
  // something to attach to. Name precedence: explicit > practice > display > default.
  if (!prac.organization_id) {
    const orgName =
      input.name?.trim() || prac.practice_name || prac.display_name || 'My organization'
    const { data: created, error: createErr } = await service
      .from('organizations')
      .insert({
        name: orgName,
        is_covered_entity: input.is_covered_entity ?? false,
        baa_status: input.baa_status ?? 'not_required',
        baa_signed_at: signedAt ?? null,
      })
      .select(ORG_FIELDS)
      .single()
    if (createErr || !created) {
      return NextResponse.json(
        { error: createErr?.message || 'Failed to create organization' },
        { status: 500 },
      )
    }
    const { error: linkErr } = await service
      .from('practitioners')
      .update({ organization_id: created.id, updated_at: now })
      .eq('id', user.id)
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }
    return NextResponse.json({ organization: created })
  }

  const fields: Record<string, unknown> = { updated_at: now }
  if (input.name !== undefined) fields.name = input.name
  if (input.is_covered_entity !== undefined) fields.is_covered_entity = input.is_covered_entity
  if (input.baa_status !== undefined) fields.baa_status = input.baa_status
  if (signedAt !== undefined) fields.baa_signed_at = signedAt

  const { data: updated, error: updateErr } = await service
    .from('organizations')
    .update(fields)
    .eq('id', prac.organization_id)
    .select(ORG_FIELDS)
    .single()
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message || 'Failed to update organization' },
      { status: 500 },
    )
  }
  return NextResponse.json({ organization: updated })
}
