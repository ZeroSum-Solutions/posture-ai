import { describe, expect, it } from 'vitest'
import {
  assertModelComparisonEvidence,
  buildAccuracyRows,
  TIER_B_RELIABILITY_ONLY_PROTOCOL,
} from './golden-model-compare-core.mjs'

describe('golden model-comparison evidence boundary', () => {
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
      { studyPurpose: 'accuracy', protocolVersion: 'measured-reference-v1', groundTruth: { trunk_lean: 8 } },
      { studyPurpose: 'accuracy', protocolVersion: 'measured-reference-v1', groundTruth: { trunk_lean: 8 } },
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
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: 8 } },
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v2', groundTruth: { trunk_lean: 8 } },
    )).toThrow(/matching.*protocolVersion/i)

    expect(() => assertModelComparisonEvidence(
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: {} },
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: {} },
    )).toThrow(/at least one measured metric/i)

    expect(() => assertModelComparisonEvidence(
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: Number.NaN } },
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: Number.NaN } },
    )).toThrow(/finite numbers/i)
  })

  it('requires the same exact ground-truth keys and values for lite and full', () => {
    expect(() => assertModelComparisonEvidence(
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: 8 } },
      {
        studyPurpose: 'accuracy',
        protocolVersion: 'reference-v1',
        groundTruth: { trunk_lean: 8, shoulder_tilt: 2 },
      },
    )).toThrow(/same exact metric key set/i)

    expect(() => assertModelComparisonEvidence(
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: 8 } },
      { studyPurpose: 'accuracy', protocolVersion: 'reference-v1', groundTruth: { trunk_lean: 9 } },
    )).toThrow(/identical measured values.*trunk_lean/i)

    const litePrototypeMetric = JSON.parse(
      '{"studyPurpose":"accuracy","protocolVersion":"reference-v1","groundTruth":{"__proto__":8,"trunk_lean":1}}',
    )
    const fullPrototypeMetric = JSON.parse(
      '{"studyPurpose":"accuracy","protocolVersion":"reference-v1","groundTruth":{"__proto__":99,"trunk_lean":1}}',
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
