export const RELIABILITY_FLOOR = 0.5

// Per-metric [warn_deg, danger_deg] thresholds
export const THRESHOLDS: Record<string, [number, number]> = {
  forward_head_posture:          [5, 15],
  anterior_imbalanced_shoulders: [2, 6],
  posterior_imbalanced_shoulders:[2, 6],
  t1_tilt_backward:              [3, 8],
  pelvic_obliquity:              [2, 5],
  anterior_pelvic_shift:         [4, 12],
  pelvic_axial_rotation:         [3, 8],
  genu_varum_valgum_left:        [5, 15],
  genu_varum_valgum_right:       [5, 15],
  knee_extension_back_knee:      [5, 15],
}

// Grade bands: overallScore 0-100 (higher = worse)
export const GRADE_BANDS: Array<{ max: number; grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'E' }> = [
  { max: 5,   grade: 'S' },
  { max: 15,  grade: 'A' },
  { max: 50,  grade: 'B' },
  { max: 85,  grade: 'C' },
  { max: 95,  grade: 'D' },
  { max: 100, grade: 'E' },
]

export function toZoneAndPct(
  deviation: number,
  key: string
): { zone: 'maintain' | 'warning' | 'danger'; severityPct: number } {
  const [warnDeg, dangerDeg] = THRESHOLDS[key] ?? [5, 15]
  const abs = Math.abs(deviation)
  if (abs < warnDeg) {
    return { zone: 'maintain', severityPct: Math.round((abs / warnDeg) * 33) }
  } else if (abs < dangerDeg) {
    const pct = 33 + ((abs - warnDeg) / (dangerDeg - warnDeg)) * 33
    return { zone: 'warning', severityPct: Math.round(pct) }
  } else {
    const pct = Math.min(100, 66 + ((abs - dangerDeg) / dangerDeg) * 34)
    return { zone: 'danger', severityPct: Math.round(pct) }
  }
}

export function toGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'E' {
  for (const band of GRADE_BANDS) {
    if (score <= band.max) return band.grade
  }
  return 'E'
}

/** Modeled percentile: "Top X%" = 100 - score (rough linear model) */
export function toPercentile(score: number): number {
  return Math.max(1, Math.round(100 - score))
}
