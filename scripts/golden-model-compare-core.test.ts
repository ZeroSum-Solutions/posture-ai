import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertModelComparisonEvidence,
  buildAccuracyRows,
  MODEL_COMPARISON_ASSET_SHA256,
  TIER_B_RELIABILITY_ONLY_PROTOCOL,
} from './golden-model-compare-core.mjs'

const CAPTURE_HMAC = `hmac-sha256:${'a'.repeat(64)}`
const ROOT = resolve(__dirname, '..')

function accuracyPayload(
  modelVariant: 'lite' | 'full',
  groundTruth: Record<string, number>,
  overrides: Record<string, unknown> = {},
) {
  return {
    studyPurpose: 'accuracy',
    protocolVersion: 'measured-reference-v1',
    modelVariant,
    modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256[modelVariant],
    sourceCaptureHmacSha256: CAPTURE_HMAC,
    frames: [],
    groundTruth,
    ...overrides,
  }
}

describe('golden model-comparison evidence boundary', () => {
  it('pins the model identities to the exact bundled asset bytes', () => {
    for (const variant of ['lite', 'full'] as const) {
      const asset = readFileSync(resolve(
        ROOT,
        `public/mediapipe/models/pose_landmarker_${variant}.task`,
      ))
      expect(
        `sha256:${createHash('sha256').update(asset).digest('hex')}`,
      ).toBe(MODEL_COMPARISON_ASSET_SHA256[variant])
    }
  })

  it('rejects the Tier B v2 reliability protocol', () => {
    expect(() => assertModelComparisonEvidence(
      { protocolVersion: TIER_B_RELIABILITY_ONLY_PROTOCOL },
      { protocolVersion: TIER_B_RELIABILITY_ONLY_PROTOCOL },
      'participant-01/front',
    )).toThrow(/reliability-only.*cannot adjudicate a model default/i)
  })

  it('rejects an explicitly repeatability-only payload', () => {
    expect(() => assertModelComparisonEvidence(
      { studyPurpose: 'repeatability' },
      {},
    )).toThrow(/repeatability evidence.*cannot adjudicate a model default/i)
  })

  it('allows only an explicitly marked accuracy-study payload', () => {
    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }),
      accuracyPayload('full', { trunk_lean: 8 }),
    )).not.toThrow()
  })

  it('rejects ambiguous legacy evidence without a positive accuracy marker', () => {
    expect(() => assertModelComparisonEvidence(
      { protocolVersion: 'measured-reference-v1', groundTruth: { trunk_lean: 8 } },
      { protocolVersion: 'measured-reference-v1', groundTruth: { trunk_lean: 8 } },
    )).toThrow(/explicit accuracy-study marker/i)
  })

  it('requires matching accuracy protocols and non-empty numeric ground truth', () => {
    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }, { protocolVersion: 'reference-v1' }),
      accuracyPayload('full', { trunk_lean: 8 }, { protocolVersion: 'reference-v2' }),
    )).toThrow(/matching.*protocolVersion/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', {}),
      accuracyPayload('full', {}),
    )).toThrow(/at least one measured metric/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: Number.NaN }),
      accuracyPayload('full', { trunk_lean: Number.NaN }),
    )).toThrow(/finite numbers/i)
  })

  it('binds model identity, exact asset hashes, and the same source capture', () => {
    expect(() => assertModelComparisonEvidence(
      accuracyPayload('full', { trunk_lean: 8 }),
      accuracyPayload('lite', { trunk_lean: 8 }),
    )).toThrow(/filename-designated lite and full/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }, {
        modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.full,
      }),
      accuracyPayload('full', { trunk_lean: 8 }),
    )).toThrow(/exact frozen lite and full model assets/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }),
      accuracyPayload('full', { trunk_lean: 8 }, {
        sourceCaptureHmacSha256: `hmac-sha256:${'b'.repeat(64)}`,
      }),
    )).toThrow(/same source capture HMAC/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }, {
        sourceCaptureHmacSha256: `sha256:${'a'.repeat(64)}`,
      }),
      accuracyPayload('full', { trunk_lean: 8 }),
    )).toThrow(/same source capture HMAC/i)
  })

  it('rejects unknown or privacy-bearing payload fields instead of ignoring them', () => {
    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }, {
        rawPhotoHash: `sha256:${'c'.repeat(64)}`,
      }),
      accuracyPayload('full', { trunk_lean: 8 }),
    )).toThrow(/only the exact governed evidence fields/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }),
      accuracyPayload('full', { trunk_lean: 8 }, {
        sourceFile: 'participant-name.jpg',
      }),
    )).toThrow(/only the exact governed evidence fields/i)
  })

  it('requires the same exact ground-truth keys and values for lite and full', () => {
    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }),
      accuracyPayload('full', { trunk_lean: 8, shoulder_tilt: 2 }),
    )).toThrow(/same exact metric key set/i)

    expect(() => assertModelComparisonEvidence(
      accuracyPayload('lite', { trunk_lean: 8 }),
      accuracyPayload('full', { trunk_lean: 9 }),
    )).toThrow(/identical measured values.*trunk_lean/i)

    const litePrototypeMetric = accuracyPayload(
      'lite',
      JSON.parse('{"__proto__":8,"trunk_lean":1}'),
    )
    const fullPrototypeMetric = accuracyPayload(
      'full',
      JSON.parse('{"__proto__":99,"trunk_lean":1}'),
    )
    expect(() => assertModelComparisonEvidence(
      litePrototypeMetric,
      fullPrototypeMetric,
    )).toThrow(/identical measured values.*__proto__/i)
  })

  it('compares every measured metric and fails when either model output omits one', () => {
    expect(buildAccuracyRows(
      'participant-01/front',
      [{ key: 'trunk_lean', deviation: 7 }],
      [{ key: 'trunk_lean', deviation: 9 }],
      { trunk_lean: 8 },
    )).toEqual([{
      name: 'participant-01/front',
      key: 'trunk_lean',
      liteDev: 7,
      fullDev: 9,
      delta: 2,
      liteErr: 1,
      fullErr: 1,
    }])

    expect(() => buildAccuracyRows(
      'participant-01/front',
      [{ key: 'trunk_lean', deviation: 7 }],
      [],
      { trunk_lean: 8 },
    )).toThrow(/measured metric trunk_lean.*missing/i)
  })
})
