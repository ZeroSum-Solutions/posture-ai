import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import {
  PRACTICE_SIMULATION_CATALOG_CHOICES,
  PRACTICE_SIMULATION_FIXTURE,
  type PracticeSimulationCatalogChoice,
} from '@/lib/training/simulation/fixture'

const reservationBaseSchema = z.object({
  status: z.enum(['reserved', 'active']),
  reservationId: z.string().uuid(),
  invitationId: z.string().uuid(),
  clientId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  provisionedUserId: z.string().uuid().nullable(),
  simulationRunId: z.string().uuid(),
  internalEmail: z.string().email(),
  fixtureId: z.string().trim().min(1).max(128),
  fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.literal(PRACTICE_SIMULATION_FIXTURE.label),
  expiresAt: z.string(),
  profileRevision: z.number().int().positive().nullable(),
}).strict()

const activationBaseSchema = z.object({
  status: z.literal('active'),
  subjectId: z.string().uuid(),
  clientId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  simulationRunId: z.string().uuid(),
  fixtureId: z.string().trim().min(1).max(128),
  fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.literal(PRACTICE_SIMULATION_FIXTURE.label),
  expiresAt: z.string(),
}).strict()

function publicProjection(data: z.infer<typeof activationBaseSchema>) {
  return {
    subjectId: data.subjectId,
    profileRevision: data.profileRevision,
  }
}

function requestedCatalog(request?: Request): PracticeSimulationCatalogChoice | null {
  if (!request) return 'starter'
  const params = new URL(request.url).searchParams
  if ([...params.keys()].length === 0) return 'starter'
  const catalog = params.get('catalog')
  if ([...params.keys()].length === 1
    && params.getAll('catalog').length === 1
    && catalog !== null
    && Object.hasOwn(PRACTICE_SIMULATION_CATALOG_CHOICES, catalog)) {
    return catalog as PracticeSimulationCatalogChoice
  }
  return null
}

export async function POST(request?: Request) {
  const catalogChoice = requestedCatalog(request)
  if (!catalogChoice) {
    return NextResponse.json({ code: 'invalid_simulation_catalog' }, { status: 422 })
  }
  const catalog = PRACTICE_SIMULATION_CATALOG_CHOICES[catalogChoice]
  const profile = catalog.profile ?? PRACTICE_SIMULATION_FIXTURE.profile
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
  const reservationResult = await supabase.rpc(catalog.reservationRpc)
  if (reservationResult.error?.code === 'PT429') {
    return NextResponse.json({ code: 'rate_limited' }, { status: 429 })
  }
  const reservation = reservationBaseSchema.safeParse(reservationResult.data)
  if (reservationResult.error || !reservation.success
    || reservation.data.fixtureId !== catalog.origin.fixtureId
    || reservation.data.fixtureHash !== catalog.origin.fixtureHash) {
    return NextResponse.json({ code: 'simulation_reservation_failed' }, { status: 503 })
  }

  if (reservation.data.status === 'active') {
    const active = activationBaseSchema.safeParse({
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
    if (!active.success
      || active.data.fixtureId !== catalog.origin.fixtureId
      || active.data.fixtureHash !== catalog.origin.fixtureHash) {
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
        training_fixture_id: profile.origin.fixtureId,
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
    p_profile_json: profile,
  })
  const activation = activationBaseSchema.safeParse(activationResult.data)
  if (activationResult.error || !activation.success
    || activation.data.fixtureId !== catalog.origin.fixtureId
    || activation.data.fixtureHash !== catalog.origin.fixtureHash) {
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
