import { describe, expect, it } from 'vitest'
import { ACTIVE_PROGRAM_COMPILER_OPTIONS } from './options'

describe('active compiler options', () => {
  it('exports the bounded public cycle, frequency, budget and goal choices', () => {
    expect(ACTIVE_PROGRAM_COMPILER_OPTIONS).toEqual({
      cycleLengthWeeks: [8], strengthDaysPerWeek: [2, 3, 4],
      sessionTimeBudgetMinutes: [30, 45, 60], goals: ['strength', 'general_fitness'],
    })
    expect(Object.isFrozen(ACTIVE_PROGRAM_COMPILER_OPTIONS.strengthDaysPerWeek)).toBe(true)
  })
})
