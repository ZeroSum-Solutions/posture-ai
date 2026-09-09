import { describe, expect, it } from 'vitest'
import {
  RECOVERY_CONTEXT_SCHEMA_VERSION,
  RecoveryReviewV1Schema,
} from '../contracts/recovery-context'
import { resolveRecoveryReview } from './recoveryReview'

const report = {
  schemaVersion: RECOVERY_CONTEXT_SCHEMA_VERSION,
  capturedAt: '2026-09-09T18:00:00.000Z',
  sleep: 'unknown',
  fatigue: 'concern_reported',
  schedule: 'no_concern_reported',
  illness: 'unknown',
} as const

function containsNumber(value: unknown): boolean {
  if (typeof value === 'number') return true
  if (Array.isArray(value)) return value.some(containsNumber)
  if (value && typeof value === 'object') return Object.values(value).some(containsNumber)
  return false
}

describe('resolveRecoveryReview', () => {
  it('preserves the legacy performance path when the whole context is missing', () => {
    expect(resolveRecoveryReview(undefined)).toEqual({
      kind: 'legacy_path',
      reason: 'recovery_context_missing',
    })
    expect(resolveRecoveryReview(null)).toEqual({
      kind: 'legacy_path',
      reason: 'recovery_context_missing',
    })
  })

  it('passes a report with no explicit choice to performance unchanged', () => {
    expect(resolveRecoveryReview({ report })).toEqual({
      kind: 'performance_eligible',
      reason: 'recovery_context_recorded_no_choice',
      report,
    })
  })

  it.each([
    ['hold', 'hold', 'explicit_recovery_hold'],
    ['request_review', 'request_review', 'explicit_recovery_review_requested'],
    ['new_familiarization', 'new_familiarization', 'explicit_new_familiarization_requested'],
  ] as const)('maps explicit %s without calculating a dose', (choice, kind, reason) => {
    const result = resolveRecoveryReview({ report, choice })
    expect(result).toEqual({ kind, reason, report })
    expect(containsNumber(result)).toBe(false)
  })

  it('preserves unknown illness as a subjective report without changing the chosen path', () => {
    const result = resolveRecoveryReview({
      report: { ...report, illness: 'concern_reported' },
    })
    expect(result).toMatchObject({
      kind: 'performance_eligible',
      report: { illness: 'concern_reported' },
    })
  })

  it('rejects malformed or tampered present context instead of treating it as missing', () => {
    expect(() => resolveRecoveryReview({ report: { ...report, sleep: '7_hours' } })).toThrow()
    expect(() => resolveRecoveryReview({ report, choice: 'automatic_deload' })).toThrow()
    expect(() => resolveRecoveryReview({ report, choice: 'hold', loadMultiplier: 0.9 })).toThrow()
  })

  it('returns only contract-valid bounded review results', () => {
    for (const context of [undefined, { report }, { report, choice: 'hold' as const }]) {
      expect(RecoveryReviewV1Schema.parse(resolveRecoveryReview(context))).toEqual(resolveRecoveryReview(context))
    }
  })
})
