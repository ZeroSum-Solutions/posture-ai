import { describe, it, expect } from 'vitest'
import { buildProgramFrom, swapAlternatives, linksForKeys } from './buildProgram'
import { exerciseEvidenceForKey, evidenceWeight } from './evidenceWeight'
import type { Finding } from '../../packages/posture-engine/src/types'

const f = (over: Partial<Finding> & Pick<Finding, 'key' | 'label' | 'region' | 'severityPct' | 'zone'>): Finding => ({
  deviation: 10,
  standard: 0,
  unit: 'deg',
  direction: 'Forward',
  viewUsed: 'front',
  confidence: 0.85,
  reliable: true,
  landmarksUsed: [],
  ...over,
})

// Three eligible priorities + one maintain (excluded).
const findings: Finding[] = [
  f({ key: 'forward_head_posture', label: 'Forward Head Posture', region: 'head_shoulders', severityPct: 78, zone: 'danger' }),
  f({ key: 'anterior_pelvic_shift', label: 'Anterior Pelvic Shift', region: 'pelvis', severityPct: 64, zone: 'warning' }),
  f({ key: 'anterior_imbalanced_shoulders', label: 'Anterior Shoulders', region: 'head_shoulders', severityPct: 52, zone: 'warning' }),
  f({ key: 'pelvic_obliquity', label: 'Pelvic Obliquity', region: 'pelvis', severityPct: 10, zone: 'maintain' }),
]

it('exerciseEvidenceForKey returns the best-graded targeted muscle', () => {
  const keyLinks = [
    { muscleSlug: 'pectoralis-minor', confidence: 'high' as const },
    { muscleSlug: 'anterior-deltoid', confidence: 'low' as const },
  ]
  expect(exerciseEvidenceForKey(['pectoralis-minor'], keyLinks)).toBe(1.0)
  expect(exerciseEvidenceForKey(['anterior-deltoid'], keyLinks)).toBe(0.4)
  expect(exerciseEvidenceForKey(['unrelated'], keyLinks)).toBe(0)
  expect(evidenceWeight(undefined)).toBe(0.7) // ungraded → medium-equivalent
})

// T7(a): cover the medium weight path explicitly
it('evidenceWeight returns 0.7 for medium confidence', () => {
  expect(evidenceWeight('medium')).toBe(0.7)
})

// T7(c): NaN defense — out-of-enum and undefined both fall back to 0.7
it('evidenceWeight falls back to 0.7 for out-of-enum and undefined values', () => {
  expect(evidenceWeight('bogus' as never)).toBe(0.7)
  expect(evidenceWeight(undefined)).toBe(0.7)
})

// T7(b): linksForKeys returns scored links with muscleSlug+confidence; skips scored===false
it('linksForKeys returns scored links and skips scored===false entries', () => {
  // knee_extension_back_knee scores hamstrings and gastrocnemius-soleus; display-only links stay absent.
  const result = linksForKeys(['knee_extension_back_knee'])
  expect(result.every((l) => typeof l.muscleSlug === 'string' && l.muscleSlug.length > 0)).toBe(true)
  const gastroc = result.find((l) => l.muscleSlug === 'gastrocnemius-soleus')
  expect(gastroc?.confidence).toBe('medium')
  expect(result.find((l) => l.muscleSlug === 'popliteus')).toBeUndefined()
  expect(result.find((l) => l.muscleSlug === 'quadriceps')).toBeUndefined()
  // All items have optional confidence; any that are present must be a valid grade
  for (const l of result) {
    if (l.confidence !== undefined) {
      expect(['high', 'medium', 'low']).toContain(l.confidence)
    }
  }
  // The result set is non-empty (there are scored links for this key)
  expect(result.length).toBeGreaterThan(0)
})

// Evidence tie-break permanently pinned: these assertions would fail if the
// evidence sort were removed and the sort fell back to pure slug order.
describe('evidence tie-break ordering (pinned against content as of feat/evidence-aware-ranking)', () => {
  // anterior_imbalanced_shoulders: activation cap=1 of 2
  //   standing-wall-serratus-slide (ev=1.0) beats shoulder-blade-squeeze (ev=0.7)
  it('anterior_imbalanced_shoulders: high-evidence activation chosen over medium-evidence', () => {
    const r = buildProgramFrom(
      [f({ key: 'anterior_imbalanced_shoulders', label: 'Anterior Shoulders', region: 'head_shoulders', severityPct: 60, zone: 'warning' })],
      'C',
    )
    const p = r.priorities.find((p) => p.primaryKey === 'anterior_imbalanced_shoulders')!
    const act = p.steps.find((s) => s.category === 'activation')
    expect(act?.slug).toBe('standing-wall-serratus-slide') // ev=1.0; shoulder-blade-squeeze (ev=0.7) excluded
  })

  // posterior_imbalanced_shoulders: strengthen cap=2 of 3
  //   high-band-pull-apart (ev=1.0) + prone-cobra-hold (ev=1.0) survive;
  //   band-rear-delt-row (ev=0) excluded
  it('posterior_imbalanced_shoulders: zero-evidence strengthen exercise excluded', () => {
    const r = buildProgramFrom(
      [f({ key: 'posterior_imbalanced_shoulders', label: 'Posterior Shoulders', region: 'head_shoulders', severityPct: 60, zone: 'warning' })],
      'C',
    )
    const p = r.priorities.find((p) => p.primaryKey === 'posterior_imbalanced_shoulders')!
    const strengthens = p.steps.filter((s) => s.category === 'strengthen').map((s) => s.slug)
    expect(strengthens).toContain('high-band-pull-apart')   // ev=1.0
    expect(strengthens).toContain('prone-cobra-hold')        // ev=1.0
    expect(strengthens).not.toContain('band-rear-delt-row') // ev=0.0, excluded
  })

  // pelvic_obliquity: strengthen cap=2 of 3
  //   side-lying-hip-abduction (ev=1.0) + side-plank-knees (ev=1.0) survive;
  //   glute-bridge-march (ev=0) excluded
  it('pelvic_obliquity: zero-evidence strengthen exercise excluded', () => {
    const r = buildProgramFrom(
      [f({ key: 'pelvic_obliquity', label: 'Pelvic Obliquity', region: 'pelvis', severityPct: 60, zone: 'warning' })],
      'C',
    )
    const p = r.priorities.find((p) => p.primaryKey === 'pelvic_obliquity')!
    const strengthens = p.steps.filter((s) => s.category === 'strengthen').map((s) => s.slug)
    expect(strengthens).toContain('side-lying-hip-abduction') // ev=1.0
    expect(strengthens).toContain('side-plank-knees')         // ev=1.0
    expect(strengthens).not.toContain('glute-bridge-march')  // ev=0.0, excluded
  })

  // knee_extension_back_knee: strengthen cap=2 — glute-bridge and standing-hamstring-curl
  // (both ev=0.7 via hamstrings) survive. standing-calf-raise never competes: it was marked
  // `informational` as an orphan (#100) and candidatesFor drops that category before evidence
  // is consulted. Were it restored to `strengthen`, its calf link (ev=0.7 since the 2026-07-09
  // regrade) would tie the other two and slug-sort ahead of standing-hamstring-curl — so this
  // assertion is the guard on that regression, not a statement about evidence weight.
  it('knee_extension_back_knee: informational standing-calf-raise never enters strengthen', () => {
    const r = buildProgramFrom(
      [f({ key: 'knee_extension_back_knee', label: 'Knee Hyperextension', region: 'leg', severityPct: 60, zone: 'warning' })],
      'C',
    )
    const p = r.priorities.find((p) => p.primaryKey === 'knee_extension_back_knee')!
    const strengthens = p.steps.filter((s) => s.category === 'strengthen').map((s) => s.slug)
    expect(strengthens).toContain('glute-bridge')            // ev=0.7
    expect(strengthens).toContain('standing-hamstring-curl') // ev=0.7
    expect(strengthens).not.toContain('standing-calf-raise') // informational, never a candidate
  })
})

describe('buildProgramFrom overrides', () => {
  it('defaults to the natural top-3 with nothing monitored', () => {
    const r = buildProgramFrom(findings, 'C')
    expect(r.priorities.map((p) => p.primaryKey)).toEqual([
      'forward_head_posture',
      'anterior_pelvic_shift',
      'anterior_imbalanced_shoulders',
    ])
    expect(r.monitored).toHaveLength(0)
    expect(r.eligibleOrder).toHaveLength(3)
  })

  it('demotes a priority to monitor-only via activeKeys', () => {
    const r = buildProgramFrom(findings, 'C', {
      activeKeys: ['forward_head_posture', 'anterior_imbalanced_shoulders'],
    })
    expect(r.priorities.map((p) => p.primaryKey)).toEqual(['forward_head_posture', 'anterior_imbalanced_shoulders'])
    expect(r.monitored.map((m) => m.primaryKey)).toEqual(['anterior_pelvic_shift'])
    expect(r.priorities[1].rank).toBe(2) // ranks renumber after demotion
  })

  it('honors a valid exercise swap within a priority', () => {
    const base = buildProgramFrom(findings, 'C')
    const fhp = base.priorities.find((p) => p.primaryKey === 'forward_head_posture')!
    const target = fhp.steps.find((s) => s.category === 'stretch')!
    const alts = swapAlternatives(['forward_head_posture'], 'danger', 'stretch', fhp.steps.map((s) => s.slug), fhp.screenedKeys)
    expect(alts.length).toBeGreaterThan(0) // there is a real alternative to swap to

    const r = buildProgramFrom(findings, 'C', {
      swaps: { forward_head_posture: { [target.slug]: alts[0].slug } },
    })
    const swapped = r.priorities.find((p) => p.primaryKey === 'forward_head_posture')!
    expect(swapped.steps.some((s) => s.slug === alts[0].slug)).toBe(true)
    expect(swapped.steps.some((s) => s.slug === target.slug)).toBe(false)
  })

  it('ignores an invalid swap (off-protocol slug) rather than going off-menu', () => {
    const base = buildProgramFrom(findings, 'C')
    const fhp = base.priorities.find((p) => p.primaryKey === 'forward_head_posture')!
    const target = fhp.steps[0].slug
    const r = buildProgramFrom(findings, 'C', {
      swaps: { forward_head_posture: { [target]: 'butterfly-stretch' } }, // not a forward-head candidate
    })
    const after = r.priorities.find((p) => p.primaryKey === 'forward_head_posture')!
    expect(after.steps.some((s) => s.slug === target)).toBe(true)
    expect(after.steps.some((s) => s.slug === 'butterfly-stretch')).toBe(false)
  })
})

// Exercise selection ORs over one priority's keys, so it cannot see a second,
// concurrent finding that makes an otherwise-coherent exercise unsafe. In a
// hyperextended knee the hamstrings are already abnormally long (Zwick 2010,
// PMID 20308923), so lengthening them is withheld — yet the stretch is still
// reachable for such a client through the trunk_lean key.
//
// A contradicting finding vetoes only when it is a positive screen: reliable and
// in an actionable zone. `maintain` means measured within normal range, and
// `reliable: false` means not measurable — neither is evidence the knee is
// hyperextended. The two boundary tests below pin that rule.
const SHS = 'seated-hamstring-stretch'

const trunkLean = f({ key: 'trunk_lean', label: 'Trunk Lean', region: 'spine', severityPct: 70, zone: 'danger' })
const knee = (over: Partial<Finding> = {}) =>
  f({ key: 'knee_extension_back_knee', label: 'Knee Hyperextension', region: 'leg', severityPct: 65, zone: 'warning', ...over })

/** Force SHS into the plan the way a coach can: swap it onto the trunk_lean stretch slot. */
function slugsAfterSwappingInSHS(fs: Finding[]): string[] {
  const base = buildProgramFrom(fs, 'C')
  const trunk = base.priorities.find((p) => p.primaryKey === 'trunk_lean')!
  const stretchStep = trunk.steps.find((s) => s.category === 'stretch')!
  const r = buildProgramFrom(fs, 'C', { swaps: { trunk_lean: { [stretchStep.slug]: SHS } } })
  return r.priorities.flatMap((p) => p.steps.map((s) => s.slug))
}

describe('cross-finding contraindication: seated-hamstring-stretch × knee hyperextension', () => {
  it('is not offered in the coach swap menu when knee hyperextension is screened', () => {
    const r = buildProgramFrom([trunkLean, knee()], 'C')
    const trunk = r.priorities.find((p) => p.primaryKey === 'trunk_lean')!
    const alts = swapAlternatives(trunk.keys, trunk.zone, 'stretch', [], trunk.screenedKeys)

    expect(alts.map((a) => a.slug)).not.toContain(SHS)
    expect(alts.length).toBeGreaterThan(0) // the rest of the menu survives
  })

  it('is rejected even when a coach swap explicitly names it', () => {
    expect(slugsAfterSwappingInSHS([trunkLean, knee()])).not.toContain(SHS)
  })

  it('still vetoes when the knee finding ranks outside the active top-3 priorities', () => {
    const findings = [
      trunkLean,
      f({ key: 'forward_head_posture', label: 'Forward Head Posture', region: 'head_shoulders', severityPct: 90, zone: 'danger' }),
      f({ key: 'anterior_imbalanced_shoulders', label: 'Anterior Shoulders', region: 'head_shoulders', severityPct: 85, zone: 'danger' }),
      knee({ severityPct: 20 }), // ranks 4th → monitored, not an active priority
    ]
    const r = buildProgramFrom(findings, 'C')
    expect(r.monitored.map((m) => m.primaryKey)).toContain('knee_extension_back_knee')
    expect(slugsAfterSwappingInSHS(findings)).not.toContain(SHS)
  })

  it('remains available when the knee is within normal range (maintain)', () => {
    expect(slugsAfterSwappingInSHS([trunkLean, knee({ zone: 'maintain' })])).toContain(SHS)
  })

  it('remains available when the knee could not be measured (unreliable)', () => {
    expect(slugsAfterSwappingInSHS([trunkLean, knee({ reliable: false })])).toContain(SHS)
  })
})
