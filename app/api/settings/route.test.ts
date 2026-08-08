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
  let updates: Record<string, unknown> | null = null
  let expectedPath: string | null | undefined
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.update.mockImplementation((fields: Record<string, unknown>) => {
    updates = fields
    return query
  })
  query.eq.mockImplementation((column: string, value: unknown) => {
    if (column === 'logo_storage_path') expectedPath = String(value)
    return query
  })
  query.is.mockImplementation((column: string, value: unknown) => {
    if (column === 'logo_storage_path' && value === null) expectedPath = null
    return query
  })
  const settle = async () => {
    if (!updates) {
      return {
        data: state.pathReadError ? null : { logo_storage_path: state.practitionerPath },
        error: state.pathReadError,
      }
    }
    if (state.pathWriteError) return { data: null, error: state.pathWriteError }
    if (expectedPath !== undefined && state.practitionerPath !== expectedPath) {
      return { data: null, error: null }
    }
    state.practitionerPath = String(updates.logo_storage_path)
    return { data: { logo_storage_path: state.practitionerPath }, error: null }
  }
  query.maybeSingle.mockImplementation(settle)
  query.single.mockImplementation(settle)
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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

  test('reconciles concurrent replacements without orphaning the losing uploaded object', async () => {
    const previousPath = '10000000-0000-4000-8000-000000000001/logo-previous.png'
    state.practitionerPath = previousPath
    const bothUploadsStarted = deferred<void>()
    let uploadCount = 0
    state.upload.mockImplementation(async () => {
      uploadCount += 1
      if (uploadCount === 2) bothUploadsStarted.resolve()
      await bothUploadsStarted.promise
      return { error: null }
    })

    const responses = await Promise.all([POST(logoRequest()), POST(logoRequest())])
    const statuses = responses.map((response) => response.status).sort()
    const uploadedPaths = state.upload.mock.calls.map((call) => String(call[0]))
    const losingPath = uploadedPaths.find((path) => path !== state.practitionerPath)

    expect(statuses).toEqual([200, 409])
    expect(state.practitionerPath).toBe(uploadedPaths.find((path) => path !== losingPath))
    expect(losingPath).toBeTruthy()
    expect(state.remove).toHaveBeenCalledWith([losingPath])
    expect(state.remove).toHaveBeenCalledWith([previousPath])
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
