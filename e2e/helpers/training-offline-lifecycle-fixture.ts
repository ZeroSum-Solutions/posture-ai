import { readFileSync } from 'node:fs'
import pg from 'pg'
import { z } from 'zod'
import { PRACTICE_SIMULATION_CATALOG_ORIGIN } from '../../lib/training/simulation/fixture'

const uuidSchema = z.string().uuid()
const stableIdSchema = z.string().trim().min(1).max(128)
const positiveRevisionSchema = z.coerce.number().int().positive()

const lifecycleEvidenceSchema = z.object({
  subject_id: uuidSchema,
  owner_user_id: uuidSchema,
  client_id: uuidSchema,
  relationship_id: uuidSchema,
  assignment_id: stableIdSchema,
  assignment_status: z.enum(['active', 'ended']),
  assignment_revision: positiveRevisionSchema,
  session_id: stableIdSchema,
  session_state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  session_revision: positiveRevisionSchema,
  relationship_status: z.enum(['active', 'revoked']),
  client_deleted: z.boolean(),
  prescription_count: z.coerce.number().int().nonnegative(),
  set_event_count: z.coerce.number().int().nonnegative(),
  mutation_receipt_count: z.coerce.number().int().nonnegative(),
  lifecycle_denial: z.enum(['relationship_revoked', 'assignment_expired']).nullable(),
}).strict()

const erasureEvidenceSchema = z.object({
  owner_user_id: uuidSchema,
  subject_id: uuidSchema,
  request_id: uuidSchema,
  subject_count: z.coerce.number().int().nonnegative(),
  assignment_count: z.coerce.number().int().nonnegative(),
  session_count: z.coerce.number().int().nonnegative(),
  prescription_count: z.coerce.number().int().nonnegative(),
  set_event_count: z.coerce.number().int().nonnegative(),
  mutation_receipt_count: z.coerce.number().int().nonnegative(),
}).strict()

export type OfflineLifecycleEvidence = z.infer<typeof lifecycleEvidenceSchema>
export type OfflineSubjectErasureEvidence = z.infer<typeof erasureEvidenceSchema>

function localDatabaseUrl(): string {
  const value = process.env.E2E_SUPABASE_DB_URL
  if (!value) throw new Error('E2E_SUPABASE_DB_URL is required')
  const database = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.port !== '55422'
    || database.pathname !== '/postgres') {
    throw new Error('Offline lifecycle fixture requires 127.0.0.1:55422/postgres')
  }
  const apiValue = process.env.E2E_SUPABASE_URL
  if (!apiValue) throw new Error('E2E_SUPABASE_URL is required')
  const api = new URL(apiValue)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.port !== '55421') {
    throw new Error('Offline lifecycle fixture requires local Supabase at 127.0.0.1:55421')
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
    lifecycleDenial: migrationFunctionBody(
      'supabase/migrations/20260907058000_training_session_lifecycle.sql',
      'private.training_session_lifecycle_denial',
    ),
    endAssignments: migrationFunctionBody(
      'supabase/migrations/20260907058000_training_session_lifecycle.sql',
      'private.end_training_assignments_after_coach_revocation',
    ),
    linkedClientErasure: migrationFunctionBody(
      'supabase/migrations/20260907058000_training_session_lifecycle.sql',
      'private.revoke_training_coaching_on_client_erasure',
    ),
    subjectErasure: migrationFunctionBody(
      'supabase/migrations/20260907057000_training_subject_erasure.sql',
      'public.erase_training_subject_transactional',
    ),
  }
  const result = await connection.query<{
    current_database: string
    simulation_control_source: string | null
    lifecycle_denial_source: string | null
    end_assignments_source: string | null
    linked_client_erasure_source: string | null
    subject_erasure_source: string | null
  }>(`
    SELECT
      pg_catalog.current_database() AS current_database,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.has_training_simulation_control(uuid)')
      ) AS simulation_control_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.training_session_lifecycle_denial(text,uuid)')
      ) AS lifecycle_denial_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.end_training_assignments_after_coach_revocation()')
      ) AS end_assignments_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('private.revoke_training_coaching_on_client_erasure()')
      ) AS linked_client_erasure_source,
      (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
        WHERE proc.oid = pg_catalog.to_regprocedure('public.erase_training_subject_transactional(uuid)')
      ) AS subject_erasure_source
  `)
  const row = result.rows[0]
  if (!row || row.current_database !== 'postgres'
    || row.simulation_control_source !== expected.simulationControl
    || row.lifecycle_denial_source !== expected.lifecycleDenial
    || row.end_assignments_source !== expected.endAssignments
    || row.linked_client_erasure_source !== expected.linkedClientErasure
    || row.subject_erasure_source !== expected.subjectErasure) {
    throw new Error('Offline lifecycle fixture database is not the exact isolated migrated stack')
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

async function readLifecycleEvidence(
  connection: pg.Client,
  input: {
    subjectId: string
    clientId: string
    assignmentId: string
    sessionId: string
    requestId: string
  },
): Promise<OfflineLifecycleEvidence> {
  const result = await connection.query<z.input<typeof lifecycleEvidenceSchema>>(`
    SELECT
      subject.id AS subject_id,
      subject.owner_user_id,
      client.id AS client_id,
      relationship.id AS relationship_id,
      assignment.id AS assignment_id,
      assignment.status AS assignment_status,
      assignment.revision AS assignment_revision,
      session.id AS session_id,
      session.state AS session_state,
      session.revision AS session_revision,
      relationship.status AS relationship_status,
      client.deleted_at IS NOT NULL AS client_deleted,
      (SELECT pg_catalog.count(*) FROM public.training_session_prescriptions prescription
        WHERE prescription.session_id = session.id AND prescription.subject_id = subject.id
      ) AS prescription_count,
      (SELECT pg_catalog.count(*) FROM public.training_set_log_events event
        WHERE event.session_id = session.id AND event.subject_id = subject.id
      ) AS set_event_count,
      (SELECT pg_catalog.count(*) FROM public.training_mutation_receipts receipt
        WHERE receipt.actor_user_id = subject.owner_user_id
          AND receipt.session_id = session.id
          AND receipt.request_id = $5
      ) AS mutation_receipt_count,
      private.training_session_lifecycle_denial(session.id, subject.owner_user_id) AS lifecycle_denial
    FROM public.training_subjects subject
    JOIN public.client_accounts account
      ON account.subject_id = subject.id AND account.client_id = $2
    JOIN public.clients client
      ON client.id = account.client_id
    JOIN public.coaching_relationships relationship
      ON relationship.subject_id = subject.id
      AND relationship.practitioner_id = client.practitioner_id
    JOIN public.training_program_assignments assignment
      ON assignment.id = $3
      AND assignment.subject_id = subject.id
      AND assignment.program_mode = 'coach_assigned'
      AND assignment.owning_practitioner_id = relationship.practitioner_id
    JOIN public.training_sessions session
      ON session.id = $4
      AND session.assignment_id = assignment.id
      AND session.subject_id = subject.id
    JOIN private.training_simulation_identities identity_record
      ON identity_record.subject_id = subject.id
      AND identity_record.client_id = client.id
      AND identity_record.practitioner_id = relationship.practitioner_id
      AND identity_record.provisioned_user_id = subject.owner_user_id
      AND identity_record.simulation_run_id = assignment.simulation_run_id
    JOIN public.training_simulation_runs simulation_run
      ON simulation_run.id = identity_record.simulation_run_id
      AND simulation_run.subject_id = subject.id
      AND simulation_run.fixture_id = identity_record.fixture_id
      AND simulation_run.fixture_hash = identity_record.fixture_hash
    WHERE subject.id = $1
      AND identity_record.fixture_id = $6
      AND identity_record.fixture_hash = $7
  `, [
    input.subjectId,
    input.clientId,
    input.assignmentId,
    input.sessionId,
    input.requestId,
    PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
    PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
  ])
  if (result.rowCount !== 1) throw new Error('Exact synthetic offline lifecycle tuple was unavailable')
  return lifecycleEvidenceSchema.parse(result.rows[0])
}

function parseLifecycleInput(input: {
  subjectId: string
  clientId: string
  assignmentId: string
  sessionId: string
  requestId: string
}) {
  return {
    subjectId: uuidSchema.parse(input.subjectId),
    clientId: uuidSchema.parse(input.clientId),
    assignmentId: stableIdSchema.parse(input.assignmentId),
    sessionId: stableIdSchema.parse(input.sessionId),
    requestId: uuidSchema.parse(input.requestId),
  }
}

/**
 * Ends one exact active synthetic coach assignment through its mutable lifecycle
 * fields. Program/session evidence remains untouched; the installed denial
 * function must classify the owner retry as assignment_expired before commit.
 */
export async function expireExactSyntheticAssignment(input: {
  subjectId: string
  clientId: string
  assignmentId: string
  sessionId: string
  requestId: string
  expectedAssignmentRevision: number
  expectedSessionRevision: number
}): Promise<OfflineLifecycleEvidence> {
  const parsed = {
    ...parseLifecycleInput(input),
    expectedAssignmentRevision: positiveRevisionSchema.parse(input.expectedAssignmentRevision),
    expectedSessionRevision: positiveRevisionSchema.parse(input.expectedSessionRevision),
  }
  return withVerifiedDatabase(async connection => {
    await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      const session = await connection.query(`
        SELECT session.id
        FROM public.training_sessions session
        WHERE session.id = $1
          AND session.subject_id = $2
          AND session.assignment_id = $3
          AND session.state = 'in_progress'
          AND session.revision = $4
        FOR UPDATE
      `, [parsed.sessionId, parsed.subjectId, parsed.assignmentId, parsed.expectedSessionRevision])
      if (session.rowCount !== 1) throw new Error('Exact in-progress session changed before assignment expiry')

      const assignment = await connection.query(`
        SELECT assignment.id
        FROM public.training_program_assignments assignment
        WHERE assignment.id = $1
          AND assignment.subject_id = $2
          AND assignment.program_mode = 'coach_assigned'
          AND assignment.status = 'active'
          AND assignment.revision = $3
        FOR UPDATE
      `, [parsed.assignmentId, parsed.subjectId, parsed.expectedAssignmentRevision])
      if (assignment.rowCount !== 1) throw new Error('Exact active assignment changed before expiry')

      const before = await readLifecycleEvidence(connection, parsed)
      if (before.lifecycle_denial !== null
        || before.relationship_status !== 'active'
        || before.client_deleted
        || before.prescription_count !== 1
        || before.set_event_count !== 0
        || before.mutation_receipt_count !== 0) {
        throw new Error(`Assignment-expiry preconditions failed: ${JSON.stringify(before)}`)
      }

      const update = await connection.query(`
        UPDATE public.training_program_assignments assignment
        SET status = 'ended', revision = assignment.revision + 1
        WHERE assignment.id = $1
          AND assignment.subject_id = $2
          AND assignment.status = 'active'
          AND assignment.revision = $3
      `, [parsed.assignmentId, parsed.subjectId, parsed.expectedAssignmentRevision])
      if (update.rowCount !== 1) throw new Error('Exact assignment expiry lost its guarded update')

      const after = await readLifecycleEvidence(connection, parsed)
      if (after.lifecycle_denial !== 'assignment_expired'
        || after.assignment_status !== 'ended'
        || after.assignment_revision !== before.assignment_revision + 1
        || after.session_state !== before.session_state
        || after.session_revision !== before.session_revision
        || after.prescription_count !== before.prescription_count
        || after.set_event_count !== before.set_event_count
        || after.mutation_receipt_count !== 0) {
        throw new Error(`Assignment expiry changed evidence or lacked denial: ${JSON.stringify(after)}`)
      }
      await connection.query('COMMIT')
      return after
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  })
}

/** Read-only evidence for a linked-client erasure performed through the UI/API. */
export async function readExactSyntheticLifecycle(input: {
  subjectId: string
  clientId: string
  assignmentId: string
  sessionId: string
  requestId: string
}): Promise<OfflineLifecycleEvidence> {
  const parsed = parseLifecycleInput(input)
  return withVerifiedDatabase(connection => readLifecycleEvidence(connection, parsed))
}

/** Read-only proof that a committed athlete erasure removed all server artifacts. */
export async function readExactSubjectErasure(input: {
  ownerUserId: string
  subjectId: string
  clientId: string
  erasureRequestId: string
  pendingRequestId: string
}): Promise<OfflineSubjectErasureEvidence> {
  const parsed = {
    ownerUserId: uuidSchema.parse(input.ownerUserId),
    subjectId: uuidSchema.parse(input.subjectId),
    clientId: uuidSchema.parse(input.clientId),
    erasureRequestId: uuidSchema.parse(input.erasureRequestId),
    pendingRequestId: uuidSchema.parse(input.pendingRequestId),
  }
  return withVerifiedDatabase(async connection => {
    const result = await connection.query<z.input<typeof erasureEvidenceSchema>>(`
      SELECT
        receipt.owner_user_id,
        receipt.subject_id,
        receipt.request_id,
        (SELECT pg_catalog.count(*) FROM public.training_subjects subject
          WHERE subject.id = receipt.subject_id
        ) AS subject_count,
        (SELECT pg_catalog.count(*) FROM public.training_program_assignments assignment
          WHERE assignment.subject_id = receipt.subject_id
        ) AS assignment_count,
        (SELECT pg_catalog.count(*) FROM public.training_sessions session
          WHERE session.subject_id = receipt.subject_id
        ) AS session_count,
        (SELECT pg_catalog.count(*) FROM public.training_session_prescriptions prescription
          WHERE prescription.subject_id = receipt.subject_id
        ) AS prescription_count,
        (SELECT pg_catalog.count(*) FROM public.training_set_log_events event
          WHERE event.subject_id = receipt.subject_id
        ) AS set_event_count,
        (SELECT pg_catalog.count(*) FROM public.training_mutation_receipts mutation
          WHERE mutation.actor_user_id = receipt.owner_user_id
            AND mutation.request_id = $4
        ) AS mutation_receipt_count
      FROM private.training_subject_erasure_receipts receipt
      JOIN auth.users owner ON owner.id = receipt.owner_user_id
      JOIN private.training_simulation_identities identity_record
        ON identity_record.provisioned_user_id = receipt.owner_user_id
        AND identity_record.client_id = $5
        AND identity_record.fixture_id = $6
        AND identity_record.fixture_hash = $7
      WHERE receipt.owner_user_id = $1
        AND receipt.subject_id = $2
        AND receipt.request_id = $3
        AND pg_catalog.lower(owner.email) ~ '^simulation\+[a-f0-9]+@fixtures\.invalid$'
        AND identity_record.subject_id IS NULL
    `, [
      parsed.ownerUserId,
      parsed.subjectId,
      parsed.erasureRequestId,
      parsed.pendingRequestId,
      parsed.clientId,
      PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureId,
      PRACTICE_SIMULATION_CATALOG_ORIGIN.fixtureHash,
    ])
    if (result.rowCount !== 1) throw new Error('Exact subject-erasure receipt was unavailable')
    const evidence = erasureEvidenceSchema.parse(result.rows[0])
    if (evidence.subject_count !== 0
      || evidence.assignment_count !== 0
      || evidence.session_count !== 0
      || evidence.prescription_count !== 0
      || evidence.set_event_count !== 0
      || evidence.mutation_receipt_count !== 0) {
      throw new Error(`Subject erasure left training evidence: ${JSON.stringify(evidence)}`)
    }
    return evidence
  })
}
