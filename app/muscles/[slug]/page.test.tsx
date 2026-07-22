import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { ClinicalContentAccess } from '@/lib/clinical-content/policy'

const { access } = vi.hoisted(() => ({ access: { current: null as ClinicalContentAccess | null } }))

vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccess: async () => access.current,
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found') } }))

import MusclePage from './page'

describe('muscle detail clinical surface isolation', () => {
  test('does not reveal exercise or dosage content in a knowledge-links-only release', async () => {
    access.current = {
      mode: 'approved',
      reason: 'test',
      contentVersion: 'knowledge-only-v1',
      inventorySha256: 'a'.repeat(64),
      surfaces: { recommendations: false, programs: false, workouts: false, knowledgeLinks: true },
      approvedItemIds: [],
      approvedMuscleSlugs: ['hamstrings'],
      approvedExerciseSlugs: ['prone-hamstring-curl', 'seated-hamstring-stretch'],
      approvedLinkIds: [],
      approvedExerciseMuscleIds: [
        'exercise_muscle:prone-hamstring-curl:hamstrings:strengthen:1',
        'exercise_muscle:seated-hamstring-stretch:hamstrings:stretch:1',
      ],
      approvedContraindicationIds: [],
      approvedReportCopyIds: [],
      approvedAlgorithmIds: [],
    }

    const html = renderToStaticMarkup(await MusclePage({ params: Promise.resolve({ slug: 'hamstrings' }) }))

    expect(html).toContain('Hamstrings')
    expect(html).not.toContain('Stretching')
    expect(html).not.toContain('Strengthening progressions')
    expect(html).not.toContain('Prone Hamstring Curl')
    expect(html).not.toContain('Seated Hamstring Stretch')
  })

  test('falls back to the raw imbalance key when the report copy is not approved', async () => {
    access.current = {
      mode: 'approved',
      reason: 'test',
      contentVersion: 'knowledge-only-v1',
      inventorySha256: 'a'.repeat(64),
      surfaces: { recommendations: false, programs: false, workouts: false, knowledgeLinks: true },
      approvedItemIds: [],
      approvedMuscleSlugs: ['hamstrings'],
      approvedExerciseSlugs: [],
      approvedLinkIds: ['link:hamstrings:trunk_lean:tight'],
      approvedExerciseMuscleIds: [],
      approvedContraindicationIds: [],
      approvedReportCopyIds: [],
      approvedAlgorithmIds: [],
    }

    const html = renderToStaticMarkup(await MusclePage({ params: Promise.resolve({ slug: 'hamstrings' }) }))

    expect(html).not.toContain('Trunk Lean')
    expect(html).toContain('trunk_lean')
  })

  test('renders the reviewed report-copy label when it is approved', async () => {
    access.current = {
      mode: 'approved',
      reason: 'test',
      contentVersion: 'knowledge-only-v1',
      inventorySha256: 'a'.repeat(64),
      surfaces: { recommendations: false, programs: false, workouts: false, knowledgeLinks: true },
      approvedItemIds: [],
      approvedMuscleSlugs: ['hamstrings'],
      approvedExerciseSlugs: [],
      approvedLinkIds: ['link:hamstrings:trunk_lean:tight'],
      approvedExerciseMuscleIds: [],
      approvedContraindicationIds: [],
      approvedReportCopyIds: ['report_copy:trunk_lean'],
      approvedAlgorithmIds: [],
    }

    const html = renderToStaticMarkup(await MusclePage({ params: Promise.resolve({ slug: 'hamstrings' }) }))

    expect(html).toContain('Trunk Lean')
  })
})
