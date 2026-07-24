import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TIER_B_ANALYSIS_VERSION,
  TIER_B_METRIC_REGISTRY,
  TIER_B_PROTOCOL_VERSION,
} from '@/lib/pose/tierb-contract'
import {
  canonicalizeTierB,
  sha256TierB,
  sha256TierBBytes,
} from './tierb-canonical'
import {
  detectTierBArtifactMime,
  TierBArtifactVerificationError,
  validateTierBChain,
  type TierBArtifactReader,
  type TierBPublicEnvelope,
  type TierBRestrictedEnvelope,
  type TierBTrustPolicy,
  type TierBTransition,
} from './tierb-validator'
import {
  analyzeTierBReliability,
  TIERB_ANALYSIS_METRIC_CELLS,
  type TierBMeasurement,
} from './tierb-analysis'
import { assessPosture } from '../../packages/posture-engine/src/engine'
import { generatePose } from '../../packages/posture-engine/golden/synthetic'

const SHA_A = `sha256:${'a'.repeat(64)}` as const
const FIXTURE_JPEG = readFileSync(
  new URL('../../e2e/fixtures/photos/front_standing.jpg', import.meta.url),
)

function jpegWithComment(bytes: Buffer, comment: string): Buffer {
  const payload = Buffer.from(comment, 'ascii')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(payload.length + 2)
  return Buffer.concat([
    bytes.subarray(0, 2),
    Buffer.from([0xff, 0xfe]),
    length,
    payload,
    bytes.subarray(2),
  ])
}

let cachedCompleteFixtureAnalysis:
  ReturnType<typeof analyzeTierBReliability> | null = null

function preparedPayload() {
  return {
    protocolVersion: TIER_B_PROTOCOL_VERSION,
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    estimand: 'within-session fully-repositioned test-retest repeatability',
    studyDesign: {
      cohort: 'primary_neutral',
      minimumParticipantsPerDevice: 12,
      targetParticipantsPerDevice: 15,
      exactDeviceCount: 2,
      sameParticipantsOnBothDevices: true,
      repeatIds: [1, 2, 3],
      views: ['front', 'side_left', 'back', 'side_right'],
      fullRestanceBetweenRepeats: true,
      expectedMinimumPhotoRows: 288,
      manifestMissingRowsAllowed: 0,
      maxMetricMissingCellFraction: 0.2,
      primaryUnit: 'percentage_points',
      deviceOrderPolicy: 'counterbalanced',
      viewOrderPolicy: 'counterbalanced-four-sequence-v1',
    },
    bootstrap: {
      algorithm: 'participant-cluster-sha256-counter-v1',
      attempts: 10_000,
      minimumValidAttempts: 9_500,
      intervalMethod: 'percentile-95-type7',
      invalidAttemptsRetried: false,
      seed: 'posture-ai-tierb-v2',
    },
    metricRegistry: TIER_B_METRIC_REGISTRY,
    collectionAuthorized: false,
    consumerEligible: false,
    frozenProvenance: null,
    approvedSigningKeyIds: [],
  } as const
}

function preparedEnvelope(): TierBPublicEnvelope {
  const payload = preparedPayload()
  return {
    schemaVersion: 'tierb-public-envelope-v1',
    packetId: 'tierb-primary-neutral-v1',
    state: 'prepared',
    parentPublicEnvelopeSha256: null,
    repositoryCommit: null,
    configurationSha256: null,
    restrictedEnvelopeSha256: null,
    payload,
    payloadSha256: sha256TierB(payload),
    transition: null,
  }
}

function emptyTrustPolicy(): TierBTrustPolicy {
  return {
    schemaVersion: 'tierb-trust-policy-v1',
    trustDomain: 'posture-ai-tierb-reliability',
    environment: 'production',
    keys: [],
  }
}

function signingKey(
  keyId: string,
  role: 'collection_owner' | 'statistical_reviewer',
) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return {
    privateKey,
    trustedKey: {
      keyId,
      algorithm: 'Ed25519' as const,
      roles: [role],
      publicKeySpkiDerBase64: der.toString('base64'),
      publicKeySha256: `sha256:${createHash('sha256').update(der).digest('hex')}` as const,
      status: 'active' as const,
      validFrom: '2026-07-01T00:00:00.000Z',
      validUntil: '2027-07-01T00:00:00.000Z',
    },
  }
}

function signatureBytes(context: TierBTransition['context']): Buffer {
  const { domain, ...bound } = context
  return Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from([0]),
    Buffer.from(canonicalizeTierB(bound), 'utf8'),
  ])
}

function transition(
  context: TierBTransition['context'],
  keyId: string,
  privateKey: KeyObject,
): TierBTransition {
  return {
    context,
    signature: {
      algorithm: 'Ed25519',
      keyId,
      signatureBase64: sign(null, signatureBytes(context), privateKey).toString('base64'),
    },
  }
}

function frozenProvenance() {
  return {
    captureBuild: {
      commitSha: '1'.repeat(40),
      deploymentId: 'deployment-pr10',
      deploymentUrl: 'https://example.invalid/pr10',
      configurationSha256: `sha256:${'2'.repeat(64)}`,
      buildReceiptSha256: `sha256:${'3'.repeat(64)}`,
    },
    engine: {
      version: '2.1.0',
      sourceSha256: `sha256:${'4'.repeat(64)}`,
    },
    poseModel: {
      variant: 'lite',
      modelAssets: [{ path: 'models/pose-lite.task', sha256: `sha256:${'5'.repeat(64)}` }],
      wasmAssets: [{ path: 'wasm/vision.wasm', sha256: `sha256:${'6'.repeat(64)}` }],
    },
    protocol: {
      version: TIER_B_PROTOCOL_VERSION,
      documentSha256: `sha256:${'7'.repeat(64)}`,
    },
    analysis: {
      version: TIER_B_ANALYSIS_VERSION,
      sourceSha256: `sha256:${'8'.repeat(64)}`,
    },
    devices: [
      {
        deviceId: 'device-a',
        manufacturer: 'Fixture',
        marketingModel: 'Phone A',
        hardwareModel: 'A1',
        osName: 'FixtureOS',
        osVersion: '1.0',
        browserName: 'FixtureBrowser',
        browserVersion: '1.0',
        cameraFacing: 'rear',
      },
      {
        deviceId: 'device-b',
        manufacturer: 'Fixture',
        marketingModel: 'Phone B',
        hardwareModel: 'B1',
        osName: 'FixtureOS',
        osVersion: '1.0',
        browserName: 'FixtureBrowser',
        browserVersion: '1.0',
        cameraFacing: 'rear',
      },
    ],
    operators: [{ operatorId: 'operator-a' }],
  } as const
}

function collectionSchedule() {
  const participantSlots = Array.from({ length: 15 }, (_, index) => index + 1)
  const deviceIds = ['device-a', 'device-b'] as const
  const repeatIds = [1, 2, 3] as const
  const views = ['front', 'side_left', 'back', 'side_right'] as const
  return {
    participantSlots,
    deviceIds,
    repeatIds,
    views,
    cells: participantSlots.flatMap((participantSlot) => {
      const deviceOrder = participantSlot % 2 === 1
        ? [...deviceIds]
        : [...deviceIds].reverse()
      const rotation = (participantSlot - 1) % views.length
      const viewOrder = [...views.slice(rotation), ...views.slice(0, rotation)]
      return deviceOrder.flatMap((deviceId, deviceIndex) =>
        repeatIds.flatMap((repeatId) =>
          viewOrder.map((view, viewIndex) => ({
            participantSlot,
            deviceId,
            repeatId,
            view,
            operatorId: 'operator-a',
            scheduledSequence: deviceIndex * 12 + (repeatId - 1) * 4 + viewIndex + 1,
          })),
        ),
      )
    }),
  }
}

function authorizedChain() {
  const owner = signingKey('collection-owner', 'collection_owner')
  const prepared = preparedEnvelope()
  const restricted: TierBRestrictedEnvelope = {
    schemaVersion: 'tierb-restricted-envelope-v1',
    packetId: prepared.packetId,
    state: 'collection_authorized',
    parentPublicEnvelopeSha256: sha256TierB(prepared),
    privacyClass: 'restricted-local',
    payload: {
      schedule: collectionSchedule(),
      manifest: null,
    },
  }
  const payload = {
    protocolVersion: TIER_B_PROTOCOL_VERSION,
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    collectionAuthorized: true,
    consumerEligible: false,
    frozenProvenance: frozenProvenance(),
    analysis: null,
    profile: null,
    adjudication: null,
  }
  const context: TierBTransition['context'] = {
    domain: 'POSTURE-AI-TIERB-AUTHORIZATION-V1',
    packetId: prepared.packetId,
    fromState: 'prepared',
    toState: 'collection_authorized',
    repositoryCommit: '1'.repeat(40),
    configurationSha256: `sha256:${'2'.repeat(64)}`,
    parentPublicEnvelopeSha256: sha256TierB(prepared),
    publicPayloadSha256: sha256TierB(payload),
    restrictedEnvelopeSha256: sha256TierB(restricted),
  }
  const authorized: TierBPublicEnvelope = {
    schemaVersion: 'tierb-public-envelope-v1',
    packetId: prepared.packetId,
    state: 'collection_authorized',
    parentPublicEnvelopeSha256: sha256TierB(prepared),
    repositoryCommit: context.repositoryCommit,
    configurationSha256: context.configurationSha256,
    restrictedEnvelopeSha256: context.restrictedEnvelopeSha256,
    payload,
    payloadSha256: context.publicPayloadSha256,
    transition: transition(context, owner.trustedKey.keyId, owner.privateKey),
  }
  return {
    prepared,
    authorized,
    restricted,
    owner,
  }
}

function adjudicatedChain(options: {
  removeLastRow?: boolean
  duplicatePhoto?: boolean
  tamperEligibleAnalysis?: boolean
  tamperProfileMdc?: boolean
  tamperSemMath?: boolean
  tamperAnalysisInput?: boolean
  wrongPhotoMime?: boolean
  withdrawnConsent?: boolean
  splitClusterIdentity?: boolean
  duplicateConsentIdentity?: boolean
  truncatedPhoto?: boolean
  staleEngineArtifact?: boolean
  omitReliableAnalysisRecord?: boolean
  omitUnreliableAnalysisRecord?: boolean
} = {}) {
  const authorized = authorizedChain()
  const reviewer = signingKey('statistical-reviewer', 'statistical_reviewer')
  const schedule = collectionSchedule()
  const activeSlots = Array.from({ length: 12 }, (_, index) => index + 1)
  const artifacts = new Map<string, Buffer>()
  const authorizationPublicEnvelopeSha256 = sha256TierB(authorized.authorized)
  const provenance = frozenProvenance()
  const frozenProvenanceSha256 = sha256TierB(provenance)
  const rows = schedule.cells
    .filter((cell) => activeSlots.includes(cell.participantSlot))
    .map((cell, index) => {
      const stableId = [
        `p${String(cell.participantSlot).padStart(2, '0')}`,
        cell.deviceId,
        `r${cell.repeatId}`,
        cell.view,
      ].join('-')
      const defaultClusterId =
        `cluster-${String(cell.participantSlot).padStart(2, '0')}`
      const clusterId = options.splitClusterIdentity
        && cell.participantSlot === 1
        && cell.deviceId === 'device-a'
        && cell.repeatId === 1
        && cell.view === 'back'
        ? 'cluster-02'
        : defaultClusterId
      const consentReceiptId = options.duplicateConsentIdentity
        && cell.participantSlot === 2
        ? 'consent-01'
        : `consent-${String(cell.participantSlot).padStart(2, '0')}`
      const photoBytes = options.duplicatePhoto && index === 1
        ? artifacts.get('photos/p01-device-a-r1-front.jpg')!
        : options.truncatedPhoto && index === 0
          ? Buffer.from([0xff, 0xd8, 0xff])
          : jpegWithComment(FIXTURE_JPEG, `tierb:${stableId}`)
      const photoPath = `photos/${stableId}.jpg`
      artifacts.set(photoPath, photoBytes)
      const sourcePhotoSha256 = sha256TierBBytes(photoBytes)
      const capturedAt = new Date(Date.UTC(2026, 6, 24, 12, 0, index)).toISOString()
      const rowBindingSha256 = sha256TierB({
        authorizationPublicEnvelopeSha256,
        frozenProvenanceSha256,
        participantSlot: cell.participantSlot,
        clusterId,
        deviceId: cell.deviceId,
        operatorId: cell.operatorId,
        repeatId: cell.repeatId,
        view: cell.view,
        scheduledSequence: cell.scheduledSequence,
        capturedAt,
        sourcePhotoSha256,
      })
      const side = cell.view === 'side_left'
        ? 'left'
        : cell.view === 'side_right'
          ? 'right'
          : null
      const signal = cell.participantSlot * 1.4
        + cell.repeatId * 0.2
        + (cell.deviceId === 'device-b' ? 0.1 : 0)
      const generatedFrame = side
        ? generatePose('side', {
            forwardHeadDeg: signal,
            trunkLeanDeg: signal / 2,
            kneeHyperextensionDeg: signal / 3,
          }, {}, side)
        : generatePose('front', {
            shoulderTiltDeg: signal,
            pelvicTiltDeg: signal / 2,
            kneeValgusLeftDeg: signal / 3,
            kneeValgusRightDeg: signal / 4,
          })
      if (index === 0) {
        generatedFrame.landmarks.left_hip.visibility = 0.1
      }
      const frame = cell.view === 'back'
        ? { ...generatedFrame, view: 'back' as const }
        : generatedFrame
      const landmarkPayload = {
        rowBindingSha256,
        sourcePhotoSha256,
        protocolVersion: TIER_B_PROTOCOL_VERSION,
        analysisVersion: TIER_B_ANALYSIS_VERSION,
        engineVersion: options.staleEngineArtifact && index === 0
          ? '1.0.0'
          : provenance.engine.version,
        poseModel: provenance.poseModel.variant,
        view: side ? 'side' : cell.view,
        profileSide: side,
        frames: [frame],
      }
      const landmarkBytes = Buffer.from(canonicalizeTierB(landmarkPayload))
      const landmarkPath = `landmarks/${stableId}.json`
      artifacts.set(landmarkPath, landmarkBytes)
      return {
        rowId: stableId,
        participantSlot: cell.participantSlot,
        clusterId,
        deviceId: cell.deviceId,
        operatorId: cell.operatorId,
        repeatId: cell.repeatId,
        view: cell.view,
        scheduledSequence: cell.scheduledSequence,
        capturedAt,
        consent: {
          verified: true,
          receiptId: consentReceiptId,
          deidentified: true,
          withdrawalState: 'active',
        },
        sourcePhoto: {
          path: photoPath,
          sha256: sourcePhotoSha256,
          byteLength: photoBytes.byteLength,
          mime: 'image/jpeg',
          widthPx: 1000,
          heightPx: 1600,
        },
        landmarks: {
          path: landmarkPath,
          sha256: sha256TierBBytes(landmarkBytes),
          byteLength: landmarkBytes.byteLength,
          mime: 'application/json',
          frameCount: 1,
        },
        authorizationPublicEnvelopeSha256,
        frozenProvenanceSha256,
        rowBindingSha256,
      }
    })
    .sort((left, right) => left.rowId.localeCompare(right.rowId))
  const analysisSourceRows = structuredClone(rows)
  if (options.removeLastRow) rows.pop()
  if (options.wrongPhotoMime) {
    rows[0].sourcePhoto.mime = 'application/json'
  }
  if (options.withdrawnConsent) {
    rows[0].consent.withdrawalState = 'withdrawn'
  }
  const manifest = {
    schemaVersion: 'tierb-collection-manifest-v1',
    authorizationPublicEnvelopeSha256,
    frozenProvenanceSha256,
    activatedParticipantSlots: activeSlots,
    rows,
  }
  const manifestSha256 = sha256TierB(manifest)
  const datasetFingerprint = sha256TierB({
    authorizationPublicEnvelopeSha256,
    manifestSha256,
    artifacts: rows.map((row) => ({
      rowId: row.rowId,
      rowBindingSha256: row.rowBindingSha256,
      sourcePhotoSha256: row.sourcePhoto.sha256,
      landmarksSha256: row.landmarks.sha256,
    })),
  })
  const participantIds = activeSlots.map((slot) =>
    `cluster-${String(slot).padStart(2, '0')}`)
  const completeAnalysisRecords: TierBMeasurement[] =
    analysisSourceRows.flatMap((row) => {
      const landmarkBytes = artifacts.get(row.landmarks.path)!
      const landmark = JSON.parse(landmarkBytes.toString('utf8')) as {
        frames: Parameters<typeof assessPosture>[0]
      }
      const result = assessPosture(landmark.frames)
      return TIER_B_METRIC_REGISTRY
        .filter((metric) =>
          metric.status === 'candidate'
          && metric.requiredViews.includes(row.view as never))
        .map((metric) => {
          const finding = result.findings.find(
            (candidate) => candidate.key === metric.key,
          )!
          return {
            participantId:
              `cluster-${String(row.participantSlot).padStart(2, '0')}`,
            deviceId: row.deviceId,
            metricId: metric.key,
            view: row.view,
            repeatId: row.repeatId,
            pose: 'neutral' as const,
            unit: 'percentage_points' as const,
            sourceField: 'severityPct' as const,
            reliable: finding.reliable,
            value: finding.reliable ? finding.severityPct : null,
          }
        })
    })
  const completeAnalysisInput = {
    participantIds,
    deviceIds: ['device-a', 'device-b'],
    metricCells: TIERB_ANALYSIS_METRIC_CELLS,
    records: completeAnalysisRecords,
    bootstrapSeed: 'validator-fixture',
  }
  if (!cachedCompleteFixtureAnalysis) {
    cachedCompleteFixtureAnalysis =
      analyzeTierBReliability(completeAnalysisInput)
  }
  const analysis = structuredClone(cachedCompleteFixtureAnalysis)
  const analysisRecords = structuredClone(completeAnalysisRecords)
  if (options.omitReliableAnalysisRecord) {
    const index = analysisRecords.findIndex((record) =>
      record.reliable
      && record.metricId !== 'anterior_imbalanced_shoulders')
    if (index < 0) throw new Error('fixture has no reliable measurement to omit')
    analysisRecords.splice(index, 1)
  }
  if (options.omitUnreliableAnalysisRecord) {
    const index = analysisRecords.findIndex((record) => !record.reliable)
    if (index < 0) throw new Error('fixture has no unreliable measurement to omit')
    analysisRecords.splice(index, 1)
  }
  const analysisInput = {
    participantIds,
    deviceIds: ['device-a', 'device-b'],
    metricCells: TIERB_ANALYSIS_METRIC_CELLS,
    records: analysisRecords,
    bootstrapSeed: 'validator-fixture',
  }
  const restrictedAnalysisInput = {
    schemaVersion: 'tierb-analysis-input-v1',
    protocolVersion: TIER_B_PROTOCOL_VERSION,
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    authorizationPublicEnvelopeSha256,
    repositoryCommit: authorized.authorized.repositoryCommit,
    configurationSha256: authorized.authorized.configurationSha256,
    unit: 'percentage_points',
    sourceField: 'severityPct',
    input: analysisInput,
    inputSha256: sha256TierB(analysisInput),
  }
  if (options.tamperAnalysisInput) {
    analysisInput.records[0].value = Number(analysisInput.records[0].value) + 5
    restrictedAnalysisInput.inputSha256 = sha256TierB(analysisInput)
  }
  if (options.tamperEligibleAnalysis) {
    const target = analysis.primary.find((entry) => !entry.isEligible)!
    target.isEligible = true
    target.failureReasons = []
  }
  if (options.tamperSemMath) {
    const target = analysis.primary.find((entry) =>
      entry.metricId === 'anterior_imbalanced_shoulders'
      && entry.deviceId === 'device-a')!
    target.stats!.semAgreement += 1
    target.stats!.sem = target.stats!.semAgreement
    target.stats!.mdc95 = 1.96 * Math.SQRT2 * target.stats!.semAgreement
  }
  const eligibleMdc = Math.max(
    ...analysis.primary
      .filter((entry) =>
        entry.metricId === 'anterior_imbalanced_shoulders'
        && entry.view === 'front'
        && entry.isEligible)
      .map((entry) => entry.bootstrap!.intervals.mdc95!.upper),
  )
  const metrics = TIER_B_METRIC_REGISTRY.map((metric) => ({
    metricKey: metric.key,
    decision: metric.status === 'excluded_design'
      ? 'excluded_design'
      : metric.key === 'anterior_imbalanced_shoulders'
        ? 'eligible'
        : 'ineligible',
    consumerEligible: metric.key === 'anterior_imbalanced_shoulders',
    consumerMdc95PercentagePoints: metric.key === 'anterior_imbalanced_shoulders'
      ? eligibleMdc
      : null,
  }))
  if (options.tamperProfileMdc) {
    metrics[0].consumerMdc95PercentagePoints =
      Number(metrics[0].consumerMdc95PercentagePoints) + 1
  }
  const profile = {
    schemaVersion: 'tierb-reliability-profile-v1',
    unit: 'percentage_points',
    consumerEligible: true,
    eligibleMetricKeys: ['anterior_imbalanced_shoulders'],
    metrics,
  }
  const adjudication = {
    schemaVersion: 'tierb-adjudication-v1',
    analysisSha256: sha256TierB(analysis),
    profileSha256: sha256TierB(profile),
    datasetFingerprint,
    decisions: metrics.map(({
      metricKey,
      decision,
      consumerMdc95PercentagePoints,
    }) => ({
      metricKey,
      decision,
      reasonCodes: decision === 'excluded_design'
        ? ['ENGINE_ALWAYS_UNRELIABLE']
        : decision === 'eligible'
          ? ['FIXTURE_GATE_PASS']
          : ['FIXTURE_INELIGIBLE'],
      rationale: 'Deterministic contract fixture.',
      consumerMdc95PercentagePoints,
    })),
  }
  const restricted: TierBRestrictedEnvelope = {
    schemaVersion: 'tierb-restricted-envelope-v1',
    packetId: authorized.prepared.packetId,
    state: 'adjudicated',
    parentPublicEnvelopeSha256: authorizationPublicEnvelopeSha256,
    privacyClass: 'restricted-local',
    payload: {
      schedule,
      manifest,
      analysisInput: restrictedAnalysisInput,
    },
  }
  const payload = {
    protocolVersion: TIER_B_PROTOCOL_VERSION,
    analysisVersion: TIER_B_ANALYSIS_VERSION,
    collectionAuthorized: true,
    consumerEligible: true,
    frozenProvenanceSha256,
    manifestSha256,
    datasetFingerprint,
    analysis,
    profile,
    adjudication,
  }
  const context: TierBTransition['context'] = {
    domain: 'POSTURE-AI-TIERB-ADJUDICATION-V1',
    packetId: authorized.prepared.packetId,
    fromState: 'collection_authorized',
    toState: 'adjudicated',
    repositoryCommit: authorized.authorized.repositoryCommit!,
    configurationSha256: authorized.authorized.configurationSha256!,
    parentPublicEnvelopeSha256: authorizationPublicEnvelopeSha256,
    publicPayloadSha256: sha256TierB(payload),
    restrictedEnvelopeSha256: sha256TierB(restricted),
  }
  const publicEnvelope: TierBPublicEnvelope = {
    schemaVersion: 'tierb-public-envelope-v1',
    packetId: authorized.prepared.packetId,
    state: 'adjudicated',
    parentPublicEnvelopeSha256: authorizationPublicEnvelopeSha256,
    repositoryCommit: context.repositoryCommit,
    configurationSha256: context.configurationSha256,
    restrictedEnvelopeSha256: context.restrictedEnvelopeSha256,
    payload,
    payloadSha256: context.publicPayloadSha256,
    transition: transition(context, reviewer.trustedKey.keyId, reviewer.privateKey),
  }
  const artifactReader: TierBArtifactReader = {
    readVerified(expected) {
      const bytes = artifacts.get(expected.path)
      if (!bytes) throw new Error(`missing fixture ${expected.path}`)
      const detectedMime = detectTierBArtifactMime(bytes)
      if (detectedMime !== expected.mime) {
        throw new TierBArtifactVerificationError(
          'ARTIFACT_MIME_MISMATCH',
          `fixture MIME mismatch for ${expected.path}`,
        )
      }
      return {
        bytes,
        sha256: sha256TierBBytes(bytes),
        byteLength: bytes.byteLength,
        mime: detectedMime,
        device: 1,
        inode: expected.path.length,
      }
    },
  }
  return {
    ...authorized,
    reviewer,
    adjudicated: publicEnvelope,
    adjudicatedRestricted: restricted,
    artifactReader,
  }
}

describe('validateTierBChain prepared lifecycle', () => {
  it('validates the checked-in lifecycle shape with an empty independently pinned trust policy', () => {
    const trustPolicy = emptyTrustPolicy()
    const result = validateTierBChain({
      envelopes: [{ publicEnvelope: preparedEnvelope() }],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result).toEqual({
      ok: true,
      state: 'prepared',
      collectionAuthorized: false,
      consumerEligible: false,
      errors: [],
    })
  })

  it('fails closed when prepared data claims authorization or carries restricted evidence', () => {
    const trustPolicy = emptyTrustPolicy()
    const envelope = preparedEnvelope()
    const payload = {
      ...(envelope.payload as Record<string, unknown>),
      collectionAuthorized: true,
    }
    const result = validateTierBChain({
      envelopes: [{
        publicEnvelope: {
          ...envelope,
          restrictedEnvelopeSha256: SHA_A,
          payload,
          payloadSha256: sha256TierB(payload),
        },
        restrictedEnvelope: {
          schemaVersion: 'tierb-restricted-envelope-v1',
          packetId: envelope.packetId,
          state: 'collection_authorized',
          parentPublicEnvelopeSha256: sha256TierB(envelope),
          privacyClass: 'restricted-local',
          payload: {},
        },
      }],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'PREPARED_AUTHORIZATION_FORBIDDEN',
      'RESTRICTED_ENVELOPE_UNEXPECTED',
    ]))
    expect(result.collectionAuthorized).toBe(false)
    expect(result.consumerEligible).toBe(false)
  })

  it('rejects privacy-bearing fields anywhere in the public envelope', () => {
    const trustPolicy = emptyTrustPolicy()
    const envelope = preparedEnvelope()
    const payload = {
      ...(envelope.payload as Record<string, unknown>),
      participantId: 'private-person',
    }
    const result = validateTierBChain({
      envelopes: [{
        publicEnvelope: {
          ...envelope,
          payload,
          payloadSha256: sha256TierB(payload),
        },
      }],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'PUBLIC_PRIVACY_FIELD_FORBIDDEN',
    }))
  })

  it('rejects unknown public fields even when their names evade the privacy blacklist', () => {
    const trustPolicy = emptyTrustPolicy()
    const envelope = preparedEnvelope()
    const payload = {
      ...(envelope.payload as Record<string, unknown>),
      takenAt: '2026-07-24T12:00:00.000Z',
    }
    const result = validateTierBChain({
      envelopes: [{
        publicEnvelope: {
          ...envelope,
          payload,
          payloadSha256: sha256TierB(payload),
        },
      }],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'SCHEMA_INVALID',
      path: '/payload',
    }))
  })

  it('does not let the packet self-select a different trust policy', () => {
    const trustPolicy = emptyTrustPolicy()
    const result = validateTierBChain({
      envelopes: [{ publicEnvelope: preparedEnvelope() }],
      trustPolicy,
      expectedTrustPolicySha256: SHA_A,
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'TRUST_POLICY_HASH_MISMATCH',
    }))
  })

  it('rejects a fixture trust policy and a changed estimand in production validation', () => {
    const fixturePolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      environment: 'fixture',
    }
    const fixtureResult = validateTierBChain({
      envelopes: [{ publicEnvelope: preparedEnvelope() }],
      trustPolicy: fixturePolicy,
      expectedTrustPolicySha256: sha256TierB(fixturePolicy),
      expectedTrustPolicyEnvironment: 'production',
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })
    expect(fixtureResult.errors).toContainEqual(expect.objectContaining({
      code: 'SCHEMA_INVALID',
      path: '/trustPolicy/environment',
    }))

    const envelope = preparedEnvelope()
    const payload = {
      ...(envelope.payload as Record<string, unknown>),
      estimand: 'quietly changed estimand',
    }
    const estimandResult = validateTierBChain({
      envelopes: [{
        publicEnvelope: {
          ...envelope,
          payload,
          payloadSha256: sha256TierB(payload),
        },
      }],
      trustPolicy: emptyTrustPolicy(),
      expectedTrustPolicySha256: sha256TierB(emptyTrustPolicy()),
      expectedState: 'prepared',
      now: '2026-07-24T12:00:00.000Z',
    })
    expect(estimandResult.errors).toContainEqual(expect.objectContaining({
      code: 'SCHEMA_INVALID',
      path: '/payload/estimand',
    }))
  })
})

describe('validateTierBChain collection authorization', () => {
  it('accepts the exact prepared-to-authorized transition signed by a pinned collection owner', () => {
    const chain = authorizedChain()
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'collection_authorized',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result).toEqual({
      ok: true,
      state: 'collection_authorized',
      collectionAuthorized: true,
      consumerEligible: false,
      errors: [],
    })
  })

  it('cannot authorize collection against the valid but empty production trust policy', () => {
    const chain = authorizedChain()
    const trustPolicy = emptyTrustPolicy()
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'collection_authorized',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'TRUST_KEY_NOT_FOUND',
    }))
    expect(result.collectionAuthorized).toBe(false)
  })

  it('rejects a signed transition whose commit differs from the public envelope', () => {
    const chain = authorizedChain()
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        {
          publicEnvelope: {
            ...chain.authorized,
            repositoryCommit: '9'.repeat(40),
          },
          restrictedEnvelope: chain.restricted,
        },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'collection_authorized',
      now: '2026-07-24T12:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'SIGNATURE_CONTEXT_MISMATCH',
    }))
  })
})

describe('validateTierBChain adjudication', { timeout: 30_000 }, () => {
  it('accepts the exact 288-row private manifest and a distinct reviewer signature', () => {
    const chain = adjudicatedChain()
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result).toEqual({
      ok: true,
      state: 'adjudicated',
      collectionAuthorized: true,
      consumerEligible: true,
      errors: [],
    })
  })

  it('rejects a private manifest missing one expected participant/device/repeat/view cell', () => {
    const chain = adjudicatedChain({ removeLastRow: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_CELL_SET_MISMATCH',
    }))
  })

  it('rejects one source photo reused for two physical observations', () => {
    const chain = adjudicatedChain({ duplicatePhoto: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_DUPLICATE_PHOTO',
    }))
  })

  it('rejects an eligible analysis cell that did not pass the frozen gates', () => {
    const chain = adjudicatedChain({ tamperEligibleAnalysis: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ANALYSIS_CONTRACT_INVALID',
    }))
    expect(result.consumerEligible).toBe(false)
  })

  it('rejects a consumer MDC that differs from the analyzer output', () => {
    const chain = adjudicatedChain({ tamperProfileMdc: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'SCHEMA_INVALID',
      path: '/payload/profile',
    }))
    expect(result.consumerEligible).toBe(false)
  })

  it('recomputes SEM and ICC identities instead of trusting signed numbers', () => {
    const chain = adjudicatedChain({ tamperSemMath: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ANALYSIS_CONTRACT_INVALID',
    }))
    expect(result.consumerEligible).toBe(false)
  })

  it('recomputes the complete public analysis from the signed restricted input', () => {
    const chain = adjudicatedChain({ tamperAnalysisInput: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ANALYSIS_CONTRACT_INVALID',
      path: '/restrictedEnvelope/payload/analysisInput',
    }))
  })

  it('rejects omission of a reliable frozen-engine measurement', () => {
    const chain = adjudicatedChain({ omitReliableAnalysisRecord: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ANALYSIS_CONTRACT_INVALID',
      path: '/restrictedEnvelope/payload/analysisInput',
    }))
    expect(result.consumerEligible).toBe(false)
  })

  it('rejects omission of an unreliable frozen-engine measurement', () => {
    const chain = adjudicatedChain({ omitUnreliableAnalysisRecord: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ANALYSIS_CONTRACT_INVALID',
      path: '/restrictedEnvelope/payload/analysisInput',
    }))
    expect(result.consumerEligible).toBe(false)
  })

  it('requires a real image MIME for every source photo', () => {
    const chain = adjudicatedChain({ wrongPhotoMime: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ARTIFACT_MIME_MISMATCH',
      path: expect.stringMatching(/sourcePhoto\/mime$/),
    }))
  })

  it('excludes withdrawn consent rows from the adjudicable manifest', () => {
    const chain = adjudicatedChain({ withdrawnConsent: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'SCHEMA_INVALID',
      path: expect.stringMatching(/manifest\/rows\/0$/),
    }))
  })

  it.each([
    ['split cluster identity', { splitClusterIdentity: true }],
    ['duplicate consent identity', { duplicateConsentIdentity: true }],
  ])('rejects pseudo-participants created by %s', (_label, options) => {
    const chain = adjudicatedChain(options)
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_DUPLICATE_ROW',
      message: expect.stringMatching(/one-to-one mapping/),
    }))
  })

  it('rejects a truncated JPEG even when its magic bytes look plausible', () => {
    const chain = adjudicatedChain({ truncatedPhoto: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ARTIFACT_MIME_MISMATCH',
    }))
  })

  it('rejects landmark output from an engine outside frozen provenance', () => {
    const chain = adjudicatedChain({ staleEngineArtifact: true })
    const trustPolicy: TierBTrustPolicy = {
      ...emptyTrustPolicy(),
      keys: [chain.owner.trustedKey, chain.reviewer.trustedKey],
    }
    const result = validateTierBChain({
      envelopes: [
        { publicEnvelope: chain.prepared },
        { publicEnvelope: chain.authorized, restrictedEnvelope: chain.restricted },
        { publicEnvelope: chain.adjudicated, restrictedEnvelope: chain.adjudicatedRestricted },
      ],
      trustPolicy,
      expectedTrustPolicySha256: sha256TierB(trustPolicy),
      expectedState: 'adjudicated',
      now: '2026-07-24T12:00:00.000Z',
      artifactReader: chain.artifactReader,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'VIEW_PROFILE_MISMATCH',
      path: expect.stringMatching(/landmarks$/),
    }))
  })
})
