import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CAPTURE_IMAGE_MAX_MULTIPART_BYTES,
  captureImageObjectPath,
  normalizeCaptureImage,
} from '@/lib/captures/captureImage'

const ids = {
  assessment: '30000000-0000-4000-8000-000000000001',
  capture: '40000000-0000-4000-8000-000000000001',
  practitioner: '10000000-0000-4000-8000-000000000001',
}

const state = vi.hoisted(() => ({
  gate: null as NextResponse | null,
  resolve: {
    status: 'found', captureId: '40000000-0000-4000-8000-000000000001',
    storagePath: null, imageSha256: null,
  } as Record<string, unknown>,
  resolveError: null as unknown,
  prepare: { status: 'ready' } as Record<string, unknown>,
  prepareError: null as unknown,
  finalize: { status: 'saved', captureId: '40000000-0000-4000-8000-000000000001' } as Record<string, unknown>,
  finalizeError: null as unknown,
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  calls: [] as string[],
  upload: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({
  practitionerGate: async () => state.gate,
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({
  hashResource: () => 'resource-hash', hashUser: () => 'user-hash', logEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
  createSupabaseServiceClient: () => ({
    rpc: async (name: string) => {
      state.calls.push(name)
      if (name === 'resolve_capture_image_slot') {
        return { data: state.resolve, error: state.resolveError }
      }
      if (name === 'prepare_capture_image_upload') {
        return { data: state.prepare, error: state.prepareError }
      }
      return { data: state.finalize, error: state.finalizeError }
    },
    storage: { from: () => ({ upload: state.upload, download: state.download }) },
  }),
}))

import { POST } from './route'

const context = { params: Promise.resolve({ id: ids.assessment }) }

async function jpegFile() {
  const bytes = await sharp({
    create: { width: 10, height: 8, channels: 3, background: { r: 12, g: 34, b: 56 } },
  }).jpeg().toBuffer()
  return new File([bytes], 'capture.jpg', { type: 'image/jpeg' })
}

async function request(options: {
  image?: File
  slot?: string
  duplicateSlot?: boolean
  extra?: boolean
} = {}) {
  const form = new FormData()
  form.set('slot', options.slot ?? 'front')
  if (options.duplicateSlot) form.append('slot', 'back')
  form.set('image', options.image ?? await jpegFile())
  if (options.extra) form.set('assessmentId', ids.assessment)
  return new NextRequest(`http://localhost/api/assessments/${ids.assessment}/capture-images`, {
    method: 'POST', body: form,
  })
}

describe('POST /api/assessments/[id]/capture-images', () => {
  beforeEach(() => {
    state.gate = null
    state.resolve = {
      status: 'found', captureId: ids.capture, storagePath: null, imageSha256: null,
    }
    state.resolveError = null
    state.prepare = { status: 'ready' }
    state.prepareError = null
    state.finalize = { status: 'saved', captureId: ids.capture }
    state.finalizeError = null
    state.user = { id: ids.practitioner }
    state.calls.length = 0
    state.upload.mockReset().mockImplementation(async () => {
      state.calls.push('upload')
      return { error: null }
    })
    state.download.mockReset().mockResolvedValue({ data: null, error: { message: 'missing' } })
  })

  test('requires the existing authenticated AAL2 practitioner gate before parsing or storage', async () => {
    state.user = null
    expect((await POST(await request(), context)).status).toBe(401)
    expect(state.calls).toEqual([])

    state.user = { id: ids.practitioner }
    state.gate = NextResponse.json({ error: 'mfa_required' }, { status: 403 })
    expect((await POST(await request(), context)).status).toBe(403)
    expect(state.calls).toEqual([])
  })

  test('rejects unknown slots, duplicate fields, and extra browser authority fields', async () => {
    for (const bad of [
      await request({ slot: 'side' }),
      await request({ duplicateSlot: true }),
      await request({ extra: true }),
    ]) {
      const response = await POST(bad, context)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_multipart' })
    }
    expect(state.calls).toEqual([])
  })

  test.each(['missing', 'lying'] as const)(
    'bounds actual multipart bytes when Content-Length is %s',
    async (headerMode) => {
      const oversized = new Uint8Array(CAPTURE_IMAGE_MAX_MULTIPART_BYTES + 1)
      const oversizedRequest = new NextRequest(
        `http://localhost/api/assessments/${ids.assessment}/capture-images`,
        {
          method: 'POST',
          headers: {
            'content-type': 'multipart/form-data; boundary=bounded-test',
            ...(headerMode === 'lying' ? { 'content-length': '1' } : {}),
          },
          body: oversized,
        },
      )

      const response = await POST(oversizedRequest, context)
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'image_too_large' })
      expect(state.calls).toEqual([])
    },
  )

  test('returns 404 without decoding when the owned assessment has no matching slot', async () => {
    state.resolve = { status: 'not_found' }
    const response = await POST(await request(), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'capture_slot_not_found' })
    expect(state.upload).not.toHaveBeenCalled()
  })

  test('rejects spoofed raster bytes before creating a cleanup intent or object', async () => {
    const image = new File(['not-a-jpeg'], 'capture.jpg', { type: 'image/jpeg' })
    const response = await POST(await request({ image }), context)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'invalid_image' })
    expect(state.upload).not.toHaveBeenCalled()
  })

  test('persists cleanup intent before deterministic private upload and finalization', async () => {
    const image = await jpegFile()
    const normalized = await normalizeCaptureImage(image)
    const expectedPath = captureImageObjectPath({
      practitionerId: ids.practitioner,
      assessmentId: ids.assessment,
      captureId: ids.capture,
      sha256: normalized.sha256,
    })

    const response = await POST(await request({ image }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ captureId: ids.capture, slot: 'front', status: 'saved' })
    expect(state.calls).toEqual([
      'resolve_capture_image_slot', 'prepare_capture_image_upload', 'upload',
      'finalize_capture_image_upload',
    ])
    expect(state.upload).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer),
      { cacheControl: '0', contentType: 'image/jpeg', upsert: false },
    )
  })

  test('returns already_saved without touching storage for an exact normalized retry', async () => {
    const image = await jpegFile()
    const normalized = await normalizeCaptureImage(image)
    state.resolve = {
      status: 'found',
      captureId: ids.capture,
      storagePath: captureImageObjectPath({
        practitionerId: ids.practitioner,
        assessmentId: ids.assessment,
        captureId: ids.capture,
        sha256: normalized.sha256,
      }),
      imageSha256: normalized.sha256,
    }
    state.prepare = { status: 'already_saved', captureId: ids.capture }

    const response = await POST(await request({ image }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ captureId: ids.capture, slot: 'front', status: 'already_saved' })
    expect(state.calls).toEqual(['resolve_capture_image_slot', 'prepare_capture_image_upload'])
    expect(state.upload).not.toHaveBeenCalled()
  })

  test('never overwrites a slot whose stored image differs', async () => {
    state.resolve = {
      status: 'found', captureId: ids.capture,
      storagePath: `${ids.practitioner}/${ids.assessment}/${ids.capture}/${'a'.repeat(64)}.jpg`,
      imageSha256: 'a'.repeat(64),
    }
    const response = await POST(await request(), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'capture_image_conflict' })
    expect(state.upload).not.toHaveBeenCalled()
  })

  test('reuses an existing compensation intent and retries a missing same-path object', async () => {
    const response = await POST(await request(), context)
    expect(response.status).toBe(200)
    expect(state.calls).toEqual([
      'resolve_capture_image_slot', 'prepare_capture_image_upload', 'upload',
      'finalize_capture_image_upload',
    ])
    expect(state.upload).toHaveBeenCalledOnce()
  })

  test('does not upload while the deletion worker owns the compensation intent', async () => {
    state.prepare = { status: 'in_progress' }
    const response = await POST(await request(), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'capture_image_in_progress' })
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.calls).toEqual(['resolve_capture_image_slot', 'prepare_capture_image_upload'])
  })

  test('recovers an exact object after an ambiguous upload without overwriting it', async () => {
    const image = await jpegFile()
    const normalized = await normalizeCaptureImage(image)
    state.upload.mockResolvedValueOnce({ error: { message: 'timeout' } })
    state.download.mockResolvedValueOnce({
      data: new Blob([Uint8Array.from(normalized.bytes)], { type: 'image/jpeg' }), error: null,
    })

    const response = await POST(await request({ image }), context)
    expect(response.status).toBe(200)
    expect(state.upload).toHaveBeenCalledOnce()
    expect(state.calls).toEqual([
      'resolve_capture_image_slot', 'prepare_capture_image_upload', 'finalize_capture_image_upload',
    ])
  })

  test('leaves the durable compensation intent when storage cannot confirm the upload', async () => {
    state.upload.mockResolvedValueOnce({ error: { message: 'timeout' } })
    const response = await POST(await request(), context)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'capture_image_storage_unavailable' })
    expect(state.calls).toContain('prepare_capture_image_upload')
    expect(state.calls).not.toContain('finalize_capture_image_upload')
  })

  test('maps a lost cleanup intent during finalization to a retryable conflict', async () => {
    state.finalize = { status: 'intent_missing' }
    const response = await POST(await request(), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'capture_image_in_progress' })
  })
})
