import { describe, it, expect } from 'vitest'
import { deriveExerciseRecommendations } from './exercises'

type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'

interface ExerciseDef {
  slug: string
  category: string
  primaryDeviationKeys: string[]
  contraindicatedDeviationKeys?: string[]
  minZone: string
}

interface FindingDef {
  imbalance_key: string
  zone: Zone
  severity_pct: number
}

// Test fixture: mirrors the authored content/ exercises this selector now reads.
const SEED_EXERCISES: ExerciseDef[] = [
  { slug: 'chin-tucks', category: 'strengthen',
    primaryDeviationKeys: ['forward_head_posture'], minZone: 'warning' },
  { slug: 'neck-lateral-stretch', category: 'stretch',
    primaryDeviationKeys: ['forward_head_posture'], minZone: 'maintain' },
  { slug: 'wall-angels', category: 'strengthen',
    primaryDeviationKeys: ['anterior_imbalanced_shoulders', 'posterior_imbalanced_shoulders'], minZone: 'maintain' },
  { slug: 'doorway-pec-stretch', category: 'stretch',
    primaryDeviationKeys: ['anterior_imbalanced_shoulders'], minZone: 'maintain' },
  { slug: 'kneeling-hip-flexor-stretch', category: 'stretch',
    primaryDeviationKeys: ['anterior_pelvic_shift', 'pelvic_obliquity'], minZone: 'warning' },
  { slug: 'glute-bridge', category: 'strengthen',
    primaryDeviationKeys: ['anterior_pelvic_shift', 'knee_extension_back_knee'], minZone: 'maintain' },
  { slug: 'clamshell', category: 'strengthen',
    primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'], minZone: 'warning' },
  { slug: 'single-leg-balance', category: 'activation',
    primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'], minZone: 'warning' },
  { slug: 'standing-hamstring-curl', category: 'strengthen',
    primaryDeviationKeys: ['knee_extension_back_knee'], minZone: 'warning' },
]

describe('deriveExerciseRecommendations - determinism', () => {
  const dangerFindings: FindingDef[] = [
    { imbalance_key: 'forward_head_posture', zone: 'danger', severity_pct: 80 },
    { imbalance_key: 'anterior_pelvic_shift', zone: 'maintain', severity_pct: 10 },
  ]

  it('returns same result for identical inputs (deterministic)', () => {
    const result1 = deriveExerciseRecommendations(SEED_EXERCISES, dangerFindings)
    const result2 = deriveExerciseRecommendations(SEED_EXERCISES, dangerFindings)
    expect(result1.map(e => e.slug)).toEqual(result2.map(e => e.slug))
  })

  it('recommends exercises for danger zone findings', () => {
    const result = deriveExerciseRecommendations(SEED_EXERCISES, dangerFindings)
    const slugs = result.map(e => e.slug)
    // forward_head_posture at danger zone should trigger both chin-tucks (min warning) and neck-lateral-stretch (min maintain)
    expect(slugs).toContain('chin-tucks')
    expect(slugs).toContain('neck-lateral-stretch')
  })

  it('does not recommend exercises for unreliable findings', () => {
    const unreliableFindings: FindingDef[] = [
      { imbalance_key: 'forward_head_posture', zone: 'unreliable', severity_pct: 0 },
    ]
    const result = deriveExerciseRecommendations(SEED_EXERCISES, unreliableFindings)
    expect(result.length).toBe(0)
  })

  it('respects min_zone threshold - warning exercise not shown for maintain finding', () => {
    const maintainFindings: FindingDef[] = [
      { imbalance_key: 'forward_head_posture', zone: 'maintain', severity_pct: 15 },
    ]
    const result = deriveExerciseRecommendations(SEED_EXERCISES, maintainFindings)
    const slugs = result.map(e => e.slug)
    // neck-lateral-stretch (min maintain) → should appear
    expect(slugs).toContain('neck-lateral-stretch')
    // chin-tucks (min warning) → should NOT appear for maintain finding
    expect(slugs).not.toContain('chin-tucks')
  })

  it('recommends at least one exercise for a danger zone finding', () => {
    const dangerOnly: FindingDef[] = [
      { imbalance_key: 'anterior_pelvic_shift', zone: 'danger', severity_pct: 90 },
    ]
    const result = deriveExerciseRecommendations(SEED_EXERCISES, dangerOnly)
    // anterior_pelvic_shift at danger → kneeling-hip-flexor-stretch (min warning) and glute-bridge (min maintain)
    expect(result.length).toBeGreaterThanOrEqual(1)
    const slugs = result.map(e => e.slug)
    expect(slugs).toContain('glute-bridge')
    expect(slugs).toContain('kneeling-hip-flexor-stretch')
  })

  it('same findings always produce same exercise list regardless of array order', () => {
    const findingsA: FindingDef[] = [
      { imbalance_key: 'forward_head_posture', zone: 'warning', severity_pct: 50 },
      { imbalance_key: 'anterior_imbalanced_shoulders', zone: 'danger', severity_pct: 75 },
    ]
    const findingsB: FindingDef[] = [
      { imbalance_key: 'anterior_imbalanced_shoulders', zone: 'danger', severity_pct: 75 },
      { imbalance_key: 'forward_head_posture', zone: 'warning', severity_pct: 50 },
    ]
    const resultA = deriveExerciseRecommendations(SEED_EXERCISES, findingsA).map(e => e.slug).sort()
    const resultB = deriveExerciseRecommendations(SEED_EXERCISES, findingsB).map(e => e.slug).sort()
    expect(resultA).toEqual(resultB)
  })

  it('honors a release-scoped relationship check when one is supplied', () => {
    const result = deriveExerciseRecommendations(SEED_EXERCISES, dangerFindings, {
      isCoherentForKey: (exercise) => exercise.slug === 'chin-tucks',
    })

    expect(result.map((exercise) => exercise.slug)).toEqual(['chin-tucks'])
  })
})

// Mirrors content/exercises/seated-hamstring-stretch.ts: indicated for trunk_lean,
// contraindicated for knee_extension_back_knee (hyperextended knee → already-long hamstrings).
const SEATED_HAMSTRING_STRETCH: ExerciseDef = {
  slug: 'seated-hamstring-stretch', category: 'stretch',
  primaryDeviationKeys: ['trunk_lean'],
  contraindicatedDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'maintain',
}

describe('deriveExerciseRecommendations - cross-finding contraindications', () => {
  it('withholds an exercise contraindicated by a concurrent finding', () => {
    const findings: FindingDef[] = [
      { imbalance_key: 'trunk_lean', zone: 'warning', severity_pct: 55 },
      { imbalance_key: 'knee_extension_back_knee', zone: 'danger', severity_pct: 80 },
    ]
    const slugs = deriveExerciseRecommendations([SEATED_HAMSTRING_STRETCH], findings).map(e => e.slug)
    expect(slugs).not.toContain('seated-hamstring-stretch')
  })

  it('recommends the exercise when the contraindicating finding is absent', () => {
    const findings: FindingDef[] = [
      { imbalance_key: 'trunk_lean', zone: 'warning', severity_pct: 55 },
    ]
    const slugs = deriveExerciseRecommendations([SEATED_HAMSTRING_STRETCH], findings).map(e => e.slug)
    expect(slugs).toContain('seated-hamstring-stretch')
  })

  // A maintain-zone knee was measured within normal range, so there is no hyperextension
  // to protect against. Vetoing on it would withhold a warranted stretch. Same bar as
  // buildProgram's screenedKeysFor.
  it('does not veto on a maintain-zone contraindicating finding', () => {
    const findings: FindingDef[] = [
      { imbalance_key: 'trunk_lean', zone: 'warning', severity_pct: 55 },
      { imbalance_key: 'knee_extension_back_knee', zone: 'maintain', severity_pct: 8 },
    ]
    const slugs = deriveExerciseRecommendations([SEATED_HAMSTRING_STRETCH], findings).map(e => e.slug)
    expect(slugs).toContain('seated-hamstring-stretch')
  })

  it('does not veto on an unreliable contraindicating finding', () => {
    const findings: FindingDef[] = [
      { imbalance_key: 'trunk_lean', zone: 'warning', severity_pct: 55 },
      { imbalance_key: 'knee_extension_back_knee', zone: 'unreliable', severity_pct: 0 },
    ]
    const slugs = deriveExerciseRecommendations([SEATED_HAMSTRING_STRETCH], findings).map(e => e.slug)
    expect(slugs).toContain('seated-hamstring-stretch')
  })
})

describe('deriveExerciseRecommendations - informational items', () => {
  // Informational content is reference reading, not movement to hand a client.
  const SEATED_TIBIAL_ROTATION: ExerciseDef = {
    slug: 'seated-tibial-rotation', category: 'informational',
    primaryDeviationKeys: ['knee_extension_back_knee'], minZone: 'warning',
  }

  it('never recommends an informational item', () => {
    const findings: FindingDef[] = [
      { imbalance_key: 'knee_extension_back_knee', zone: 'danger', severity_pct: 80 },
    ]
    const slugs = deriveExerciseRecommendations([SEATED_TIBIAL_ROTATION], findings).map(e => e.slug)
    expect(slugs).not.toContain('seated-tibial-rotation')
  })
})
