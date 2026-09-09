import { deepStrictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_CATALOG_ORIGIN,
} from '../../lib/training/simulation/fixture'

type CalibrationProposalFamily = 'active' | 'manual'

interface ExactCalibrationProposalExpiry {
  readonly family: CalibrationProposalFamily
  readonly proposalId: string
  readonly subjectId: string
  readonly assignmentId: string
  readonly offer: unknown
}

function localDatabaseUrl(): string {
  const value = process.env.E2E_SUPABASE_DB_URL
  if (!value) throw new Error('E2E_SUPABASE_DB_URL is required')
  const database = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.port !== '55422'
    || database.pathname !== '/postgres') {
    throw new Error('Calibration expiry fixtures require isolated local PostgreSQL at 127.0.0.1:55422/postgres')
  }
  const api = process.env.E2E_SUPABASE_URL
  if (!api) throw new Error('E2E_SUPABASE_URL is required')
  const endpoint = new URL(api)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '55421') {
    throw new Error('Calibration expiry fixtures require isolated local Supabase at 127.0.0.1:55421')
  }
  return value
}

function migrationFunctionBody(qualifiedName: string): string {
  const sql = readFileSync(
    'supabase/migrations/20260907069500_training_calibration_request_renewal_authority.sql',
    'utf8',
  )
  const declaration = `CREATE OR REPLACE FUNCTION ${qualifiedName}`
  const declarationIndex = sql.indexOf(declaration)
  if (declarationIndex < 0) throw new Error(`Missing migration function ${qualifiedName}`)
  const bodyStart = sql.indexOf('AS $$', declarationIndex)
  const bodyEnd = bodyStart < 0 ? -1 : sql.indexOf('$$;', bodyStart + 5)
  if (bodyStart < 0 || bodyEnd < 0) throw new Error(`Malformed migration function ${qualifiedName}`)
  return sql.slice(bodyStart + 5, bodyEnd)
}

export async function expireExactUnacceptedCalibrationProposal(
  input: ExactCalibrationProposalExpiry,
): Promise<void> {
  const databaseUrl = localDatabaseUrl()
  const names = input.family === 'active'
    ? {
        proposalTable: 'training_active_calibration_proposals',
        acceptanceTable: 'training_active_calibration_acceptances',
        lifetimeTable: 'training_active_calibration_proposal_lifetimes',
        renewalFunction: 'public.renew_training_active_calibration_proposal',
      }
    : {
        proposalTable: 'training_manual_recalibration_proposals',
        acceptanceTable: 'training_manual_recalibration_acceptances',
        lifetimeTable: 'training_manual_recalibration_proposal_lifetimes',
        renewalFunction: 'public.renew_training_manual_recalibration_proposal',
      }
  const connection = new pg.Client({ connectionString: databaseUrl })
  await connection.connect()
  try {
    const identity = await connection.query<{
      current_database: string
      renewal_source: string | null
    }>(`
      SELECT pg_catalog.current_database() AS current_database,
        (SELECT proc.prosrc FROM pg_catalog.pg_proc proc
          WHERE proc.oid = pg_catalog.to_regprocedure('${names.renewalFunction}(uuid)')
        ) AS renewal_source
    `)
    if (identity.rows[0]?.current_database !== 'postgres'
      || identity.rows[0]?.renewal_source !== migrationFunctionBody(names.renewalFunction)) {
      throw new Error('Calibration expiry fixture database is not the isolated 69500 Posture AI stack')
    }

    await connection.query('BEGIN')
    try {
      const selected = await connection.query<{
        id: string
        offer_json: unknown
        immutable_identity: unknown
        acceptance_count: number
        lifetime_count: number
      }>(`
        SELECT proposal.id, proposal.offer_json,
          pg_catalog.to_jsonb(proposal) - 'created_at' - 'expires_at' AS immutable_identity,
          (SELECT pg_catalog.count(*)::integer
            FROM public.${names.acceptanceTable} acceptance
            WHERE acceptance.proposal_id = proposal.id) AS acceptance_count,
          (SELECT pg_catalog.count(*)::integer
            FROM public.${names.lifetimeTable} lifetime
            WHERE lifetime.proposal_id = proposal.id) AS lifetime_count
        FROM public.${names.proposalTable} proposal
        JOIN public.training_program_assignments assignment
          ON assignment.id = proposal.assignment_id
          AND assignment.subject_id = proposal.subject_id
          AND assignment.simulation_run_id IS NOT NULL
        JOIN public.training_simulation_runs simulation_run
          ON simulation_run.id = assignment.simulation_run_id
          AND simulation_run.subject_id = proposal.subject_id
        WHERE proposal.id = $1::uuid
          AND proposal.subject_id = $2::uuid
          AND proposal.assignment_id = $3::text
          AND proposal.offer_json = $4::jsonb
          AND proposal.expires_at > pg_catalog.clock_timestamp()
          AND proposal.execution_context->>'kind' = 'synthetic_simulation'
          AND proposal.execution_context->>'simulationRunId' = simulation_run.id::text
          AND proposal.execution_context->>'fixtureId' = simulation_run.fixture_id
          AND proposal.execution_context->>'fixtureHash' = simulation_run.fixture_hash
          AND simulation_run.status = 'active'
          AND simulation_run.expires_at > pg_catalog.clock_timestamp()
          AND EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements($5::jsonb) approved(value)
            WHERE approved.value->>'fixtureId' = simulation_run.fixture_id
              AND approved.value->>'fixtureHash' = simulation_run.fixture_hash
          )
        FOR UPDATE OF proposal
      `, [
        input.proposalId,
        input.subjectId,
        input.assignmentId,
        JSON.stringify(input.offer),
        JSON.stringify([
          PRACTICE_SIMULATION_CATALOG_ORIGIN,
          BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN,
        ]),
      ])
      const before = selected.rows[0]
      if (selected.rowCount !== 1 || !before || before.id !== input.proposalId
        || before.acceptance_count !== 0 || before.lifetime_count !== 0) {
        throw new Error('Exact unaccepted calibration proposal was not eligible for local expiry')
      }
      deepStrictEqual(before.offer_json, input.offer)

      await connection.query('SET LOCAL session_replication_role = replica')
      const expired = await connection.query<{
        id: string
        offer_json: unknown
        immutable_identity: unknown
      }>(`
        UPDATE public.${names.proposalTable} proposal
        SET created_at = pg_catalog.clock_timestamp() - interval '2 hours',
          expires_at = pg_catalog.clock_timestamp() - interval '1 hour'
        WHERE proposal.id = $1::uuid
          AND proposal.subject_id = $2::uuid
          AND proposal.assignment_id = $3::text
          AND proposal.offer_json = $4::jsonb
          AND pg_catalog.to_jsonb(proposal) - 'created_at' - 'expires_at' = $5::jsonb
        RETURNING proposal.id, proposal.offer_json,
          pg_catalog.to_jsonb(proposal) - 'created_at' - 'expires_at' AS immutable_identity
      `, [
        input.proposalId,
        input.subjectId,
        input.assignmentId,
        JSON.stringify(input.offer),
        JSON.stringify(before.immutable_identity),
      ])
      await connection.query('SET LOCAL session_replication_role = origin')
      const changed = expired.rows[0]
      if (expired.rowCount !== 1 || !changed || changed.id !== input.proposalId) {
        throw new Error('Exact calibration proposal was not aged inside the guarded fixture transaction')
      }
      deepStrictEqual(changed.offer_json, input.offer)
      deepStrictEqual(changed.immutable_identity, before.immutable_identity)
      const localSetting = await connection.query<{ session_replication_role: string }>(
        `SELECT pg_catalog.current_setting('session_replication_role') AS session_replication_role`,
      )
      if (localSetting.rows[0]?.session_replication_role !== 'origin') {
        throw new Error('Calibration expiry fixture did not restore trigger enforcement before commit')
      }
      await connection.query('COMMIT')
    } catch (cause) {
      await connection.query('ROLLBACK')
      throw cause
    }
    const setting = await connection.query<{ session_replication_role: string }>(
      `SELECT pg_catalog.current_setting('session_replication_role') AS session_replication_role`,
    )
    if (setting.rows[0]?.session_replication_role !== 'origin') {
      throw new Error('Calibration expiry fixture leaked trigger bypass state after commit')
    }
  } finally {
    await connection.end()
  }
}
