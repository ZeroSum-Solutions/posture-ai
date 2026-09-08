import { describe, expect, it } from 'vitest'
import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'
import {
  PRACTICE_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_FIXTURE,
} from './fixture'

describe('private practice simulation fixture', () => {
  it('is visibly synthetic, contract-valid, and content-bound', () => {
    expect(AthleteTrainingProfileV1Schema.safeParse(PRACTICE_SIMULATION_FIXTURE.profile).success).toBe(true)
    expect(PRACTICE_SIMULATION_FIXTURE.label).toBe('Practice data')
    expect(PRACTICE_SIMULATION_FIXTURE.profile.origin).toMatchObject({
      kind: 'synthetic_fixture', fixtureId: 'practice-strength-profile.v1',
    })
    expect(PRACTICE_SIMULATION_CATALOG_ORIGIN).toEqual({
      fixtureId: 'synthetic-starter-catalog.v1',
      fixtureHash: 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
    })
  })
})
