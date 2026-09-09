import { describe, expect, it } from 'vitest'
import type { ScheduledStrengthDay } from './schedule'
import { movementOccurrenceIndex, undulatingExposureForOccurrence } from './exposureSchedule'
import type { IntermediateUndulatingTemplateV1 } from './strengthTemplate'

const template: IntermediateUndulatingTemplateV1 = {
  schemaVersion: 'strength-template.v1',
  style: 'intermediate_undulating',
  templateId: 'intermediate-undulating',
  templateVersion: 'intermediate-undulating.v1',
  provenance: {
    kind: 'synthetic_fixture', fixtureId: 'fixture', fixtureHash: 'a'.repeat(64), label: 'Practice data',
  },
  heavy: {
    exposureType: 'heavy', repRange: { minimum: 6, maximum: 8 },
    targetRir: { minimum: 2, maximum: 3 }, restSeconds: 180,
  },
  volume: {
    exposureType: 'volume', repRange: { minimum: 10, maximum: 12 },
    targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
  },
}

describe('movement exposure scheduling', () => {
  it.each([
    [['monday', 'thursday'], ['full_body', 'full_body'], [0, 1, 2, 3]],
    [['monday', 'wednesday', 'friday'], ['full_body', 'full_body', 'full_body'], [0, 1, 2, 3, 4, 5]],
    [['monday', 'tuesday', 'thursday', 'friday'], ['upper', 'lower', 'upper', 'lower'], [0, 1, 2, 3]],
  ] as const)('counts each movement independently across %s', (weekdays, sessionTypes, expected) => {
    const days = weekdays.map((weekday, index) => ({
      weekday,
      sessionType: sessionTypes[index],
    })) as ScheduledStrengthDay[]
    const pattern = days[0].sessionType === 'upper' ? 'push' : 'knee_dominant'
    const actual: number[] = []
    for (let weekIndex = 0; actual.length < expected.length; weekIndex += 1) {
      days.forEach((day, sessionIndex) => {
        const isPresent = day.sessionType === 'full_body'
          || (day.sessionType === 'upper' && pattern === 'push')
          || (day.sessionType === 'lower' && pattern === 'knee_dominant')
        if (isPresent && actual.length < expected.length) {
          actual.push(movementOccurrenceIndex(days, pattern, weekIndex, sessionIndex))
        }
      })
    }
    expect(actual).toEqual(expected)
    expect(actual.map(index => undulatingExposureForOccurrence(template, index).exposureType))
      .toEqual(expected.map(index => index % 2 === 0 ? 'heavy' : 'volume'))
  })

  it('rejects positions that do not contain the movement', () => {
    const days: ScheduledStrengthDay[] = [
      { weekday: 'monday', sessionType: 'upper' },
      { weekday: 'tuesday', sessionType: 'lower' },
    ]
    expect(() => movementOccurrenceIndex(days, 'hinge', 0, 0)).toThrow('Movement is not authored')
    expect(() => movementOccurrenceIndex(days, 'push', -1, 0)).toThrow('Invalid movement occurrence')
  })
})
