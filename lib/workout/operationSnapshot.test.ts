import { describe, expect, test } from 'vitest'
import type { SessionSnapshot } from './generateWorkoutSession'
import {
  isSessionSnapshotForOperation,
  mintPrototypeSessionSnapshot,
} from './operationSnapshot'

const base: SessionSnapshot = {
  version: 1,
  week: 1,
  capability: 'standard',
  priorities: [],
  items: [],
  estimatedDurationSec: 0,
  disclaimer: 'Screening only.',
}

const practitionerId = '00000000-0000-4000-8000-000000000001'
const catalog = { version: 'clinical-content-prototype-v1', inventorySha256: 'a'.repeat(64) }

describe('operation workout snapshots', () => {
  test('mints prototype provenance without a legal document or clinical approval claim', () => {
    const snapshot = mintPrototypeSessionSnapshot(base, catalog)

    expect(snapshot).toMatchObject({
      version: 4,
      operationMode: 'prototype',
      contentState: 'prototype_unreviewed',
      clinicalContent: catalog,
    })
    expect(snapshot).not.toHaveProperty('legalNotice')
  })

  test('admits the prototype snapshot only for the matching prototype operation and catalog', () => {
    const snapshot = mintPrototypeSessionSnapshot(base, catalog)

    expect(isSessionSnapshotForOperation(snapshot, {
      mode: 'prototype', isPrototype: true, practitionerId,
    }, catalog)).toBe(true)
    expect(isSessionSnapshotForOperation(snapshot, {
      mode: 'governed', isPrototype: false, practitionerId,
    }, catalog)).toBe(false)
    expect(isSessionSnapshotForOperation(snapshot, {
      mode: 'prototype', isPrototype: true, practitionerId,
    }, { ...catalog, inventorySha256: 'b'.repeat(64) })).toBe(false)
  })
})
