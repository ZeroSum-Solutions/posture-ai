import { afterEach, describe, expect, test } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from './route'

const ORIGINAL_TEST_MODE = process.env.POSTURE_TEST_MODE_ENABLED
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV

afterEach(() => {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.POSTURE_TEST_MODE_ENABLED
  else process.env.POSTURE_TEST_MODE_ENABLED = ORIGINAL_TEST_MODE
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV
})

describe('GET /api/legal/documents', () => {
  test('returns the resolved legal snapshot in explicit local fixture mode', async () => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'

    const response = await GET(new NextRequest(
      'http://localhost/api/legal/documents?kind=subject_consent',
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      document: {
        schemaVersion: 1,
        kind: 'subject_consent',
        documentId: 'subject-consent-test-fixture-v1',
        version: 'test-1',
        isFixture: true,
      },
    })
  })

  test('fails closed when no approved production document exists', async () => {
    delete process.env.POSTURE_TEST_MODE_ENABLED
    process.env.VERCEL_ENV = 'production'

    const response = await GET(new NextRequest(
      'https://example.com/api/legal/documents?kind=terms',
    ))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Legal documents are temporarily unavailable.',
      code: 'legal_unavailable',
    })
  })

  test('rejects an unknown document kind', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/legal/documents?kind=not-a-document',
    ))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid legal document kind.',
      code: 'invalid_kind',
    })
  })
})
