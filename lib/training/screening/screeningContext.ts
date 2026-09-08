import type { PoseFrame } from '@posture-ai/engine'
import {
  RELIABILITY_FLOOR,
  THRESHOLDS,
} from '@posture-ai/engine/thresholds'
import {
  poseFrameMetaSchema,
  STRUCTURAL_LANDMARKS_BY_GROUP,
  type RequiredCaptureGroup,
} from '@/lib/validation/frames'
import type {
  BuildScreeningContextInput,
  PersistedScreeningAssessmentRow,
  PersistedScreeningCaptureRow,
  PersistedScreeningFindingRow,
  ScanUse,
  ScreeningContextBoundaryResult,
  ScreeningContextV1,
  ScreeningObservation,
} from './types'
export type {
  BuildScreeningContextInput,
  PersistedScreeningAssessmentRow,
  PersistedScreeningCaptureRow,
  PersistedScreeningFindingRow,
  ScreeningContextBoundaryResult,
  ScreeningContextV1,
  ScreeningObservation,
} from './types'

// Labels and regions come from the current engine contract, rather than from
// unrestricted legacy finding columns that may contain diagnostic aliases.
const METRICS: Record<string, { label: string; region: ScreeningObservation['metric']['region'] }> = {
  forward_head_posture: { label: 'Forward Head Posture', region: 'head_shoulders' },
  anterior_imbalanced_shoulders: { label: 'Shoulder Imbalance (Front)', region: 'head_shoulders' },
  posterior_imbalanced_shoulders: { label: 'Shoulder Imbalance (Back)', region: 'head_shoulders' },
  trunk_lean: { label: 'Trunk Lean', region: 'spine' },
  pelvic_obliquity: { label: 'Pelvic Obliquity', region: 'pelvis' },
  genu_varum_valgum_left: { label: 'Knee Alignment (Left)', region: 'leg' },
  genu_varum_valgum_right: { label: 'Knee Alignment (Right)', region: 'leg' },
  knee_extension_back_knee: { label: 'Knee Hyperextension', region: 'leg' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function bounded(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max
}

function poseMeta(frame: Record<string, unknown>) {
  const parsed = poseFrameMetaSchema.safeParse(frame.poseMeta)
  return parsed.success ? parsed.data : null
}

function persistedModelVersion(meta: NonNullable<ReturnType<typeof poseMeta>>): string {
  const model = meta.poseModel
  return `${model.runtime}@${model.runtimeVersion}/${model.variant}/sha256:${model.assetSha256}`
}

function captureGroup(row: PersistedScreeningCaptureRow): RequiredCaptureGroup | null {
  if (row.view === 'front' || row.view === 'back') return row.view
  if (row.view === 'side' && (row.profile_side === 'left' || row.profile_side === 'right')) {
    return `side-${row.profile_side}`
  }
  return null
}

function captureProblem(row: PersistedScreeningCaptureRow): 'contradictory' | 'invalid' | null {
  if (!isRecord(row.pose_frame)) return 'invalid'
  const frame = row.pose_frame as Partial<PoseFrame>
  if (frame.view !== row.view) return 'contradictory'
  if (row.view === 'side') {
    if (frame.profileSide !== row.profile_side) return 'contradictory'
  } else if (frame.profileSide !== undefined) {
    return 'contradictory'
  }
  const group = captureGroup(row)
  if (!group || !isRecord(frame.landmarks)) return 'invalid'
  for (const name of STRUCTURAL_LANDMARKS_BY_GROUP[group]) {
    const landmark = frame.landmarks[name]
    if (!isRecord(landmark) || !finite(landmark.x) || !finite(landmark.y)) return 'invalid'
    if (landmark.x < -0.5 || landmark.x > 1.5 || landmark.y < -0.5 || landmark.y > 1.5) return 'invalid'
    if (landmark.visibility !== undefined &&
      (!finite(landmark.visibility) || landmark.visibility < 0 || landmark.visibility > 1)) return 'invalid'
  }
  if ('poseMeta' in frame) {
    const meta = poseMeta(frame as Record<string, unknown>)
    if (!meta) return 'invalid'
    if (row.width_px !== null && row.width_px !== meta.analysisWidthPx) return 'contradictory'
    if (row.height_px !== null && row.height_px !== meta.analysisHeightPx) return 'contradictory'
    if (row.model_version !== null && row.model_version !== persistedModelVersion(meta)) return 'contradictory'
  }
  return null
}

function requiredGroups(view: string): RequiredCaptureGroup[] {
  if (view === 'front' || view === 'back') return [view]
  if (view === 'side') return ['side-left', 'side-right']
  return []
}

function findingView(view: string): ScreeningObservation['metric']['view'] {
  return view === 'front' || view === 'side' || view === 'back' ? view : 'unknown'
}

function viewReasons(
  finding: PersistedScreeningFindingRow,
  captures: readonly PersistedScreeningCaptureRow[],
  assessment: PersistedScreeningAssessmentRow,
): string[] {
  const reasons: string[] = []
  for (const group of requiredGroups(finding.view_used)) {
    const groupRows = captures.filter((row) => captureGroup(row) === group)
    if (groupRows.length === 0) {
      reasons.push(`missing_required_capture_group:${group}`)
      continue
    }
    if (groupRows.some((row) => row.assessment_id !== assessment.id || row.practitioner_id !== assessment.practitioner_id)) {
      reasons.push(`capture_scope_mismatch:${group}`)
    } else if (groupRows.some((row) => captureProblem(row) === 'contradictory')) {
      reasons.push(`contradictory_capture_metadata:${group}`)
    } else if (groupRows.some((row) => captureProblem(row) === 'invalid')) {
      reasons.push(`invalid_capture_group:${group}`)
    }
  }
  return reasons
}

function validity(value: string | null, compatible: boolean): ScreeningObservation['validity'] {
  const persistedFrame = (
    value === 'VALIDATED' || value === 'LITERATURE_CITED' || value === 'SCREENING_ONLY'
  ) ? value : null
  const statuses = {
    VALIDATED: 'validated',
    LITERATURE_CITED: 'literature_cited',
    SCREENING_ONLY: 'screening_only',
  } as const
  if (!persistedFrame) {
    return {
      status: 'not_established',
      persistedFrame: null,
      applicability: 'not_persisted',
    }
  }
  return {
    status: compatible ? statuses[persistedFrame] : 'not_established',
    persistedFrame,
    applicability: compatible ? 'current_engine' : 'incompatible_engine',
  }
}

function withinCaptureQuality(finding: PersistedScreeningFindingRow): ScreeningObservation['quality']['withinCaptureProcessing'] {
  const stability = finding.stability_score
  const uncertainty = finding.uncertainty_deg
  if (stability === null && uncertainty === null) {
    return { status: 'not_observed', stabilityScore: null, uncertaintyDeg: null }
  }
  if (finite(stability) && stability >= 0 && stability <= 1 && finite(uncertainty) && uncertainty >= 0) {
    return { status: 'observed', stabilityScore: stability, uncertaintyDeg: uncertainty }
  }
  return {
    status: 'invalid',
    stabilityScore: finite(stability) ? stability : null,
    uncertaintyDeg: finite(uncertainty) ? uncertainty : null,
  }
}

function sideProvenance(finding: PersistedScreeningFindingRow): ScreeningObservation['sideProvenance'] {
  if (finding.view_used !== 'side' || finding.observations === null) {
    return {
      status: 'not_persisted',
      drivingProfileSide: null,
      reason: 'no_driving_side_persisted',
    }
  }
  const stored = finding.observations as unknown
  if (isRecord(stored) &&
    (stored.drivingProfileSide === 'left' || stored.drivingProfileSide === 'right') &&
    Array.isArray(stored.sides) &&
    stored.sides.some((side) => isRecord(side) && side.profileSide === stored.drivingProfileSide)) {
    return {
      status: 'asserted',
      drivingProfileSide: stored.drivingProfileSide,
      reason: null,
    }
  }
  return {
    status: 'invalid',
    drivingProfileSide: null,
    reason: 'driving_side_missing_from_persisted_observations',
  }
}

function buildObservation(
  finding: PersistedScreeningFindingRow,
  captures: readonly PersistedScreeningCaptureRow[],
  assessment: PersistedScreeningAssessmentRow,
  incompatibilityReasons: readonly string[],
): ScreeningObservation {
  const reasons = viewReasons(finding, captures, assessment)
  const metric = METRICS[finding.imbalance_key]
  const threshold = THRESHOLDS[finding.imbalance_key]
  const view = findingView(finding.view_used)
  if (!metric || !threshold) reasons.push('unsupported_measurement')
  if (view === 'unknown') reasons.push('invalid_finding_view')
  if (finding.assessment_id !== assessment.id || finding.practitioner_id !== assessment.practitioner_id) {
    reasons.push('finding_scope_mismatch')
  }
  if (!finite(finding.deviation) || !finite(finding.severity_pct)) reasons.push('invalid_measurement_value')
  if (!finite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1) reasons.push('invalid_confidence')
  else if (finding.confidence < RELIABILITY_FLOOR) reasons.push('insufficient_confidence')
  if (!['maintain', 'warning', 'danger', 'unreliable'].includes(finding.zone)) reasons.push('invalid_zone')
  else if (finding.zone === 'unreliable') reasons.push('unreliable_measurement')
  if (assessment.status !== 'complete') reasons.push('assessment_not_complete')
  reasons.push(...incompatibilityReasons)
  const assertedSide = sideProvenance(finding)
  if (assertedSide.status === 'invalid') reasons.push(assertedSide.reason)

  const unavailableReasons = [...new Set(reasons)]
  const available = unavailableReasons.length === 0
  const zone = finding.zone === 'maintain' || finding.zone === 'warning' || finding.zone === 'danger'
    ? finding.zone
    : null

  return {
    metric: {
      key: finding.imbalance_key,
      label: metric?.label ?? 'Unsupported measurement',
      region: metric?.region ?? 'unknown',
      view,
    },
    availability: available ? 'descriptive' : 'unavailable',
    unavailableReasons,
    value: available && zone ? {
      deviationDeg: finding.deviation,
      severityPct: finding.severity_pct,
      zone,
      confidence: finding.confidence,
      borderline: typeof finding.borderline === 'boolean' ? finding.borderline : null,
    } : null,
    quality: {
      measurementConfidence: finite(finding.confidence) ? finding.confidence : null,
      withinCaptureProcessing: withinCaptureQuality(finding),
    },
    repeatability: {
      status: 'not_established',
      evidenceRef: null,
      reason: 'no_restance_repeatability_profile_persisted',
    },
    validity: validity(
      finding.metric_validity,
      Boolean(metric && threshold && incompatibilityReasons.length === 0),
    ),
    sideProvenance: assertedSide,
    thresholdProvenance: threshold && incompatibilityReasons.length === 0 ? {
      status: 'available',
      warn: { degrees: threshold.warn.deg, source: threshold.warn.source, citation: threshold.warn.citation },
      danger: { degrees: threshold.danger.deg, source: threshold.danger.source, citation: threshold.danger.citation },
    } : { status: 'unavailable', warn: null, danger: null },
    actionability: {
      status: 'not_established',
      permittedUse: 'display_only',
      reason: 'static_scan_alone_is_not_a_programming_authority',
    },
  }
}

function provenance(captures: readonly PersistedScreeningCaptureRow[]): ScreeningContextV1['provenance'] {
  const limitations = new Set<string>([
    'image_hash_not_persisted',
    'view_identity_asserted_not_measured',
  ])
  return {
    captures: captures.map((capture) => {
      const frame = isRecord(capture.pose_frame) ? capture.pose_frame : {}
      const hasPoseMeta = 'poseMeta' in frame
      const meta = poseMeta(frame)
      if (hasPoseMeta && !meta) limitations.add('invalid_pose_metadata')
      if (!meta) {
        limitations.add('source_dimensions_not_persisted')
        limitations.add('mirror_transform_not_persisted')
        limitations.add('camera_protocol_not_persisted')
        limitations.add('pose_model_version_not_persisted')
      } else if (meta.sourceWidthPx === null || meta.sourceHeightPx === null) {
        limitations.add('source_dimensions_not_observed')
      }
      if (frame.captureRollDeg !== undefined && !bounded(frame.captureRollDeg, -45, 45)) {
        limitations.add('invalid_capture_roll')
      }
      if (frame.aspectRatio !== undefined && !bounded(frame.aspectRatio, 0.1, 10)) {
        limitations.add('invalid_capture_aspect_ratio')
      }
      return {
        captureId: capture.id,
        assessmentId: capture.assessment_id,
        practitionerId: capture.practitioner_id,
        assertedView: capture.view,
        profileSide: capture.profile_side,
        source: capture.source,
        createdAt: capture.created_at,
        imageSha256: null,
        widthPx: capture.width_px ?? meta?.analysisWidthPx ?? null,
        heightPx: capture.height_px ?? meta?.analysisHeightPx ?? null,
        poseModelVersion: capture.model_version ?? (meta ? persistedModelVersion(meta) : null),
        captureRollDeg: bounded(frame.captureRollDeg, -45, 45) ? frame.captureRollDeg : null,
        aspectRatio: bounded(frame.aspectRatio, 0.1, 10) ? frame.aspectRatio : null,
        sourceWidthPx: meta?.sourceWidthPx ?? null,
        sourceHeightPx: meta?.sourceHeightPx ?? null,
        mirrorTransform: meta ? {
          status: 'persisted' as const,
          analysisMirrored: meta.analysisMirrored,
          displayMirrored: meta.displayMirrored,
        } : {
          status: 'not_persisted' as const,
          analysisMirrored: null,
          displayMirrored: null,
        },
        cameraProtocol: meta ? {
          status: 'persisted' as const,
          orientationNormalization: meta.orientationNormalization,
          exifOrientationDegrees: meta.exifOrientationDegrees,
          requestedFacingMode: meta.requestedCameraFacingMode,
          observedFacingMode: meta.observedCameraFacingMode,
        } : {
          status: 'not_persisted' as const,
          orientationNormalization: null,
          exifOrientationDegrees: null,
          requestedFacingMode: null,
          observedFacingMode: null,
        },
        viewIdentity: 'asserted_not_verified' as const,
      }
    }),
    limitations: [...limitations],
  }
}

/**
 * Projects persisted scan rows into a non-diagnostic, display-only boundary.
 * The result can describe supported measurements, but can never clear a person
 * for training or generate lift bans, load changes, or volume changes.
 */
export function buildScreeningContextV1(input: BuildScreeningContextInput): ScreeningContextBoundaryResult {
  if (!input.assessment) {
    return {
      version: 'screening-context-v1',
      scanUse: 'absent',
      scanAllowsGeneralTraining: true,
      reasonCodes: ['no_scan'],
      context: null,
    }
  }
  const assessment = input.assessment
  if (assessment.client_id !== input.expectedSubjectId) {
    return {
      version: 'screening-context-v1',
      scanUse: 'denied',
      scanAllowsGeneralTraining: true,
      reasonCodes: ['subject_mismatch'],
      context: null,
    }
  }

  const captures = input.captures ?? []
  const findings = input.findings ?? []
  const reasonCodes: string[] = []
  const engineVersion = assessment.scoring_engine_version
  if (!engineVersion || !input.supportedEngineVersions.includes(engineVersion)) {
    reasonCodes.push(`unsupported_engine_version:${engineVersion ?? 'missing'}`)
  }
  if (assessment.assessment_type !== 'static') {
    reasonCodes.push(`unsupported_assessment_type:${assessment.assessment_type ?? 'missing'}`)
  }
  const incompatibilityReasons = reasonCodes.filter((reason) => reason.startsWith('unsupported_'))
  const observations = findings.map((finding) =>
    buildObservation(finding, captures, assessment, incompatibilityReasons),
  )
  const context: ScreeningContextV1 = {
    assessment: {
      id: assessment.id,
      subjectId: assessment.client_id,
      practitionerId: assessment.practitioner_id,
      assessedAt: assessment.assessed_at,
      status: assessment.status,
      assessmentType: assessment.assessment_type,
      scoringEngineVersion: assessment.scoring_engine_version,
      levelVerified: typeof assessment.level_verified === 'boolean' ? assessment.level_verified : null,
      withinCaptureStability: bounded(assessment.capture_stability, 0, 1)
        ? assessment.capture_stability
        : null,
    },
    provenance: provenance(captures),
    observations,
  }
  if (assessment.status !== 'complete') reasonCodes.push(`assessment_not_complete:${assessment.status}`)
  if (findings.length === 0) reasonCodes.push('no_findings')
  if (assessment.level_verified !== null && typeof assessment.level_verified !== 'boolean') {
    reasonCodes.push('invalid_level_verified')
  }
  if (assessment.capture_stability !== null && !bounded(assessment.capture_stability, 0, 1)) {
    reasonCodes.push('invalid_capture_stability')
  }

  let scanUse: ScanUse
  if (reasonCodes.some((reason) => reason.startsWith('unsupported_'))) scanUse = 'incompatible'
  else if (
    reasonCodes.some((reason) => reason === 'no_findings' || reason.startsWith('assessment_not_complete:'))
    || observations.every((observation) => observation.availability === 'unavailable')
  ) {
    scanUse = 'unavailable'
  } else {
    scanUse = 'descriptive'
  }

  return {
    version: 'screening-context-v1',
    scanUse,
    scanAllowsGeneralTraining: true,
    reasonCodes,
    context,
  }
}
