import { describe, it, expect } from 'vitest'
import { deriveExerciseRecommendations } from './exercises'

type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'

interface ExerciseDef {
  id: string
  slug: string
  name: string
  category: string
  primary_deviation_keys: string[]
  min_zone: string
  instructions: string
  sets: number
  hold_seconds: number
}

interface FindingDef {
  imbalance_key: string
  zone: Zone
  severity_pct: number
}

// Test fixture: seed exercises (matches DB seed data)
const SEED_EXERCISES: ExerciseDef[] = [
  { id: '1', slug: 'chin-tucks', name: 'Chin Tucks', category: 'strengthen',
    primary_deviation_keys: ['forward_head_posture'], min_zone: 'warning',
    instructions: 'Retract chin.', sets: 3, hold_seconds: 5 },
  { id: '2', slug: 'neck-lateral-stretch', name: 'Neck Lateral Stretch', category: 'stretch',
    primary_deviation_keys: ['forward_head_posture'], min_zone: 'maintain',
    instructions: 'Tilt head.', sets: 3, hold_seconds: 20 },
  { id: '3', slug: 'wall-angels', name: 'Wall Angels', category: 'strengthen',
    primary_deviation_keys: ['anterior_imbalanced_shoulders', 'posterior_imbalanced_shoulders'], min_zone: 'maintain',
    instructions: 'Wall angels.', sets: 3, hold_seconds: 10 },
  { id: '4', slug: 'doorway-pec-stretch', name: 'Doorway Pec Stretch', category: 'stretch',
    primary_deviation_keys: ['anterior_imbalanced_shoulders'], min_zone: 'maintain',
    instructions: 'Doorway stretch.', sets: 3, hold_seconds: 20 },
  { id: '5', slug: 'kneeling-hip-flexor-stretch', name: 'Kneeling Hip Flexor Stretch', category: 'stretch',
    primary_deviation_keys: ['anterior_pelvic_shift', 'pelvic_obliquity'], min_zone: 'warning',
    instructions: 'Kneeling stretch.', sets: 3, hold_seconds: 20 },
  { id: '6', slug: 'glute-bridge', name: 'Glute Bridge', category: 'strengthen',
    primary_deviation_keys: ['anterior_pelvic_shift', 'knee_extension_back_knee'], min_zone: 'maintain',
    instructions: 'Glute bridge.', sets: 3, hold_seconds: 2 },
  { id: '7', slug: 'clamshell', name: 'Clamshell Exercise', category: 'strengthen',
    primary_deviation_keys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'], min_zone: 'warning',
    instructions: 'Clamshell.', sets: 3, hold_seconds: 5 },
  { id: '8', slug: 'single-leg-balance', name: 'Single Leg Balance', category: 'activation',
    primary_deviation_keys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'], min_zone: 'warning',
    instructions: 'Balance.', sets: 3, hold_seconds: 30 },
  { id: '9', slug: 'standing-hamstring-curl', name: 'Standing Hamstring Curl', category: 'strengthen',
    primary_deviation_keys: ['knee_extension_back_knee'], min_zone: 'warning',
    instructions: 'Hamstring curl.', sets: 3, hold_seconds: 5 },
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
})
