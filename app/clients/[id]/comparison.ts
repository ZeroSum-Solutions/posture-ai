import { comparePostgresTimestamps } from '@/lib/time/postgres-timestamp'

export type ChronologicalAssessment = {
  id: string
  assessed_at: string
}

export type ComparisonSelection = {
  baseId: string
  targetId: string
}

export function sortAssessmentsChronologically<T extends ChronologicalAssessment>(assessments: readonly T[]): T[] {
  return [...assessments].sort((left, right) => {
    const dateDifference = comparePostgresTimestamps(left.assessed_at, right.assessed_at) ?? 0
    return dateDifference || left.id.localeCompare(right.id)
  })
}

export function initialComparison(assessments: readonly ChronologicalAssessment[]): ComparisonSelection {
  if (assessments.length < 2) return { baseId: '', targetId: '' }
  const base = assessments[0]
  const target = [...assessments].reverse().find(
    (assessment) => comparePostgresTimestamps(assessment.assessed_at, base.assessed_at) === 1,
  )
  return {
    baseId: base.id,
    targetId: target?.id ?? '',
  }
}

export function selectComparisonBase(
  assessments: readonly ChronologicalAssessment[],
  currentTargetId: string,
  nextBaseId: string,
): ComparisonSelection {
  const baseIndex = assessments.findIndex((assessment) => assessment.id === nextBaseId)
  const targetIndex = assessments.findIndex((assessment) => assessment.id === currentTargetId)
  if (baseIndex < 0) return initialComparison(assessments)
  const isCurrentTargetLater = targetIndex >= 0
    && comparePostgresTimestamps(
      assessments[targetIndex].assessed_at,
      assessments[baseIndex].assessed_at,
    ) === 1
  const nextLaterAssessment = assessments.find(
    (assessment) => comparePostgresTimestamps(
      assessment.assessed_at,
      assessments[baseIndex].assessed_at,
    ) === 1,
  )

  return {
    baseId: nextBaseId,
    targetId: isCurrentTargetLater ? currentTargetId : nextLaterAssessment?.id ?? '',
  }
}

export function selectComparisonTarget(
  assessments: readonly ChronologicalAssessment[],
  currentBaseId: string,
  nextTargetId: string,
): ComparisonSelection {
  const baseIndex = assessments.findIndex((assessment) => assessment.id === currentBaseId)
  const targetIndex = assessments.findIndex((assessment) => assessment.id === nextTargetId)
  if (targetIndex < 0) return initialComparison(assessments)
  const isCurrentBaseEarlier = baseIndex >= 0
    && comparePostgresTimestamps(
      assessments[baseIndex].assessed_at,
      assessments[targetIndex].assessed_at,
    ) === -1
  const nextEarlierAssessment = [...assessments].reverse().find(
    (assessment) => comparePostgresTimestamps(
      assessment.assessed_at,
      assessments[targetIndex].assessed_at,
    ) === -1,
  )

  return {
    baseId: isCurrentBaseEarlier ? currentBaseId : nextEarlierAssessment?.id ?? '',
    targetId: nextTargetId,
  }
}
