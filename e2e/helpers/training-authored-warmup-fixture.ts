import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { z } from 'zod'
import { TrainingProgramRevisionV1Schema } from '../../lib/training/contracts/program'
import { createLoadQuantity } from '../../lib/training/quantity'

const setupSchema = z.object({
  subjectId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
}).passthrough()

const buildSchema = z.object({
  buildId: z.string().uuid(),
  result: z.object({
    kind: z.literal('draft_program'),
    weeks: z.array(z.object({
      conditioningBouts: z.array(z.object({
        boutId: z.string(),
        modalityId: z.string(),
        scheduledLocalDate: z.string(),
        allowedDurationSeconds: z.object({ minimum: z.number().int().positive() }).passthrough(),
      }).passthrough()),
    }).passthrough()),
  }).passthrough(),
  calibrations: z.array(z.object({
    calibration: z.object({ exerciseInstanceId: z.string().min(1) }).passthrough(),
  }).passthrough()),
}).passthrough()

const acceptanceSchema = z.object({ draftId: z.string().uuid() }).passthrough()
const publicationSchema = z.object({ assignmentId: z.string().min(1).max(128) }).passthrough()

const sourceDraftSchema = z.object({
  subject_id: z.string().uuid(),
  created_by_user_id: z.string().uuid(),
  profile_revision: z.coerce.number().int().positive(),
  simulation_run_id: z.string().uuid(),
  eligibility_source_revision_id: z.null(),
  program_json: z.unknown(),
  expires_at: z.coerce.date(),
}).strict()

export interface AuthoredWarmupTrainingFixture {
  readonly assignmentId: string
  readonly sessionId: string
  readonly warmupSetId: string
  readonly workingSetId: string
  readonly totalWorkingSetCount: number
  readonly prescribedWarmup: { readonly value: string; readonly unit: 'kg' | 'lb' }
}

function localEnvironment(): {
  readonly databaseUrl: string
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
} {
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  if (!supabaseUrl) throw new Error('E2E_SUPABASE_URL is required')
  const api = new URL(supabaseUrl)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.port !== '55421') {
    throw new Error('Authored warm-up fixtures require isolated local Supabase at 127.0.0.1:55421')
  }
  const value = process.env.E2E_SUPABASE_DB_URL
  if (!value) throw new Error('E2E_SUPABASE_DB_URL is required')
  const database = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.port !== '55422'
    || database.pathname !== '/postgres') {
    throw new Error('Authored warm-up fixtures require isolated local PostgreSQL at 127.0.0.1:55422/postgres')
  }
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')
  return { databaseUrl: value, supabaseUrl, serviceRoleKey }
}

async function assertLocalDatabaseIdentity(databaseUrl: string): Promise<void> {
  const connection = new pg.Client({ connectionString: databaseUrl })
  await connection.connect()
  try {
    const identity = await connection.query<{
      current_database: string
      warmup_resolver_source: string | null
    }>(`
      SELECT
        pg_catalog.current_database() AS current_database,
        (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
          WHERE proc.oid = pg_catalog.to_regprocedure('private.resolve_training_prescribed_set(jsonb,text)')
        ) AS warmup_resolver_source
    `)
    const migration = readFileSync('supabase/migrations/20260907060000_training_authored_warmup_sets.sql', 'utf8')
    const expectedSource = migration.split('AS $$')[1]?.split('$$;')[0]
    if (identity.rows[0]?.current_database !== 'postgres'
      || !expectedSource || identity.rows[0]?.warmup_resolver_source !== expectedSource) {
      throw new Error('Authored warm-up fixture database identity is not the isolated migrated Posture AI stack')
    }
  } finally {
    await connection.end()
  }
}

async function parsedResponse<T>(response: APIResponse, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok()) {
    throw new Error(`Authored warm-up fixture HTTP setup failed (${response.status()}): ${JSON.stringify(body)}`)
  }
  return schema.parse(body)
}

async function acceptedStarterDraft(request: APIRequestContext) {
  const setup = await parsedResponse(
    await request.post('/api/training/simulation/setup'),
    setupSchema,
  )
  const build = await parsedResponse(
    await request.post('/api/training/programs/builds', {
      data: {
        subjectId: setup.subjectId,
        profileRevision: setup.profileRevision,
        cycleStartLocalDate: '2030-01-07',
      },
    }),
    buildSchema,
  )
  const conditioningBySlot = new Map<string, {
    boutId: string
    acceptedDurationSeconds: number
  }>()
  for (const week of build.result.weeks) {
    for (const bout of week.conditioningBouts) {
      const weekday = new Date(`${bout.scheduledLocalDate}T12:00:00Z`).getUTCDay()
      const key = `${weekday}:${bout.modalityId}`
      if (!conditioningBySlot.has(key)) {
        conditioningBySlot.set(key, {
          boutId: bout.boutId,
          acceptedDurationSeconds: bout.allowedDurationSeconds.minimum,
        })
      }
    }
  }
  const acceptance = await parsedResponse(
    await request.post(`/api/training/programs/builds/${build.buildId}/accept`, {
      data: {
        loadChoices: build.calibrations.map(offer => ({
          exerciseInstanceId: offer.calibration.exerciseInstanceId,
          optionIndex: 0,
        })),
        conditioningChoices: [...conditioningBySlot.values()],
      },
    }),
    acceptanceSchema,
  )
  return { setup, draftId: acceptance.draftId }
}

/**
 * Creates a local-only authored synthetic program without changing the frozen
 * starter catalog or pretending the compiler authored a warm-up it does not
 * contain. The published prescription and every workout mutation still pass
 * through the production HTTP/RPC boundaries.
 */
export async function createAuthoredWarmupTrainingFixture(
  request: APIRequestContext,
): Promise<AuthoredWarmupTrainingFixture> {
  const local = localEnvironment()
  await assertLocalDatabaseIdentity(local.databaseUrl)
  const { setup, draftId: sourceDraftId } = await acceptedStarterDraft(request)
  const service = createClient(local.supabaseUrl, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const fixtureDraftId = randomUUID()
  const assignmentId = `assignment:warmup-e2e:${fixtureDraftId}`
  const warmupSetId = `warmup:${randomUUID()}`
  const prescribedWarmup = { value: '3.75', unit: 'lb' as const }
  let sessionId = ''
  let workingSetId = ''
  let totalWorkingSetCount = 0
  const { data: source, error: sourceError } = await service
    .from('training_program_drafts')
    .select(`
      subject_id, created_by_user_id, profile_revision,
      simulation_run_id, eligibility_source_revision_id,
      program_json, expires_at
    `)
    .eq('id', sourceDraftId)
    .maybeSingle()
  if (sourceError || !source) {
    throw new Error(`Accepted synthetic source draft is unavailable: ${sourceError?.code ?? 'missing'}`)
  }
  const row = sourceDraftSchema.parse(source)
  try {
    if (row.subject_id !== setup.subjectId || row.expires_at.getTime() <= Date.now()) {
      throw new Error('Accepted synthetic source draft does not match the active local fixture')
    }

    const sourceProgram = TrainingProgramRevisionV1Schema.parse(row.program_json)
    if (sourceProgram.executionContext.kind !== 'synthetic_simulation'
      || sourceProgram.executionContext.label !== 'Practice data'
      || sourceProgram.sessions[0]?.exercises[0] === undefined
      || sourceProgram.sessions[0].exercises[0].warmupSets !== undefined) {
      throw new Error('Starter draft is not the expected warm-up-free synthetic program')
    }
    const firstSession = sourceProgram.sessions[0]
    const firstExercise = firstSession.exercises[0]
    sessionId = firstSession.sessionId
    workingSetId = firstExercise.setIds[0] ?? ''
    totalWorkingSetCount = firstSession.exercises.reduce(
      (count, exercise) => count + exercise.setIds.length,
      0,
    )
    if (!workingSetId || totalWorkingSetCount < 1) {
      throw new Error('Synthetic source session has no working sets')
    }

    const program = TrainingProgramRevisionV1Schema.parse({
      ...sourceProgram,
      assignmentId,
      sessions: sourceProgram.sessions.map((session, sessionIndex) => sessionIndex === 0
        ? {
          ...session,
          exercises: session.exercises.map((exercise, exerciseIndex) => exerciseIndex === 0
            ? {
              ...exercise,
              warmupSets: [{
                setId: warmupSetId,
                targetReps: 6,
                prescribedLoad: createLoadQuantity(prescribedWarmup),
              }],
            }
            : exercise),
        }
        : session),
    })

    const { error: insertError } = await service.from('training_program_drafts').insert({
      id: fixtureDraftId,
      subject_id: row.subject_id,
      created_by_user_id: row.created_by_user_id,
      profile_revision: row.profile_revision,
      simulation_run_id: row.simulation_run_id,
      eligibility_source_revision_id: null,
      source_build_id: null,
      selection_hash: null,
      program_json: program,
      expires_at: row.expires_at.toISOString(),
    })
    if (insertError) {
      throw new Error(`Authored synthetic warm-up draft insert failed: ${insertError.code}`)
    }
  } catch (cause) {
    throw cause
  }

  const publication = await parsedResponse(
    await request.post('/api/training/programs/publish', { data: { draftId: fixtureDraftId } }),
    publicationSchema,
  )
  if (publication.assignmentId !== assignmentId) {
    throw new Error('Published authored warm-up fixture does not match its immutable assignment')
  }
  return {
    assignmentId,
    sessionId,
    warmupSetId,
    workingSetId,
    totalWorkingSetCount,
    prescribedWarmup,
  }
}
