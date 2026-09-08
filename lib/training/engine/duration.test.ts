import { describe, expect, it } from 'vitest'
import { estimateDynamicSessionDuration } from './duration'

describe('estimateDynamicSessionDuration', () => {
  it('matches both exact PR-16 duration oracles', () => {
    expect(estimateDynamicSessionDuration({
      exercises: Array.from({ length: 4 }, () => ({ sets: 2, repCeiling: 10, restSeconds: 120 })),
      warmupSeconds: 300,
      cooldownSeconds: 120,
      preparationSeconds: 0,
    })).toEqual({ durationSeconds: 1_400, fitsBudget: true, budgetSeconds: 1_800 })

    expect(estimateDynamicSessionDuration({
      exercises: Array.from({ length: 4 }, () => ({ sets: 3, repCeiling: 10, restSeconds: 180 })),
      warmupSeconds: 300,
      cooldownSeconds: 120,
      preparationSeconds: 0,
      budgetMinutes: 30,
    })).toEqual({ durationSeconds: 2_520, fitsBudget: false, budgetSeconds: 1_800 })

    expect(estimateDynamicSessionDuration({
      exercises: Array.from({ length: 4 }, () => ({ sets: 3, repCeiling: 10, restSeconds: 180 })),
      warmupSeconds: 300,
      cooldownSeconds: 120,
      preparationSeconds: 0,
      budgetMinutes: 45,
    }).fitsBudget).toBe(true)
  })

  it('uses an authored tempo override and explicit preparation time', () => {
    expect(estimateDynamicSessionDuration({
      exercises: [{ sets: 2, repCeiling: 5, restSeconds: 120, secondsPerRep: 6 }],
      warmupSeconds: 300,
      cooldownSeconds: 120,
      preparationSeconds: 90,
      budgetMinutes: 30,
    }).durationSeconds).toBe(690)
  })

  it('rejects malformed or unbounded runtime input', () => {
    expect(() => estimateDynamicSessionDuration({
      exercises: [],
      warmupSeconds: 300,
      cooldownSeconds: 120,
      preparationSeconds: 0,
    })).toThrow('Invalid duration input')
  })
})
