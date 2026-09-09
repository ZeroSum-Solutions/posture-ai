import { describe, expect, it } from 'vitest'
import { AthleteTrainingProfileV1Schema } from '@/lib/training/contracts/profile'
import {
  BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN,
  BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE,
  CONDITIONING_SIMULATION_CATALOG_ORIGIN,
  EXERCISE_SWAP_SIMULATION_CATALOG_ORIGIN,
  PRACTICE_SIMULATION_CATALOG_CHOICES,
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
    expect(PRACTICE_SIMULATION_CATALOG_CHOICES.starter.origin).toBe(PRACTICE_SIMULATION_CATALOG_ORIGIN)
    expect(EXERCISE_SWAP_SIMULATION_CATALOG_ORIGIN).toEqual({
      fixtureId: 'synthetic-swap-journey-catalog.v1',
      fixtureHash: '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
    })
    expect(CONDITIONING_SIMULATION_CATALOG_ORIGIN).toEqual({
      fixtureId: 'synthetic-conditioning-journey-catalog.v1',
      fixtureHash: 'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
    })
    expect(PRACTICE_SIMULATION_CATALOG_CHOICES.conditioning.origin)
      .toBe(CONDITIONING_SIMULATION_CATALOG_ORIGIN)
    expect(BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN).toEqual({
      fixtureId: 'synthetic-bodyweight-assistance-catalog.v1',
      fixtureHash: 'f21b09cc4e744be6bb483cab4af6c0404c0ea8e88b30122ac773b6279e197ee1',
    })
    expect(PRACTICE_SIMULATION_CATALOG_CHOICES['bodyweight-assistance'].origin)
      .toBe(BODYWEIGHT_ASSISTANCE_SIMULATION_CATALOG_ORIGIN)
    expect(PRACTICE_SIMULATION_CATALOG_CHOICES['bodyweight-assistance'].reservationRpc)
      .toBe('reserve_training_bodyweight_assistance_simulation_identity')
    expect(BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE.equipmentInventory).toEqual([
      {
        kind: 'bodyweight_external', equipmentId: 'synthetic-bodyweight-station',
        unit: 'kg', externalLoads: ['0', '5', '10'],
      },
      {
        kind: 'assistance_machine', equipmentId: 'synthetic-assisted-pullup-machine',
        unit: 'kg', assistanceLoads: ['10', '20', '30', '40', '50', '60'],
      },
    ])
    expect(AthleteTrainingProfileV1Schema.safeParse(BODYWEIGHT_ASSISTANCE_SIMULATION_PROFILE).success)
      .toBe(true)
  })
})
