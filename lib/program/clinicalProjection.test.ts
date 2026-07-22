import { describe, expect, test } from 'vitest'
import { buildClinicalProjection } from './clinicalProjection'

const finding = {
  imbalance_key: 'knee_extension_back_knee',
  label: 'Knee extension',
  region: 'leg',
  deviation: 8,
  direction: 'Hyperextended',
  severity_pct: 55,
  zone: 'warning',
  view_used: 'side',
  confidence: 0.9,
}

describe('buildClinicalProjection', () => {
  test('projects only the exact approved exercise, link, and report-copy subset', () => {
    const projection = buildClinicalProjection(
      { overall_grade: 'B', capability: 'standard' },
      [finding],
      {
        approvedExerciseSlugs: ['prone-hamstring-curl'],
        approvedLinkIds: ['link:hamstrings:knee_extension_back_knee:weak'],
        approvedReportCopyIds: ['report_copy:knee_extension_back_knee'],
      },
    )

    expect(projection.exercises.map((exercise) => exercise.slug)).toEqual(['prone-hamstring-curl'])
    expect(projection.program.priorities).toHaveLength(1)
    expect(projection.program.priorities[0].steps.map((step) => step.slug)).toEqual(['prone-hamstring-curl'])
    expect(projection.program.priorities[0].steps[0].alternatives).toEqual([
      { slug: 'prone-hamstring-curl', name: 'Prone Hamstring Curl' },
    ])
    expect(projection.sessionPreview?.itemCount).toBe(1)
    expect(JSON.stringify(projection)).not.toContain('standing-hamstring-curl')
    expect(JSON.stringify(projection)).not.toContain('glute-bridge')
  })

  test('cannot generate a program when the reviewed report copy is absent', () => {
    const projection = buildClinicalProjection(
      { overall_grade: 'B' },
      [finding],
      {
        approvedExerciseSlugs: ['prone-hamstring-curl'],
        approvedLinkIds: ['link:hamstrings:knee_extension_back_knee:weak'],
        approvedReportCopyIds: [],
      },
    )

    expect(projection.program.hasPlan).toBe(false)
    expect(projection.sessionPreview).toBeNull()
  })
})
