import { describe, it, expect } from 'vitest'
import { dbFindingsToEngineFindings, isCapability, clientSummaryMode, type DbFindingRow } from './clientProgram'
import { buildProgramFrom } from '@/lib/program/buildProgram'

const row = (over: Partial<DbFindingRow> & Pick<DbFindingRow, 'imbalance_key' | 'region' | 'zone'>): DbFindingRow => ({
  label: 'Test Finding',
  deviation: 10,
  direction: 'Forward',
  severity_pct: 50,
  view_used: 'front',
  confidence: 0.85,
  ...over,
})

describe('dbFindingsToEngineFindings', () => {
  it('maps DB rows to engine findings with numeric coercion', () => {
    const out = dbFindingsToEngineFindings([
      row({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', deviation: '22', severity_pct: '78', confidence: '0.92' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      key: 'forward_head_posture',
      region: 'head_shoulders',
      deviation: 22,
      severityPct: 78,
      confidence: 0.92,
      zone: 'danger',
      reliable: true,
    })
  })

  it('flags unreliable findings as not reliable', () => {
    const [f] = dbFindingsToEngineFindings([row({ imbalance_key: 'pelvic_axial_rotation', region: 'pelvis', zone: 'unreliable' })])
    expect(f.reliable).toBe(false)
  })

  it('feeds buildProgramFrom to produce a coherent client program', () => {
    const findings = dbFindingsToEngineFindings([
      row({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', severity_pct: 78 }),
      row({ imbalance_key: 'anterior_pelvic_shift', region: 'pelvis', zone: 'warning', severity_pct: 60 }),
      row({ imbalance_key: 't1_tilt_backward', region: 'spine', zone: 'maintain', severity_pct: 12 }),
    ])
    const report = buildProgramFrom(findings, 'B', { capability: 'standard' })
    expect(report.hasPlan).toBe(true)
    expect(report.priorities.length).toBeGreaterThan(0)
    expect(report.priorities[0].primaryKey).toBe('forward_head_posture')
  })

  it('honors coach override keys when selecting active priorities', () => {
    const findings = dbFindingsToEngineFindings([
      row({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', severity_pct: 78 }),
      row({ imbalance_key: 'anterior_pelvic_shift', region: 'pelvis', zone: 'warning', severity_pct: 60 }),
    ])
    const report = buildProgramFrom(findings, 'B', { capability: 'standard', activeKeys: ['anterior_pelvic_shift'] })
    expect(report.priorities[0].primaryKey).toBe('anterior_pelvic_shift')
  })
})

describe('isCapability', () => {
  it('accepts the three valid levels and rejects anything else', () => {
    expect(isCapability('regression')).toBe(true)
    expect(isCapability('standard')).toBe(true)
    expect(isCapability('progression')).toBe(true)
    expect(isCapability('')).toBe(false)
    expect(isCapability(null)).toBe(false)
    expect(isCapability('STANDARD')).toBe(false)
    expect(isCapability(undefined)).toBe(false)
  })
})

describe('clientSummaryMode', () => {
  const findings = dbFindingsToEngineFindings([
    row({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', severity_pct: 78 }),
    row({ imbalance_key: 'anterior_pelvic_shift', region: 'pelvis', zone: 'warning', severity_pct: 60 }),
  ])

  it('returns "plan" when there are active priorities', () => {
    expect(clientSummaryMode(buildProgramFrom(findings, 'B', { capability: 'standard' }))).toBe('plan')
  })

  it('returns "monitor" (NOT all-clear) when the coach demoted every real finding', () => {
    // priority_keys=[] is an explicit "demote everything" override; the danger
    // findings must still be surfaced as monitored, never as "nothing stood out".
    const report = buildProgramFrom(findings, 'B', { capability: 'standard', activeKeys: [] })
    expect(report.hasPlan).toBe(false)
    expect(report.monitored.length).toBeGreaterThan(0)
    expect(clientSummaryMode(report)).toBe('monitor')
  })

  it('returns "clear" only when there are genuinely no warning/danger findings', () => {
    const allMaintain = dbFindingsToEngineFindings([
      row({ imbalance_key: 't1_tilt_backward', region: 'spine', zone: 'maintain', severity_pct: 8 }),
    ])
    expect(clientSummaryMode(buildProgramFrom(allMaintain, 'A', { capability: 'standard' }))).toBe('clear')
  })
})
