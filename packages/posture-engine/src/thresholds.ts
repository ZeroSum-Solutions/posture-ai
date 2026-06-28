export const RELIABILITY_FLOOR = 0.5

export type ThresholdSource = 'literature' | 'engineering'

export interface ThresholdBoundary {
  /** Zone-edge magnitude in degrees, applied to |deviation|. */
  deg: number
  /** Whether this boundary is a peer-reviewed cut-point or a tuned default. */
  source: ThresholdSource
  /** Citation backing a literature boundary; null for engineering defaults. */
  citation: string | null
}

export interface MetricThreshold {
  warn: ThresholdBoundary
  danger: ThresholdBoundary
  /** Clinical context: what the metric measures and why it is / isn't validated. */
  note: string
}

const eng = (deg: number): ThresholdBoundary => ({ deg, source: 'engineering', citation: null })
const lit = (deg: number, citation: string): ThresholdBoundary => ({ deg, source: 'literature', citation })

// Proxy metrics measure a lean-from-vertical / line-tilt angle, NOT the named
// clinical construct (CVA, FSA, kyphosis, APT). Their cut-points are tuned
// defaults; true clinical-convention metrics await the Layer-1 validation study.
const PROXY_NOTE =
  'Engineering default. Proxy metric — measures a lean-from-vertical or line-tilt ' +
  'angle, not the named clinical construct (CVA / FSA / kyphosis / APT). True ' +
  'clinical-convention metrics are deferred to the Layer-1 validation study.'

// Frontal knee alignment: no peer-reviewed 2D/goniometric degree cut-point
// exists. Every OA-progression threshold (Sharma 2001 JAMA; MOST/OAI) is
// radiographic mechanical-axis/HKA, and surface goniometry explains only ~20%
// of mechanical-axis variance (Hinman 2012, n=1390) — so this stays a default.
const GENU_NOTE =
  'Engineering default. No peer-reviewed degree cut-point exists for 2D/goniometric ' +
  'frontal knee alignment; the OA-progression literature is radiographic only. Tuned screening default.'

// Sagittal knee hyperextension (recurvatum). The cited cut-points govern ONLY a
// confirmed hyperextension; flexion and unverifiable-facing knees are reported
// Neutral (0°) by the metric and never reach these thresholds, so the literature
// label is honest (it is never applied to a non-recurvatum deviation).
const KNEE_EXT_NOTE =
  'Recurvatum (sagittal knee hyperextension). These cut-points are applied ONLY ' +
  'to a confirmed hyperextension — a deviation from straight (180°) with the knee ' +
  'posterior to the hip→ankle chord, per foot-based facing. Flexion and ' +
  'unverifiable-facing knees report Neutral (0°) and are never scored as recurvatum.'

/**
 * Per-metric thresholds with boundary-level provenance. severityPct ramps
 * piecewise-linearly across [warn.deg, danger.deg] (see toZoneAndPct).
 *
 * pelvic_axial_rotation is intentionally absent: it is confidence-gated below
 * RELIABILITY_FLOOR and never scored, so it never reaches toZoneAndPct.
 */
export const THRESHOLDS: Record<string, MetricThreshold> = {
  forward_head_posture:           { warn: eng(5),  danger: eng(15), note: PROXY_NOTE },
  anterior_imbalanced_shoulders:  { warn: eng(2),  danger: eng(6),  note: PROXY_NOTE },
  posterior_imbalanced_shoulders: { warn: eng(2),  danger: eng(6),  note: PROXY_NOTE },
  t1_tilt_backward:               { warn: eng(3),  danger: eng(8),  note: PROXY_NOTE },
  pelvic_obliquity:               { warn: eng(2),  danger: eng(5),  note: PROXY_NOTE },
  anterior_pelvic_shift:          { warn: eng(4),  danger: eng(12), note: PROXY_NOTE },
  genu_varum_valgum_left:         { warn: eng(5),  danger: eng(15), note: GENU_NOTE },
  genu_varum_valgum_right:        { warn: eng(5),  danger: eng(15), note: GENU_NOTE },
  knee_extension_back_knee: {
    warn: lit(5, 'Loudon 1998 (JOSPT 27:361) — knee hyperextension >5° defines genu recurvatum (clinical goniometry; transfers to a sagittal 2D angle).'),
    danger: lit(10, 'Kawahara 2012 (KSSTA 20:1479) — >10° hyperextension marks the frank genu-recurvatum subgroup (3D motion capture, ACL-deficient gait).'),
    note: KNEE_EXT_NOTE,
  },
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
  const t = THRESHOLDS[key]
  const warnDeg = t?.warn.deg ?? 5
  const dangerDeg = t?.danger.deg ?? 15
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
