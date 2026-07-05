import { describe, it, expect } from 'vitest'
import { ALL_EXERCISES, ALL_MUSCLES } from '../../content'

// Scored tight/weak muscle slugs for an imbalance key, derived from the graded
// links on each muscle (the link's muscle is its parent MuscleContent.slug).
function scoredSets(key: string) {
  const tight = new Set<string>()
  const weak = new Set<string>()
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.imbalanceKey !== key || l.scored === false) continue
      if (l.role === 'tight') tight.add(m.slug)
      else if (l.role === 'weak') weak.add(m.slug)
    }
  }
  return { tight, weak }
}

// KNOWN_DEBT: pre-existing incoherent (exercise × finding) pairs present when the
// coherence gate was introduced (Plan 2 §5.1). This is an ENFORCED burn-down list,
// not a waiver — the gate stays at full strength for all new content:
//   * a NEW incoherent pair (not in this list) fails the test → fix the content.
//   * a listed pair that becomes coherent fails the test → delete it from this list.
// Each pair's root cause and resolution options are tracked in docs/coherence-debt.md.
// Target: this list shrinks to []. Do not add to it without product-owner sign-off.
const KNOWN_DEBT: string[] = [
  'band-lying-hip-internal-rotation [strengthen] × pelvic_axial_rotation',
  'band-rear-delt-row [strengthen] × posterior_imbalanced_shoulders',
  'band-reverse-fly [strengthen] × posterior_imbalanced_shoulders',
  'bent-knee-calf-stretch [stretch] × knee_extension_back_knee',
  'bird-dog [strengthen] × pelvic_axial_rotation',
  'cat-cow [mobility] × forward_head_posture',
  'figure-four-stretch [stretch] × pelvic_axial_rotation',
  'glute-bridge-march [strengthen] × pelvic_obliquity',
  'half-kneeling-band-chop [strengthen] × pelvic_axial_rotation',
  'kneeling-hip-flexor-stretch [stretch] × pelvic_obliquity',
  'open-book-stretch [mobility] × pelvic_axial_rotation',
  'pallof-press [strengthen] × pelvic_axial_rotation',
  'prone-t-raise [strengthen] × posterior_imbalanced_shoulders',
  'prone-w-raise [strengthen] × posterior_imbalanced_shoulders',
  'rear-deltoid-stretch [stretch] × posterior_imbalanced_shoulders',
  'seated-hamstring-stretch [stretch] × knee_extension_back_knee',
  'seated-tibial-rotation [activation] × knee_extension_back_knee',
  'side-plank-knees [strengthen] × pelvic_axial_rotation',
  'side-plank [strengthen] × pelvic_axial_rotation',
  'single-leg-glute-bridge [strengthen] × pelvic_axial_rotation',
  'single-leg-rdl [strengthen] × pelvic_obliquity',
  'standing-band-trunk-rotation [strengthen] × pelvic_axial_rotation',
  'standing-calf-raise [strengthen] × knee_extension_back_knee',
  'standing-quad-stretch [stretch] × knee_extension_back_knee',
  'supine-crossover-stretch [stretch] × pelvic_axial_rotation',
  'tall-kneeling-anti-rotation-hold [activation] × pelvic_axial_rotation',
  'thoracic-extension [mobility] × forward_head_posture',
  'wall-ankle-dorsiflexion-rock [mobility] × genu_varum_valgum_left',
  'wall-ankle-dorsiflexion-rock [mobility] × genu_varum_valgum_right',
  'wall-calf-stretch [stretch] × knee_extension_back_knee',
]

describe('exercise coherence gate (Plan 2 §5.1)', () => {
  const failures: string[] = []
  for (const ex of ALL_EXERCISES) {
    if (ex.category === 'informational') continue
    for (const key of ex.primaryDeviationKeys) {
      const { tight, weak } = scoredSets(key)
      const targets = ex.muscles ?? []
      const hitsTight = targets.some(m => m.role === 'stretch' && tight.has(m.muscleSlug))
      const hitsWeak = targets.some(m => m.role === 'strengthen' && weak.has(m.muscleSlug))
      let ok = false
      if (ex.category === 'stretch') ok = hitsTight
      else if (ex.category === 'strengthen' || ex.category === 'activation') ok = hitsWeak
      else if (ex.category === 'mobility')
        ok = targets.some(m => tight.has(m.muscleSlug) || weak.has(m.muscleSlug))
      if (!ok) failures.push(`${ex.slug} [${ex.category}] × ${key}`)
    }
  }

  const debt = new Set(KNOWN_DEBT)
  const fail = new Set(failures)
  const newlyBroken = failures.filter((f) => !debt.has(f)).sort()
  const newlyFixed = KNOWN_DEBT.filter((d) => !fail.has(d)).sort()

  it('introduces no NEW incoherent exercise×finding pairs', () => {
    expect(newlyBroken).toEqual([])
  })

  it('KNOWN_DEBT contains no already-fixed pairs (ratchet down)', () => {
    expect(newlyFixed).toEqual([])
  })
})
