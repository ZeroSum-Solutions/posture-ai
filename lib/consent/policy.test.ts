import { describe, expect, test } from 'vitest'

import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import { hashConsent } from './policy'

function fixtureDocument() {
  const resolution = resolveRuntimeLegalDocument(
    { kind: 'subject_consent' },
    { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview' },
  )
  if (!resolution.ok) throw new Error(resolution.message)
  return snapshotLegalDocument(resolution.document)
}

describe('hashConsent governed provenance', () => {
  test('is deterministic and binds the signer to the exact legal snapshot', () => {
    const document = fixtureDocument()
    const parts = {
      document,
      signerName: '  Morgan Example  ',
      signerRelationship: 'self',
      signedAt: '2026-07-20T02:00:00.000Z',
    }

    expect(hashConsent(parts)).toBe(hashConsent({ ...parts, signerName: 'morgan example' }))
    expect(hashConsent(parts)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashConsent(parts)).not.toBe(hashConsent({
      ...parts,
      document: { ...document, bodySha256: '0'.repeat(64) },
    }))
    expect(hashConsent(parts)).not.toBe(hashConsent({
      ...parts,
      document: { ...document, version: 'different-version' },
    }))
  })
})
