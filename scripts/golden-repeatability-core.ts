import {
  TIER_B_ANALYSIS_VERSION,
  TIER_B_PROTOCOL_VERSION,
} from '../lib/pose/tierb-contract'
import {
  analyzeTierBReliability,
  type TierBAnalysisInput,
  type TierBAnalysisResult,
} from '../lib/reliability/tierb-analysis'
import {
  sha256TierB,
  type TierBSha256,
} from '../lib/reliability/tierb-canonical'
import type { TierBPublicEnvelope } from '../lib/reliability/tierb-validator'

export const RELIABILITY_PROTOCOL_VERSION = TIER_B_PROTOCOL_VERSION
export const RELIABILITY_ANALYSIS_VERSION = TIER_B_ANALYSIS_VERSION
export const RELIABILITY_INPUT_SCHEMA_VERSION = 'tierb-analysis-input-v1' as const

export interface TierBAnalysisInputEnvelope {
  schemaVersion: typeof RELIABILITY_INPUT_SCHEMA_VERSION
  protocolVersion: typeof TIER_B_PROTOCOL_VERSION
  analysisVersion: typeof TIER_B_ANALYSIS_VERSION
  authorizationPublicEnvelopeSha256: TierBSha256
  repositoryCommit: string
  configurationSha256: TierBSha256
  unit: 'percentage_points'
  sourceField: 'severityPct'
  input: TierBAnalysisInput
  inputSha256: TierBSha256
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

/**
 * Binds the restricted, deidentified analysis rows to the exact signed
 * collection authorization. This adapter intentionally accepts no legacy
 * directory/filename convention and no degree-valued input.
 */
export function validateTierBAnalysisInputEnvelope(
  envelope: TierBAnalysisInputEnvelope,
  authorization: TierBPublicEnvelope,
): void {
  if (!envelope || typeof envelope !== 'object' || !exactKeys(envelope, [
    'schemaVersion',
    'protocolVersion',
    'analysisVersion',
    'authorizationPublicEnvelopeSha256',
    'repositoryCommit',
    'configurationSha256',
    'unit',
    'sourceField',
    'input',
    'inputSha256',
  ])) {
    throw new Error('Tier B analysis input envelope has unknown or missing fields')
  }
  if (authorization.state !== 'collection_authorized') {
    throw new Error('Tier B analysis requires a validated collection_authorized packet')
  }
  if (envelope.schemaVersion !== RELIABILITY_INPUT_SCHEMA_VERSION
    || envelope.protocolVersion !== TIER_B_PROTOCOL_VERSION
    || envelope.analysisVersion !== TIER_B_ANALYSIS_VERSION) {
    throw new Error('Tier B analysis input version differs from the frozen contract')
  }
  if (envelope.authorizationPublicEnvelopeSha256 !== sha256TierB(authorization)
    || envelope.repositoryCommit !== authorization.repositoryCommit
    || envelope.configurationSha256 !== authorization.configurationSha256) {
    throw new Error('Tier B analysis input is not bound to the exact collection authorization')
  }
  if (envelope.unit !== 'percentage_points' || envelope.sourceField !== 'severityPct') {
    throw new Error('Tier B analysis input must use severityPct percentage points')
  }
  if (envelope.input.participantIds.some((participantId) =>
    !/^cluster-[0-9]{2}$/.test(participantId))) {
    throw new Error('Tier B analysis input must use deidentified cluster-XX participant IDs')
  }
  if (envelope.inputSha256 !== sha256TierB(envelope.input)) {
    throw new Error('Tier B analysis input hash does not match its canonical rows')
  }
}

export function analyzeAuthorizedTierBInput(
  envelope: TierBAnalysisInputEnvelope,
  authorization: TierBPublicEnvelope,
): TierBAnalysisResult {
  validateTierBAnalysisInputEnvelope(envelope, authorization)
  return analyzeTierBReliability(envelope.input)
}
