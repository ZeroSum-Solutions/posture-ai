import { describe, expect, test } from 'vitest'
import { ALL_EXERCISES, ALL_MUSCLES } from '@/content'
import {
  approvedClinicalExercises,
  approvedClinicalLinks,
  approvedClinicalMuscles,
  approvedExerciseMuscles,
} from './catalog'
import type { ClinicalContentAccess } from './policy'

function access(overrides: Partial<ClinicalContentAccess> = {}): ClinicalContentAccess {
  return {
    mode: 'approved',
    reason: 'test',
    contentVersion: 'release-test',
    inventorySha256: 'a'.repeat(64),
    surfaces: { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
    approvedItemIds: [],
    approvedMuscleSlugs: [],
    approvedExerciseSlugs: [],
    approvedLinkIds: [],
    approvedExerciseMuscleIds: [],
    approvedContraindicationIds: [],
    approvedReportCopyIds: [],
    approvedAlgorithmIds: [],
    ...overrides,
  }
}

describe('release-scoped clinical catalog', () => {
  test('projects rendered exercise text from the hash-authoritative TypeScript catalog', () => {
    const exercise = ALL_EXERCISES.find((item) => item.slug === 'wall-angels')!
    const result = approvedClinicalExercises(access({ approvedExerciseSlugs: [exercise.slug] }))

    expect(result).toEqual([exercise])
    expect(result[0]?.instructions).toBe(exercise.instructions)
  })

  test('requires exact muscle, link, and exercise-muscle relationship ids', () => {
    const muscle = ALL_MUSCLES.find((item) => item.slug === 'latissimus-dorsi')!
    const exercise = ALL_EXERCISES.find((item) => item.slug === 'wall-angels')!
    const scoped = access({
      approvedMuscleSlugs: [muscle.slug],
      approvedExerciseSlugs: [exercise.slug],
      approvedLinkIds: ['link:latissimus-dorsi:trunk_lean:tight'],
      approvedExerciseMuscleIds: ['exercise_muscle:wall-angels:lower-trapezius:strengthen:2'],
    })

    expect(approvedClinicalMuscles(scoped)).toEqual([muscle])
    expect(approvedClinicalLinks(scoped)).toHaveLength(1)
    expect(approvedExerciseMuscles(scoped, exercise)).toEqual([
      { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    ])
  })
})
