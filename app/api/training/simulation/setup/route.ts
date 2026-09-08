import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import {
  PRACTICE_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_FIXTURE,
} from '@/lib/training/simulation/fixture'

const reservationSchema = z.object({
  status: z.enum(['reserved', 'active']),
  reservationId: z.string().uuid(),
  invitationId: z.string().uuid(),
  clientId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  provisionedUserId: z.string().uuid().nullable(),
  simulationRunId: z.string().uuid(),
  internalEmail: z.string().email(),
  fixtureId: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId),
  fixtureHash: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash),
  label: z.literal(PRACTICE_SIMULATION_FIXTURE.label),
  expiresAt: z.string(),
  profileRevision: z.number().int().positive().nullable(),
}).strict()

const activationSchema = z.object({
  status: z.literal('active'),
  subjectId: z.string().uuid(),
  clientId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  simulationRunId: z.string().uuid(),
  fixtureId: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId),
  fixtureHash: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash),
  label: z.literal(PRACTICE_SIMULATION_FIXTURE.label),
  expiresAt: z.string(),
}).strict()

function publicProjection(data: z.infer<typeof activationSchema>) {
  return {
    subjectId: data.subjectId,
    profileRevision: data.profileRevision,
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) {
    return NextResponse.json({ code: actor.code }, { status: actor.status })
  }
  if (actor.actorKind !== 'practitioner') {
    return NextResponse.json({ code: 'practitioner_required' }, { status: 403 })
  }

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, {
    route: 'training_simulation_setup', userId: actor.userId, limit: 120, windowSeconds: 60,
  })
  if (!allowed) {
    return NextResponse.json({ code: 'rate_limited' }, { status: 429 })
  }

  // Creation is capped inside the RPC; reopening an existing sample must not spend that quota.
  const reservationResult = await supabase.rpc('reserve_training_simulation_identity')
  if (reservationResult.error?.code === 'PT429') {
    return NextResponse.json({ code: 'rate_limited' }, { status: 429 })
  }
  const reservation = reservationSchema.safeParse(reservationResult.data)
  if (reservationResult.error || !reservation.success) {
    return NextResponse.json({ code: 'simulation_reservation_failed' }, { status: 503 })
  }

  if (reservation.data.status === 'active') {
    const active = activationSchema.safeParse({
      status: 'active',
      subjectId: reservation.data.subjectId,
      clientId: reservation.data.clientId,
      profileRevision: reservation.data.profileRevision,
      simulationRunId: reservation.data.simulationRunId,
      fixtureId: reservation.data.fixtureId,
      fixtureHash: reservation.data.fixtureHash,
      label: reservation.data.label,
      expiresAt: reservation.data.expiresAt,
    })
    if (!active.success) {
      return NextResponse.json({ code: 'simulation_reservation_invalid' }, { status: 503 })
    }
    return NextResponse.json(publicProjection(active.data), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  let provisionedUserId = reservation.data.provisionedUserId
  let createdUser = false
  if (!provisionedUserId) {
    const created = await service.auth.admin.createUser({
      email: reservation.data.internalEmail,
      email_confirm: true,
      user_metadata: {
        display_name: PRACTICE_SIMULATION_FIXTURE.label,
        training_fixture_id: PRACTICE_SIMULATION_FIXTURE.profile.origin.fixtureId,
      },
    })
    if (created.error || !created.data.user) {
      await service.rpc('cancel_training_simulation_identity', {
        p_reservation_id: reservation.data.reservationId,
        p_reason: 'auth provisioning failed',
      })
      return NextResponse.json({ code: 'simulation_identity_failed' }, { status: 503 })
    }
    provisionedUserId = created.data.user.id
    createdUser = true
  }

  const activationResult = await service.rpc('activate_training_simulation_identity', {
    p_reservation_id: reservation.data.reservationId,
    p_provisioned_user_id: provisionedUserId,
    p_profile_json: PRACTICE_SIMULATION_FIXTURE.profile,
  })
  const activation = activationSchema.safeParse(activationResult.data)
  if (activationResult.error || !activation.success) {
    await service.rpc('cancel_training_simulation_identity', {
      p_reservation_id: reservation.data.reservationId,
      p_reason: 'practice activation failed',
    })
    if (createdUser) await service.auth.admin.deleteUser(provisionedUserId)
    return NextResponse.json({ code: 'simulation_activation_failed' }, { status: 503 })
  }

  return NextResponse.json(publicProjection(activation.data), {
    status: 201,
    headers: { 'Cache-Control': 'no-store' },
  })
}
