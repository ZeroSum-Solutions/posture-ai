import { isTrainingConflictCode } from '@/lib/training/persistence/conflict'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'

const uuidSchema = z.string().uuid()
const patchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  profile: AthleteTrainingProfileV1Schema,
}).strict()

async function resolveProjection(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string | null,
  clientId: string | null,
) {
  return supabase.rpc('resolve_training_profile_projection', {
    p_subject_id: subjectId,
    p_client_id: clientId,
  })
}

export async function GET(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get('subjectId')
  const clientId = request.nextUrl.searchParams.get('clientId')
  if ((subjectId === null) === (clientId === null)) {
    return NextResponse.json(
      { error: 'Provide exactly one subjectId or clientId.', code: 'invalid_selector' },
      { status: 400 },
    )
  }
  if (!uuidSchema.safeParse(subjectId ?? clientId).success) {
    return NextResponse.json(
      { error: 'The profile selector must be a UUID.', code: 'invalid_selector' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) {
    return NextResponse.json(
      { error: 'Training profile access is unavailable.', code: actor.code },
      { status: actor.status },
    )
  }
  const { data, error } = await resolveProjection(supabase, subjectId, clientId)
  if (error || !data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Training profile access is unavailable.', code: 'profile_access_denied' },
      { status: 403 },
    )
  }
  const projection = data as Record<string, unknown>
  if (projection.status === 'setup_required') {
    return NextResponse.json(
      { code: 'athlete_setup_required', clientId: projection.clientId },
      { status: 409 },
    )
  }
  if (projection.status !== 'ok') {
    return NextResponse.json(
      { error: 'Training profile access is unavailable.', code: 'profile_access_denied' },
      { status: 403 },
    )
  }
  return NextResponse.json(projection)
}

export async function PATCH(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get('subjectId')
  const clientId = request.nextUrl.searchParams.get('clientId')
  if (clientId !== null || !uuidSchema.safeParse(subjectId).success) {
    return NextResponse.json(
      { error: 'PATCH requires one canonical subjectId.', code: 'invalid_selector' },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid_profile' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'The profile payload is invalid.', code: 'invalid_profile', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) {
    return NextResponse.json(
      { error: 'Training profile update was denied.', code: actor.code },
      { status: actor.status },
    )
  }
  const { error } = await supabase.rpc('append_training_profile_revision', {
    p_subject_id: subjectId,
    p_expected_revision: parsed.data.expectedRevision,
    p_profile_json: parsed.data.profile,
  })
  if (error) {
    if (isTrainingConflictCode(error.code)) {
      const current = await resolveProjection(supabase, subjectId, null)
      if (!current.error && current.data && typeof current.data === 'object') {
        return NextResponse.json(
          { code: 'profile_revision_conflict', current: current.data },
          { status: 409 },
        )
      }
    }
    const invalid = error.code === '22023'
    return NextResponse.json(
      {
        error: invalid ? 'The profile payload is invalid.' : 'Training profile update was denied.',
        code: invalid ? 'invalid_profile' : 'profile_update_denied',
      },
      { status: invalid ? 422 : 403 },
    )
  }

  const current = await resolveProjection(supabase, subjectId, null)
  if (current.error || !current.data || typeof current.data !== 'object') {
    return NextResponse.json(
      { error: 'The saved profile could not be reloaded.', code: 'profile_reload_failed' },
      { status: 500 },
    )
  }
  return NextResponse.json(current.data)
}
