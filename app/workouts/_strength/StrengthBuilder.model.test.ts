import { describe, expect, it } from 'vitest'
import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'
import {
  createInitialStrengthProfile,
  profileOptionValues,
  validateStrengthProfile,
} from './StrengthBuilder.model'

describe('strength builder profile model', () => {
  it('starts from a schema-valid eight-week adult training profile draft', () => {
    const profile = createInitialStrengthProfile('America/Los_Angeles')

    expect(AthleteTrainingProfileV1Schema.safeParse(profile).success).toBe(true)
    expect(profile).toMatchObject({
      origin: { kind: 'athlete_input' },
      goal: 'general_fitness',
      experience: 'beginner',
      recentConsistency: 'unknown',
      cycleLengthWeeks: 8,
      strengthDays: ['monday', 'wednesday', 'friday'],
      localTimezone: 'America/Los_Angeles',
      sessionTimeBudgetMinutes: 45,
      preferredLoadUnit: 'kg',
      equipmentInventory: [],
      startingHistory: [],
    })
  })

  it('derives form option values from the shared profile schema', () => {
    expect(profileOptionValues.cycleLengths).toEqual([4, 6, 8, 12])
    expect(profileOptionValues.sessionMinutes).toEqual([30, 45, 60])
    expect(profileOptionValues.goals).toEqual(['strength', 'general_fitness'])
    expect(profileOptionValues.experience).toEqual(['new_to_strength', 'beginner', 'intermediate'])
  })

  it('returns field-addressable shared-schema issues instead of accepting an invalid schedule', () => {
    const profile = {
      ...createInitialStrengthProfile('Etc/UTC'),
      strengthDays: ['monday'],
    }

    expect(validateStrengthProfile(profile)).toEqual({
      status: 'invalid',
      fieldErrors: {
        strengthDays: ['Too small: expected array to have >=2 items'],
      },
    })
  })

  it('preserves exact entered equipment decimals for shared-schema validation', () => {
    const profile = {
      ...createInitialStrengthProfile('Etc/UTC'),
      equipmentInventory: [{
        kind: 'barbell' as const,
        equipmentId: 'home-rack',
        unit: 'kg' as const,
        barWeight: '20.00',
        collarsTotalWeight: '0.5',
        plates: [{ value: '1.25', count: 4 }],
      }],
    }

    const result = validateStrengthProfile(profile)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.profile.equipmentInventory[0]).toMatchObject({
        barWeight: '20.00',
        plates: [{ value: '1.25', count: 4 }],
      })
    }
  })
})
