import { ENGINE_VERSION } from '@posture-ai/engine'
import {
  buildScreeningContextV1,
  type PersistedScreeningAssessmentRow,
  type PersistedScreeningCaptureRow,
  type PersistedScreeningFindingRow,
  type ScreeningContextBoundaryResult,
} from './screeningContext'

export const SCREENING_CAPTURE_SELECT = [
  'id',
  'assessment_id',
  'practitioner_id',
  'view',
  'profile_side',
  'storage_path',
  'source',
  'pose_frame',
  'width_px',
  'height_px',
  'model_version',
  'created_at',
  'image_sha256',
].join(', ')

export interface DerivedScreeningUseInput {
  expectedSubjectId: string
  assessment: PersistedScreeningAssessmentRow
  captures: readonly PersistedScreeningCaptureRow[]
  findings: readonly PersistedScreeningFindingRow[]
}

export interface DerivedScreeningUseResult {
  screeningContext: ScreeningContextBoundaryResult
  /**
   * Canonical descriptive measurements only. Persisted source rows remain
   * immutable; this projection is the sole input allowed into report and
   * corrective-workout builders.
   */
  descriptiveFindings: DerivedScreeningFinding[]
}

export interface DerivedScreeningFinding {
  id: string
  imbalance_key: string
  label: string
  region: string
  deviation: number
  direction: string
  severity_pct: number
  zone: 'maintain' | 'warning' | 'danger'
  view_used: 'front' | 'side' | 'back'
  confidence: number
  borderline: boolean | null
  unit: 'deg'
}

/**
 * Applies ScreeningContextV1 before a persisted finding may influence a
 * derived report or corrective workout. The static scan remains display-only
 * evidence and never becomes training clearance.
 */
export function screenFindingsForDerivedUse(
  input: DerivedScreeningUseInput,
): DerivedScreeningUseResult {
  const screeningContext = buildScreeningContextV1({
    expectedSubjectId: input.expectedSubjectId,
    supportedEngineVersions: [ENGINE_VERSION],
    assessment: input.assessment,
    captures: input.captures,
    findings: input.findings,
  })
  const observations = screeningContext.context?.observations ?? []
  const descriptiveFindings = input.findings.flatMap((finding, index) => {
    const observation = observations[index]
    if (
      observation?.availability !== 'descriptive'
      || observation.value === null
      || observation.metric.key !== finding.imbalance_key
      || observation.metric.view === 'unknown'
    ) {
      return []
    }
    return [{
      id: finding.id,
      imbalance_key: finding.imbalance_key,
      label: observation.metric.label,
      region: observation.metric.region,
      deviation: observation.value.deviationDeg,
      direction: observation.value.direction,
      severity_pct: observation.value.severityPct,
      zone: observation.value.zone,
      view_used: observation.metric.view,
      confidence: observation.value.confidence,
      borderline: observation.value.borderline,
      unit: 'deg' as const,
    }]
  })

  return { screeningContext, descriptiveFindings }
}
