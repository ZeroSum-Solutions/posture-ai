import {
  buildRepeatMatrix,
  testRetestReliability,
  type ReliabilityStats,
} from '../packages/posture-engine/src/reliability'
import { TIER_B_PROTOCOL_VERSION, type TierBPoseModel } from '../lib/pose/tierb-contract'

export const RELIABILITY_PROFILE_SCHEMA_VERSION = 1 as const
export const RELIABILITY_ALGORITHM_VERSION = 'icc-2-1-pooled-sd-mdc95-v1' as const
export const RELIABILITY_PROTOCOL_VERSION = TIER_B_PROTOCOL_VERSION
export const EXPECTED_REPEAT_IDS = ['1', '2', '3'] as const

const TIER_B_FILE_RE = /^([a-z0-9-]+)_(front|side|back)_([a-z0-9-]+)_r(\d+)\.landmarks\.json$/

export interface TierBFileName {
  pose: string
  view: 'front' | 'side' | 'back'
  device: string
  repeatId: string
}

export function parseTierBFileName(file: string): TierBFileName | null {
  const match = TIER_B_FILE_RE.exec(file)
  if (!match) return null
  return {
    pose: match[1],
    view: match[2] as TierBFileName['view'],
    device: match[3],
    repeatId: match[4],
  }
}

export function validateTierBProvenance(
  payload: { poseModel?: unknown; protocolVersion?: unknown },
  source: string,
): TierBPoseModel {
  if (payload.poseModel !== 'lite' && payload.poseModel !== 'full') {
    throw new Error(`${source} is missing a valid poseModel provenance field`)
  }
  if (payload.protocolVersion !== TIER_B_PROTOCOL_VERSION) {
    throw new Error(`${source} has incompatible protocolVersion ${payload.protocolVersion ?? 'missing'}`)
  }
  return payload.poseModel
}

export function assertCapturePoseModel(
  existing: TierBPoseModel,
  incoming: TierBPoseModel,
  captureKey: string,
): void {
  if (existing !== incoming) {
    throw new Error(`capture ${captureKey} mixes pose models ${existing} and ${incoming}`)
  }
}

export interface MetricCaptureRecord {
  caseKey: string
  repeatId: string
  deviationDeg: number
  severityPct: number
}

interface ReliabilitySeries<Unit extends string> {
  unit: Unit
  stats: ReliabilityStats | null
}

export interface MetricReliabilityProfile {
  repeatIds: string[]
  droppedCases: string[]
  deviationDeg: ReliabilitySeries<'deg'>
  severityPct: ReliabilitySeries<'percentage_points'>
}

export function buildMetricReliability(
  records: MetricCaptureRecord[],
  expectedRepeatIds: readonly string[] = EXPECTED_REPEAT_IDS,
): MetricReliabilityProfile {
  const deviation = buildRepeatMatrix(
    records.map(({ caseKey, repeatId, deviationDeg }) => ({ caseKey, repeatId, value: deviationDeg })),
    expectedRepeatIds,
  )
  const severity = buildRepeatMatrix(
    records.map(({ caseKey, repeatId, severityPct }) => ({ caseKey, repeatId, value: severityPct })),
    expectedRepeatIds,
  )

  return {
    repeatIds: deviation.repeatIds,
    droppedCases: deviation.droppedCases,
    deviationDeg: { unit: 'deg', stats: testRetestReliability(deviation.matrix) },
    severityPct: { unit: 'percentage_points', stats: testRetestReliability(severity.matrix) },
  }
}

export interface ReliabilityProfileInput {
  engineVersion: string
  poseModel: TierBPoseModel
  generatedAt: string
  nSubjects: number
  capturesAssessed: number
  unreliableFindingsExcluded: number
  perMetric: Record<string, MetricReliabilityProfile>
}

export function buildReliabilityProfile(input: ReliabilityProfileInput) {
  return {
    schemaVersion: RELIABILITY_PROFILE_SCHEMA_VERSION,
    algorithmVersion: RELIABILITY_ALGORITHM_VERSION,
    protocolVersion: RELIABILITY_PROTOCOL_VERSION,
    engineVersion: input.engineVersion,
    poseModel: input.poseModel,
    generatedAt: input.generatedAt,
    label: 'pilot' as const,
    consumerEligible: false as const,
    method: {
      icc: 'ICC(2,1): two-way random, absolute agreement, single measure',
      sem: 'pooled sample SD * sqrt(1 - clamp(ICC, 0, 1))',
      mdc95: '1.96 * sqrt(2) * SEM',
    },
    nSubjects: input.nSubjects,
    capturesAssessed: input.capturesAssessed,
    unreliableFindingsExcluded: input.unreliableFindingsExcluded,
    caveats: [
      'No confidence intervals are reported; this pilot profile must not gate report comparisons.',
      'Cases cluster within subjects, so case counts are not independent-subject counts.',
      'Unreliable findings are excluded, so this describes the reliable-gated pipeline.',
    ],
    perMetric: input.perMetric,
  }
}
