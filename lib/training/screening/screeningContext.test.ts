import { describe, expect, it } from 'vitest'
import { assessPosture, testLandmarksFrames, type PoseFrame } from '@posture-ai/engine'
import { buildCaptureRow } from '@/lib/captures/buildCaptureRow'
import { buildFindingRow } from '@/lib/findings/buildFindingRow'
import { POSE_MODEL_SHA256 } from '@/lib/pose/pose-model'
import {
  buildScreeningContextV1,
  type PersistedScreeningAssessmentRow,
  type PersistedScreeningCaptureRow,
  type PersistedScreeningFindingRow,
} from './screeningContext'

const SUBJECT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'
const OTHER_SUBJECT_ID = '6a76a8b9-df1d-4e93-a65b-33419bb01bb4'
const ASSESSMENT_ID = '81da03e0-6f9e-4e88-9ba1-59121047159e'
const PRACTITIONER_ID = '6a6d11e1-9099-4325-8cc4-8d00c87bc6a4'
const ENGINE_VERSION = '2.1.0'

function sourceFrames(): PoseFrame[] {
  const front = testLandmarksFrames.find((frame) => frame.view === 'front')!
  const side = testLandmarksFrames.find((frame) => frame.view === 'side')!
  return [
    { ...front, source: 'camera' },
    { ...side, source: 'camera', profileSide: 'left' },
    { ...side, source: 'camera', profileSide: 'right' },
    { ...front, source: 'camera', view: 'back' },
  ]
}

function assessment(
  overrides: Partial<PersistedScreeningAssessmentRow> = {},
): PersistedScreeningAssessmentRow {
  return {
    id: ASSESSMENT_ID,
    client_id: SUBJECT_ID,
    practitioner_id: PRACTITIONER_ID,
    assessed_at: '2026-09-07T12:00:00.000Z',
    status: 'complete',
    assessment_type: 'static',
    scoring_engine_version: ENGINE_VERSION,
    level_verified: true,
    capture_stability: 0.91,
    ...overrides,
  }
}

function captures(): PersistedScreeningCaptureRow[] {
  return sourceFrames().map((frame, index) => ({
    ...buildCaptureRow(frame, ASSESSMENT_ID, PRACTITIONER_ID, { useFixture: false }),
    id: `capture-${index}`,
    width_px: null,
    height_px: null,
    model_version: null,
    created_at: '2026-09-07T12:00:00.000Z',
    image_sha256: null,
    storage_path: null,
  }))
}

function findings(): PersistedScreeningFindingRow[] {
  return assessPosture(sourceFrames()).findings.map((finding, index) => ({
    ...buildFindingRow(finding, ASSESSMENT_ID, PRACTITIONER_ID),
    id: `finding-${index}`,
    metric_validity: buildFindingRow(finding, ASSESSMENT_ID, PRACTITIONER_ID)
      .metric_validity as PersistedScreeningFindingRow['metric_validity'],
  }))
}

function buildInput(overrides: {
  assessment?: PersistedScreeningAssessmentRow
  captures?: PersistedScreeningCaptureRow[]
  findings?: PersistedScreeningFindingRow[]
  expectedSubjectId?: string
  supportedEngineVersions?: string[]
} = {}) {
  return {
    expectedSubjectId: overrides.expectedSubjectId ?? SUBJECT_ID,
    supportedEngineVersions: overrides.supportedEngineVersions ?? [ENGINE_VERSION],
    assessment: overrides.assessment ?? assessment(),
    captures: overrides.captures ?? captures(),
    findings: overrides.findings ?? findings(),
  }
}

describe('buildScreeningContextV1', () => {
  it('SC-02 marks only a metric with a missing contributing view unavailable', () => {
    const withoutBack = captures().filter((capture) => capture.view !== 'back')
    const result = buildScreeningContextV1(buildInput({ captures: withoutBack }))

    expect(result.scanUse).toBe('descriptive')
    expect(result.scanAllowsGeneralTraining).toBe(true)
    expect(result.context).not.toBeNull()
    const back = result.context!.observations.find((observation) => observation.metric.view === 'back')!
    const front = result.context!.observations.find((observation) => observation.metric.view === 'front')!
    expect(back.availability).toBe('unavailable')
    expect(back.unavailableReasons).toContain('missing_required_capture_group:back')
    expect(back.value).toBeNull()
    expect(front.availability).toBe('descriptive')
    expect(front.value).not.toBeNull()
  })

  it('SC-02 rejects contradictory stored capture metadata for the affected metric', () => {
    const contradictory = captures().map((capture) => capture.view === 'back'
      ? { ...capture, pose_frame: { ...(capture.pose_frame as PoseFrame), view: 'front' as const } }
      : capture)
    const result = buildScreeningContextV1(buildInput({ captures: contradictory }))
    const back = result.context!.observations.find((observation) => observation.metric.view === 'back')!

    expect(back.availability).toBe('unavailable')
    expect(back.unavailableReasons).toContain('contradictory_capture_metadata:back')
  })

  it('SC-02 rejects a capture group containing both valid and invalid persisted rows', () => {
    const current = captures()
    const validBack = current.find((capture) => capture.view === 'back')!
    const invalidBack = {
      ...validBack,
      id: 'capture-back-invalid',
      pose_frame: {
        ...(validBack.pose_frame as PoseFrame),
        landmarks: {},
      },
    }
    const result = buildScreeningContextV1(buildInput({
      captures: [...current, invalidBack],
    }))
    const back = result.context!.observations.find((observation) => observation.metric.view === 'back')!
    const front = result.context!.observations.find((observation) => observation.metric.view === 'front')!

    expect(back.availability).toBe('unavailable')
    expect(back.value).toBeNull()
    expect(back.unavailableReasons).toContain('invalid_capture_group:back')
    expect(front.availability).toBe('descriptive')
  })

  it('SC-02 rejects stale capture rows from a different assessment for the affected metric', () => {
    const stale = captures().map((capture) => capture.view === 'back'
      ? { ...capture, assessment_id: '17f4b5f1-6fdd-42cb-a506-b288a68529bd' }
      : capture)
    const result = buildScreeningContextV1(buildInput({ captures: stale }))
    const back = result.context!.observations.find((observation) => observation.metric.view === 'back')!

    expect(back.availability).toBe('unavailable')
    expect(back.unavailableReasons).toContain('capture_scope_mismatch:back')
  })

  it('SC-03 preserves invalid confidence and unsupported measurements as explicit unavailable states', () => {
    const [first, second, ...rest] = findings()
    const invalid = { ...first, confidence: Number.NaN }
    const unsupported = { ...second, imbalance_key: 'unsupported_static_proxy' }
    const result = buildScreeningContextV1(buildInput({ findings: [invalid, unsupported, ...rest] }))
    const invalidObservation = result.context!.observations.find(
      (observation) => observation.metric.key === invalid.imbalance_key,
    )!
    const unsupportedObservation = result.context!.observations.find(
      (observation) => observation.unavailableReasons.includes('unsupported_measurement'),
    )!

    expect(invalidObservation.availability).toBe('unavailable')
    expect(invalidObservation.unavailableReasons).toContain('invalid_confidence')
    expect(unsupportedObservation.availability).toBe('unavailable')
    expect(unsupportedObservation.unavailableReasons).toContain('unsupported_measurement')
    expect(unsupportedObservation.metric).toMatchObject({
      key: 'unsupported_static_proxy',
      region: 'unknown',
    })
  })

  it('SC-04 keeps within-capture processing stability separate from re-stance repeatability', () => {
    const [first, ...rest] = findings()
    const result = buildScreeningContextV1(buildInput({
      findings: [{ ...first, stability_score: 0.94, uncertainty_deg: 0.6 }, ...rest],
    }))
    const observation = result.context!.observations[0]

    expect(observation.quality.withinCaptureProcessing).toEqual({
      status: 'observed',
      stabilityScore: 0.94,
      uncertaintyDeg: 0.6,
    })
    expect(observation.repeatability).toEqual({
      status: 'not_established',
      evidenceRef: null,
      reason: 'no_restance_repeatability_profile_persisted',
    })
  })

  it('marks invalid within-capture processing unavailable without treating absent quality as invalid', () => {
    const [first, ...rest] = findings()
    const result = buildScreeningContextV1(buildInput({
      findings: [{
        ...first,
        metric_validity: null,
        stability_score: 2,
        uncertainty_deg: null,
      }, ...rest],
    }))
    const observation = result.context!.observations[0]

    expect(observation.availability).toBe('unavailable')
    expect(observation.unavailableReasons).toContain('invalid_within_capture_quality')
    expect(observation.value).toBeNull()
    expect(observation.validity).toEqual({
      status: 'not_established',
      persistedFrame: null,
      applicability: 'not_persisted',
    })
    expect(observation.quality.withinCaptureProcessing).toEqual({
      status: 'invalid',
      stabilityScore: 2,
      uncertaintyDeg: null,
    })
    expect(observation.repeatability.status).toBe('not_established')
    expect(observation.actionability.status).toBe('not_established')

    const absent = buildScreeningContextV1(buildInput({
      findings: [{ ...first, stability_score: null, uncertainty_deg: null }, ...rest],
    }))
    expect(absent.context!.observations[0].availability).toBe('descriptive')
  })

  it('SC-05 never exposes diagnostic aliases or scan-derived training restrictions', () => {
    const [first, ...rest] = findings()
    const sourceWithLegacyClaims = {
      ...first,
      label: 'Squat ban because hip flexor is tight',
      legacy_direction_claim: 'gluteus medius weakness',
      severity_pct: 100,
      zone: 'danger',
      metric_validity: 'SCREENING_ONLY',
      weak_muscles: ['gluteus medius'],
      tight_muscles: ['hip flexor'],
      injury_prediction: 'high',
      lift_bans: ['squat'],
      load_reduction_pct: 50,
    } as PersistedScreeningFindingRow
    const result = buildScreeningContextV1(buildInput({
      findings: [sourceWithLegacyClaims, ...rest],
    }))
    const observation = result.context!.observations[0]

    expect(observation.availability).toBe('descriptive')
    expect(observation.metric.label).not.toBe(sourceWithLegacyClaims.label)
    expect(observation.validity.status).toBe('screening_only')
    expect(observation.actionability).toEqual({
      status: 'not_established',
      permittedUse: 'display_only',
      reason: 'static_scan_alone_is_not_a_programming_authority',
    })
    expect(JSON.stringify(result)).not.toMatch(
      /weak_muscles|tight_muscles|injury_prediction|lift_bans|load_reduction_pct|gluteus medius|hip flexor|squat/,
    )
  })

  it('SC-06 permits scan-independent general training when no scan exists', () => {
    const result = buildScreeningContextV1({
      expectedSubjectId: SUBJECT_ID,
      supportedEngineVersions: [ENGINE_VERSION],
      assessment: null,
    })

    expect(result).toEqual({
      version: 'screening-context-v1',
      scanUse: 'absent',
      scanAllowsGeneralTraining: true,
      reasonCodes: ['no_scan'],
      context: null,
    })
  })

  it('SC-03 keeps an incomplete assessment explicit and unavailable', () => {
    const result = buildScreeningContextV1(buildInput({
      assessment: assessment({ status: 'processing' }),
    }))

    expect(result.scanUse).toBe('unavailable')
    expect(result.scanAllowsGeneralTraining).toBe(true)
    expect(result.reasonCodes).toContain('assessment_not_complete:processing')
    expect(result.context!.observations.every(
      (observation) => observation.unavailableReasons.includes('assessment_not_complete'),
    )).toBe(true)
  })

  it('SC-07 denies a different subject without returning their scan context', () => {
    const result = buildScreeningContextV1(buildInput({ expectedSubjectId: OTHER_SUBJECT_ID }))

    expect(result.scanUse).toBe('denied')
    expect(result.scanAllowsGeneralTraining).toBe(true)
    expect(result.reasonCodes).toEqual(['subject_mismatch'])
    expect(result.context).toBeNull()
  })

  it('SC-07 makes an incompatible engine version explicit and non-actionable', () => {
    const result = buildScreeningContextV1(buildInput({ supportedEngineVersions: ['3.0.0'] }))

    expect(result.scanUse).toBe('incompatible')
    expect(result.reasonCodes).toContain('unsupported_engine_version:2.1.0')
    expect(result.context!.observations.every(
      (observation) => observation.actionability.status === 'not_established',
    )).toBe(true)
    expect(result.context!.observations.every(
      (observation) => observation.availability === 'unavailable'
        && observation.value === null
        && observation.unavailableReasons.includes('unsupported_engine_version:2.1.0')
        && observation.thresholdProvenance.status === 'unavailable',
    )).toBe(true)
    expect(result.context!.observations.every(
      (observation) => observation.validity.status === 'not_established'
        && observation.validity.applicability === 'incompatible_engine',
    )).toBe(true)
  })

  it('treats a missing assessment type as explicit incompatible provenance', () => {
    const result = buildScreeningContextV1(buildInput({
      assessment: assessment({ assessment_type: null }),
    }))

    expect(result.scanUse).toBe('incompatible')
    expect(result.reasonCodes).toContain('unsupported_assessment_type:missing')
    expect(result.context!.observations.every(
      (observation) => observation.availability === 'unavailable' && observation.value === null,
    )).toBe(true)
  })

  it('preserves only a validated persisted driving side as asserted provenance', () => {
    const sideFinding = findings().find((finding) =>
      finding.view_used === 'side' && finding.observations !== null,
    )!
    const result = buildScreeningContextV1(buildInput({ findings: [sideFinding] }))

    expect(result.context!.observations[0].sideProvenance).toEqual({
      status: 'asserted',
      drivingProfileSide: sideFinding.observations!.drivingProfileSide,
      reason: null,
    })

    const malformed = {
      ...sideFinding,
      observations: {
        sides: sideFinding.observations!.sides,
        drivingProfileSide: 'left' as const,
      },
    }
    malformed.observations.sides = malformed.observations.sides.filter(
      (side) => side.profileSide !== 'left',
    )
    const invalid = buildScreeningContextV1(buildInput({ findings: [malformed] }))
    expect(invalid.context!.observations[0].sideProvenance).toEqual({
      status: 'invalid',
      drivingProfileSide: null,
      reason: 'driving_side_missing_from_persisted_observations',
    })
    expect(invalid.context!.observations[0].availability).toBe('unavailable')
  })

  it('fails closed when a side metric has no persisted driving side', () => {
    const sideFinding = findings().find((finding) => finding.view_used === 'side')!
    const result = buildScreeningContextV1(buildInput({
      findings: [{ ...sideFinding, observations: null }],
    }))

    expect(result.context!.observations[0]).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: expect.arrayContaining(['no_driving_side_persisted']),
      value: null,
      validity: { status: 'not_established' },
      thresholdProvenance: { status: 'unavailable', warn: null, danger: null },
    })
  })

  it.each([
    ['invalid_level_verified', { level_verified: 'yes' as unknown as boolean }],
    ['invalid_capture_stability', { capture_stability: 2 }],
  ])('propagates %s from assessment provenance to every observation', (reason, overrides) => {
    const result = buildScreeningContextV1(buildInput({
      assessment: assessment(overrides),
    }))

    expect(result.scanUse).toBe('unavailable')
    expect(result.reasonCodes).toContain(reason)
    expect(result.context!.observations.every((observation) => (
      observation.availability === 'unavailable'
      && observation.unavailableReasons.includes(reason)
      && observation.validity.status === 'not_established'
      && observation.thresholdProvenance.status === 'unavailable'
    ))).toBe(true)
  })

  it('rejects a residual persisted direction outside the current metric contract', () => {
    const [first] = findings()
    const result = buildScreeningContextV1(buildInput({
      findings: [{ ...first, direction: 'diagnostic legacy alias' }],
    }))

    expect(result.context!.observations[0]).toMatchObject({
      availability: 'unavailable',
      unavailableReasons: expect.arrayContaining(['invalid_finding_direction']),
      value: null,
    })
  })

  it('records current provenance gaps without inventing hashes, transforms, or model metadata', () => {
    const result = buildScreeningContextV1(buildInput())
    const capture = result.context!.provenance.captures[0]

    expect(capture).toMatchObject({
      imageSha256: null,
      widthPx: null,
      heightPx: null,
      poseModelVersion: null,
      sourceWidthPx: null,
      sourceHeightPx: null,
      mirrorTransform: {
        status: 'not_persisted',
        analysisMirrored: null,
        displayMirrored: null,
      },
      cameraProtocol: {
        status: 'not_persisted',
        orientationNormalization: null,
        requestedFacingMode: null,
        observedFacingMode: null,
      },
      viewIdentity: 'asserted_not_verified',
    })
    expect(result.context!.provenance.limitations).toEqual(expect.arrayContaining([
      'image_hash_not_persisted',
      'source_dimensions_not_persisted',
      'mirror_transform_not_persisted',
      'view_identity_asserted_not_measured',
      'camera_protocol_not_persisted',
      'pose_model_version_not_persisted',
    ]))
  })

  it('projects valid capture provenance while keeping the operator view assertion explicit', () => {
    const withProvenance = sourceFrames().map((frame, index) => {
      const poseFrame: PoseFrame = {
        ...frame,
        poseMeta: {
          version: 'pose-frame-meta-v1',
          coordinateSpace: 'decoded_image_normalized',
          sourceWidthPx: 1280,
          sourceHeightPx: 720,
          analysisWidthPx: 1280,
          analysisHeightPx: 720,
          orientationNormalization: 'camera_video_frame',
          exifOrientationDegrees: null,
          analysisMirrored: false,
          displayMirrored: false,
          viewAssignment: 'operator_asserted_not_verified',
          requestedCameraFacingMode: 'environment',
          observedCameraFacingMode: 'environment',
          poseModel: {
            runtime: '@mediapipe/tasks-vision',
            runtimeVersion: '0.10.35',
            variant: 'lite',
            assetPath: '/mediapipe/models/pose_landmarker_lite.task',
            assetSha256: POSE_MODEL_SHA256.lite,
          },
        },
      }
      return {
        ...buildCaptureRow(poseFrame, ASSESSMENT_ID, PRACTITIONER_ID, { useFixture: false }),
        id: `capture-meta-${index}`,
        created_at: '2026-09-07T12:00:00.000Z',
        image_sha256: `${'a'.repeat(63)}${index}`,
        storage_path: `private/capture-meta-${index}.jpg`,
      }
    })
    const result = buildScreeningContextV1(buildInput({ captures: withProvenance }))
    const capture = result.context!.provenance.captures[0]

    expect(capture).toMatchObject({
      imageSha256: `${'a'.repeat(63)}0`,
      widthPx: 1280,
      heightPx: 720,
      sourceWidthPx: 1280,
      sourceHeightPx: 720,
      viewIdentity: 'asserted_not_verified',
      mirrorTransform: {
        status: 'persisted',
        analysisMirrored: false,
        displayMirrored: false,
      },
      cameraProtocol: {
        status: 'persisted',
        orientationNormalization: 'camera_video_frame',
        requestedFacingMode: 'environment',
        observedFacingMode: 'environment',
      },
    })
    expect(result.context!.provenance.limitations).not.toContain('mirror_transform_not_persisted')
    expect(result.context!.provenance.limitations).not.toContain('camera_protocol_not_persisted')
    expect(result.context!.provenance.limitations).not.toContain('image_hash_not_persisted')
  })

  it('sanitizes malformed assessment and legacy geometry metadata without making it clinical', () => {
    const malformedAssessment = assessment({
      capture_stability: 2,
      level_verified: 'yes' as unknown as boolean,
    })
    const malformedCaptures = captures().map((capture, index) => index === 0
      ? {
          ...capture,
          pose_frame: {
            ...(capture.pose_frame as PoseFrame),
            captureRollDeg: 90,
            aspectRatio: 99,
          },
        }
      : capture)
    const result = buildScreeningContextV1(buildInput({
      assessment: malformedAssessment,
      captures: malformedCaptures,
    }))

    expect(result.scanUse).toBe('unavailable')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'invalid_level_verified',
      'invalid_capture_stability',
    ]))
    expect(result.context!.assessment).toMatchObject({
      levelVerified: null,
      withinCaptureStability: null,
    })
    expect(result.context!.provenance.captures[0]).toMatchObject({
      captureRollDeg: null,
      aspectRatio: null,
    })
    expect(result.context!.provenance.limitations).toEqual(expect.arrayContaining([
      'invalid_capture_roll',
      'invalid_capture_aspect_ratio',
    ]))
    expect(result.context!.observations.every((observation) => (
      observation.availability === 'unavailable'
      && observation.validity.status === 'not_established'
      && observation.thresholdProvenance.status === 'unavailable'
    ))).toBe(true)
  })

  it('marks a practitioner-mismatched finding unavailable without leaking its value', () => {
    const [first] = findings()
    const mismatch = { ...first, practitioner_id: '17f4b5f1-6fdd-42cb-a506-b288a68529bd' }
    const result = buildScreeningContextV1(buildInput({ findings: [mismatch] }))
    const observation = result.context!.observations[0]

    expect(observation.availability).toBe('unavailable')
    expect(observation.value).toBeNull()
    expect(observation.unavailableReasons).toContain('finding_scope_mismatch')
  })
})
