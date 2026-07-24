import { describe, expect, it } from 'vitest'
import {
  TIER_B_ANALYSIS_VERSION,
  TIER_B_PROTOCOL_VERSION,
} from '../lib/pose/tierb-contract'
import {
  TIERB_ANALYSIS_METRIC_CELLS,
  type TierBAnalysisInput,
  type TierBMeasurement,
} from '../lib/reliability/tierb-analysis'
import { sha256TierB } from '../lib/reliability/tierb-canonical'
import type { TierBPublicEnvelope } from '../lib/reliability/tierb-validator'
import {
  analyzeAuthorizedTierBInput,
  RELIABILITY_INPUT_SCHEMA_VERSION,
  validateTierBAnalysisInputEnvelope,
  type TierBAnalysisInputEnvelope,
} from './golden-repeatability-core'

function authorization(): TierBPublicEnvelope {
  return {
    schemaVersion: 'tierb-public-envelope-v1',
    packetId: 'fixture',
    state: 'collection_authorized',
    parentPublicEnvelopeSha256: `sha256:${'1'.repeat(64)}`,
    repositoryCommit: '2'.repeat(40),
    configurationSha256: `sha256:${'3'.repeat(64)}`,
    restrictedEnvelopeSha256: `sha256:${'4'.repeat(64)}`,
    payload: {},
    payloadSha256: `sha256:${'5'.repeat(64)}`,
    transition: null,
  }
}

function input(): TierBAnalysisInput {
  const participantIds = Array.from(
    { length: 12 },
    (_, index) => `cluster-${String(index + 1).padStart(2, '0')}`,
  )
  const deviceIds = ['device-a', 'device-b']
  const records: TierBMeasurement[] = participantIds.flatMap(
    (participantId, participantIndex) =>
      deviceIds.flatMap((deviceId, deviceIndex) =>
        [1, 2, 3].map((repeatId, repeatIndex) => ({
          participantId,
          deviceId,
          metricId: 'anterior_imbalanced_shoulders',
          view: 'front' as const,
          repeatId: repeatId as 1 | 2 | 3,
          pose: 'neutral' as const,
          unit: 'percentage_points' as const,
          sourceField: 'severityPct' as const,
          reliable: true,
          value: 10 + participantIndex + deviceIndex * 0.2 + repeatIndex * 0.1,
        })),
      ),
  )
  return {
    participantIds,
    deviceIds,
    metricCells: TIERB_ANALYSIS_METRIC_CELLS,
    records,
    bootstrapSeed: 'runner-fixture',
  }
}

function envelope(
  authorized = authorization(),
): TierBAnalysisInputEnvelope {
  const analysisInput = input()
  return {
    schemaVersion: RELIABILITY_INPUT_SCHEMA_VERSION,
    protocolVersion: TIER_B_PROTOCOL_VERSION,
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    authorizationPublicEnvelopeSha256: sha256TierB(authorized),
    repositoryCommit: authorized.repositoryCommit!,
    configurationSha256: authorized.configurationSha256!,
    unit: 'percentage_points',
    sourceField: 'severityPct',
    input: analysisInput,
    inputSha256: sha256TierB(analysisInput),
  }
}

describe('Tier B v2 authorized repeatability adapter', () => {
  it('analyzes only input bound to the exact collection authorization', () => {
    const authorized = authorization()
    const result = analyzeAuthorizedTierBInput(envelope(authorized), authorized)
    const shoulders = result.primary.filter((entry) =>
      entry.metricId === 'anterior_imbalanced_shoulders')

    expect(shoulders).toHaveLength(2)
    expect(shoulders.every((entry) => entry.isEligible)).toBe(true)
    expect(result.consumerEligible).toBe(false)
  })

  it('rejects prepared state, wrong units, and stale row hashes', () => {
    const authorized = authorization()
    const prepared = { ...authorized, state: 'prepared' as const }
    expect(() => validateTierBAnalysisInputEnvelope(
      envelope(authorized),
      prepared,
    )).toThrow('collection_authorized')

    expect(() => validateTierBAnalysisInputEnvelope({
      ...envelope(authorized),
      unit: 'degrees' as TierBAnalysisInputEnvelope['unit'],
    }, authorized)).toThrow('severityPct')

    expect(() => validateTierBAnalysisInputEnvelope({
      ...envelope(authorized),
      inputSha256: `sha256:${'f'.repeat(64)}`,
    }, authorized)).toThrow('hash')
  })
})
