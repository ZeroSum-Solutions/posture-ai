import { createHash } from 'node:crypto'
import {
  testRetestReliability,
  type ReliabilityStats,
} from '../../packages/posture-engine/src/reliability'
import {
  TIER_B_ANALYSIS_VERSION,
  TIER_B_METRIC_REGISTRY,
  TIER_B_REPEAT_IDS,
  TIER_B_VIEWS,
  type TierBRepeatId,
  type TierBView,
} from '../pose/tierb-contract'

export const TIERB_REPEAT_IDS = TIER_B_REPEAT_IDS
export const TIERB_VIEWS = TIER_B_VIEWS
export const TIERB_MIN_COMPLETE_PARTICIPANTS = 12
export const TIERB_MAX_METRIC_CELL_MISSINGNESS = 0.2
export const TIERB_BOOTSTRAP_ATTEMPTS = 10_000
export const TIERB_MIN_VALID_BOOTSTRAP_ATTEMPTS = 9_500

export interface TierBMetricCell {
  metricId: string
  view: TierBView
}

export const TIERB_ANALYSIS_METRIC_CELLS: readonly TierBMetricCell[] =
  TIER_B_METRIC_REGISTRY
    .filter((metric) => metric.status === 'candidate')
    .flatMap((metric) =>
      metric.requiredViews.map((view) => ({ metricId: metric.key, view })))

export interface TierBMeasurement {
  participantId: string
  deviceId: string
  metricId: string
  view: TierBView
  repeatId: TierBRepeatId
  pose: 'neutral'
  unit: 'percentage_points'
  sourceField: 'severityPct'
  reliable: boolean
  value: number | null
}

export interface TierBAnalysisInput {
  /** The same expected participants for every exact-device analysis. */
  participantIds: readonly string[]
  /** The protocol requires exactly two distinct physical device identifiers. */
  deviceIds: readonly string[]
  /** Metric/view combinations expected for every participant, device and repeat. */
  metricCells: readonly TierBMetricCell[]
  records: readonly TierBMeasurement[]
  /** Public, non-secret seed recorded in the statistical receipt. */
  bootstrapSeed: string
}

export interface PercentileInterval {
  lower: number
  median: number
  upper: number
  confidenceLevel: 0.95
  percentileMethod: 'type-7'
}

export interface TierBBootstrapResult {
  method: 'participant-cluster-sha256-counter'
  seed: string
  requestedAttempts: number
  validAttempts: number
  invalidAttempts: number
  minimumValidAttempts: number
  hasSufficientValidAttempts: boolean
  invalidReasonCounts: Readonly<Record<string, number>>
  intervals: {
    icc21: PercentileInterval | null
    semAgreement: PercentileInterval | null
    mdc95: PercentileInterval | null
  }
}

export type TierBPrimaryFailureReason =
  | 'fewer-than-12-complete-participants'
  | 'metric-cell-missingness-over-20-percent'
  | 'bootstrap-fewer-than-9500-valid-attempts'
  | 'undefined-reliability-statistics'

export interface TierBPrimaryAnalysis {
  scope: 'primary-exact-device'
  deviceId: string
  metricId: string
  view: TierBView
  expectedParticipants: number
  completeParticipants: number
  observedMetricCells: number
  expectedMetricCells: number
  missingMetricCells: number
  absentMetricCells: number
  unreliableMetricCells: number
  missingness: number
  isEligible: boolean
  failureReasons: TierBPrimaryFailureReason[]
  stats: ReliabilityStats | null
  bootstrap: TierBBootstrapResult | null
}

export interface TierBPooledDescriptive {
  scope: 'pooled-descriptive-only'
  metricId: string
  view: TierBView
  deviceIds: string[]
  participantCount: number
  measurementCount: number
  mean: number | null
  sampleSd: number | null
}

export interface TierBAnalysisResult {
  schemaVersion: 'tierb-analysis-v1'
  analysisVersion: typeof TIER_B_ANALYSIS_VERSION
  primaryUnit: 'percentage_points'
  /**
   * Analysis alone never enables a consumer value. Adjudication may derive a
   * metric MDC only from bootstrap.intervals.mdc95.upper across every required
   * passing device/view cell.
   */
  consumerEligible: false
  protocol: {
    pose: 'neutral'
    repeatIds: typeof TIERB_REPEAT_IDS
    primaryGrouping: 'exact-device'
    independentCluster: 'participant'
  }
  primary: TierBPrimaryAnalysis[]
  /** Never contains ICC, SEM or MDC; cross-device pooling is descriptive only. */
  pooledDescriptive: {
    primary: false
    consumerEligible: false
    groups: TierBPooledDescriptive[]
  }
}

export interface ParticipantBootstrapOptions {
  seed: string
  attempts?: number
  minimumValidAttempts?: number
}

interface ValidatedInput {
  participantIds: string[]
  deviceIds: string[]
  metricCells: TierBMetricCell[]
  recordsByCell: Map<string, TierBMeasurement>
}

function assertDistinctNonempty(values: readonly string[], label: string): string[] {
  if (values.length === 0 || values.some((value) => value.trim().length === 0)) {
    throw new Error(`${label} must contain non-empty identifiers`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`)
  }
  return [...values]
}

function exactObjectKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function metricCellKey(metricId: string, view: TierBView): string {
  return `${metricId}\u0000${view}`
}

function recordCellKey(record: Pick<TierBMeasurement,
  'participantId' | 'deviceId' | 'metricId' | 'view' | 'repeatId'>): string {
  return [
    record.participantId,
    record.deviceId,
    record.metricId,
    record.view,
    record.repeatId,
  ].join('\u0000')
}

function validateInput(input: TierBAnalysisInput): ValidatedInput {
  if (!input || typeof input !== 'object' || !exactObjectKeys(input, [
    'participantIds',
    'deviceIds',
    'metricCells',
    'records',
    'bootstrapSeed',
  ])) {
    throw new Error('Tier B analysis input has unknown or missing fields')
  }
  const participantIds = assertDistinctNonempty(input.participantIds, 'participantIds')
  if (participantIds.length < 12 || participantIds.length > 15) {
    throw new Error(
      `Tier B requires 12 to 15 participants; received ${participantIds.length}`,
    )
  }
  const deviceIds = assertDistinctNonempty(input.deviceIds, 'deviceIds')
  if (deviceIds.length !== 2) {
    throw new Error(`Tier B requires exactly two devices; received ${deviceIds.length}`)
  }
  if (input.bootstrapSeed.trim().length === 0) {
    throw new Error('bootstrapSeed must be non-empty')
  }
  if (input.metricCells.length === 0) {
    throw new Error('metricCells must not be empty')
  }

  const expectedMetricKeys = new Set(
    TIERB_ANALYSIS_METRIC_CELLS.map((cell) => metricCellKey(cell.metricId, cell.view)),
  )
  const metricKeys = new Set<string>()
  const metricCells = input.metricCells.map((cell) => {
    if (!cell || typeof cell !== 'object' || !exactObjectKeys(cell, ['metricId', 'view'])) {
      throw new Error('Tier B metric cell has unknown or missing fields')
    }
    if (cell.metricId.trim().length === 0) {
      throw new Error('metricId must be non-empty')
    }
    if (!TIERB_VIEWS.includes(cell.view)) {
      throw new Error(`unexpected Tier B view: ${cell.view}`)
    }
    const key = metricCellKey(cell.metricId, cell.view)
    if (metricKeys.has(key)) {
      throw new Error(`duplicate metric cell: ${cell.metricId}/${cell.view}`)
    }
    metricKeys.add(key)
    return { ...cell }
  })
  if (
    metricKeys.size !== expectedMetricKeys.size
    || [...expectedMetricKeys].some((key) => !metricKeys.has(key))
  ) {
    throw new Error('metricCells must equal the frozen candidate metric/view registry')
  }

  const participants = new Set(participantIds)
  const devices = new Set(deviceIds)
  const recordsByCell = new Map<string, TierBMeasurement>()
  for (const record of input.records) {
    if (!record || typeof record !== 'object' || !exactObjectKeys(record, [
      'participantId',
      'deviceId',
      'metricId',
      'view',
      'repeatId',
      'pose',
      'unit',
      'sourceField',
      'reliable',
      'value',
    ])) {
      throw new Error('Tier B measurement has unknown or missing fields')
    }
    if (record.pose !== 'neutral') {
      throw new Error(`Tier B reliability analysis is neutral-only; received ${record.pose}`)
    }
    if (record.unit !== 'percentage_points' || record.sourceField !== 'severityPct') {
      throw new Error('Tier B primary measurements must bind the severityPct percentage-point output')
    }
    if (!participants.has(record.participantId)) {
      throw new Error(`unexpected participant: ${record.participantId}`)
    }
    if (!devices.has(record.deviceId)) {
      throw new Error(`unexpected device: ${record.deviceId}`)
    }
    if (!metricKeys.has(metricCellKey(record.metricId, record.view))) {
      throw new Error(`unexpected metric cell: ${record.metricId}/${record.view}`)
    }
    if (!TIERB_REPEAT_IDS.includes(record.repeatId)) {
      throw new Error(`unexpected repeat: ${record.repeatId}`)
    }
    if (typeof record.reliable !== 'boolean') {
      throw new Error('Tier B measurement reliable must be a boolean')
    }
    if (
      record.value !== null
      && (!Number.isFinite(record.value) || record.value < 0 || record.value > 100)
    ) {
      throw new Error('Tier B percentage-point values must be finite within [0, 100] or null')
    }
    if (record.reliable && record.value === null) {
      throw new Error('a reliable Tier B measurement must have a finite value')
    }
    if (!record.reliable && record.value !== null) {
      throw new Error('an unreliable Tier B measurement must use null, never a numeric value')
    }
    const key = recordCellKey(record)
    if (recordsByCell.has(key)) {
      throw new Error(`duplicate Tier B measurement cell: ${key.replaceAll('\u0000', '/')}`)
    }
    recordsByCell.set(key, { ...record })
  }

  return { participantIds, deviceIds, metricCells, recordsByCell }
}

function meanAndSampleSd(values: readonly number[]): {
  mean: number | null
  sampleSd: number | null
} {
  if (values.length === 0) return { mean: null, sampleSd: null }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (values.length === 1) return { mean, sampleSd: null }
  const sumSquaredDeviations = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  )
  return {
    mean,
    sampleSd: Math.sqrt(sumSquaredDeviations / (values.length - 1)),
  }
}

/** Hyndman-Fan type-7 percentile, matching the R/NumPy default interpolation. */
export function type7Percentile(sortedValues: readonly number[], probability: number): number {
  if (sortedValues.length === 0) {
    throw new Error('cannot compute a percentile of an empty sample')
  }
  if (probability < 0 || probability > 1 || !Number.isFinite(probability)) {
    throw new Error('percentile probability must be finite and within [0, 1]')
  }
  if (sortedValues.some((value) => !Number.isFinite(value))) {
    throw new Error('percentile sample values must be finite')
  }
  for (let index = 1; index < sortedValues.length; index += 1) {
    if (sortedValues[index] < sortedValues[index - 1]) {
      throw new Error('percentile sample must be sorted ascending')
    }
  }

  const position = (sortedValues.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const fraction = position - lowerIndex
  const lower = sortedValues[lowerIndex]
  const upper = sortedValues[Math.min(lowerIndex + 1, sortedValues.length - 1)]
  return lower + fraction * (upper - lower)
}

function percentileInterval(values: number[]): PercentileInterval | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return {
    lower: type7Percentile(sorted, 0.025),
    median: type7Percentile(sorted, 0.5),
    upper: type7Percentile(sorted, 0.975),
    confidenceLevel: 0.95,
    percentileMethod: 'type-7',
  }
}

function createSha256CounterRandom(seed: string): () => number {
  let counter = 0
  return () => {
    const counterBytes = Buffer.alloc(8)
    counterBytes.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0)
    counterBytes.writeUInt32BE(counter >>> 0, 4)
    counter += 1
    const digest = createHash('sha256')
      .update('posture-ai-tierb-participant-bootstrap-v1')
      .update('\0')
      .update(seed)
      .update('\0')
      .update(counterBytes)
      .digest()
    // 48 bits are exactly representable in a JavaScript number.
    return digest.readUIntBE(0, 6) / 281_474_976_710_656
  }
}

function primaryBootstrapSeed(
  studySeed: string,
  deviceId: string,
  metricId: string,
  view: TierBView,
): string {
  return `sha256:${createHash('sha256')
    .update('posture-ai-tierb-primary-bootstrap-seed-v1')
    .update('\0')
    .update(studySeed)
    .update('\0')
    .update(deviceId)
    .update('\0')
    .update(metricId)
    .update('\0')
    .update(view)
    .digest('hex')}`
}

function validateBootstrapMatrix(matrix: readonly (readonly number[])[]): number[][] {
  if (matrix.length < 3) {
    throw new Error('participant bootstrap requires at least three participant rows')
  }
  const repeatCount = matrix[0]?.length ?? 0
  if (repeatCount < 2) {
    throw new Error('participant bootstrap requires at least two repeats')
  }
  return matrix.map((row) => {
    if (row.length !== repeatCount) {
      throw new Error(`ragged bootstrap matrix: expected ${repeatCount}, got ${row.length}`)
    }
    if (row.some((value) => !Number.isFinite(value))) {
      throw new Error('bootstrap matrix values must be finite')
    }
    return [...row]
  })
}

/**
 * Resamples whole participant rows. Each requested attempt is consumed once;
 * invalid draws are counted and never retried.
 */
export function participantClusterBootstrap(
  inputMatrix: readonly (readonly number[])[],
  options: ParticipantBootstrapOptions,
): TierBBootstrapResult {
  const matrix = validateBootstrapMatrix(inputMatrix)
  if (options.seed.trim().length === 0) {
    throw new Error('participant bootstrap seed must be non-empty')
  }
  const attempts = options.attempts ?? TIERB_BOOTSTRAP_ATTEMPTS
  const minimumValidAttempts = options.minimumValidAttempts
    ?? TIERB_MIN_VALID_BOOTSTRAP_ATTEMPTS
  if (!Number.isInteger(attempts) || attempts <= 0) {
    throw new Error('bootstrap attempts must be a positive integer')
  }
  if (
    !Number.isInteger(minimumValidAttempts)
    || minimumValidAttempts < 0
    || minimumValidAttempts > attempts
  ) {
    throw new Error('minimum valid bootstrap attempts must be within [0, attempts]')
  }

  const random = createSha256CounterRandom(options.seed)
  const iccValues: number[] = []
  const semAgreementValues: number[] = []
  const mdcValues: number[] = []
  const invalidReasonCounts: Record<string, number> = {}

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sampled = Array.from({ length: matrix.length }, () => {
      const participantIndex = Math.floor(random() * matrix.length)
      return matrix[participantIndex]
    })
    const stats = testRetestReliability(sampled)
    if (stats === null) {
      invalidReasonCounts['undefined-reliability-statistics'] =
        (invalidReasonCounts['undefined-reliability-statistics'] ?? 0) + 1
      continue
    }
    iccValues.push(stats.icc21)
    semAgreementValues.push(stats.semAgreement)
    mdcValues.push(stats.mdc95)
  }

  const validAttempts = iccValues.length
  return {
    method: 'participant-cluster-sha256-counter',
    seed: options.seed,
    requestedAttempts: attempts,
    validAttempts,
    invalidAttempts: attempts - validAttempts,
    minimumValidAttempts,
    hasSufficientValidAttempts: validAttempts >= minimumValidAttempts,
    invalidReasonCounts,
    intervals: {
      icc21: percentileInterval(iccValues),
      semAgreement: percentileInterval(semAgreementValues),
      mdc95: percentileInterval(mdcValues),
    },
  }
}

function analyzePrimaryGroup(
  validated: ValidatedInput,
  deviceId: string,
  metricCell: TierBMetricCell,
  bootstrapSeed: string,
): TierBPrimaryAnalysis {
  const completeMatrix: number[][] = []
  let observedMetricCells = 0
  let absentMetricCells = 0
  let unreliableMetricCells = 0

  for (const participantId of validated.participantIds) {
    const row: number[] = []
    let isComplete = true
    for (const repeatId of TIERB_REPEAT_IDS) {
      const record = validated.recordsByCell.get(recordCellKey({
        participantId,
        deviceId,
        metricId: metricCell.metricId,
        view: metricCell.view,
        repeatId,
      }))
      // Unreliable and absent values are missing. They are never zero-filled.
      if (!record) {
        absentMetricCells += 1
        isComplete = false
        continue
      }
      if (!record.reliable || record.value === null) {
        unreliableMetricCells += 1
        isComplete = false
        continue
      }
      observedMetricCells += 1
      row.push(record.value)
    }
    if (isComplete) completeMatrix.push(row)
  }

  const expectedMetricCells = validated.participantIds.length * TIERB_REPEAT_IDS.length
  const missingMetricCells = expectedMetricCells - observedMetricCells
  const missingness = missingMetricCells / expectedMetricCells
  const failureReasons: TierBPrimaryFailureReason[] = []
  if (completeMatrix.length < TIERB_MIN_COMPLETE_PARTICIPANTS) {
    failureReasons.push('fewer-than-12-complete-participants')
  }
  if (missingness > TIERB_MAX_METRIC_CELL_MISSINGNESS) {
    failureReasons.push('metric-cell-missingness-over-20-percent')
  }

  let stats: ReliabilityStats | null = null
  let bootstrap: TierBBootstrapResult | null = null
  if (failureReasons.length === 0) {
    stats = testRetestReliability(completeMatrix)
    if (stats === null) {
      failureReasons.push('undefined-reliability-statistics')
    }
    else {
      bootstrap = participantClusterBootstrap(completeMatrix, {
        seed: primaryBootstrapSeed(
          bootstrapSeed,
          deviceId,
          metricCell.metricId,
          metricCell.view,
        ),
      })
      if (!bootstrap.hasSufficientValidAttempts) {
        failureReasons.push('bootstrap-fewer-than-9500-valid-attempts')
      }
    }
  }

  return {
    scope: 'primary-exact-device',
    deviceId,
    metricId: metricCell.metricId,
    view: metricCell.view,
    expectedParticipants: validated.participantIds.length,
    completeParticipants: completeMatrix.length,
    observedMetricCells,
    expectedMetricCells,
    missingMetricCells,
    absentMetricCells,
    unreliableMetricCells,
    missingness,
    isEligible: failureReasons.length === 0,
    failureReasons,
    stats,
    bootstrap,
  }
}

export function analyzeTierBReliability(input: TierBAnalysisInput): TierBAnalysisResult {
  const validated = validateInput(input)
  const primary = validated.deviceIds.flatMap((deviceId) =>
    validated.metricCells.map((metricCell) =>
      analyzePrimaryGroup(validated, deviceId, metricCell, input.bootstrapSeed)))

  const pooledDescriptive = validated.metricCells.map((metricCell) => {
    const values: number[] = []
    const participants = new Set<string>()
    for (const record of validated.recordsByCell.values()) {
      if (
        record.metricId === metricCell.metricId
        && record.view === metricCell.view
        && record.reliable
        && record.value !== null
      ) {
        values.push(record.value)
        participants.add(record.participantId)
      }
    }
    const { mean, sampleSd } = meanAndSampleSd(values)
    return {
      scope: 'pooled-descriptive-only' as const,
      metricId: metricCell.metricId,
      view: metricCell.view,
      deviceIds: [...validated.deviceIds],
      participantCount: participants.size,
      measurementCount: values.length,
      mean,
      sampleSd,
    }
  })

  return {
    schemaVersion: 'tierb-analysis-v1',
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    primaryUnit: 'percentage_points',
    consumerEligible: false,
    protocol: {
      pose: 'neutral',
      repeatIds: TIERB_REPEAT_IDS,
      primaryGrouping: 'exact-device',
      independentCluster: 'participant',
    },
    primary,
    pooledDescriptive: {
      primary: false,
      consumerEligible: false,
      groups: pooledDescriptive,
    },
  }
}
