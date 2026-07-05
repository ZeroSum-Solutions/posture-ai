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

// Pelvic obliquity thresholds are grounded in peer-reviewed surface-inclinometry
// norms for the same iliac-crest/ASIS construct (Bibrowicz 2023, n=300 healthy).
// No 2D-photograph-specific normative study exists, so a residual proxy caveat
// remains: the photo line-angle is taken as functionally equivalent to the
// inclinometer construct, pending the Layer-1 validation study.
const PELVIC_NOTE =
  'Literature-referenced (surface-inclinometry norms, Bibrowicz 2023 n=300 healthy). ' +
  'Residual proxy: 2D-photo line angle taken as equivalent to the iliac-crest/ASIS ' +
  'inclinometer construct; no photo-specific norm exists yet.'

// Frontal knee alignment: no peer-reviewed 2D/goniometric degree cut-point
// exists. Every OA-progression threshold (Sharma 2001 JAMA; MOST/OAI) is
// radiographic mechanical-axis/HKA, and surface goniometry explains only ~20%
// of mechanical-axis variance (Riddle 2012, Manual Therapy 17(5):459, n=1390) —
// so this stays a default. Hinman 2006 (Arthritis Rheum 55(2):306, n=40)
// similarly found no significant goniometry–mechanical-axis correlation.
const GENU_NOTE =
  'Engineering default. No peer-reviewed degree cut-point exists for 2D/goniometric ' +
  'frontal knee alignment; the OA-progression literature is radiographic only. ' +
  'Surface goniometry explains only ~20% of radiographic mechanical-axis variance ' +
  '(Riddle 2012, Manual Therapy 17(5):459, n=1390). Tuned screening default.'

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
  trunk_lean:                     { warn: eng(3),  danger: eng(8),  note: PROXY_NOTE },
  pelvic_obliquity: {
    warn: lit(3, 'Bibrowicz 2023 (Front Psychol 14:1148239) — iliac-crest/ASIS obliquity >3° = moderate asymmetry in n=300 healthy adults (surface inclinometry; functionally equivalent to a 2D frontal-photo line angle).'),
    danger: lit(6, 'Bibrowicz 2023 (Front Psychol 14:1148239) — >6° = significant asymmetry (75th/≈95th healthy percentiles; surface inclinometry, no 2D-photo-specific norm exists).'),
    note: PELVIC_NOTE,
  },
  genu_varum_valgum_left:         { warn: eng(5),  danger: eng(15), note: GENU_NOTE },
  genu_varum_valgum_right:        { warn: eng(5),  danger: eng(15), note: GENU_NOTE },
  knee_extension_back_knee: {
    warn: lit(5, 'Loudon 1998 (JOSPT 27:361) — knee hyperextension >5° defines genu recurvatum (clinical goniometry; transfers to a sagittal 2D angle).'),
    danger: lit(10, 'Kawahara 2012 (KSSTA 20:1479) — >10° hyperextension marks the frank genu-recurvatum subgroup (3D motion capture, ACL-deficient gait).'),
    note: KNEE_EXT_NOTE,
  },
}

// Grade bands: overallScore 0-100 (higher = worse).
// Recalibrated 2026-07 against validity-weighted golden anchors (spec §3.2).
export const GRADE_BANDS: Array<{ max: number; grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'E' }> = [
  { max: 3,   grade: 'S' }, // recalibrated 2026-07: 5→3, anchor: trunk-lean-warn (score 7 must exceed S)
  { max: 7,   grade: 'A' }, // recalibrated 2026-07: 15→7, anchor: trunk-lean-danger (score 13 must exceed A)
  { max: 20,  grade: 'B' }, // recalibrated 2026-07: 50→20, anchor: combined-moderate (score 24 must exceed B)
  { max: 55,  grade: 'C' }, // recalibrated 2026-07: 85→55, anchor: combined-moderate (score 24 lands here)
  { max: 87,  grade: 'D' }, // recalibrated 2026-07: 95→87, preserves toGrade(86)→D
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

/**
 * Dominant honesty frame for a scored metric, derived purely from boundary
 * provenance (no scoring change — this is a read-only projection over THRESHOLDS):
 *   LITERATURE_CITED — both zone boundaries are peer-reviewed cut-points
 *                      (only knee_extension_back_knee today).
 *   SCREENING_ONLY   — any engineering boundary, or an absent/unscored key.
 *   VALIDATED        — reserved for metrics that clear the Layer-1 validation
 *                      study; nothing qualifies yet.
 * Stored per finding by the POST route (see lib/findings/buildFindingRow.ts).
 */
export type MetricValidity = 'VALIDATED' | 'LITERATURE_CITED' | 'SCREENING_ONLY'

/** Distance (deg) from |deviation| to the nearest zone boundary of key. */
export function distanceToZoneEdge(deviation: number, key: string): number {
  const t = THRESHOLDS[key]
  if (!t) return Infinity
  const abs = Math.abs(deviation)
  return Math.min(Math.abs(abs - t.warn.deg), Math.abs(abs - t.danger.deg))
}

export function metricValidity(key: string): MetricValidity {
  const t = THRESHOLDS[key]
  if (!t) return 'SCREENING_ONLY'
  if (t.warn.source === 'literature' && t.danger.source === 'literature') {
    return 'LITERATURE_CITED'
  }
  return 'SCREENING_ONLY'
}

/** Overall-score weights by honesty frame (spec §3.2): a literature-cited
 * metric carries full weight; a screening proxy carries half. VALIDATED is
 * reserved for post-study promotion. */
export const VALIDITY_WEIGHT: Record<MetricValidity, number> = {
  VALIDATED: 1,
  LITERATURE_CITED: 1,
  SCREENING_ONLY: 0.5,
}
