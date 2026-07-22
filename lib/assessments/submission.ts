import { createHash } from 'node:crypto'
import type { PoseFrame } from '@posture-ai/engine'

export interface AssessmentSubmissionDigestInput {
  client_id: string
  frames: PoseFrame[] | null
  useFixture: boolean
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson }

function canonicalValue(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) return value.map(item => canonicalValue(item === undefined ? null : item))
  if (typeof value === 'object') {
    const result: Record<string, CanonicalJson> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) result[key] = canonicalValue(item)
    }
    return result
  }
  throw new TypeError(`Unsupported canonical payload value: ${typeof value}`)
}

/**
 * Canonical scoring input for replay detection. Object keys and frame ordering
 * are normalized, while duplicate burst frames remain represented as duplicates.
 */
export function canonicalAssessmentSubmission(input: AssessmentSubmissionDigestInput): string {
  const frames = input.frames === null
    ? null
    : input.frames
      .map(frame => canonicalValue(frame))
      .sort((a, b) => {
        const left = JSON.stringify(a)
        const right = JSON.stringify(b)
        return left < right ? -1 : left > right ? 1 : 0
      })

  return JSON.stringify(canonicalValue({
    client_id: input.client_id,
    frames,
    useFixture: input.useFixture,
  }))
}

/** SHA-256 digest persisted with an assessment's idempotency key. */
export function assessmentSubmissionDigest(input: AssessmentSubmissionDigestInput): string {
  return createHash('sha256').update(canonicalAssessmentSubmission(input)).digest('hex')
}
