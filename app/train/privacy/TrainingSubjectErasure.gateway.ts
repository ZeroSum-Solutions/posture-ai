import { z } from 'zod'

const receiptSchema = z.object({
  schemaVersion: z.literal('training-subject-erasure.v1'),
  status: z.enum(['erased', 'already_erased']),
  subjectId: z.string().uuid(),
  requestId: z.string().uuid(),
}).strict()

export type TrainingSubjectErasureReceipt = z.infer<typeof receiptSchema>

export class TrainingSubjectErasureError extends Error {
  constructor(message: string, readonly canRetryExact: boolean) {
    super(message)
  }
}

export async function eraseTrainingSubject(input: {
  requestId: string
  expectedSubjectId: string
}): Promise<TrainingSubjectErasureReceipt> {
  let response: Response
  try {
    response = await fetch('/api/training/privacy/erase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: input.requestId }),
    })
  } catch {
    throw new TrainingSubjectErasureError('Permanent erasure was not confirmed. Retry the exact request.', true)
  }

  const raw = await response.json().catch(() => null)
  if (!response.ok) {
    throw new TrainingSubjectErasureError(
      response.status >= 500 || response.status === 429
        ? 'Permanent erasure was not confirmed. Retry the exact request.'
        : 'Permanent erasure is not available for this account.',
      response.status >= 500 || response.status === 429,
    )
  }
  const receipt = receiptSchema.safeParse(raw)
  if (!receipt.success
    || receipt.data.requestId !== input.requestId
    || receipt.data.subjectId !== input.expectedSubjectId) {
    throw new TrainingSubjectErasureError('Permanent erasure returned an invalid receipt. Retry the exact request.', true)
  }
  return receipt.data
}
