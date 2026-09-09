import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import { TrainingConditioningLogEventV1Schema } from '../contracts/logs'
import { TrainingStartedPrescriptionSchema } from './session-http'

// SQL security tests must use the same contract the application accepts.
describe('database/application training contract parity', () => {
  for (const filename of ['training_program_sessions_test.sql', 'training_online_logs_test.sql', 'training_conditioning_logs_test.sql']) {
    it(`uses a complete application-valid program fixture in ${filename}`, () => {
      const sql = readFileSync(resolve('supabase/tests', filename), 'utf8')
      const literal = sql.match(/'(\{\s*"schemaVersion":\s*"training-program-revision.v1"[\s\S]*?\})'::jsonb/)
      expect(literal).not.toBeNull()
      const program = TrainingProgramRevisionV1Schema.parse(JSON.parse(literal![1]))
      expect(program.conditioningBouts).toHaveLength(1)
      expect(program.sessions).toHaveLength(1)
    })
  }

  // The isolated SQL runner exports these actual RPC/table outputs before rollback.
  // This is deliberately skipped without database evidence, never fabricated from fixtures.
  it.skipIf(!process.env.TRAINING_DATABASE_CONTRACT_OUTPUT)('validates database-emitted prescriptions and events with application schemas', () => {
    const data = JSON.parse(readFileSync(process.env.TRAINING_DATABASE_CONTRACT_OUTPUT!, 'utf8'))
    const parsed = z.object({
      program: TrainingProgramRevisionV1Schema,
      prescriptions: z.array(TrainingStartedPrescriptionSchema).length(2),
      conditioningEvents: z.array(TrainingConditioningLogEventV1Schema).min(1),
    }).strict().parse(data)
    expect(new Set(parsed.prescriptions.map(item => item.schemaVersion)).size).toBe(2)
    expect(parsed.conditioningEvents.at(-1)?.eventType).toBe('conditioning_actual_corrected')
  })
})
