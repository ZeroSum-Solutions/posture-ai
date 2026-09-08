// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PracticeDraftPanel from './PracticeDraftPanel'
import type { StartingTargetsSelection, TrainingBuildProjection } from './StrengthBuilder.gateway'

afterEach(cleanup)

const quantity = { entered: { value: '7.5', unit: 'kg' as const }, canonicalKg: '7.5' }
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '10000000-0000-4000-8000-000000000001',
  fixtureId: 'fixture-1',
  fixtureHash: 'a'.repeat(64),
  label: 'Practice data' as const,
}
const phasesByCycleLength = {
  4: ['calibration', 'build', 'build', 'review'],
  6: ['calibration', 'build', 'build', 'review_adjust', 'build', 'review'],
  8: ['calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review'],
  12: ['calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review'],
} as const

function createWeeks(cycleLengthWeeks: keyof typeof phasesByCycleLength) {
  return phasesByCycleLength[cycleLengthWeeks].map((phase, index) => ({
    week: index + 1,
    phase,
    strengthSessions: [{ sessionId: `session-${index + 1}`, exercises: [] }],
    conditioningBouts: [
      {
        boutId: `bout-${index + 1}-tuesday`, modalityId: 'walking.v1', weekday: 'tuesday',
        scheduledLocalDate: `2026-09-${String(15 + index * 7).padStart(2, '0')}`, athleteTimezone: 'America/Los_Angeles',
        durationOfferSeconds: 600, allowedDurationSeconds: { minimum: 60, maximum: 1_200 },
        effortCue: 'Keep a conversational pace.', status: 'requires_explicit_acceptance',
      },
      {
        boutId: `bout-${index + 1}-saturday`, modalityId: 'walking.v1', weekday: 'saturday',
        scheduledLocalDate: `2026-09-${String(19 + index * 7).padStart(2, '0')}`, athleteTimezone: 'America/Los_Angeles',
        durationOfferSeconds: 600, allowedDurationSeconds: { minimum: 60, maximum: 1_200 },
        effortCue: 'Keep a conversational pace.', status: 'requires_explicit_acceptance',
      },
    ],
  }))
}

function createProjection(cycleLengthWeeks: keyof typeof phasesByCycleLength = 8): TrainingBuildProjection {
  return {
  schemaVersion: 'training-build-projection.v1',
  buildId: '20000000-0000-4000-8000-000000000001',
  result: {
    kind: 'draft_program', executionContext: context, schemaVersion: 'compiled-program.v1',
    compilerPolicyVersion: 'strength-cycle-compiler.v3', status: 'requires_explicit_acceptance',
    subjectId: 'subject-1', profileRevisionId: '3', programRevisionId: 'program-1',
    catalogVersion: 'catalog-1', catalogOrigin: { kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'fixture-1', fixtureHash: 'a'.repeat(64), label: 'Synthetic catalog' },
    goal: 'strength', cycleStartLocalDate: '2026-09-14', cycleLengthWeeks,
    athleteTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 45,
    scheduleKind: 'full_body', weeks: createWeeks(cycleLengthWeeks),
  },
  calibrations: [
    { exerciseLabel: 'Synthetic goblet squat', calibration: { schemaVersion: 'initial-load-calibration.v1', status: 'requires_explicit_acceptance', subjectId: 'subject-1', profileRevisionId: '3', programRevisionId: 'program-1', catalogVersion: 'catalog-1', exerciseInstanceId: 'goblet-1', exerciseVersionId: 'goblet.v1', executionContext: context, loadBasis: 'dumbbell_single_implement', options: [{ equipmentId: 'dumbbells', basis: 'dumbbell_single_implement', quantity }] } },
    { exerciseLabel: 'Synthetic two-dumbbell row', calibration: { schemaVersion: 'initial-load-calibration.v1', status: 'requires_explicit_acceptance', subjectId: 'subject-1', profileRevisionId: '3', programRevisionId: 'program-1', catalogVersion: 'catalog-1', exerciseInstanceId: 'row-1', exerciseVersionId: 'row.v1', executionContext: context, loadBasis: 'dumbbell_per_hand', options: [{ equipmentId: 'dumbbells', basis: 'dumbbell_per_hand', quantity }] } },
  ],
  } as unknown as TrainingBuildProjection
}

const projection = createProjection()

describe('PracticeDraftPanel', () => {
  it.each([
    { cycleLengthWeeks: 4 as const, visiblePhases: ['Familiarization', 'Progressive practice', 'Next-cycle review'] },
    { cycleLengthWeeks: 6 as const, visiblePhases: ['Familiarization', 'Progressive practice', 'Review and adjust', 'Next-cycle review'] },
    { cycleLengthWeeks: 12 as const, visiblePhases: ['Familiarization', 'Progressive practice', 'Review and adjust', 'Next-cycle review'] },
  ])('renders the compiler-provided phases for a $cycleLengthWeeks-week draft', ({ cycleLengthWeeks, visiblePhases }) => {
    render(<PracticeDraftPanel projection={createProjection(cycleLengthWeeks)} />)

    expect(screen.getByRole('heading', { name: `${cycleLengthWeeks}-week draft` })).toBeTruthy()
    expect(screen.getByLabelText(`${cycleLengthWeeks}-week schedule preview`).children).toHaveLength(cycleLengthWeeks)
    for (const phase of visiblePhases) expect(screen.getAllByText(phase).length).toBeGreaterThan(0)
  })

  it('sends one bounded starting-target selection without calibration or draft authority', async () => {
    const onAcceptTargets = vi.fn(async (input: StartingTargetsSelection) => {
      void input
      return { status: 'accepted' as const, draftId: 'draft-1' }
    })
    const onPublishDraft = vi.fn(async () => {
      return {
        status: 'accepted' as const,
        draftId: 'draft-1',
        assignmentId: 'assignment-1',
        firstStrengthSessionId: 'strength-session-1',
        firstConditioningSessionId: 'conditioning-session-1',
      }
    })
    render(<PracticeDraftPanel projection={projection} onAcceptTargets={onAcceptTargets} onPublishDraft={onPublishDraft} />)

    expect(screen.getByText('7.5 kg · one dumbbell total')).toBeTruthy()
    expect(screen.getByText('7.5 kg per hand · two dumbbells')).toBeTruthy()
    expect(screen.getAllByText(/strength · 2 conditioning/)).toHaveLength(8)
    expect(screen.getByText('2 weekly slots')).toBeTruthy()
    expect(screen.getByText('Tuesday · Sep 15')).toBeTruthy()
    expect(screen.getAllByText('Keep a conversational pace.')).toHaveLength(2)
    const durations = screen.getAllByRole('spinbutton', { name: 'Duration in minutes' })
    expect(durations).toHaveLength(2)
    fireEvent.change(durations[0], { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use these starting targets' }))

    await waitFor(() => expect(screen.getByText('Starting targets accepted and program created.')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Open first strength session' }).getAttribute('href')).toBe('/workouts?training_session_id=strength-session-1')
    expect(screen.getByRole('link', { name: 'Open first conditioning session' }).getAttribute('href')).toBe('/workouts?training_session_id=conditioning-session-1')
    expect(onAcceptTargets).toHaveBeenCalledWith({
      loadChoices: [
        { exerciseInstanceId: 'goblet-1', optionIndex: 0 },
        { exerciseInstanceId: 'row-1', optionIndex: 0 },
      ],
      conditioningChoices: [
        { boutId: 'bout-1-tuesday', acceptedDurationSeconds: 720 },
        { boutId: 'bout-1-saturday', acceptedDurationSeconds: 600 },
      ],
    })
    expect(onAcceptTargets.mock.calls[0][0]).not.toHaveProperty('calibration')
    expect(onAcceptTargets.mock.calls[0][0]).not.toHaveProperty('draft')
    expect(onPublishDraft).toHaveBeenCalledWith('draft-1')
  })

  it('retries publishing the same accepted draft without accepting different choices again', async () => {
    const onAcceptTargets = vi.fn(async () => ({ status: 'accepted' as const, draftId: 'draft-1' }))
    const onPublishDraft = vi.fn()
      .mockRejectedValueOnce(new Error('publish unavailable'))
      .mockResolvedValueOnce({
        status: 'accepted' as const,
        draftId: 'draft-1',
        assignmentId: 'assignment-1',
        firstStrengthSessionId: null,
        firstConditioningSessionId: null,
      })
    render(<PracticeDraftPanel projection={projection} onAcceptTargets={onAcceptTargets} onPublishDraft={onPublishDraft} />)

    fireEvent.click(screen.getByRole('button', { name: 'Use these starting targets' }))
    await screen.findByRole('button', { name: 'Retry publishing accepted draft' })
    expect(screen.getByRole('alert').textContent).toMatch(/accepted, but the program was not published/i)
    expect((screen.getAllByRole('combobox', { name: 'Starting load' })[0] as HTMLSelectElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Retry publishing accepted draft' }))
    await screen.findByText('Starting targets accepted and program created.')
    expect(onAcceptTargets).toHaveBeenCalledTimes(1)
    expect(onPublishDraft).toHaveBeenCalledTimes(2)
    expect(onPublishDraft).toHaveBeenNthCalledWith(1, 'draft-1')
    expect(onPublishDraft).toHaveBeenNthCalledWith(2, 'draft-1')
  })
})
