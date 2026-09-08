import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import {
  CAPTURE_IMAGE_MAX_INPUT_BYTES,
  CAPTURE_IMAGE_MAX_MULTIPART_BYTES,
  captureImageObjectPath,
  CaptureImageError,
  isCaptureImageSlot,
  normalizeCaptureImage,
  type CaptureImageSlot,
  type NormalizedCaptureImage,
} from '@/lib/captures/captureImage'
import { logEvent, hashResource, hashUser } from '@/lib/log'
import { enforceRateLimit } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ROUTE = 'POST /api/assessments/[id]/capture-images'

type ResolvedSlot = {
  status?: 'found' | 'not_found' | 'invalid_input'
  captureId?: string
  storagePath?: string | null
  imageSha256?: string | null
}

type FinalizeResult = {
  status?: 'saved' | 'already_saved' | 'conflict' | 'not_found' | 'invalid_input' | 'intent_missing'
  captureId?: string
}

type PrepareResult = {
  status?: 'ready' | 'already_saved' | 'in_progress' | 'conflict' | 'not_found' | 'invalid_input'
  captureId?: string
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return value !== null
    && typeof value !== 'string'
    && typeof value.arrayBuffer === 'function'
    && typeof value.size === 'number'
    && typeof value.type === 'string'
}

async function readExactMultipart(request: NextRequest): Promise<
  | { ok: true; image: File; slot: CaptureImageSlot }
  | { ok: false; response: NextResponse }
> {
  const contentType = request.headers.get('content-type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    return { ok: false, response: jsonError('invalid_multipart', 400) }
  }
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > CAPTURE_IMAGE_MAX_MULTIPART_BYTES) {
    return { ok: false, response: jsonError('image_too_large', 413) }
  }

  if (!request.body) return { ok: false, response: jsonError('invalid_multipart', 400) }

  // Content-Length is advisory and absent for routine HTTP/2 requests. Bound
  // the bytes actually received before invoking formData(), which buffers.
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > CAPTURE_IMAGE_MAX_MULTIPART_BYTES) {
        await reader.cancel()
        return { ok: false, response: jsonError('image_too_large', 413) }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, response: jsonError('invalid_multipart', 400) }
  }

  let form: FormData
  try {
    form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    }).formData()
  } catch {
    return { ok: false, response: jsonError('invalid_multipart', 400) }
  }
  const entries = [...form.entries()]
  if (
    entries.length !== 2
    || form.getAll('slot').length !== 1
    || form.getAll('image').length !== 1
    || entries.some(([key]) => key !== 'slot' && key !== 'image')
  ) {
    return { ok: false, response: jsonError('invalid_multipart', 400) }
  }

  const slot = form.get('slot')
  const image = form.get('image')
  if (!isCaptureImageSlot(slot) || !isUploadedFile(image)) {
    return { ok: false, response: jsonError('invalid_multipart', 400) }
  }
  if (image.size > CAPTURE_IMAGE_MAX_INPUT_BYTES) {
    return { ok: false, response: jsonError('image_too_large', 413) }
  }
  return { ok: true, image, slot }
}

async function objectMatches(
  bucket: { download: (path: string) => Promise<{ data: Blob | null; error: unknown }> },
  path: string,
  normalized: NormalizedCaptureImage,
): Promise<boolean> {
  try {
    const { data, error } = await bucket.download(path)
    if (error || !data || data.size !== normalized.byteSize) return false
    const actual = Buffer.from(await data.arrayBuffer())
    return createHash('sha256').update(actual).digest('hex') === normalized.sha256
  } catch {
    return false
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const started = Date.now()
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return jsonError('unauthorized', 401)
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { id: assessmentId } = await params
  const userHash = hashUser(user.id)
  const resourceHash = hashResource(assessmentId)
  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, {
    route: 'assessment_capture_image', userId: user.id, limit: 24, windowSeconds: 60,
  })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash, resourceHash })
    return jsonError('rate_limited', 429)
  }

  const multipart = await readExactMultipart(request)
  if (!multipart.ok) return multipart.response

  const { data: resolvedData, error: resolveError } = await service.rpc(
    'resolve_capture_image_slot',
    { p_assessment_id: assessmentId, p_practitioner_id: user.id, p_slot: multipart.slot },
  )
  const resolved = resolvedData as ResolvedSlot | null
  if (resolveError) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash, detailCode: 'capture_image_resolve_failed' })
    return jsonError('capture_image_storage_unavailable', 500)
  }
  if (resolved?.status !== 'found' || !resolved.captureId) {
    return jsonError('capture_slot_not_found', 404)
  }

  let normalized: NormalizedCaptureImage
  try {
    normalized = await normalizeCaptureImage(multipart.image)
  } catch (error) {
    if (error instanceof CaptureImageError) return jsonError(error.code, error.status)
    return jsonError('invalid_image', 422)
  }

  const storagePath = captureImageObjectPath({
    assessmentId,
    captureId: resolved.captureId,
    practitionerId: user.id,
    sha256: normalized.sha256,
  })
  if (resolved.storagePath !== null && resolved.storagePath !== undefined) {
    if (resolved.storagePath !== storagePath || resolved.imageSha256 !== normalized.sha256) {
      return jsonError('capture_image_conflict', 409)
    }
  }

  const bucket = service.storage.from('posture-captures')
  const finalize = async (): Promise<NextResponse> => {
    const { data, error } = await service.rpc('finalize_capture_image_upload', {
      p_assessment_id: assessmentId,
      p_capture_id: resolved.captureId,
      p_practitioner_id: user.id,
      p_slot: multipart.slot,
      p_storage_path: storagePath,
      p_image_sha256: normalized.sha256,
      p_image_byte_size: normalized.byteSize,
      p_image_width_px: normalized.width,
      p_image_height_px: normalized.height,
    })
    const result = data as FinalizeResult | null
    if (!error && (result?.status === 'saved' || result?.status === 'already_saved')) {
      logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, resourceHash, durationMs: Date.now() - started })
      return NextResponse.json({
        captureId: result.captureId ?? resolved.captureId,
        slot: multipart.slot,
        status: result.status,
      })
    }
    if (!error && result?.status === 'conflict') return jsonError('capture_image_conflict', 409)
    if (!error && result?.status === 'not_found') return jsonError('capture_slot_not_found', 404)
    if (!error && result?.status === 'intent_missing') {
      return jsonError('capture_image_in_progress', 409)
    }
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash, detailCode: 'capture_image_finalize_unconfirmed' })
    return jsonError('capture_image_storage_unavailable', 500)
  }

  const { data: prepareData, error: prepareError } = await service.rpc(
    'prepare_capture_image_upload',
    {
      p_assessment_id: assessmentId,
      p_capture_id: resolved.captureId,
      p_practitioner_id: user.id,
      p_slot: multipart.slot,
      p_storage_path: storagePath,
      p_image_sha256: normalized.sha256,
    },
  )
  const prepared = prepareData as PrepareResult | null
  if (prepareError) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash, detailCode: 'capture_image_cleanup_intent_failed' })
    return jsonError('capture_image_storage_unavailable', 500)
  }
  if (prepared?.status === 'already_saved') {
    return NextResponse.json({
      captureId: prepared.captureId ?? resolved.captureId,
      slot: multipart.slot,
      status: 'already_saved',
    })
  }
  if (prepared?.status === 'conflict') return jsonError('capture_image_conflict', 409)
  if (prepared?.status === 'not_found') return jsonError('capture_slot_not_found', 404)
  if (prepared?.status === 'in_progress') return jsonError('capture_image_in_progress', 409)
  if (prepared?.status !== 'ready') {
    return jsonError('capture_image_storage_unavailable', 500)
  }

  const { error: uploadError } = await bucket.upload(storagePath, normalized.bytes, {
    cacheControl: '0',
    contentType: normalized.contentType,
    upsert: false,
  })
  if (uploadError) {
    // Storage responses can be commit-ambiguous. Rescue the exact deterministic
    // object when it exists; otherwise retain the intent for the deletion worker.
    if (await objectMatches(bucket, storagePath, normalized)) return finalize()
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash, detailCode: 'capture_image_upload_failed' })
    return jsonError('capture_image_storage_unavailable', 500)
  }

  return finalize()
}
