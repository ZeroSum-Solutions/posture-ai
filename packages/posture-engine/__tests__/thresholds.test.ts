import { describe, it, expect } from 'vitest'
import { THRESHOLDS, toZoneAndPct, metricValidity, GRADE_BANDS, toGrade } from '../src/thresholds'
import { GOLDEN_CASES } from '../golden/cases'
import { generatePose } from '../golden/synthetic'
import { assessPosture } from '../src/engine'

// Proxy metrics: the engine measures a lean-from-vertical / line-tilt quantity,
// NOT the named clinical construct (CVA, FSA, kyphosis, APT). Their thresholds
// are tunable engineering defaults, not literature-cited cut-points.
// pelvic_obliquity is NOT in this list — it graduated to LITERATURE_CITED
// (Bibrowicz 2023, surface-inclinometry norms, n=300 healthy adults).
const PROXY_KEYS = [
  'forward_head_posture',
  'anterior_imbalanced_shoulders',
  'posterior_imbalanced_shoulders',
  'trunk_lean',
]

describe('threshold provenance', () => {
  it('knee_extension_back_knee carries literature provenance ([5,10], recurvatum)', () => {
    const t = THRESHOLDS['knee_extension_back_knee']
    expect(t.warn.deg).toBe(5)
    expect(t.danger.deg).toBe(10)
    expect(t.warn.source).toBe('literature')
    expect(t.danger.source).toBe('literature')
    expect(t.warn.citation).toMatch(/Loudon/)
    expect(t.danger.citation).toMatch(/Kawahara/)
  })

  it('genu varum/valgum stay engineering defaults (no 2D-validated cut-point exists)', () => {
    for (const key of ['genu_varum_valgum_left', 'genu_varum_valgum_right']) {
      const t = THRESHOLDS[key]
      expect(t.warn.source).toBe('engineering')
      expect(t.danger.source).toBe('engineering')
      expect(t.warn.citation).toBeNull()
      expect(t.danger.citation).toBeNull()
    }
  })

  it('every proxy metric is engineering, uncited, and noted as a proxy', () => {
    for (const key of PROXY_KEYS) {
      const t = THRESHOLDS[key]
      expect(t.warn.source).toBe('engineering')
      expect(t.danger.source).toBe('engineering')
      expect(t.warn.citation).toBeNull()
      expect(t.danger.citation).toBeNull()
      expect(t.note.toLowerCase()).toContain('proxy')
    }
  })

  it('provenance is internally consistent: literature⇔citation, engineering⇔null', () => {
    for (const t of Object.values(THRESHOLDS)) {
      for (const b of [t.warn, t.danger]) {
        if (b.source === 'literature') expect(b.citation).toBeTruthy()
        else expect(b.citation).toBeNull()
      }
      expect(t.note.length).toBeGreaterThan(0)
      expect(t.danger.deg).toBeGreaterThan(t.warn.deg)
    }
  })

  it('every literature boundary carries a citation; every engineering boundary carries none', () => {
    for (const [key, t] of Object.entries(THRESHOLDS)) {
      for (const b of [t.warn, t.danger]) {
        if (b.source === 'literature') expect(b.citation, key).toBeTruthy()
        else expect(b.citation, key).toBeNull()
      }
    }
  })

  it('toZoneAndPct still maps deviations to zones after the model change', () => {
    expect(toZoneAndPct(0, 'knee_extension_back_knee').zone).toBe('maintain')
    expect(toZoneAndPct(7, 'knee_extension_back_knee').zone).toBe('warning')
    expect(toZoneAndPct(12, 'knee_extension_back_knee').zone).toBe('danger')
  })
})

describe('metricValidity (projection over threshold provenance)', () => {
  it('knee_extension_back_knee is LITERATURE_CITED (both boundaries peer-reviewed)', () => {
    expect(metricValidity('knee_extension_back_knee')).toBe('LITERATURE_CITED')
  })

  it('every proxy + genu metric is SCREENING_ONLY (engineering boundaries)', () => {
    for (const key of [...PROXY_KEYS, 'genu_varum_valgum_left', 'genu_varum_valgum_right']) {
      expect(metricValidity(key), key).toBe('SCREENING_ONLY')
    }
  })

  it('pelvic_obliquity is LITERATURE_CITED after Bibrowicz 2023 graduation', () => {
    expect(metricValidity('pelvic_obliquity')).toBe('LITERATURE_CITED')
    const t = THRESHOLDS['pelvic_obliquity']
    expect(t.warn.source).toBe('literature')
    expect(t.danger.source).toBe('literature')
    expect(t.warn.citation).toMatch(/Bibrowicz/)
    expect(t.danger.citation).toMatch(/Bibrowicz/)
    expect(t.warn.deg).toBe(3)
    expect(t.danger.deg).toBe(6)
  })

  it('an absent / unscored key is SCREENING_ONLY (most conservative default)', () => {
    expect(metricValidity('pelvic_axial_rotation')).toBe('SCREENING_ONLY')
    expect(metricValidity('nonexistent_metric')).toBe('SCREENING_ONLY')
  })

  it('no metric is VALIDATED yet (reserved for the Layer-1 validation study)', () => {
    for (const key of Object.keys(THRESHOLDS)) {
      expect(metricValidity(key), key).not.toBe('VALIDATED')
    }
  })
})

// Grade-band anchor invariants (spec §3.2, recalibrated 2026-07 against the
// golden distribution under the validity-weighted overall score).
const gradeOf = (name: string) => {
  const c = GOLDEN_CASES.find(x => x.name === name)!
  return assessPosture([generatePose('front', c.spec, c.cam), generatePose('side', c.spec, c.cam)]).overallGrade
}

describe('grade bands discriminate the golden anchor cases', () => {
  it('grade bands discriminate the golden anchor cases', () => {
    expect(gradeOf('neutral')).toBe('S')
    expect(['A', 'B']).toContain(gradeOf('trunk-lean-warn'))
    expect(['B', 'C']).toContain(gradeOf('trunk-lean-danger'))
    expect(['C', 'D', 'E']).toContain(gradeOf('combined-moderate'))
  })
})
