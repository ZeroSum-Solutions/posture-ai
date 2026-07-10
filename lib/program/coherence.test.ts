import { describe, it, expect } from 'vitest'
import { ALL_EXERCISES } from '../../content'
import { isCoherentForKey } from './roleCoherence'

// Coherence is defined once in roleCoherence.ts (isCoherentForKey) and enforced
// two ways: this content gate fails authoring-time on any incoherent pair, and
// candidatesFor() applies the same rule at runtime. Sharing the definition keeps
// the gate and the selector from drifting.

// KNOWN_DEBT: pre-existing incoherent (exercise × finding) pairs present when the
// coherence gate was introduced (Plan 2 §5.1). This is an ENFORCED burn-down list,
// not a waiver — the gate stays at full strength for all new content:
//   * a NEW incoherent pair (not in this list) fails the test → fix the content.
//   * a listed pair that becomes coherent fails the test → delete it from this list.
// Each pair's root cause and resolution options are tracked in docs/coherence-debt.md.
// Target: this list shrinks to []. Do not add to it without product-owner sign-off.
const KNOWN_DEBT: string[] = []

describe('exercise coherence gate (Plan 2 §5.1)', () => {
  const failures: string[] = []
  for (const ex of ALL_EXERCISES) {
    if (ex.category === 'informational') continue
    for (const key of ex.primaryDeviationKeys) {
      if (!isCoherentForKey(ex, key)) failures.push(`${ex.slug} [${ex.category}] × ${key}`)
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
