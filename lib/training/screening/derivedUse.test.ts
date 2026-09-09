import { describe, expect, it } from 'vitest'
import { assessPosture, ENGINE_VERSION, testLandmarksFrames, type PoseFrame } from '@posture-ai/engine'
import { buildCaptureRow } from '@/lib/captures/buildCaptureRow'
import { buildFindingRow } from '@/lib/findings/buildFindingRow'
import type {
  PersistedScreeningAssessmentRow,
  PersistedScreeningCaptureRow,
  PersistedScreeningFindingRow,
} from './screeningContext'
import { screenFindingsForDerivedUse } from './derivedUse'

const ASSESSMENT_ID = '81da03e0-6f9e-4e88-9ba1-59121047159e'
const SUBJECT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'
const PRACTITIONER_ID = '6a6d11e1-9099-4325-8cc4-8d00c87bc6a4'

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

function fixture() {
  const frames = sourceFrames()
  const assessment: PersistedScreeningAssessmentRow = {
    id: ASSESSMENT_ID,
    client_id: SUBJECT_ID,
    practitioner_id: PRACTITIONER_ID,
    assessed_at: '2026-09-07T12:00:00.000Z',
    status: 'complete',
    assessment_type: 'static',
    scoring_engine_version: ENGINE_VERSION,
    level_verified: true,
    capture_stability: 0.91,
  }
  const captures: PersistedScreeningCaptureRow[] = frames.map((frame, index) => ({
    ...buildCaptureRow(frame, ASSESSMENT_ID, PRACTITIONER_ID, { useFixture: false }),
    id: `capture-${index}`,
    storage_path: null,
    width_px: null,
    height_px: null,
    model_version: null,
    created_at: assessment.assessed_at,
    image_sha256: null,
  }))
  const findings: PersistedScreeningFindingRow[] = assessPosture(frames).findings.map((finding, index) => ({
    ...buildFindingRow(finding, ASSESSMENT_ID, PRACTITIONER_ID),
    id: `finding-${index}`,
  }))
  return { assessment, captures, findings }
}

describe('screenFindingsForDerivedUse', () => {
  it('returns canonical descriptive rows for an available supported scan', () => {
    const input = fixture()
    const legacyClaim = {
      ...input.findings[0],
      label: 'Ban squats because of a diagnosis',
    }
    const result = screenFindingsForDerivedUse({
      expectedSubjectId: SUBJECT_ID,
      ...input,
      findings: [legacyClaim, ...input.findings.slice(1)],
    })

    expect(result.screeningContext.scanUse).toBe('descriptive')
    expect(result.descriptiveFindings.length).toBeGreaterThan(0)
    expect(result.descriptiveFindings[0].label).not.toBe(legacyClaim.label)
    expect(result.descriptiveFindings[0].unit).toBe('deg')
    expect(Object.keys(result.descriptiveFindings[0]).sort()).toEqual([
      'borderline', 'confidence', 'deviation', 'direction', 'id', 'imbalance_key',
      'label', 'region', 'severity_pct', 'unit', 'view_used', 'zone',
    ])
    expect(JSON.stringify(result.descriptiveFindings[0])).not.toMatch(
      /assessment_id|practitioner_id|metric_validity|observations|injury_prediction/,
    )
  })

  it('drops a row with an unrecognized persisted direction instead of forwarding the alias', () => {
    const input = fixture()
    const result = screenFindingsForDerivedUse({
      expectedSubjectId: SUBJECT_ID,
      ...input,
      findings: [{ ...input.findings[0], direction: 'avoid all lifting' }],
    })

    expect(result.descriptiveFindings).toEqual([])
    expect(result.screeningContext.context?.observations[0].unavailableReasons)
      .toContain('invalid_finding_direction')
  })

  it('returns no rows for an incompatible engine', () => {
    const input = fixture()
    const result = screenFindingsForDerivedUse({
      expectedSubjectId: SUBJECT_ID,
      ...input,
      assessment: { ...input.assessment, scoring_engine_version: 'unsupported-engine' },
    })

    expect(result.screeningContext.scanUse).toBe('incompatible')
    expect(result.descriptiveFindings).toEqual([])
  })

  it('excludes a persisted finding whose assessment scope does not match', () => {
    const input = fixture()
    const mismatched = {
      ...input.findings[0],
      assessment_id: '17f4b5f1-6fdd-42cb-a506-b288a68529bd',
    }
    const result = screenFindingsForDerivedUse({
      expectedSubjectId: SUBJECT_ID,
      ...input,
      findings: [mismatched, ...input.findings.slice(1)],
    })

    expect(result.descriptiveFindings).not.toContainEqual(expect.objectContaining({ id: mismatched.id }))
    expect(result.screeningContext.context?.observations[0].unavailableReasons).toContain('finding_scope_mismatch')
  })
})
