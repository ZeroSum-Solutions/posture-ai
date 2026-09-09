import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRAINING_LAUNCH_MEDIA_REGISTRY,
  createTrainingLaunchMediaRegistry,
  resolveTrainingLaunchMedia,
} from './registry'

const origin = { kind: 'authored_catalog' as const }
const binding = {
  catalogVersion: 'reviewed-catalog.v1',
  catalogOrigin: origin,
  exerciseVersionId: 'goblet-squat.v1',
}

const registered = {
  schemaVersion: 'training-launch-media-entry.v1' as const,
  binding,
  review: {
    kind: 'qualified_exact_variant' as const,
    reviewRecordId: 'review:goblet-squat:v1',
    reviewedAt: '2026-09-01T12:00:00Z',
  },
  source: {
    rightsRecordId: 'rights:goblet-squat:v1',
    provider: 'example-provider',
    assetId: 'asset:goblet-squat:v1',
    sourcePageUrl: 'https://media.example.test/goblet-squat',
    author: 'Example Author',
    license: {
      identifier: 'CC-BY-SA-4.0',
      name: 'Creative Commons Attribution-ShareAlike 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
  },
  assets: {
    poster: {
      path: '/training-media/goblet-squat-v1.webp',
      alt: 'Goblet squat setup and lowered position.',
      width: 1200,
      height: 630,
    },
    video: {
      path: '/training-media/goblet-squat-v1.webm',
      mimeType: 'video/webm' as const,
      width: 1280,
      height: 720,
    },
  },
  expiresAt: '2026-10-01T00:00:00Z',
}

const evaluatedAt = '2026-09-09T12:00:00Z'

describe('training launch media registry', () => {
  it('resolves only the exact stored catalog, origin, and exercise tuple', () => {
    const registry = createTrainingLaunchMediaRegistry([registered])
    expect(resolveTrainingLaunchMedia(registry, { binding, evaluatedAt })).toMatchObject({
      status: 'available',
      binding,
      assets: registered.assets,
    })

    for (const mismatchedBinding of [
      { ...binding, catalogVersion: 'other-catalog.v1' },
      { ...binding, exerciseVersionId: 'other-exercise.v1' },
      {
        ...binding,
        catalogOrigin: {
          kind: 'synthetic_fixture' as const,
          source: 'server_fixture' as const,
          fixtureId: 'fixture:media',
          fixtureHash: 'a'.repeat(64),
          label: 'Synthetic media fixture',
        },
      },
    ]) {
      expect(resolveTrainingLaunchMedia(registry, { binding: mismatchedBinding, evaluatedAt }))
        .toEqual({
          schemaVersion: 'training-launch-media-projection.v1',
          status: 'missing',
          binding: mismatchedBinding,
          reason: 'not_registered',
        })
    }
  })

  it('expires at the exact boundary and removes usable asset paths', () => {
    const registry = createTrainingLaunchMediaRegistry([registered])
    expect(resolveTrainingLaunchMedia(registry, {
      binding,
      evaluatedAt: '2026-10-01T00:00:00Z',
    })).toEqual({
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'expired',
      binding,
      review: registered.review,
      source: registered.source,
      expiredAt: '2026-10-01T00:00:00Z',
    })
  })

  it('keeps a permanent entry available when expiresAt is null', () => {
    const registry = createTrainingLaunchMediaRegistry([{ ...registered, expiresAt: null }])
    expect(resolveTrainingLaunchMedia(registry, {
      binding,
      evaluatedAt: '2126-09-09T12:00:00Z',
    }).status).toBe('available')
  })

  it('keeps the production default empty', () => {
    expect(resolveTrainingLaunchMedia(EMPTY_TRAINING_LAUNCH_MEDIA_REGISTRY, { binding, evaluatedAt }))
      .toEqual({
        schemaVersion: 'training-launch-media-projection.v1',
        status: 'missing',
        binding,
        reason: 'not_registered',
      })
  })

  it('does not expose mutable registry state', () => {
    const input = structuredClone(registered)
    const registry = createTrainingLaunchMediaRegistry([input])
    input.assets.poster.path = '/training-media/changed.webp'

    const result = resolveTrainingLaunchMedia(registry, { binding, evaluatedAt })
    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('Expected available media')
    expect(result.assets.poster?.path).toBe('/training-media/goblet-squat-v1.webp')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.assets)).toBe(true)
  })

  it('rejects duplicate exact bindings instead of shadowing one entry', () => {
    expect(() => createTrainingLaunchMediaRegistry([registered, registered]))
      .toThrow('Launch media registry bindings must be unique.')
  })
})
