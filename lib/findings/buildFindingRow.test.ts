import { describe, it, expect } from 'vitest'
import type { Finding } from '@posture-ai/engine'
import { buildFindingRow } from './buildFindingRow'

const baseFinding: Finding = {
  key: 'knee_extension_back_knee',
  label: 'Recurvatum',
  region: 'leg',
  deviation: 7,
  standard: 0,
  unit: 'deg',
  direction: 'Hyperextended',
  severityPct: 50,
  zone: 'warning',
  viewUsed: 'side',
  confidence: 0.9,
  reliable: true,
  landmarksUsed: ['left_hip', 'left_knee', 'left_ankle'],
}

describe('buildFindingRow', () => {
  it('maps engine fields to the assessment_findings row shape', () => {
    const row = buildFindingRow(baseFinding, 'assess-1', 'prac-1')
    expect(row.assessment_id).toBe('assess-1')
    expect(row.practitioner_id).toBe('prac-1')
    expect(row.imbalance_key).toBe('knee_extension_back_knee')
    expect(row.region).toBe('leg')
    expect(row.severity_pct).toBe(50)
    expect(row.zone).toBe('warning')
    expect(row.view_used).toBe('side')
    expect(row.confidence).toBe(0.9)
  })

  it('stamps LITERATURE_CITED for the literature-cited recurvatum metric', () => {
    expect(buildFindingRow(baseFinding, 'a', 'p').metric_validity).toBe('LITERATURE_CITED')
  })

  it('stamps SCREENING_ONLY for an engineering-default metric', () => {
    const fhp: Finding = { ...baseFinding, key: 'forward_head_posture' }
    expect(buildFindingRow(fhp, 'a', 'p').metric_validity).toBe('SCREENING_ONLY')
  })

  it('persists within-capture stability when the engine emitted it (burst capture)', () => {
    const burst: Finding = { ...baseFinding, stabilityScore: 0.92, uncertaintyDeg: 0.4 }
    const row = buildFindingRow(burst, 'a', 'p')
    expect(row.stability_score).toBe(0.92)
    expect(row.uncertainty_deg).toBe(0.4)
  })

  it('stores null stability for a legacy single-frame finding (never fabricated)', () => {
    const row = buildFindingRow(baseFinding, 'a', 'p')
    expect(row.stability_score).toBeNull()
    expect(row.uncertainty_deg).toBeNull()
  })
})
