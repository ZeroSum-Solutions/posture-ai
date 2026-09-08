import type { MetricValidity } from '@posture-ai/engine/thresholds'
import type { CaptureRow } from '@/lib/captures/buildCaptureRow'
import type { FindingRow } from '@/lib/findings/buildFindingRow'

export interface PersistedScreeningAssessmentRow {
  id: string
  client_id: string
  practitioner_id: string
  assessed_at: string
  status: string
  assessment_type: string | null
  scoring_engine_version: string | null
  level_verified: boolean | null
  capture_stability: number | null
}

export interface PersistedScreeningCaptureRow extends CaptureRow {
  id: string
  width_px: number | null
  height_px: number | null
  model_version: string | null
  created_at: string
}

export type PersistedScreeningFindingRow = Omit<FindingRow, 'metric_validity'> & {
  metric_validity: string | null
}

export interface BuildScreeningContextInput {
  expectedSubjectId: string
  supportedEngineVersions: readonly string[]
  assessment: PersistedScreeningAssessmentRow | null
  captures?: readonly PersistedScreeningCaptureRow[]
  findings?: readonly PersistedScreeningFindingRow[]
}

export type ScanUse = 'absent' | 'unavailable' | 'descriptive' | 'incompatible' | 'denied'

export interface ScreeningObservation {
  metric: {
    key: string
    label: string
    region: 'head_shoulders' | 'spine' | 'pelvis' | 'leg' | 'unknown'
    view: 'front' | 'side' | 'back' | 'unknown'
  }
  availability: 'descriptive' | 'unavailable'
  unavailableReasons: string[]
  value: {
    deviationDeg: number
    severityPct: number
    zone: 'maintain' | 'warning' | 'danger'
    confidence: number
    borderline: boolean | null
  } | null
  quality: {
    measurementConfidence: number | null
    withinCaptureProcessing:
      | { status: 'observed'; stabilityScore: number; uncertaintyDeg: number }
      | { status: 'not_observed'; stabilityScore: null; uncertaintyDeg: null }
      | { status: 'invalid'; stabilityScore: number | null; uncertaintyDeg: number | null }
  }
  repeatability: {
    status: 'not_established'
    evidenceRef: null
    reason: 'no_restance_repeatability_profile_persisted'
  }
  validity: {
    status: 'validated' | 'literature_cited' | 'screening_only' | 'not_established'
    persistedFrame: MetricValidity | null
    applicability: 'current_engine' | 'incompatible_engine' | 'not_persisted'
  }
  sideProvenance:
    | { status: 'asserted'; drivingProfileSide: 'left' | 'right'; reason: null }
    | { status: 'not_persisted'; drivingProfileSide: null; reason: 'no_driving_side_persisted' }
    | { status: 'invalid'; drivingProfileSide: null; reason: 'driving_side_missing_from_persisted_observations' }
  thresholdProvenance: {
    status: 'available' | 'unavailable'
    warn: { degrees: number; source: string; citation: string | null } | null
    danger: { degrees: number; source: string; citation: string | null } | null
  }
  actionability: {
    status: 'not_established'
    permittedUse: 'display_only'
    reason: 'static_scan_alone_is_not_a_programming_authority'
  }
}

export interface ScreeningContextV1 {
  assessment: {
    id: string
    subjectId: string
    practitionerId: string
    assessedAt: string
    status: string
    assessmentType: string | null
    scoringEngineVersion: string | null
    levelVerified: boolean | null
    withinCaptureStability: number | null
  }
  provenance: {
    captures: Array<{
      captureId: string
      assessmentId: string
      practitionerId: string
      assertedView: string
      profileSide: 'left' | 'right' | null
      source: string
      createdAt: string
      imageSha256: null
      widthPx: number | null
      heightPx: number | null
      poseModelVersion: string | null
      captureRollDeg: number | null
      aspectRatio: number | null
      sourceWidthPx: number | null
      sourceHeightPx: number | null
      mirrorTransform:
        | { status: 'persisted'; analysisMirrored: boolean; displayMirrored: boolean }
        | { status: 'not_persisted'; analysisMirrored: null; displayMirrored: null }
      cameraProtocol:
        | {
            status: 'persisted'
            orientationNormalization: 'camera_video_frame' | 'exif_from_image_canvas_v1' | 'browser_decoder'
            exifOrientationDegrees: null
            requestedFacingMode: 'environment' | null
            observedFacingMode: string | null
          }
        | {
            status: 'not_persisted'
            orientationNormalization: null
            exifOrientationDegrees: null
            requestedFacingMode: null
            observedFacingMode: null
          }
      viewIdentity: 'asserted_not_verified'
    }>
    limitations: string[]
  }
  observations: ScreeningObservation[]
}

export interface ScreeningContextBoundaryResult {
  version: 'screening-context-v1'
  scanUse: ScanUse
  /**
   * True means this scan adds no training restriction. It is not medical
   * clearance and does not bypass eligibility, consent, symptom, or safety gates.
   */
  scanAllowsGeneralTraining: true
  reasonCodes: string[]
  context: ScreeningContextV1 | null
}
