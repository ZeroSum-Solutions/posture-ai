import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG } from './syntheticStarter'
import { createProgramLiveCatalogRegistry, PROGRAM_LIVE_CATALOG_REGISTRY } from './liveRegistry'

function authoredSelection(version: string) {
  return {
    catalog: {
      ...SYNTHETIC_STARTER_CATALOG,
      catalogVersion: version,
      origin: { kind: 'authored_catalog' as const },
      exercises: SYNTHETIC_STARTER_CATALOG.exercises.map(exercise => ({
        ...exercise,
        contentReviewStatus: 'reviewed' as const,
        mediaStatus: 'reviewed_exact_variant' as const,
      })),
      conditioningModes: SYNTHETIC_STARTER_CATALOG.conditioningModes.map(mode => ({
        ...mode,
        contentReviewStatus: 'reviewed' as const,
      })),
    },
    conditioningModalityId: SYNTHETIC_STARTER_CATALOG.conditioningModes[0]!.modalityId,
  }
}

describe('live program catalog registry', () => {
  it('keeps the production registry empty until reviewed content is registered in source', () => {
    expect(PROGRAM_LIVE_CATALOG_REGISTRY.resolve()).toBeNull()
    expect(PROGRAM_LIVE_CATALOG_REGISTRY.resolve('unknown')).toBeNull()
  })

  it('resolves only exact source-registered authored catalog versions', () => {
    const selection = authoredSelection('authored-test-catalog.v1')
    const registry = createProgramLiveCatalogRegistry([selection])

    expect(registry.resolve()).toBe(selection)
    expect(registry.resolve('authored-test-catalog.v1')).toBe(selection)
    expect(registry.resolve('another-catalog.v1')).toBeNull()
  })

  it('rejects synthetic and duplicate catalog registrations', () => {
    expect(() => createProgramLiveCatalogRegistry([{
      catalog: SYNTHETIC_STARTER_CATALOG,
      conditioningModalityId: SYNTHETIC_STARTER_CATALOG.conditioningModes[0]!.modalityId,
    }])).toThrow(/authored catalog/i)
    const selection = authoredSelection('authored-test-catalog.v1')
    expect(() => createProgramLiveCatalogRegistry([selection, selection])).toThrow(/unique/i)
  })

  it('rejects active content that lacks reviewed live provenance', () => {
    const selection = authoredSelection('unreviewed-test-catalog.v1')
    expect(() => createProgramLiveCatalogRegistry([{ ...selection, catalog: {
      ...selection.catalog,
      exercises: selection.catalog.exercises.map((exercise, index) => index === 0
        ? { ...exercise, contentReviewStatus: 'unreviewed' as const }
        : exercise),
    } }])).toThrow(/reviewed exact variants/i)
  })
})
