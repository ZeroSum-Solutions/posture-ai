type ScoredAssessment = {
  overall_score: number | null
}

export type DashboardPulsePoint = {
  score: number
  x: number
  y: number
}

export function deriveDashboardMetrics(assessments: readonly ScoredAssessment[]) {
  const scoredAssessments = assessments.filter(
    (assessment): assessment is { overall_score: number } =>
      typeof assessment.overall_score === 'number' && Number.isFinite(assessment.overall_score),
  )
  const averageScore = scoredAssessments.length > 0
    ? Math.round(scoredAssessments.reduce((sum, assessment) => sum + assessment.overall_score, 0) / scoredAssessments.length)
    : null
  const pulse = scoredAssessments.slice(0, 5).reverse().map((assessment, index) => ({
    score: assessment.overall_score,
    x: 14 + index * 23,
    y: Math.max(15, 72 - assessment.overall_score * 0.55),
  }))

  return {
    averageScore,
    scoredCount: scoredAssessments.length,
    pulse,
    pulseLine: pulse.length > 1 ? pulse.map((point) => `${point.x},${point.y}`).join(' ') : null,
  }
}
