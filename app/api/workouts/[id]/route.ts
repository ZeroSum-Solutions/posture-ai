import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

const requestSchema = z.object({ archived: z.literal(true) }).strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!requestSchema.safeParse(raw).success) {
    return NextResponse.json({ error: 'Invalid archive request' }, { status: 422 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, {
    route: 'workouts_archive',
    userId: user.id,
    limit: 20,
    windowSeconds: 60,
  })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })

  const archivedAt = new Date().toISOString()
  const { data, error } = await service.rpc('archive_workout_session', {
    p_session_id: id,
    p_practitioner_id: user.id,
    p_operation_id: randomUUID(),
    p_archived_at: archivedAt,
  })
  const result = data as { status?: string } | null
  if (error || !result?.status) {
    return NextResponse.json({ error: 'Could not archive workout.' }, { status: 500 })
  }
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  }
  if (!['archived', 'already_archived'].includes(result.status)) {
    return NextResponse.json({ error: 'Could not archive workout.' }, { status: 422 })
  }
  return NextResponse.json({ status: result.status, archived_at: archivedAt })
}
