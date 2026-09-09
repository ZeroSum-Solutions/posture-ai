import { describe, expect, it } from 'vitest'
import {
  RECOVERY_CONTEXT_SCHEMA_VERSION,
  RecoveryContextChoiceV1Schema,
  RecoveryContextRecordV1Schema,
  RecoveryContextReportV1Schema,
  RecoveryContextSignalV1Schema,
  RecoveryContextSubmissionV1Schema,
  RecoveryContextV1Schema,
} from './recovery-context'

const report = {
  schemaVersion: RECOVERY_CONTEXT_SCHEMA_VERSION,
  capturedAt: '2026-09-09T18:00:00.000Z',
  sleep: 'unknown',
  fatigue: 'no_concern_reported',
  schedule: 'concern_reported',
  illness: 'unknown',
} as const

describe('RecoveryContextV1Schema', () => {
  it('preserves unknown and explicit neutral self-report states', () => {
    expect(RecoveryContextReportV1Schema.parse(report)).toEqual(report)
    for (const value of ['unknown', 'no_concern_reported', 'concern_reported']) {
      expect(RecoveryContextSignalV1Schema.parse(value)).toBe(value)
    }
  })

  it('allows a report without an intervention choice', () => {
    expect(RecoveryContextV1Schema.parse({ report })).toEqual({ report })
  })

  it('accepts only the three explicit user choices', () => {
    for (const choice of ['hold', 'request_review', 'new_familiarization']) {
      expect(RecoveryContextChoiceV1Schema.parse(choice)).toBe(choice)
      expect(RecoveryContextV1Schema.parse({ report, choice })).toEqual({ report, choice })
    }
  })

  it('rejects missing, unknown, clinical, numeric, and extra report values', () => {
    expect(RecoveryContextReportV1Schema.safeParse({ ...report, sleep: undefined }).success).toBe(false)
    expect(RecoveryContextReportV1Schema.safeParse({ ...report, fatigue: 'moderate' }).success).toBe(false)
    expect(RecoveryContextReportV1Schema.safeParse({ ...report, illness: 0 }).success).toBe(false)
    expect(RecoveryContextReportV1Schema.safeParse({ ...report, diagnosis: 'none' }).success).toBe(false)
    expect(RecoveryContextReportV1Schema.safeParse({ ...report, capturedAt: '2026-09-09' }).success).toBe(false)
    expect(RecoveryContextV1Schema.safeParse({ report, choice: 'reduce_load_10_percent' }).success).toBe(false)
    expect(RecoveryContextV1Schema.safeParse({ report, choice: 'hold', reductionPercent: 10 }).success).toBe(false)
  })

  it('binds a request identity and validates the immutable server record', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    expect(RecoveryContextSubmissionV1Schema.parse({ requestId, context: { report, choice: 'hold' } }))
      .toEqual({ requestId, context: { report, choice: 'hold' } })
    const record = {
      schemaVersion: 'training-recovery-context-record.v1',
      recordId: '22222222-2222-4222-8222-222222222222',
      subjectId: 'subject-1', assignmentId: 'assignment-1',
      sourceProgramRevisionNumber: 3, sourceProgramHash: 'a'.repeat(64),
      sourceSessionId: 'session-2', sourceSessionRevision: 4,
      exerciseInstanceId: 'exercise-2', progressionSeriesId: 'series-push',
      executionContext: { kind: 'live' }, context: { report, choice: 'hold' },
      recordedAt: '2026-09-09T18:01:00.000Z',
    }
    expect(RecoveryContextRecordV1Schema.parse(record)).toEqual(record)
    expect(RecoveryContextRecordV1Schema.safeParse({ ...record, sourceProgramHash: 'forged' }).success).toBe(false)
    expect(RecoveryContextRecordV1Schema.safeParse({ ...record, progressionSeriesId: '' }).success).toBe(false)
    expect(RecoveryContextSubmissionV1Schema.safeParse({ requestId, context: { report }, actorUserId: requestId }).success).toBe(false)
  })
})
