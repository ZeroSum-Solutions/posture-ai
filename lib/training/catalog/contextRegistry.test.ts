import { describe, expect, it, vi } from 'vitest'
import { createProgramLiveCatalogRegistry } from './liveRegistry'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from './syntheticSwapJourney'
import { TrainingCatalogV1Schema } from './types'
import { createTrainingCatalogResolver } from './contextRegistry'

const authoredCatalog = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1',
  catalogVersion: 'test-only-reviewed-authored.v1',
  origin: { kind: 'authored_catalog' },
  exercises: [{
    exerciseId: 'test-only-squat',
    exerciseVersionId: 'test-only-squat.v1',
    label: 'Test-only reviewed squat',
    movementPattern: 'knee_dominant',
    role: 'primary',
    preferenceRank: 0,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed',
    mediaStatus: 'reviewed_exact_variant',
    preparationSeconds: 30,
    secondsPerRep: 4,
    textInstruction: 'Test-only reviewed instruction.',
    progressionDefaults: {
      side: 'bilateral', rom: 'test-only-full', tempo: 'test-only-controlled', exposureType: 'standard',
    },
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_single_implement',
      implementCount: 1, holdingConfiguration: 'two_hands_single_implement',
      minimumCanonicalKg: '1', maximumCanonicalKg: '50',
    }],
  }],
  conditioningModes: [{
    modalityId: 'test-only-walking.v1',
    label: 'Test-only reviewed walking',
    preferenceRank: 0,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed',
    effortCue: 'Test-only reviewed effort cue.',
  }],
})

describe('context-aware training catalog resolver', () => {
  it('resolves only an exact registered authored version', () => {
    const resolver = createTrainingCatalogResolver(createProgramLiveCatalogRegistry([{
      catalog: authoredCatalog,
      conditioningModalityId: 'test-only-walking.v1',
    }]))

    expect(resolver.resolve(authoredCatalog.catalogVersion, authoredCatalog.origin))
      .toEqual(authoredCatalog)
    expect(resolver.resolve('unknown-authored.v1', { kind: 'authored_catalog' })).toBeNull()
  })

  it('never falls back from a synthetic context into the live registry', () => {
    const resolve = vi.fn(() => ({
      catalog: authoredCatalog,
      conditioningModalityId: 'test-only-walking.v1',
    }))
    const resolver = createTrainingCatalogResolver({ resolve })
    const origin = SYNTHETIC_SWAP_JOURNEY_CATALOG.origin

    expect(resolver.resolve(SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion, origin))
      .toBe(SYNTHETIC_SWAP_JOURNEY_CATALOG)
    expect(resolve).not.toHaveBeenCalled()

    if (origin.kind !== 'synthetic_fixture') throw new Error('expected synthetic fixture')
    expect(resolver.resolve(SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion, {
      ...origin,
      fixtureHash: '0'.repeat(64),
    })).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects a mismatched authored selection returned by an injected registry', () => {
    expect(createTrainingCatalogResolver({
      resolve: () => ({
        catalog: { ...authoredCatalog, catalogVersion: 'different.v1' },
        conditioningModalityId: 'test-only-walking.v1',
      }),
    }).resolve(authoredCatalog.catalogVersion, authoredCatalog.origin)).toBeNull()
  })
})
