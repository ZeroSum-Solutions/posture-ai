import { describe, it, expect } from 'vitest'
import { selectPriorities } from './selectPriorities'
import type { Finding } from '../../packages/posture-engine/src/types'

const f = (over: Partial<Finding> & Pick<Finding, 'key' | 'region' | 'severityPct' | 'zone'>): Finding => ({
  label: over.key!,
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

describe('selectPriorities', () => {
  it('excludes maintain and unreliable findings', () => {
    const out = selectPriorities([
      f({ key: 'forward_head_posture', region: 'head_shoulders', severityPct: 20, zone: 'maintain' }),
      f({ key: 't1_tilt_backward', region: 'spine', severityPct: 90, zone: 'danger', reliable: false }),
    ])
    expect(out).toHaveLength(0)
  })

  it('ranks every danger above every warning regardless of severityPct', () => {
    const out = selectPriorities([
      f({ key: 'anterior_pelvic_shift', region: 'pelvis', severityPct: 99, zone: 'warning' }),
      f({ key: 'forward_head_posture', region: 'head_shoulders', severityPct: 51, zone: 'danger' }),
    ])
    expect(out.map((p) => p.primaryKey)).toEqual(['forward_head_posture', 'anterior_pelvic_shift'])
  })

  it('orders warnings by severityPct descending', () => {
    const out = selectPriorities([
      f({ key: 'anterior_imbalanced_shoulders', region: 'head_shoulders', severityPct: 52, zone: 'warning' }),
      f({ key: 'anterior_pelvic_shift', region: 'pelvis', severityPct: 64, zone: 'warning' }),
    ])
    expect(out.map((p) => p.primaryKey)).toEqual(['anterior_pelvic_shift', 'anterior_imbalanced_shoulders'])
  })

  it('collapses both knees into one bilateral slot when same direction', () => {
    const out = selectPriorities([
      f({ key: 'genu_varum_valgum_left', region: 'leg', severityPct: 70, zone: 'danger', direction: 'Valgum (Knock-Knee)' }),
      f({ key: 'genu_varum_valgum_right', region: 'leg', severityPct: 60, zone: 'warning', direction: 'Valgum (Knock-Knee)' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].isBilateral).toBe(true)
    expect(out[0].keys).toEqual(['genu_varum_valgum_left', 'genu_varum_valgum_right'])
    // higher-severity (left, danger) sets the slot's zone/severity
    expect(out[0].zone).toBe('danger')
    expect(out[0].severityPct).toBe(70)
  })

  it('does NOT collapse knees with opposite directions', () => {
    const out = selectPriorities([
      f({ key: 'genu_varum_valgum_left', region: 'leg', severityPct: 70, zone: 'warning', direction: 'Valgum (Knock-Knee)' }),
      f({ key: 'genu_varum_valgum_right', region: 'leg', severityPct: 60, zone: 'warning', direction: 'Varum (Bow-Leg)' }),
    ])
    expect(out).toHaveLength(2)
    expect(out.every((p) => !p.isBilateral)).toBe(true)
  })

  it('labels severity words by zone (danger=significant, warning split mild/moderate)', () => {
    const out = selectPriorities([
      f({ key: 'forward_head_posture', region: 'head_shoulders', severityPct: 78, zone: 'danger' }),
      f({ key: 'anterior_pelvic_shift', region: 'pelvis', severityPct: 64, zone: 'warning' }),
      f({ key: 'anterior_imbalanced_shoulders', region: 'head_shoulders', severityPct: 52, zone: 'warning' }),
    ])
    expect(out.map((p) => p.severityWord)).toEqual(['significant', 'moderate', 'mild'])
  })

  it('is deterministic — identical input yields identical order', () => {
    const input = [
      f({ key: 'pelvic_obliquity', region: 'pelvis', severityPct: 50, zone: 'warning' }),
      f({ key: 'anterior_imbalanced_shoulders', region: 'head_shoulders', severityPct: 50, zone: 'warning' }),
    ]
    expect(selectPriorities(input).map((p) => p.primaryKey)).toEqual(
      selectPriorities(input).map((p) => p.primaryKey),
    )
  })
})
