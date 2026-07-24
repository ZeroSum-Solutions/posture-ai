import { describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const access = {
    mode: 'test_fixture',
    surfaces: { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
  }
  const payload = { assessment: { id: 'assessment-1' } }
  return {
    access,
    payload,
    loadAssessmentResults: vi.fn(async () => ({ ok: true, data: payload })),
  }
})

vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccess: async () => state.access,
}))
vi.mock('@/lib/clinical-content/surfaces', () => ({
  hasCompleteClinicalSurfaces: () => true,
}))
vi.mock('./loadAssessmentResults', () => ({
  loadAssessmentResults: state.loadAssessmentResults,
}))
vi.mock('./AssessmentOnlyResults', () => ({ default: () => null }))
vi.mock('./ClinicalAssessmentResults', () => ({ default: () => null }))

import AssessmentResultsPage from './page'

describe('assessment results server data handoff', () => {
  test('passes the authenticated server payload into the clinical results component', async () => {
    const params = Promise.resolve({ id: 'assessment-1' })

    const element = await AssessmentResultsPage({ params })

    expect(state.loadAssessmentResults).toHaveBeenCalledWith('assessment-1', state.access)
    expect(element.props.initialAssessmentId).toBe('assessment-1')
    expect(element.props.initialData).toBe(state.payload)
  })
})
