import { describe, it, expect } from 'vitest'
import { buildProgramFrom, swapAlternatives } from './buildProgram'
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
    const alts = swapAlternatives(['forward_head_posture'], 'danger', 'stretch', fhp.steps.map((s) => s.slug))
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
