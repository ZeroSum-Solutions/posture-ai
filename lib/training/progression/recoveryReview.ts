import {
  RecoveryReviewV1Schema,
  RecoveryContextV1Schema,
  type RecoveryReviewV1,
} from '../contracts/recovery-context'

/**
 * Resolves only the user's explicit recovery-context choice. It intentionally
 * does not calculate an easier dose or interpret a reported concern as a
 * clinical restriction or clearance decision.
 */
export function resolveRecoveryReview(context: unknown): RecoveryReviewV1 {
  if (context === undefined || context === null) {
    return RecoveryReviewV1Schema.parse({ kind: 'legacy_path', reason: 'recovery_context_missing' })
  }

  const parsed = RecoveryContextV1Schema.parse(context)
  switch (parsed.choice) {
    case undefined:
      return RecoveryReviewV1Schema.parse({
        kind: 'performance_eligible',
        reason: 'recovery_context_recorded_no_choice',
        report: parsed.report,
      })
    case 'hold':
      return RecoveryReviewV1Schema.parse({
        kind: 'hold',
        reason: 'explicit_recovery_hold',
        report: parsed.report,
      })
    case 'request_review':
      return RecoveryReviewV1Schema.parse({
        kind: 'request_review',
        reason: 'explicit_recovery_review_requested',
        report: parsed.report,
      })
    case 'new_familiarization':
      return RecoveryReviewV1Schema.parse({
        kind: 'new_familiarization',
        reason: 'explicit_new_familiarization_requested',
        report: parsed.report,
      })
  }
}
