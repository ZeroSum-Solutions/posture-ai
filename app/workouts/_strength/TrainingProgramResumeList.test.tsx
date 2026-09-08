// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainingProgramResumeList from './TrainingProgramResumeList'

const request = vi.hoisted(() => vi.fn())
vi.mock('./StrengthBuilder.gateway', async importOriginal => ({
  ...(await importOriginal<typeof import('./StrengthBuilder.gateway')>()),
  requestTrainingPrograms: request,
}))

afterEach(cleanup)

describe('TrainingProgramResumeList', () => {
  it('labels simulations as Practice data and links resumable strength and conditioning sessions', async () => {
    request.mockResolvedValue({
      schemaVersion: 'training-program-list.v1', subjectId: 'subject-1',
      programs: [{
        id: 'assignment-1', subject_id: 'subject-1', program_mode: 'coach_assigned', simulation_run_id: 'simulation-1',
        status: 'active', created_at: '2026-09-14T00:00:00Z',
        sessions: [
          { id: 'strength-1', session_kind: 'strength', state: 'in_progress', scheduled_local_date: '2026-09-14', athlete_timezone: 'UTC', revision: 2 },
          { id: 'conditioning-1', session_kind: 'conditioning', state: 'scheduled', scheduled_local_date: '2026-09-15', athlete_timezone: 'UTC', revision: 1 },
        ],
      }],
    })

    render(<TrainingProgramResumeList subjectId="subject-1" />)

    await screen.findByText('Practice data')
    expect(screen.getByRole('link', { name: 'Resume strength · 2026-09-14' }).getAttribute('href')).toBe('/workouts?training_session_id=strength-1')
    expect(screen.getByRole('link', { name: 'Open conditioning · 2026-09-15' }).getAttribute('href')).toBe('/workouts?training_session_id=conditioning-1')
  })

  it('uses the athlete workspace for athlete session links', async () => {
    request.mockResolvedValue({
      schemaVersion: 'training-program-list.v1', subjectId: 'subject-1',
      programs: [{
        id: 'assignment-1', subject_id: 'subject-1', program_mode: 'self_directed', simulation_run_id: null,
        status: 'active', created_at: '2026-09-14T00:00:00Z',
        sessions: [
          { id: 'strength-1', session_kind: 'strength', state: 'scheduled', scheduled_local_date: '2026-09-14', athlete_timezone: 'UTC', revision: 1 },
        ],
      }],
    })

    render(<TrainingProgramResumeList subjectId="subject-1" sessionHrefBase="/train" />)

    expect((await screen.findByRole('link', { name: 'Open strength · 2026-09-14' })).getAttribute('href'))
      .toBe('/train?training_session_id=strength-1')
  })
})
