import { z } from 'zod'
import { trainingJson } from './session-http'

export const MANUAL_REFERENCE_ROUTINE_MAX_BODY_BYTES = 128 * 1024

export async function parseManualReferenceRoutineBody<T>(request: Request, schema: z.ZodType<T>) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MANUAL_REFERENCE_ROUTINE_MAX_BODY_BYTES) {
    return { ok: false, response: trainingJson({ error: 'training_payload_too_large' }, 413) } as const
  }

  const reader = request.body?.getReader()
  if (!reader) return { ok: false, response: trainingJson({ error: 'invalid_json' }, 400) } as const
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    receivedBytes += chunk.value.byteLength
    if (receivedBytes > MANUAL_REFERENCE_ROUTINE_MAX_BODY_BYTES) {
      await reader.cancel()
      return { ok: false, response: trainingJson({ error: 'training_payload_too_large' }, 413) } as const
    }
    chunks.push(chunk.value)
  }

  try {
    const bytes = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const parsed = schema.safeParse(raw)
    return parsed.success
      ? { ok: true, data: parsed.data } as const
      : { ok: false, response: trainingJson({ error: 'invalid_training_payload' }, 422) } as const
  } catch {
    return { ok: false, response: trainingJson({ error: 'invalid_json' }, 400) } as const
  }
}
