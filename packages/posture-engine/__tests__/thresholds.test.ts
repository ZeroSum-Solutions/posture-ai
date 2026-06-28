import { describe, it, expect } from 'vitest'
import { THRESHOLDS, toZoneAndPct, metricValidity } from '../src/thresholds'

// Proxy metrics: the engine measures a lean-from-vertical / line-tilt quantity,
// NOT the named clinical construct (CVA, FSA, kyphosis, APT). Their thresholds
// are tunable engineering defaults, not literature-cited cut-points.
const PROXY_KEYS = [
  'forward_head_posture',
  'anterior_imbalanced_shoulders',
  'posterior_imbalanced_shoulders',
  't1_tilt_backward',
  'pelvic_obliquity',
  'anterior_pelvic_shift',
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
