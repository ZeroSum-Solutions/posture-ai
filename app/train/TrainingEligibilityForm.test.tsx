// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingEligibilityForm from './TrainingEligibilityForm'

afterEach(cleanup)
beforeEach(() => vi.unstubAllGlobals())

const subjectId = '11111111-1111-4111-8111-111111111111'
const savedAnswers = {
  schemaVersion: 'eligibility-answers.v1',
  questionnaireSourceVersion: 'preparticipation-inputs.v1-unvalidated',
  submittedAt: '2026-09-08T18:00:00.000Z',
  origin: { kind: 'athlete_self_report' },
  adultScope: 'confirmed_18_plus',
  currentActivity: 'regularly_active',
  knownConditions: { cardiovascular: 'no', metabolic: 'unknown', renal: 'no' },
  relevantSignsOrSymptoms: 'unknown',
  desiredIntensity: 'moderate',
  answerCertainty: 'uncertain',
  pregnancyPostpartumContext: 'prefer_not_to_say',
  requestedProgrammingScope: 'strength_or_general_fitness',
}

function projection(revision: number, answers = savedAnswers) {
  return {
    schemaVersion: 'training-eligibility-answers-projection.v1',
    subjectId,
    current: { revision, sourceRevisionId: `source-${revision}`, answers },
  }
}

describe('TrainingEligibilityForm', () => {
  it('starts every unanswered input at an explicit unknown or uncertain value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      schemaVersion: 'training-eligibility-answers-projection.v1',
      subjectId,
      current: null,
    })))

    render(<TrainingEligibilityForm />)

    await screen.findByText('No answers saved yet')
    expect((screen.getByLabelText('Are you 18 or older?') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('How active are you currently?') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Heart or circulation condition') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Metabolic condition') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Kidney condition') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Are you currently experiencing signs or symptoms that may affect exercise?') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Preferred training intensity') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Are these answers complete?') as HTMLSelectElement).value).toBe('uncertain')
    expect((screen.getByLabelText('Pregnancy or postpartum context') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('What kind of programming are you looking for?') as HTMLSelectElement).value).toBe('unknown')
  })

  it('sends only the exact answer fields and does not imply an eligibility decision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-eligibility-answers-projection.v1', subjectId, current: null,
      }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 'training-eligibility-answer-receipt.v1', subjectId,
        revision: 1, sourceRevisionId: 'source-1', status: 'answers_saved', decisionCreated: false,
      }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingEligibilityForm />)
    await screen.findByText('No answers saved yet')
    fireEvent.change(screen.getByLabelText('Are you 18 or older?'), { target: { value: 'confirmed_18_plus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save answers' }))

    await screen.findByText('Answers saved. This did not create a training decision.')
    const request = fetchMock.mock.calls[1]
    expect(request[0]).toBe('/api/training/eligibility/answers')
    expect(request[1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } })
    const body = JSON.parse(request[1].body)
    expect(body).toEqual({
      expectedRevision: 0,
      answers: {
        adultScope: 'confirmed_18_plus',
        currentActivity: 'unknown',
        knownConditions: { cardiovascular: 'unknown', metabolic: 'unknown', renal: 'unknown' },
        relevantSignsOrSymptoms: 'unknown',
        desiredIntensity: 'unknown',
        answerCertainty: 'uncertain',
        pregnancyPostpartumContext: 'unknown',
        requestedProgrammingScope: 'unknown',
      },
    })
    expect(body.answers).not.toHaveProperty('schemaVersion')
    expect(body.answers).not.toHaveProperty('origin')
    expect(body).not.toHaveProperty('subjectId')
    expect(screen.getByText('Saved response 1')).toBeTruthy()
  })

  it('hydrates every answer from the latest saved response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(projection(7))))

    render(<TrainingEligibilityForm />)

    await screen.findByText('Saved response 7')
    expect((screen.getByLabelText('Are you 18 or older?') as HTMLSelectElement).value).toBe('confirmed_18_plus')
    expect((screen.getByLabelText('How active are you currently?') as HTMLSelectElement).value).toBe('regularly_active')
    expect((screen.getByLabelText('Metabolic condition') as HTMLSelectElement).value).toBe('unknown')
    expect((screen.getByLabelText('Preferred training intensity') as HTMLSelectElement).value).toBe('moderate')
    expect((screen.getByLabelText('Pregnancy or postpartum context') as HTMLSelectElement).value).toBe('prefer_not_to_say')
    expect((screen.getByLabelText('What kind of programming are you looking for?') as HTMLSelectElement).value)
      .toBe('strength_or_general_fitness')
  })

  it('preserves edits on a revision conflict and reloads only after an explicit discard action', async () => {
    const latestAnswers = { ...savedAnswers, desiredIntensity: 'light' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(projection(2)))
      .mockResolvedValueOnce(Response.json({
        error: 'eligibility_answers_revision_conflict', action: 'refresh_answers',
      }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(projection(3, latestAnswers)))
    vi.stubGlobal('fetch', fetchMock)

    render(<TrainingEligibilityForm />)
    await screen.findByText('Saved response 2')
    fireEvent.change(screen.getByLabelText('Preferred training intensity'), { target: { value: 'vigorous' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save answers' }))

    await screen.findByText(/A newer saved response exists/)
    expect((screen.getByLabelText('Preferred training intensity') as HTMLSelectElement).value).toBe('vigorous')
    expect((screen.getByRole('button', { name: 'Save answers' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Discard edits and reload saved answers' }))
    await waitFor(() => {
      expect((screen.getByLabelText('Preferred training intensity') as HTMLSelectElement).value).toBe('light')
    })
    expect(screen.getByText('Saved response 3')).toBeTruthy()
  })
})
