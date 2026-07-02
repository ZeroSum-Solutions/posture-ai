import { describe, it, expect } from 'vitest'
import type { StoredFinding } from '../findings/storedFindingToEngine'
import { buildSessionFromAssessment } from './buildSessionFromAssessment'

const storedFinding = (over: Partial<StoredFinding> & Pick<StoredFinding, 'imbalance_key' | 'region' | 'zone' | 'severity_pct'>): StoredFinding => ({
  label: over.imbalance_key,
  deviation: 10,
  direction: 'Forward',
  view_used: 'side',
  confidence: 0.9,
  ...over,
})

const FINDINGS: StoredFinding[] = [
  storedFinding({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', severity_pct: 80 }),
  storedFinding({ imbalance_key: 'anterior_pelvic_shift', region: 'pelvis', zone: 'warning', severity_pct: 50 }),
]

describe('buildSessionFromAssessment', () => {
  it('assembles a playable session from stored findings + grade', () => {
    const snap = buildSessionFromAssessment({ overall_grade: 'C' }, FINDINGS, 1)
    expect(snap).not.toBeNull()
    expect(snap!.week).toBe(1)
    expect(snap!.items.length).toBeGreaterThan(0)
    expect(snap!.capability).toBe('standard') // default when unset
    expect(snap!.priorities.map((p) => p.primaryKey)).toContain('forward_head_posture')
  })

  it('honors the stored capability override', () => {
    const snap = buildSessionFromAssessment({ overall_grade: 'C', capability: 'regression' }, FINDINGS, 2)
    expect(snap!.capability).toBe('regression')
  })

  it('ignores an invalid capability string (defaults to standard)', () => {
    const snap = buildSessionFromAssessment({ overall_grade: 'C', capability: 'bogus' }, FINDINGS, 1)
    expect(snap!.capability).toBe('standard')
  })

  it('returns null when no reliable finding yields a playable session (empty floor)', () => {
    expect(buildSessionFromAssessment({ overall_grade: 'S' }, [], 1)).toBeNull()
    const unreliable = [storedFinding({ imbalance_key: 'forward_head_posture', region: 'head_shoulders', zone: 'unreliable', severity_pct: 0 })]
    expect(buildSessionFromAssessment({ overall_grade: 'S' }, unreliable, 1)).toBeNull()
  })
})
