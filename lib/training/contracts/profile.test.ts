import { describe, expect, it } from 'vitest'
import {
  ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION,
  AthleteTrainingProfileV1Schema,
} from './profile'

const validProfile = {
  schemaVersion: 'athlete-training-profile.v1',
  origin: { kind: 'athlete_input' as const },
  goal: 'strength' as const,
  experience: 'beginner' as const,
  recentConsistency: 'intermittent' as const,
  cycleLengthWeeks: 8 as const,
  strengthDays: ['monday', 'wednesday', 'friday'] as const,
  localTimezone: 'America/Los_Angeles',
  sessionTimeBudgetMinutes: 45 as const,
  preferredLoadUnit: 'kg' as const,
  equipmentInventory: [
    {
      kind: 'dumbbell' as const,
      equipmentId: 'dumbbells-home',
      unit: 'kg' as const,
      perHandLoads: ['5', '7.5', '10', '12.5'],
    },
  ],
  startingHistory: [
    {
      exerciseVersionId: 'goblet-squat.v1',
      performedAt: null,
      equipmentLoad: {
        equipmentId: 'dumbbells-home',
        basis: 'dumbbell_per_hand' as const,
        quantity: {
          entered: { value: '10', unit: 'kg' as const },
          canonicalKg: '10',
        },
      },
      reps: 8,
      source: {
        kind: 'recalled' as const,
        sourceVersion: 'athlete-recall.v1' as const,
        capturedAt: '2026-09-07T18:00:00.000Z',
      },
      progressionEvidenceEligible: false as const,
    },
  ],
}

describe('AthleteTrainingProfileV1Schema', () => {
  it('accepts the capability-free athlete profile and preserves exact load provenance', () => {
    const parsed = AthleteTrainingProfileV1Schema.parse(validProfile)

    expect(parsed).toEqual(validProfile)
    expect(parsed.startingHistory[0].equipmentLoad.quantity).toEqual({
      entered: { value: '10', unit: 'kg' },
      canonicalKg: '10',
    })
    expect(parsed.startingHistory[0].progressionEvidenceEligible).toBe(false)
  })

  it('exports the exact profile schema version accepted by the parser', () => {
    expect(ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION).toBe('athlete-training-profile.v1')
    expect(AthleteTrainingProfileV1Schema.parse(validProfile).schemaVersion)
      .toBe(ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION)
  })

  it.each([4, 6, 8, 12] as const)('accepts the %s-week cycle option', (cycleLengthWeeks) => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      cycleLengthWeeks,
    }).success).toBe(true)
  })

  it.each([
    { strengthDays: ['monday', 'thursday'] },
    { strengthDays: ['monday', 'wednesday', 'friday'] },
    { strengthDays: ['monday', 'tuesday', 'thursday', 'friday'] },
  ] as const)('accepts a selected 2/3/4-day schedule: $strengthDays', ({ strengthDays }) => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      strengthDays,
    }).success).toBe(true)
  })

  it.each([30, 45, 60] as const)('accepts the %s-minute session budget', (sessionTimeBudgetMinutes) => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      sessionTimeBudgetMinutes,
    }).success).toBe(true)
  })

  it.each([3, 5, 10, 90])('rejects unsupported cycle length %s', (cycleLengthWeeks) => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      cycleLengthWeeks,
    }).success).toBe(false)
  })

  it('rejects duplicate or unsupported selected training days', () => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      strengthDays: ['monday', 'monday'],
    }).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      strengthDays: ['monday', 'funday'],
    }).success).toBe(false)
  })

  it('requires a real IANA timezone rather than a display abbreviation or UTC offset', () => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      localTimezone: 'America/New_York',
    }).success).toBe(true)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      localTimezone: 'UTC',
    }).success).toBe(true)
    for (const localTimezone of ['', 'PST', 'UTC-8', 'Mars/Olympus']) {
      expect(AthleteTrainingProfileV1Schema.safeParse({
        ...validProfile,
        localTimezone,
      }).success).toBe(false)
    }
  })

  it('rejects duplicate equipment IDs and malformed exact inventory loads', () => {
    const duplicate = {
      ...validProfile,
      equipmentInventory: [
        validProfile.equipmentInventory[0],
        { ...validProfile.equipmentInventory[0] },
      ],
    }
    expect(AthleteTrainingProfileV1Schema.safeParse(duplicate).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      equipmentInventory: [{
        ...validProfile.equipmentInventory[0],
        perHandLoads: ['5', '7.5000'],
      }],
    }).success).toBe(false)
  })

  it('rejects forged canonical loads and history that names unavailable equipment', () => {
    const history = validProfile.startingHistory[0]
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      startingHistory: [{
        ...history,
        equipmentLoad: {
          ...history.equipmentLoad,
          quantity: { ...history.equipmentLoad.quantity, canonicalKg: '100' },
        },
      }],
    }).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      startingHistory: [{
        ...history,
        equipmentLoad: { ...history.equipmentLoad, equipmentId: 'unknown-rack' },
      }],
    }).success).toBe(false)
  })

  it('rejects history entered in a different unit from its machine inventory', () => {
    const history = validProfile.startingHistory[0]
    const result = AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      equipmentInventory: [{
        kind: 'machine',
        equipmentId: 'machine-stack',
        unit: 'kg',
        stackLoads: ['10', '20'],
      }],
      startingHistory: [{
        ...history,
        equipmentLoad: {
          equipmentId: 'machine-stack',
          basis: 'machine_stack',
          quantity: {
            entered: { value: '22.046', unit: 'lb' },
            canonicalKg: '9.99988249602',
          },
        },
      }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['startingHistory', 0, 'equipmentLoad', 'quantity', 'entered', 'unit'],
        }),
      ]))
    }
  })

  it('rejects a barbell-total history basis for dumbbell inventory', () => {
    const history = validProfile.startingHistory[0]
    const result = AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      startingHistory: [{
        ...history,
        equipmentLoad: {
          ...history.equipmentLoad,
          basis: 'barbell_total',
        },
      }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['startingHistory', 0, 'equipmentLoad', 'basis'],
        }),
      ]))
    }
  })

  it('accepts one exact dumbbell denomination as a single implement load', () => {
    const history = validProfile.startingHistory[0]
    const parsed = AthleteTrainingProfileV1Schema.parse({
      ...validProfile,
      startingHistory: [{
        ...history,
        equipmentLoad: {
          ...history.equipmentLoad,
          basis: 'dumbbell_single_implement',
        },
      }],
    })

    expect(parsed.startingHistory[0].equipmentLoad).toMatchObject({
      equipmentId: 'dumbbells-home',
      basis: 'dumbbell_single_implement',
      quantity: { entered: { value: '10', unit: 'kg' } },
    })
  })

  it('rejects the single-implement basis for barbell and machine inventory', () => {
    const history = validProfile.startingHistory[0]
    for (const inventory of [
      {
        kind: 'barbell',
        equipmentId: 'rack-a',
        unit: 'kg',
        barWeight: '20',
        collarsTotalWeight: '0',
        plates: [],
      },
      {
        kind: 'machine',
        equipmentId: 'stack-a',
        unit: 'kg',
        stackLoads: ['10', '20'],
      },
    ]) {
      expect(AthleteTrainingProfileV1Schema.safeParse({
        ...validProfile,
        equipmentInventory: [inventory],
        startingHistory: [{
          ...history,
          equipmentLoad: {
            ...history.equipmentLoad,
            equipmentId: inventory.equipmentId,
            basis: 'dumbbell_single_implement',
          },
        }],
      }).success).toBe(false)
    }
  })

  it('requires closed history source versions and keeps recalled/imported history out of progression evidence', () => {
    const history = validProfile.startingHistory[0]
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      startingHistory: [{
        ...history,
        source: { ...history.source, sourceVersion: 'athlete-recall.v2' },
      }],
    }).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      startingHistory: [{ ...history, progressionEvidenceEligible: true }],
    }).success).toBe(false)
  })

  it('accepts imported history only with explicit adapter provenance', () => {
    const history = validProfile.startingHistory[0]
    expect(AthleteTrainingProfileV1Schema.parse({
      ...validProfile,
      startingHistory: [{
        ...history,
        performedAt: '2026-08-30T18:00:00.000Z',
        source: {
          kind: 'imported',
          sourceVersion: 'external-history-import.v1',
          sourceSystemId: 'csv-import',
          sourceRecordReference: 'row-42',
          importedAt: '2026-09-07T18:00:00.000Z',
        },
      }],
    }).startingHistory[0].source).toMatchObject({
      kind: 'imported',
      sourceSystemId: 'csv-import',
    })
  })

  it('requires synthetic profiles to carry a visible fixture id and label', () => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      origin: { kind: 'synthetic_fixture' },
    }).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.parse({
      ...validProfile,
      origin: {
        kind: 'synthetic_fixture',
        fixtureId: 'profile-fixture-1',
        label: 'SYNTHETIC — not a real athlete',
      },
    }).origin.kind).toBe('synthetic_fixture')
  })

  it('rejects scan-derived capability fields and unknown profile versions', () => {
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      scanScore: 92,
    }).success).toBe(false)
    expect(AthleteTrainingProfileV1Schema.safeParse({
      ...validProfile,
      schemaVersion: 'athlete-training-profile.v2',
    }).success).toBe(false)
  })
})
