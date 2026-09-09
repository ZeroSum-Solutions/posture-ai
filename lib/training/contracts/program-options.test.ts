import { describe, expect, it } from 'vitest'
import { TrainingProgramOptionsV1Schema } from './program-options'

const liveOptions = {
  schemaVersion: 'training-program-options.v1' as const,
  subjectId: '11111111-1111-4111-8111-111111111111',
  profileRevision: 4,
  executionContext: { kind: 'live' as const },
  catalogVersion: 'authored-general.v1',
  catalogOrigin: { kind: 'authored_catalog' as const },
  conditioningPreference: {
    status: 'ready' as const,
    value: {
      schemaVersion: 'conditioning-preference.v1' as const,
      catalogVersion: 'authored-general.v1',
      preferredModalityIds: ['walking.v1'],
    },
  },
  conditioningModes: [{ modalityId: 'walking.v1', label: 'Walking' }],
  exerciseOptions: [{
    exerciseVersionId: 'goblet-squat.v1',
    label: 'Goblet squat',
    equipmentOptions: [{
      equipmentId: 'dumbbells-home', basis: 'dumbbell_single_implement' as const, unit: 'kg' as const,
    }],
  }],
}

describe('TrainingProgramOptionsV1Schema', () => {
  it('preserves the catalog-bound conditioning and recalled-history choices', () => {
    expect(TrainingProgramOptionsV1Schema.parse(liveOptions)).toEqual(liveOptions)
  })

  it('requires catalog origin to match the execution context', () => {
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      catalogOrigin: {
        kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'fixture.v1',
        fixtureHash: 'a'.repeat(64), label: 'Synthetic fixture',
      },
    }).success).toBe(false)
  })

  it('rejects duplicate modality IDs and duplicate equipment option tuples', () => {
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      conditioningModes: [liveOptions.conditioningModes[0], liveOptions.conditioningModes[0]],
    }).success).toBe(false)
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      exerciseOptions: [{
        ...liveOptions.exerciseOptions[0],
        equipmentOptions: [
          liveOptions.exerciseOptions[0].equipmentOptions[0],
          liveOptions.exerciseOptions[0].equipmentOptions[0],
        ],
      }],
    }).success).toBe(false)
  })

  it('binds preference readiness and stale states to the projected catalog', () => {
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      conditioningPreference: {
        status: 'ready',
        value: {
          ...liveOptions.conditioningPreference.value,
          catalogVersion: 'authored-old.v1',
        },
      },
    }).success).toBe(false)
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      conditioningPreference: {
        status: 'ready',
        value: {
          ...liveOptions.conditioningPreference.value,
          preferredModalityIds: ['cycling.v1'],
        },
      },
    }).success).toBe(false)
    expect(TrainingProgramOptionsV1Schema.safeParse({
      ...liveOptions,
      conditioningPreference: {
        status: 'stale_catalog',
        value: liveOptions.conditioningPreference.value,
      },
    }).success).toBe(false)
  })
})
