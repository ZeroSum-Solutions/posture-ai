import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { z } from 'zod'
import { AthleteTrainingProfileV1Schema } from '../../lib/training/contracts/profile'
import {
  PRACTICE_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_FIXTURE,
} from '../../lib/training/simulation/fixture'

const uuidSchema = z.string().uuid()
const expectedPermissions = [
  'subject:read',
  'client_link:read',
  'profile:read',
  'profile:write',
  'program:coach_publish',
  'session:read',
  'set_log:write',
  'session:complete',
  'history:read',
  'relationship:revoke',
] as const

const invitationEmailSchema = z.string().regex(/^simulation\+[a-f0-9]+@fixtures\.invalid$/)
const zeroArtifactsSchema = z.object({
  profile_revisions: z.coerce.number().int().nonnegative(),
  builds: z.coerce.number().int().nonnegative(),
  drafts: z.coerce.number().int().nonnegative(),
  assignments: z.coerce.number().int().nonnegative(),
  sessions: z.coerce.number().int().nonnegative(),
  prescriptions: z.coerce.number().int().nonnegative(),
  set_logs: z.coerce.number().int().nonnegative(),
  conditioning_logs: z.coerce.number().int().nonnegative(),
}).strict()

const bindingSchema = z.object({
  invitation_id: uuidSchema,
  client_id: uuidSchema,
  subject_id: uuidSchema,
  owner_user_id: uuidSchema,
  practitioner_id: uuidSchema,
  relationship_id: uuidSchema,
  relationship_revision: z.coerce.number().int().positive(),
  permissions: z.array(z.string()),
  email_normalized: invitationEmailSchema,
  auth_email: invitationEmailSchema,
  invitation_state: z.literal('accepted'),
  subject_status: z.literal('active'),
  account_status: z.literal('active'),
  relationship_status: z.literal('active'),
  current_profile_revision: z.union([z.null(), z.coerce.number().int().positive()]),
}).strict()

const attachedFixtureSchema = bindingSchema.extend({
  simulation_run_id: uuidSchema,
  fixture_id: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId),
  fixture_hash: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash),
  profile_revision: z.literal(1),
  profile_hash: z.string().regex(/^[a-f0-9]{64}$/),
  expires_at: z.coerce.date(),
}).strict()

export type CoachAthleteHandoffFixture = z.infer<typeof attachedFixtureSchema>

function localDatabaseUrl(): string {
  const value = process.env.E2E_SUPABASE_DB_URL
  if (!value) throw new Error('E2E_SUPABASE_DB_URL is required')
  const database = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.port !== '55422'
    || database.pathname !== '/postgres') {
    throw new Error('Coach-athlete handoff fixture requires 127.0.0.1:55422/postgres')
  }
  const apiValue = process.env.E2E_SUPABASE_URL
  if (!apiValue) throw new Error('E2E_SUPABASE_URL is required')
  const api = new URL(apiValue)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.port !== '55421') {
    throw new Error('Coach-athlete handoff fixture requires local Supabase at 127.0.0.1:55421')
  }
  return value
}

function migrationFunctionBody(path: string, qualifiedName: string): string {
  const sql = readFileSync(path, 'utf8')
  const declarationIndex = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}`)
  if (declarationIndex < 0) throw new Error(`Missing migration function ${qualifiedName}`)
  const bodyStart = sql.indexOf('AS $$', declarationIndex)
  const bodyEnd = bodyStart < 0 ? -1 : sql.indexOf('$$;', bodyStart + 5)
  if (bodyStart < 0 || bodyEnd < 0) throw new Error(`Malformed migration function ${qualifiedName}`)
  return sql.slice(bodyStart + 5, bodyEnd)
}

async function assertFixtureDatabase(connection: pg.Client): Promise<void> {
  const expected = {
    simulationControl: migrationFunctionBody(
      'supabase/migrations/20260907045000_training_simulation_identity.sql',
      'private.has_training_simulation_control',
    ),
    reserveStarter: migrationFunctionBody(
      'supabase/migrations/20260907068200_training_bodyweight_assistance_simulation_fixture.sql',
      'public.reserve_training_simulation_identity',
    ),
    evidencePointers: migrationFunctionBody(
      'supabase/migrations/20260907057000_training_subject_erasure.sql',
      'private.enforce_training_subject_evidence_pointers',
    ),
  }
  const result = await connection.query<{
    current_database: string
    simulation_control_source: string | null
    reserve_starter_source: string | null
    evidence_pointer_source: string | null
  }>(`
    SELECT
      pg_catalog.current_database() AS current_database,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.has_training_simulation_control(uuid)')
      ) AS simulation_control_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('public.reserve_training_simulation_identity()')
      ) AS reserve_starter_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.enforce_training_subject_evidence_pointers()')
      ) AS evidence_pointer_source
  `)
  const row = result.rows[0]
  if (!row || row.current_database !== 'postgres'
    || row.simulation_control_source !== expected.simulationControl
    || row.reserve_starter_source !== expected.reserveStarter
    || row.evidence_pointer_source !== expected.evidencePointers) {
    throw new Error('Coach-athlete fixture database is not the exact isolated migrated stack')
  }
}

async function countProgramArtifacts(connection: pg.Client, subjectId: string) {
  const result = await connection.query<z.input<typeof zeroArtifactsSchema>>(`
    SELECT
      (SELECT pg_catalog.count(*) FROM public.training_profile_revisions WHERE subject_id = $1) AS profile_revisions,
      (SELECT pg_catalog.count(*) FROM public.training_program_builds WHERE subject_id = $1) AS builds,
      (SELECT pg_catalog.count(*) FROM public.training_program_drafts WHERE subject_id = $1) AS drafts,
      (SELECT pg_catalog.count(*) FROM public.training_program_assignments WHERE subject_id = $1) AS assignments,
      (SELECT pg_catalog.count(*) FROM public.training_sessions WHERE subject_id = $1) AS sessions,
      (SELECT pg_catalog.count(*) FROM public.training_session_prescriptions WHERE subject_id = $1) AS prescriptions,
      (SELECT pg_catalog.count(*) FROM public.training_set_log_events WHERE subject_id = $1) AS set_logs,
      (SELECT pg_catalog.count(*) FROM public.training_conditioning_log_events WHERE subject_id = $1) AS conditioning_logs
  `, [subjectId])
  return zeroArtifactsSchema.parse(result.rows[0])
}

function assertExpectedArtifactCounts(
  counts: z.infer<typeof zeroArtifactsSchema>,
  expectedProfileRevisions: 0 | 1,
): void {
  const { profile_revisions: profileRevisions, ...programArtifacts } = counts
  if (profileRevisions !== expectedProfileRevisions
    || Object.values(programArtifacts).some(count => count !== 0)) {
    throw new Error(`Coach-athlete fixture artifact counts were invalid: ${JSON.stringify(counts)}`)
  }
}

function assertExactPermissions(permissions: string[]): void {
  const actual = [...permissions].sort()
  const expected = [...expectedPermissions].sort()
  if (actual.length !== expected.length || actual.some((permission, index) => permission !== expected[index])) {
    throw new Error('Coach-athlete fixture requires the exact reviewed coaching permission set')
  }
}

/**
 * Attaches the frozen starter practice context to one freshly accepted local
 * invitation. It seeds only a synthetic profile revision and the identity/run
 * binding needed by the normal server build path. Program artifacts remain
 * browser-authored through the ordinary APIs.
 */
export async function attachStarterPracticeToAcceptedAthlete(input: {
  subjectId: string
  clientId: string
  athleteEmail: string
}): Promise<CoachAthleteHandoffFixture> {
  const subjectId = uuidSchema.parse(input.subjectId)
  const clientId = uuidSchema.parse(input.clientId)
  const athleteEmail = invitationEmailSchema.parse(input.athleteEmail)
  const connection = new pg.Client({ connectionString: localDatabaseUrl() })
  await connection.connect()
  try {
    await assertFixtureDatabase(connection)
    await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      await connection.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))', [subjectId])
      const before = await connection.query<z.input<typeof bindingSchema>>(`
        SELECT
          invitation.id AS invitation_id,
          account.client_id,
          subject.id AS subject_id,
          subject.owner_user_id,
          client.practitioner_id,
          relationship.id AS relationship_id,
          relationship.revision AS relationship_revision,
          relationship.permissions::text[] AS permissions,
          invitation.email_normalized,
          pg_catalog.lower(auth_user.email) AS auth_email,
          invitation.state::text AS invitation_state,
          subject.status::text AS subject_status,
          account.status::text AS account_status,
          relationship.status::text AS relationship_status,
          subject.current_profile_revision
        FROM public.training_subjects subject
        JOIN auth.users auth_user ON auth_user.id = subject.owner_user_id
        JOIN public.client_accounts account
          ON account.subject_id = subject.id AND account.client_id = $2
        JOIN public.clients client
          ON client.id = account.client_id AND client.deleted_at IS NULL
        JOIN private.athlete_invitations invitation
          ON invitation.subject_id = subject.id
          AND invitation.target_client_id = account.client_id
          AND invitation.provisioned_user_id = subject.owner_user_id
          AND invitation.issuer_practitioner_id = client.practitioner_id
        JOIN public.coaching_relationships relationship
          ON relationship.subject_id = subject.id
          AND relationship.practitioner_id = client.practitioner_id
        JOIN public.practitioners practitioner
          ON practitioner.id = relationship.practitioner_id
          AND practitioner.access_status = 'active'
          AND practitioner.role = 'practitioner'
          AND practitioner.access_revoked_at IS NULL
        WHERE subject.id = $1
          AND subject.status = 'active'
          AND subject.revoked_at IS NULL
          AND subject.deleted_at IS NULL
          AND account.status = 'active'
          AND account.revoked_at IS NULL
          AND invitation.mode = 'coach_invited'
          AND invitation.state = 'accepted'
          AND invitation.accepted_at IS NOT NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expired_at IS NULL
          AND invitation.expires_at > pg_catalog.clock_timestamp()
          AND invitation.email_normalized = $3
          AND pg_catalog.lower(auth_user.email) = invitation.email_normalized
          AND relationship.status = 'active'
          AND relationship.ended_at IS NULL
          AND subject.current_profile_revision IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.practitioners athlete_role WHERE athlete_role.id = subject.owner_user_id)
        FOR UPDATE OF subject, account, client, invitation, relationship, practitioner
      `, [subjectId, clientId, athleteEmail])
      if (before.rowCount !== 1) throw new Error('Fresh accepted coach-athlete binding was unavailable')
      const binding = bindingSchema.parse(before.rows[0])
      assertExactPermissions(binding.permissions)
      assertExpectedArtifactCounts(await countProgramArtifacts(connection, subjectId), 0)

      const simulationRunId = randomUUID()
      const identityId = randomUUID()
      const existing = await connection.query(`
        SELECT 1
        FROM private.training_simulation_identities identity_record
        FULL JOIN public.training_simulation_runs simulation_run
          ON simulation_run.id = identity_record.simulation_run_id
        WHERE identity_record.invitation_id = $1
          OR identity_record.client_id = $2
          OR identity_record.provisioned_user_id = $3
          OR identity_record.subject_id = $4
          OR identity_record.simulation_run_id = $5
          OR simulation_run.id = $5
          OR simulation_run.subject_id = $4
          OR (
            identity_record.practitioner_id = $6
            AND identity_record.fixture_id = $7
            AND identity_record.fixture_hash = $8
            AND identity_record.state IN ('reserved', 'active')
          )
      `, [
        binding.invitation_id,
        clientId,
        binding.owner_user_id,
        subjectId,
        simulationRunId,
        binding.practitioner_id,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
      ])
      if (existing.rowCount !== 0) {
        throw new Error('Coach-athlete fixture requires an unbound subject and no open starter fixture for this coach')
      }

      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
      const profile = AthleteTrainingProfileV1Schema.parse(PRACTICE_SIMULATION_FIXTURE.profile)
      const profileJson = JSON.stringify(profile)

      await connection.query(`
        INSERT INTO public.training_profile_revisions(
          subject_id, revision, schema_version, profile_json, profile_hash,
          hash_encoding, created_by_user_id
        ) VALUES (
          $1, 1, 'athlete-training-profile.v1', $2::jsonb,
          private.training_evidence_sha256($2::jsonb),
          'postgres-jsonb-text-utf8.v1', $3
        )
      `, [subjectId, profileJson, binding.owner_user_id])
      await connection.query(`
        UPDATE public.training_subjects
        SET current_profile_revision = 1
        WHERE id = $1 AND owner_user_id = $2 AND current_profile_revision IS NULL
      `, [subjectId, binding.owner_user_id])

      await connection.query(`
        INSERT INTO public.training_simulation_runs(
          id, subject_id, created_by_user_id, fixture_id, fixture_hash, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'active', $6)
      `, [
        simulationRunId,
        subjectId,
        binding.practitioner_id,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
        expiresAt,
      ])
      await connection.query(`
        INSERT INTO private.training_simulation_identities(
          id, invitation_id, client_id, practitioner_id, provisioned_user_id,
          subject_id, simulation_run_id, fixture_id, fixture_hash, label,
          internal_email, state, expires_at, activated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 'Practice data',
          $10, 'active', $11, pg_catalog.clock_timestamp()
        )
      `, [
        identityId,
        binding.invitation_id,
        clientId,
        binding.practitioner_id,
        binding.owner_user_id,
        subjectId,
        simulationRunId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
        athleteEmail,
        expiresAt,
      ])

      const after = await connection.query<z.input<typeof attachedFixtureSchema>>(`
        SELECT
          invitation.id AS invitation_id,
          account.client_id,
          subject.id AS subject_id,
          subject.owner_user_id,
          identity_record.practitioner_id,
          relationship.id AS relationship_id,
          relationship.revision AS relationship_revision,
          relationship.permissions::text[] AS permissions,
          invitation.email_normalized,
          pg_catalog.lower(auth_user.email) AS auth_email,
          invitation.state::text AS invitation_state,
          subject.status::text AS subject_status,
          account.status::text AS account_status,
          relationship.status::text AS relationship_status,
          subject.current_profile_revision,
          identity_record.simulation_run_id,
          identity_record.fixture_id,
          identity_record.fixture_hash,
          profile.revision AS profile_revision,
          profile.profile_hash,
          identity_record.expires_at
        FROM private.training_simulation_identities identity_record
        JOIN public.training_simulation_runs simulation_run
          ON simulation_run.id = identity_record.simulation_run_id
          AND simulation_run.subject_id = identity_record.subject_id
          AND simulation_run.created_by_user_id = identity_record.practitioner_id
          AND simulation_run.fixture_id = identity_record.fixture_id
          AND simulation_run.fixture_hash = identity_record.fixture_hash
          AND simulation_run.status = 'active'
          AND simulation_run.expires_at = identity_record.expires_at
        JOIN public.training_subjects subject ON subject.id = identity_record.subject_id
        JOIN auth.users auth_user ON auth_user.id = subject.owner_user_id
        JOIN public.client_accounts account
          ON account.subject_id = subject.id AND account.client_id = identity_record.client_id
        JOIN private.athlete_invitations invitation
          ON invitation.id = identity_record.invitation_id
          AND invitation.subject_id = subject.id
          AND invitation.provisioned_user_id = subject.owner_user_id
          AND invitation.target_client_id = account.client_id
        JOIN public.coaching_relationships relationship
          ON relationship.subject_id = subject.id
          AND relationship.practitioner_id = identity_record.practitioner_id
        JOIN public.training_profile_revisions profile
          ON profile.subject_id = subject.id AND profile.revision = subject.current_profile_revision
        WHERE identity_record.id = $1
          AND identity_record.state = 'active'
          AND identity_record.permission = 'simulation:control'
          AND identity_record.internal_email = invitation.email_normalized
          AND identity_record.expires_at > pg_catalog.clock_timestamp()
          AND profile.profile_json = $2::jsonb
          AND profile.profile_hash = private.training_evidence_sha256($2::jsonb)
          AND profile.created_by_user_id = subject.owner_user_id
          AND invitation.state = 'accepted'
          AND relationship.status = 'active'
          AND relationship.ended_at IS NULL
      `, [identityId, profileJson])
      if (after.rowCount !== 1) throw new Error('Practice binding failed exact post-insert verification')
      const attached = attachedFixtureSchema.parse({
        ...after.rows[0],
        profile_revision: Number(after.rows[0].profile_revision),
      })
      assertExactPermissions(attached.permissions)
      if (attached.owner_user_id !== binding.owner_user_id
        || attached.relationship_revision !== binding.relationship_revision
        || attached.invitation_id !== binding.invitation_id) {
        throw new Error('Accepted invitation, owner, or relationship changed during practice attachment')
      }
      assertExpectedArtifactCounts(await countProgramArtifacts(connection, subjectId), 1)
      await connection.query('COMMIT')
      return attached
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  } finally {
    await connection.end()
  }
}
