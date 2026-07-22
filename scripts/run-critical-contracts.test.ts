import { describe, expect, it } from 'vitest'
import { CRITICAL_CONTRACT_FILES, validateCriticalContractInventory } from './run-critical-contracts.mjs'

describe('critical-contract ratchet inventory', () => {
  it('keeps every required safety domain explicit and materialized', () => {
    expect(Object.keys(CRITICAL_CONTRACT_FILES).sort()).toEqual([
      'auth',
      'capture',
      'comparison',
      'consent_lifecycle',
      'migration_guards',
      'scoring',
      'workout_state',
    ])
    expect(validateCriticalContractInventory()).toEqual([])
    for (const files of Object.values(CRITICAL_CONTRACT_FILES)) expect(files.length).toBeGreaterThan(0)
  })

  it('cannot silently pass after a named contract test disappears', () => {
    expect(validateCriticalContractInventory('/definitely/missing/posture-ai')).toEqual(
      expect.arrayContaining([expect.stringMatching(/^missing critical test:/)]),
    )
  })
})
