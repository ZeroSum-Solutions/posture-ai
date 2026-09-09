import { readFileSync } from 'node:fs'
import pg from 'pg'
import { z } from 'zod'
import { PRACTICE_SIMULATION_CATALOG_ORIGIN } from '../../lib/training/simulation/fixture'

const uuidSchema = z.string().uuid()
const stableIdSchema = z.string().trim().min(1).max(128)

const relationshipFixtureSchema = z.object({
  relationship_id: uuidSchema,
  subject_id: uuidSchema,
  practitioner_id: uuidSchema,
  simulation_run_id: uuidSchema,
  fixture_id: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId),
  fixture_hash: z.literal(PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash),
  permissions: z.array(z.string()),
  revision: z.coerce.number().int().positive(),
}).strict()

const programEvidenceSchema = z.object({
  assignment_id: stableIdSchema,
  subject_id: uuidSchema,
  owning_practitioner_id: uuidSchema,
  program_mode: z.literal('coach_assigned'),
  assignment_status: z.enum(['active', 'ended']),
  relationship_status: z.enum(['active', 'revoked']),
  relationship_revision: z.coerce.number().int().positive(),
  session_states: z.record(stableIdSchema, z.enum([
    'scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted',
  ])),
  set_event_count: z.coerce.number().int().nonnegative(),
  program_revision_count: z.coerce.number().int().positive(),
}).strict()

export type CoachingRelationshipFixture = z.infer<typeof relationshipFixtureSchema>
export type CoachAssignedProgramEvidence = z.infer<typeof programEvidenceSchema>

function localDatabaseUrl(): string {
  const value = process.env.E2E_SUPABASE_DB_URL
  if (!value) throw new Error('E2E_SUPABASE_DB_URL is required')
  const database = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.port !== '55422'
    || database.pathname !== '/postgres') {
    throw new Error('Relationship fixtures require isolated local PostgreSQL at 127.0.0.1:55422/postgres')
  }
  const api = process.env.E2E_SUPABASE_URL
  if (!api) throw new Error('E2E_SUPABASE_URL is required')
  const endpoint = new URL(api)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '55421') {
    throw new Error('Relationship fixtures require isolated local Supabase at 127.0.0.1:55421')
  }
  return value
}

function migrationFunctionBody(path: string, qualifiedName: string): string {
  const sql = readFileSync(path, 'utf8')
  const declaration = `CREATE OR REPLACE FUNCTION ${qualifiedName}`
  const declarationIndex = sql.indexOf(declaration)
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
    revokeRelationship: migrationFunctionBody(
      'supabase/migrations/20260907046000_training_business_conflict_sqlstate.sql',
      'public.revoke_training_coaching_relationship',
    ),
    endAssignments: migrationFunctionBody(
      'supabase/migrations/20260907058000_training_session_lifecycle.sql',
      'private.end_training_assignments_after_coach_revocation',
    ),
    transactionalRevocation: migrationFunctionBody(
      'supabase/migrations/20260907069300_training_coaching_revocation_receipts.sql',
      'public.revoke_training_coaching_relationship_transactional',
    ),
  }
  const result = await connection.query<{
    current_database: string
    simulation_control_source: string | null
    revoke_relationship_source: string | null
    end_assignments_source: string | null
    transactional_revocation_source: string | null
  }>(`
    SELECT
      pg_catalog.current_database() AS current_database,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.has_training_simulation_control(uuid)')
      ) AS simulation_control_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('public.revoke_training_coaching_relationship(uuid,bigint)')
      ) AS revoke_relationship_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.end_training_assignments_after_coach_revocation()')
      ) AS end_assignments_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure(
          'public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)'
        )
      ) AS transactional_revocation_source
  `)
  const row = result.rows[0]
  if (!row || row.current_database !== 'postgres'
    || row.simulation_control_source !== expected.simulationControl
    || row.revoke_relationship_source !== expected.revokeRelationship
    || row.end_assignments_source !== expected.endAssignments
    || row.transactional_revocation_source !== expected.transactionalRevocation) {
    throw new Error('Relationship fixture database is not the isolated migrated Posture AI stack')
  }
}

async function withVerifiedDatabase<T>(work: (connection: pg.Client) => Promise<T>): Promise<T> {
  const connection = new pg.Client({ connectionString: localDatabaseUrl() })
  await connection.connect()
  try {
    await assertFixtureDatabase(connection)
    return await work(connection)
  } finally {
    await connection.end()
  }
}

/**
 * Adds the ordinary revoke permission to one exact active private-practice
 * relationship. The subject must already be bound by the immutable simulation
 * identity/run/catalog tuple; a live subject or arbitrary relationship cannot
 * satisfy the query.
 */
export async function grantPrivatePracticeRelationshipRevocation(
  subjectId: string,
): Promise<CoachingRelationshipFixture> {
  const parsedSubjectId = uuidSchema.parse(subjectId)
  return withVerifiedDatabase(async connection => {
    await connection.query('BEGIN')
    try {
      const fixture = await connection.query<z.input<typeof relationshipFixtureSchema>>(`
        SELECT
          relationship.id AS relationship_id,
          identity_record.subject_id,
          identity_record.practitioner_id,
          identity_record.simulation_run_id,
          identity_record.fixture_id,
          identity_record.fixture_hash,
          relationship.permissions::text[] AS permissions,
          relationship.revision
        FROM private.training_simulation_identities identity_record
        JOIN public.training_subjects subject
          ON subject.id = identity_record.subject_id
          AND subject.owner_user_id = identity_record.provisioned_user_id
          AND subject.status = 'active'
          AND subject.revoked_at IS NULL
          AND subject.deleted_at IS NULL
        JOIN public.training_simulation_runs simulation_run
          ON simulation_run.id = identity_record.simulation_run_id
          AND simulation_run.subject_id = identity_record.subject_id
          AND simulation_run.created_by_user_id = identity_record.practitioner_id
          AND simulation_run.fixture_id = identity_record.fixture_id
          AND simulation_run.fixture_hash = identity_record.fixture_hash
          AND simulation_run.status = 'active'
          AND simulation_run.expires_at = identity_record.expires_at
          AND simulation_run.expires_at > pg_catalog.clock_timestamp()
        JOIN public.coaching_relationships relationship
          ON relationship.subject_id = identity_record.subject_id
          AND relationship.practitioner_id = identity_record.practitioner_id
          AND relationship.status = 'active'
          AND relationship.ended_at IS NULL
        WHERE identity_record.subject_id = $1
          AND identity_record.state = 'active'
          AND identity_record.permission = 'simulation:control'
          AND identity_record.fixture_id = $2
          AND identity_record.fixture_hash = $3
          AND identity_record.expires_at > pg_catalog.clock_timestamp()
        FOR UPDATE OF relationship
      `, [
        parsedSubjectId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
        PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
      ])
      if (fixture.rowCount !== 1) {
        throw new Error('Exact active private-practice relationship was unavailable')
      }
      let current = relationshipFixtureSchema.parse(fixture.rows[0])
      if (!current.permissions.includes('relationship:revoke')) {
        const updated = await connection.query<z.input<typeof relationshipFixtureSchema>>(`
          UPDATE public.coaching_relationships relationship
          SET permissions = pg_catalog.array_append(
                relationship.permissions,
                'relationship:revoke'::public.training_coach_permission
              ),
              revision = relationship.revision + 1
          WHERE relationship.id = $1
            AND relationship.subject_id = $2
            AND relationship.practitioner_id = $3
            AND relationship.status = 'active'
            AND relationship.ended_at IS NULL
            AND NOT ('relationship:revoke'::public.training_coach_permission = ANY(relationship.permissions))
          RETURNING
            relationship.id AS relationship_id,
            relationship.subject_id,
            relationship.practitioner_id,
            $4::uuid AS simulation_run_id,
            $5::text AS fixture_id,
            $6::text AS fixture_hash,
            relationship.permissions::text[] AS permissions,
            relationship.revision
        `, [
          current.relationship_id,
          current.subject_id,
          current.practitioner_id,
          current.simulation_run_id,
          current.fixture_id,
          current.fixture_hash,
        ])
        if (updated.rowCount !== 1) throw new Error('Private-practice relationship permission changed concurrently')
        current = relationshipFixtureSchema.parse(updated.rows[0])
      }
      if (!current.permissions.includes('relationship:revoke')) {
        throw new Error('Private-practice relationship lacks the requested bounded permission')
      }
      await connection.query('COMMIT')
      return current
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  })
}

/** Read-only persistence evidence after the browser has ended a relationship. */
export async function readCoachAssignedProgramEvidence(
  relationshipId: string,
  assignmentId: string,
): Promise<CoachAssignedProgramEvidence> {
  const parsedRelationshipId = uuidSchema.parse(relationshipId)
  const parsedAssignmentId = stableIdSchema.parse(assignmentId)
  return withVerifiedDatabase(async connection => {
    const result = await connection.query<z.input<typeof programEvidenceSchema>>(`
      SELECT
        assignment.id AS assignment_id,
        assignment.subject_id,
        assignment.owning_practitioner_id,
        assignment.program_mode,
        assignment.status AS assignment_status,
        relationship.status AS relationship_status,
        relationship.revision AS relationship_revision,
        COALESCE((
          SELECT pg_catalog.jsonb_object_agg(session.id, session.state ORDER BY session.id)
          FROM public.training_sessions session
          WHERE session.assignment_id = assignment.id
        ), '{}'::jsonb) AS session_states,
        (SELECT pg_catalog.count(*)
          FROM public.training_set_log_events event
          JOIN public.training_sessions session ON session.id = event.session_id
          WHERE session.assignment_id = assignment.id
        ) AS set_event_count,
        (SELECT pg_catalog.count(*)
          FROM public.training_program_revisions revision
          WHERE revision.assignment_id = assignment.id
        ) AS program_revision_count
      FROM public.training_program_assignments assignment
      JOIN public.coaching_relationships relationship
        ON relationship.id = $1
        AND relationship.subject_id = assignment.subject_id
        AND relationship.practitioner_id = assignment.owning_practitioner_id
      WHERE assignment.id = $2
        AND assignment.program_mode = 'coach_assigned'
    `, [parsedRelationshipId, parsedAssignmentId])
    if (result.rowCount !== 1) throw new Error('Coach-assigned program evidence was unavailable')
    return programEvidenceSchema.parse(result.rows[0])
  })
}
