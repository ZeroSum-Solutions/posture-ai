import { describe, expect, it } from 'vitest'
import {
  TrainingLaunchMediaProjectionV1Schema,
  TrainingLaunchMediaRegistryEntryV1Schema,
} from './contract'

const authoredBinding = {
  catalogVersion: 'reviewed-catalog.v1',
  catalogOrigin: { kind: 'authored_catalog' as const },
  exerciseVersionId: 'goblet-squat.v1',
}

const reviewedSource = {
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
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'training-launch-media-entry.v1',
    binding: authoredBinding,
    ...reviewedSource,
    assets: {
      poster: {
        path: '/training-media/goblet-squat-v1.webp',
        alt: 'Goblet squat setup and lowered position.',
        width: 1200,
        height: 630,
      },
    },
    expiresAt: null,
    ...overrides,
  }
}

describe('TrainingLaunchMediaRegistryEntryV1Schema', () => {
  it('accepts a reviewed authored entry with only a same-origin poster', () => {
    expect(TrainingLaunchMediaRegistryEntryV1Schema.parse(entry()).assets.poster?.path)
      .toBe('/training-media/goblet-squat-v1.webp')
  })

  it('accepts a reviewed authored entry with only a same-origin video', () => {
    const parsed = TrainingLaunchMediaRegistryEntryV1Schema.parse(entry({
      assets: {
        video: {
          path: '/training-media/goblet-squat-v1.webm',
          mimeType: 'video/webm',
          width: 1280,
          height: 720,
        },
      },
    }))
    expect(parsed.assets.video?.mimeType).toBe('video/webm')
  })

  it('requires at least one usable asset for an available registry entry', () => {
    expect(TrainingLaunchMediaRegistryEntryV1Schema.safeParse(entry({ assets: {} })).success).toBe(false)
  })

  it.each([
    'https://cdn.example.test/goblet.webm',
    '//cdn.example.test/goblet.webm',
    '/training-media\\goblet.webm',
    '/training-media/goblet.webm\nnext',
    '/training-media/../goblet.webm',
  ])('rejects an asset path outside the normalized same-origin path contract: %s', path => {
    expect(TrainingLaunchMediaRegistryEntryV1Schema.safeParse(entry({
      assets: {
        video: { path, mimeType: 'video/webm', width: 1280, height: 720 },
      },
    })).success).toBe(false)
  })

  it('rejects synthetic fixture review as authority for an authored catalog', () => {
    expect(TrainingLaunchMediaRegistryEntryV1Schema.safeParse(entry({
      review: {
        kind: 'synthetic_fixture',
        fixtureId: 'fixture:media',
        fixtureHash: 'a'.repeat(64),
      },
    })).success).toBe(false)
  })

  it('requires synthetic review identity to match the exact catalog origin', () => {
    const synthetic = entry({
      binding: {
        catalogVersion: 'synthetic-media-catalog.v1',
        catalogOrigin: {
          kind: 'synthetic_fixture',
          source: 'server_fixture',
          fixtureId: 'fixture:media',
          fixtureHash: 'a'.repeat(64),
          label: 'Synthetic media fixture',
        },
        exerciseVersionId: 'synthetic-goblet.v1',
      },
      review: {
        kind: 'synthetic_fixture',
        fixtureId: 'fixture:other',
        fixtureHash: 'a'.repeat(64),
      },
    })
    expect(TrainingLaunchMediaRegistryEntryV1Schema.safeParse(synthetic).success).toBe(false)
  })
})

describe('TrainingLaunchMediaProjectionV1Schema', () => {
  it('rejects synthetic review authority in an authored available projection', () => {
    expect(TrainingLaunchMediaProjectionV1Schema.safeParse({
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'available',
      binding: authoredBinding,
      review: {
        kind: 'synthetic_fixture',
        fixtureId: 'fixture:media',
        fixtureHash: 'a'.repeat(64),
      },
      source: reviewedSource.source,
      assets: entry().assets,
      expiresAt: null,
    }).success).toBe(false)
  })

  it('does not permit usable asset paths on expired projections', () => {
    const expired = {
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'expired',
      binding: authoredBinding,
      ...reviewedSource,
      expiredAt: '2026-09-02T12:00:00Z',
      assets: entry().assets,
    }
    expect(TrainingLaunchMediaProjectionV1Schema.safeParse(expired).success).toBe(false)
  })
})
