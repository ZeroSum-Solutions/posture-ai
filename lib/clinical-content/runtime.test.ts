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

describe('clinicalContentAccess with the review gate removed', () => {
  test.each([
    ['production', undefined, undefined],
    ['production', '1', '1'],
    ['preview', undefined, undefined],
    [undefined, undefined, undefined],
  ])('serves the full catalog on %s with test=%s and unreviewed=%s', (vercelEnv, testMode, showUnreviewed) => {
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = vercelEnv
    if (testMode === undefined) delete process.env.POSTURE_TEST_MODE_ENABLED
    else process.env.POSTURE_TEST_MODE_ENABLED = testMode
    if (showUnreviewed === undefined) delete process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT
    else process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = showUnreviewed

    const access = clinicalContentAccess()
    expect(access.mode).toBe('open')
    expect(access.reason).toBe('clinical_content_gate_removed')
    expect(access.contentVersion).toBe(`clinical-content-open-${access.inventorySha256.slice(0, 12)}`)
    expect(Object.values(access.surfaces).every(Boolean)).toBe(true)
    expect(access.approvedMuscleSlugs.length).toBeGreaterThan(0)
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
