export type AssessmentProcessingStatus = 'processing' | 'complete' | 'failed'

interface AssessmentProcessingResult {
  id: string
  status: AssessmentProcessingStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates the small polling boundary. Completion depends only on the
 * persisted processing state for the requested assessment; finding
 * availability is evaluated on the results screen and cannot keep polling
 * alive indefinitely.
 */
export function parseAssessmentProcessingResult(
  value: unknown,
  expectedAssessmentId: string,
): AssessmentProcessingResult | null {
  if (!isRecord(value) || value.id !== expectedAssessmentId) return null
  if (value.status !== 'processing' && value.status !== 'complete' && value.status !== 'failed') return null
  return { id: value.id, status: value.status }
}
