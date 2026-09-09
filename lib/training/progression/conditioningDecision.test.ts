import { describe, expect, it } from 'vitest'
import { decideConditioningProgression } from './conditioningDecision'
import type { ConditioningProgressionInputV1 } from '../contracts/conditioning-progression'

const source = (sessionId: string, date: string, overrides: Record<string, unknown> = {}) => ({
  sessionId, sessionRevision: 3, boutId: `bout-${sessionId}`, modalityId: 'walking.v1',
  scheduledLocalDate: date, sessionState: 'completed' as const,
  actual: { eventRevision: 1, durationSeconds: 600, perceivedEffort: 4, symptomState: 'none' as const },
  ...overrides,
})

function input(overrides: Partial<ConditioningProgressionInputV1> = {}): ConditioningProgressionInputV1 {
  return {
    schemaVersion: 'conditioning-progression-input.v1', subjectId: 'subject-1', assignmentId: 'assignment-1',
    assignmentRevision: 2, baseProgramRevisionNumber: 1, sourceProfileRevision: 1,
    sourceEligibilityRevisionId: 'eligibility-1', executionContext: { kind: 'live' },
    policy: {
      schemaVersion: 'conditioning-progression-policy.v1', policyVersion: 'conditioning-duration-v1',
      origin: {
        kind: 'synthetic_fixture', sourceVersion: 'conditioning-duration-policy-fixture.v1',
        fixtureId: 'synthetic-conditioning-duration-policy.v1', fixtureHash: 'a'.repeat(64),
        label: 'Synthetic conditioning duration policy',
      },
      modalityId: 'walking.v1', targetEffortMaximum: 4, maxIncreasePerBoutSeconds: 120,
      maxTotalWeeklyIncreaseSeconds: 240, maxBoutDurationSeconds: 1_800,
      maxPlannedWeeklyDurationSeconds: 3_600,
    },
    sourceBouts: [source('session-1', '2026-09-01'), source('session-2', '2026-09-04')],
    targetBouts: [
      { sessionId: 'session-3', sessionRevision: 1, boutId: 'bout-3', modalityId: 'walking.v1', scheduledLocalDate: '2026-09-08', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
      { sessionId: 'session-4', sessionRevision: 1, boutId: 'bout-4', modalityId: 'walking.v1', scheduledLocalDate: '2026-09-11', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
    ],
    plannedWeeklyDurationSeconds: 1_200,
    ...overrides,
  }
}

describe('conditioning duration progression decision', () => {
  it('adds one minute to each next bout after two comparable ten-minute completions', () => {
    expect(decideConditioningProgression(input())).toMatchObject({
      kind: 'duration_proposal', status: 'proposed', reason: 'two_comparable_bouts_completed',
      increaseSecondsPerBout: 60,
      targetBouts: [
        { sessionId: 'session-3', acceptedDurationSeconds: 660 },
        { sessionId: 'session-4', acceptedDurationSeconds: 660 },
      ],
    })
  })

  it.each([[600, 660], [1_200, 1_320], [1_740, 1_800]])('progresses two %i-second bouts to %i seconds without adding bouts (CO-03)', (duration, nextDuration) => {
    const value = input()
    value.sourceBouts = [
      source('session-1', '2026-09-01', { actual: { eventRevision: 1, durationSeconds: duration, perceivedEffort: 4, symptomState: 'none' } }),
      source('session-2', '2026-09-04', { actual: { eventRevision: 1, durationSeconds: duration, perceivedEffort: 4, symptomState: 'none' } }),
    ]
    value.targetBouts = value.targetBouts.map(bout => ({ ...bout, acceptedDurationSeconds: duration, authoredMaximumDurationSeconds: 1_800 }))
    value.plannedWeeklyDurationSeconds = duration * 2
    const before = structuredClone(value)
    const result = decideConditioningProgression(value)
    expect(result).toMatchObject({
      kind: 'duration_proposal', status: 'proposed',
      targetBouts: [
        { sessionId: 'session-3', acceptedDurationSeconds: nextDuration },
        { sessionId: 'session-4', acceptedDurationSeconds: nextDuration },
      ],
    })
    if (result.kind !== 'duration_proposal') throw new Error('Expected duration proposal')
    expect(result.targetBouts).toHaveLength(2)
    expect(value).toEqual(before)
  })

  it('holds two 30-minute bouts at the authored ceiling without changing frequency or targets', () => {
    const value = input()
    value.sourceBouts = value.sourceBouts.map(bout => ({
      ...bout,
      actual: { eventRevision: 1, durationSeconds: 1_800, perceivedEffort: 4, symptomState: 'none' },
    }))
    value.targetBouts = value.targetBouts.map(bout => ({ ...bout, acceptedDurationSeconds: 1_800, authoredMaximumDurationSeconds: 1_800 }))
    value.plannedWeeklyDurationSeconds = 3_600
    const before = structuredClone(value)
    expect(decideConditioningProgression(value)).toMatchObject({
      kind: 'hold', status: 'not_proposed', reason: 'no_whole_minute_available_hold',
    })
    expect(value).toEqual(before)
  })

  it('caps the step at two minutes and fits authored bout and weekly ceilings', () => {
    const long = input({
      sourceBouts: [source('session-1', '2026-09-01', { actual: { eventRevision: 1, durationSeconds: 1_200, perceivedEffort: 4, symptomState: 'none' } }), source('session-2', '2026-09-04', { actual: { eventRevision: 1, durationSeconds: 1_200, perceivedEffort: 4, symptomState: 'none' } })],
    })
    expect(decideConditioningProgression(long)).toMatchObject({ increaseSecondsPerBout: 120 })
    expect(decideConditioningProgression(input({
      plannedWeeklyDurationSeconds: 3_540,
    }))).toMatchObject({ kind: 'hold', reason: 'no_whole_minute_available_hold' })
  })

  it.each([
    ['source_incomplete_hold', { sourceBouts: [source('session-1', '2026-09-01'), source('session-2', '2026-09-04', { actual: null })] }],
    ['effort_unknown_hold', { sourceBouts: [source('session-1', '2026-09-01'), source('session-2', '2026-09-04', { actual: { eventRevision: 1, durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none' } })] }],
    ['effort_above_target_hold', { sourceBouts: [source('session-1', '2026-09-01'), source('session-2', '2026-09-04', { actual: { eventRevision: 1, durationSeconds: 600, perceivedEffort: 5, symptomState: 'none' } })] }],
    ['adverse_symptom_hold', { sourceBouts: [source('session-1', '2026-09-01'), source('session-2', '2026-09-04', { actual: { eventRevision: 1, durationSeconds: 600, perceivedEffort: 4, symptomState: 'adverse_reported' } })] }],
    ['modality_changed_recalibration', { targetBouts: [
      { sessionId: 'session-3', sessionRevision: 1, boutId: 'bout-3', modalityId: 'cycle.v1', scheduledLocalDate: '2026-09-08', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
      { sessionId: 'session-4', sessionRevision: 1, boutId: 'bout-4', modalityId: 'walking.v1', scheduledLocalDate: '2026-09-11', acceptedDurationSeconds: 600, authoredMaximumDurationSeconds: 1_200 },
    ] }],
  ])('fails closed with %s', (reason, overrides) => {
    expect(decideConditioningProgression(input(overrides as Partial<ConditioningProgressionInputV1>)))
      .toMatchObject({ kind: reason === 'modality_changed_recalibration' ? 'hold' : 'hold', status: 'not_proposed', reason })
  })

  it('is deterministic under source ordering and changes identity when source revisions change', () => {
    const original = decideConditioningProgression(input())
    const reordered = decideConditioningProgression(input({ sourceBouts: [...input().sourceBouts].reverse() }))
    expect(reordered.decisionKey).toBe(original.decisionKey)
    const changed = input()
    changed.sourceBouts[1].actual!.eventRevision = 2
    expect(decideConditioningProgression(changed).decisionKey).not.toBe(original.decisionKey)
  })
})
