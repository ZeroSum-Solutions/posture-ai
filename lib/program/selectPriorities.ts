import { IMBALANCE_KEYS } from '../../content/muscles/types'
import type { Finding } from '../../packages/posture-engine/src/types'

export type Capability = 'regression' | 'standard' | 'progression'

/** A corrective priority chosen from the assessment's findings (max 3 shown). */
export interface SelectedPriority {
  /** The driving imbalance key (the higher-severity side for a bilateral knee). */
  primaryKey: string
  /** One key normally; two when left+right knees were collapsed. */
  keys: string[]
  region: Finding['region']
  zone: 'warning' | 'danger'
  severityPct: number
  confidence: number
  deviation: number
  direction: string
  isBilateral: boolean
  severityWord: 'mild' | 'moderate' | 'significant'
}

const ZONE_WEIGHT: Record<string, number> = { danger: 1000, warning: 0 }
const REGION_RANK: Record<Finding['region'], number> = {
  head_shoulders: 0,
  spine: 1,
  pelvis: 2,
  leg: 3,
}
const KEY_ORDER: Record<string, number> = Object.fromEntries(
  IMBALANCE_KEYS.map((k, i) => [k, i]),
)

function severityWord(zone: 'warning' | 'danger', severityPct: number): SelectedPriority['severityWord'] {
  if (zone === 'danger') return 'significant'
  return severityPct < 60 ? 'mild' : 'moderate'
}

/** Both-knee deviations point the same way ("Valgum" vs "Varum"). */
function sameKneeDirection(a: Finding, b: Finding): boolean {
  const dir = (f: Finding) => (/valgum/i.test(f.direction) ? 'valgum' : /varum/i.test(f.direction) ? 'varum' : f.direction.toLowerCase())
  return dir(a) === dir(b)
}

/**
 * Deterministic top-3 corrective priority selection over engine findings.
 * Pure: same findings → same ordered output. Returns ALL eligible priorities
 * ranked (callers take the top 3; a 4th is "one more to watch").
 */
export function selectPriorities(findings: Finding[]): SelectedPriority[] {
  // Step 1 — eligibility: reliable, and an actionable (non-maintain) zone.
  const eligible = findings.filter(
    (f) => f.reliable && (f.zone === 'warning' || f.zone === 'danger'),
  )

  // Step 2 — bilateral knee collapse (before ranking).
  const left = eligible.find((f) => f.key === 'genu_varum_valgum_left')
  const right = eligible.find((f) => f.key === 'genu_varum_valgum_right')
  let working: Finding[] = eligible
  const bilateralKeys = new Set<string>()
  if (left && right && sameKneeDirection(left, right)) {
    const high = left.severityPct >= right.severityPct ? left : right
    bilateralKeys.add(left.key)
    bilateralKeys.add(right.key)
    // Drop the two singles; the higher-severity side stands in as the merged slot.
    working = eligible.filter((f) => f.key !== left.key && f.key !== right.key).concat(high)
  }

  // Step 3 — total-order rank, descending.
  const ranked = [...working].sort((a, b) => {
    const za = ZONE_WEIGHT[a.zone] ?? 0
    const zb = ZONE_WEIGHT[b.zone] ?? 0
    if (za !== zb) return zb - za
    if (a.severityPct !== b.severityPct) return b.severityPct - a.severityPct
    if (a.confidence !== b.confidence) return b.confidence - a.confidence
    const da = Math.abs(a.deviation)
    const db = Math.abs(b.deviation)
    if (da !== db) return db - da
    if (REGION_RANK[a.region] !== REGION_RANK[b.region]) return REGION_RANK[a.region] - REGION_RANK[b.region]
    return (KEY_ORDER[a.key] ?? 99) - (KEY_ORDER[b.key] ?? 99)
  })

  return ranked.map((f) => {
    const zone = f.zone as 'warning' | 'danger'
    const isBilateral = bilateralKeys.has(f.key)
    return {
      primaryKey: f.key,
      keys: isBilateral ? ['genu_varum_valgum_left', 'genu_varum_valgum_right'] : [f.key],
      region: f.region,
      zone,
      severityPct: f.severityPct,
      confidence: f.confidence,
      deviation: f.deviation,
      direction: f.direction,
      isBilateral,
      severityWord: severityWord(zone, f.severityPct),
    }
  })
}
