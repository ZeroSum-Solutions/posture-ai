export interface SubmissionAttempt {
  submissionId: string
  token: number
}

export interface SubmissionGuard {
  currentId(): string
  contentChanged(): string
  tryBegin(): SubmissionAttempt | null
  isCurrent(attempt: SubmissionAttempt): boolean
  release(attempt: SubmissionAttempt): void
}

/**
 * Synchronous client guard for assessment submission.
 *
 * React's `submitting` state is intentionally not used as the lock: two clicks
 * can run before React commits the disabled button. The submission id changes
 * whenever capture content changes, then remains stable across transport retries
 * of those exact frames so the server can provide authoritative idempotency.
 */
export function createSubmissionGuard(createId: () => string = () => crypto.randomUUID()): SubmissionGuard {
  let submissionId = createId()
  let activeToken: number | null = null
  let tokenSequence = 0

  return {
    currentId: () => submissionId,
    contentChanged: () => {
      if (activeToken !== null) return submissionId
      submissionId = createId()
      tokenSequence += 1
      return submissionId
    },
    tryBegin: () => {
      if (activeToken !== null) return null
      activeToken = ++tokenSequence
      return { submissionId, token: activeToken }
    },
    isCurrent: (attempt) => activeToken === attempt.token && submissionId === attempt.submissionId,
    release: (attempt) => {
      if (activeToken === attempt.token) activeToken = null
    },
  }
}
