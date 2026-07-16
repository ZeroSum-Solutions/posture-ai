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
    const dateDifference = Date.parse(left.assessed_at) - Date.parse(right.assessed_at)
    return dateDifference || left.id.localeCompare(right.id)
  })
}

export function initialComparison(assessments: readonly ChronologicalAssessment[]): ComparisonSelection {
  if (assessments.length < 2) return { baseId: '', targetId: '' }
  const base = assessments[0]
  const target = [...assessments].reverse().find(
    (assessment) => Date.parse(assessment.assessed_at) > Date.parse(base.assessed_at),
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
  const baseDate = Date.parse(assessments[baseIndex].assessed_at)
  const isCurrentTargetLater = targetIndex >= 0
    && Date.parse(assessments[targetIndex].assessed_at) > baseDate
  const nextLaterAssessment = assessments.find(
    (assessment) => Date.parse(assessment.assessed_at) > baseDate,
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
  const targetDate = Date.parse(assessments[targetIndex].assessed_at)
  const isCurrentBaseEarlier = baseIndex >= 0
    && Date.parse(assessments[baseIndex].assessed_at) < targetDate
  const nextEarlierAssessment = [...assessments].reverse().find(
    (assessment) => Date.parse(assessment.assessed_at) < targetDate,
  )

  return {
    baseId: isCurrentBaseEarlier ? currentBaseId : nextEarlierAssessment?.id ?? '',
    targetId: nextTargetId,
  }
}
