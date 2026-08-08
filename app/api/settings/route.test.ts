import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  authError: null as unknown,
  practitionerPath: null as string | null,
  pathReadError: null as unknown,
  pathWriteError: null as unknown,
  uploadError: null as unknown,
  removeError: null as unknown,
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}))

function practitionerQuery() {
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockImplementation(async () => ({
    data: state.pathReadError ? null : { logo_storage_path: state.practitionerPath },
    error: state.pathReadError,
  }))
  query.single.mockImplementation(async () => ({
    data: state.pathWriteError ? null : { logo_storage_path: 'saved-path' },
    error: state.pathWriteError,
  }))
  Object.assign(query, {
    then: (onFulfilled: (value: { error: unknown }) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve({ error: state.pathWriteError }).then(onFulfilled, onRejected),
  })
  return query
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.authError }) },
    from: () => practitionerQuery(),
  }),
  createSupabaseServiceClient: () => ({
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: state.upload,
        remove: state.remove,
        createSignedUrl: state.createSignedUrl,
      }),
    },
  }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ logEvent: vi.fn(), hashUser: () => 'user-hash' }))

import { POST } from './route'

function logoRequest() {
  const formData = new FormData()
  formData.set('logo', new File(['png'], 'logo.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/settings', { method: 'POST', body: formData })
}

describe('POST /api/settings logo upload', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.authError = null
    state.practitionerPath = null
    state.pathReadError = null
    state.pathWriteError = null
    state.uploadError = null
    state.removeError = null
    state.upload.mockReset().mockImplementation(async () => ({ error: state.uploadError }))
    state.remove.mockReset().mockImplementation(async () => ({ error: state.removeError }))
    state.createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://signed.example/logo' }, error: null })
  })

  test('removes the just-uploaded object when saving its metadata fails', async () => {
    state.pathWriteError = { message: 'database unavailable' }

    const response = await POST(logoRequest())

    expect(response.status).toBe(500)
    expect(state.upload).toHaveBeenCalledOnce()
    const uploadedPath = state.upload.mock.calls[0]?.[0]
    expect(uploadedPath).toMatch(/^10000000-0000-4000-8000-000000000001\/logo-[0-9a-f-]+\.png$/)
    expect(state.remove).toHaveBeenCalledWith([uploadedPath])
  })

  test('does not touch storage without an authenticated practitioner', async () => {
    state.user = null

    const response = await POST(logoRequest())

    expect(response.status).toBe(401)
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.remove).not.toHaveBeenCalled()
  })

  test('replaces the metadata before removing the previous practitioner-owned object', async () => {
    state.practitionerPath = '10000000-0000-4000-8000-000000000001/logo-previous.png'

    const response = await POST(logoRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logo_storage_path).toMatch(/^10000000-0000-4000-8000-000000000001\/logo-[0-9a-f-]+\.png$/)
    expect(state.remove).toHaveBeenCalledWith([
      '10000000-0000-4000-8000-000000000001/logo-previous.png',
    ])
  })

  test('never removes a previous path outside the authenticated practitioner prefix', async () => {
    state.practitionerPath = '20000000-0000-4000-8000-000000000002/logo.png'

    const response = await POST(logoRequest())

    expect(response.status).toBe(200)
    expect(state.remove).not.toHaveBeenCalled()
  })

  test('rejects non-raster input before creating a storage object', async () => {
    const formData = new FormData()
    formData.set('logo', new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))

    const response = await POST(new NextRequest('http://localhost/api/settings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(422)
    expect(state.upload).not.toHaveBeenCalled()
  })
})
