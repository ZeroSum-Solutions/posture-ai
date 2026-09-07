import { afterEach, describe, expect, test } from 'vitest'
import { clinicalContentAccess, clinicalContentAccessForOperation } from './runtime'

const original = {
  vercelEnv: process.env.VERCEL_ENV,
  testMode: process.env.POSTURE_TEST_MODE_ENABLED,
  showUnreviewed: process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT,
}

afterEach(() => {
  if (original.vercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = original.vercelEnv
  if (original.testMode === undefined) delete process.env.POSTURE_TEST_MODE_ENABLED
  else process.env.POSTURE_TEST_MODE_ENABLED = original.testMode
  if (original.showUnreviewed === undefined) delete process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT
  else process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = original.showUnreviewed
})

describe('clinicalContentAccess production fixture boundary', () => {
  test('allows the complete catalog only in an explicit non-production fixture', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = '1'

    expect(clinicalContentAccess().mode).toBe('test_fixture')
  })

  test('production cannot enable unreviewed content even when both fixture flags are set', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = '1'

    const access = clinicalContentAccess()
    expect(access.mode).toBe('disabled')
    expect(Object.values(access.surfaces).every((enabled) => !enabled)).toBe(true)
  })

  test('an authorized prototype operation can use unreviewed content on a production deployment', () => {
    process.env.VERCEL_ENV = 'production'

    const access = clinicalContentAccessForOperation({
      mode: 'prototype',
      isPrototype: true,
      practitionerId: '00000000-0000-4000-8000-000000000001',
    })

    expect(access.mode).toBe('prototype')
    expect(access.reason).toBe('explicit_prototype_operation')
    expect(Object.values(access.surfaces).every(Boolean)).toBe(true)
  })
})
