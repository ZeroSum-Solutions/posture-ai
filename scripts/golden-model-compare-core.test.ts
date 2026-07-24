import { describe, expect, it } from 'vitest'
import {
  assertModelComparisonEvidence,
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
})
