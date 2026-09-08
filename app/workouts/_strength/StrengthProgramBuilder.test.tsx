// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialStrengthProfile } from './StrengthBuilder.model'
import StrengthProgramBuilder, { type SaveProfileOutcome } from './StrengthProgramBuilder'

const subject = {
  id: 'subject-1',
  name: 'Alexandra With An Intentionally Long Athlete Display Name',
}

afterEach(cleanup)

function setup(overrides: Partial<ComponentProps<typeof StrengthProgramBuilder>> = {}) {
  return render(<StrengthProgramBuilder
    subject={subject}
    initialProfile={createInitialStrengthProfile('America/Los_Angeles')}
    initialRevision={3}
    supportedCycleLengths={[8]}
    catalogState={{ status: 'pending', message: 'Reviewed strength catalog connection is pending.' }}
    {...overrides}
  />)
}

describe('StrengthProgramBuilder', () => {
  it('uses compact visible tab copy while preserving full accessible names', () => {
    setup()

    expect(screen.getByRole('tab', { name: 'Equipment' }).textContent).toBe('Kit')
    expect(screen.getByRole('tab', { name: 'Starting loads' }).textContent).toBe('Loads')
  })

  it('shows the complete setup flow while marking unsupported cycles and integrations truthfully', () => {
    setup()

    expect(screen.getByRole('heading', { name: 'Build a strength program' })).toBeTruthy()
    expect(screen.getByText(subject.name)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Schedule' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Equipment' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Starting loads' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    expect(screen.getByRole('button', { name: '8 weeks Available' }).getAttribute('aria-pressed')).toBe('true')
    for (const weeks of [4, 6, 12]) {
      expect((screen.getByRole('button', { name: `${weeks} weeks Planned` }) as HTMLButtonElement).disabled).toBe(true)
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    expect(screen.getByText('Reviewed strength catalog connection is pending.')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Starting loads' }))
    expect(screen.getByText(/Starting-load acceptance becomes available after reviewed exercise variants are connected/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Profile saving is not connected yet.')).toBeTruthy()
  })

  it('shows saving and enters saved only after the server acknowledges the profile revision', async () => {
    let resolveSave: ((outcome: SaveProfileOutcome) => void) | undefined
    const onSaveProfile = vi.fn(() => new Promise<SaveProfileOutcome>((resolve) => {
      resolveSave = resolve
    }))
    setup({ onSaveProfile })

    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    expect(screen.getByText('Not saved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect((screen.getByRole('button', { name: 'Saving profile…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onSaveProfile).toHaveBeenCalledWith({
      expectedRevision: 3,
      profile: expect.objectContaining({ goal: 'strength' }),
    })

    resolveSave?.({ status: 'saved', revision: 4 })
    await waitFor(() => expect(screen.getByText('Saved · revision 4')).toBeTruthy())
  })

  it('keeps edits visible and offers the current revision when profile saving conflicts', async () => {
    const current = createInitialStrengthProfile('America/New_York')
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({
      status: 'conflict',
      current: { revision: 7, profile: current },
    }))
    setup({ onSaveProfile })

    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Profile changed elsewhere'))
    expect(screen.getByRole('button', { name: 'Load revision 7' })).toBeTruthy()
    expect((screen.getByLabelText('Training goal') as HTMLSelectElement).value).toBe('strength')

    fireEvent.click(screen.getByRole('button', { name: 'Load revision 7' }))
    expect((screen.getByLabelText('Local timezone') as HTMLInputElement).value).toBe('America/New_York')
    expect(screen.getByText('Loaded · revision 7')).toBeTruthy()
  })

  it('blocks profile persistence when shared-schema validation fails', async () => {
    const onSaveProfile = vi.fn()
    setup({ onSaveProfile })

    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(onSaveProfile).not.toHaveBeenCalled()
    expect(screen.getByText('Choose at least two strength days before saving.')).toBeTruthy()
  })

  it('preserves exact dumbbell denominations for server-side practice compilation', async () => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    const onBuildPracticeDraft = vi.fn(async () => ({
      schemaVersion: 'training-build-projection.v1' as const,
      buildId: null,
      result: {
        kind: 'needs_template_adjustment' as const,
        reason: 'required_movement_unavailable' as const,
        missingMovementPatterns: ['push' as const],
        executionContext: {
          kind: 'synthetic_simulation' as const,
          simulationRunId: 'sim-1',
          fixtureId: 'fixture-1',
          fixtureHash: 'a'.repeat(64),
          label: 'Practice data' as const,
        },
      },
      calibrations: [],
    }))
    setup({ onSaveProfile, onBuildPracticeDraft })

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add dumbbell set' }))
    fireEvent.change(screen.getByLabelText(/Available weights per dumbbell/), { target: { value: '2.5, 5, 7.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(screen.getByText('Saved · revision 4')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Build practice draft' }))

    await waitFor(() => expect(onBuildPracticeDraft).toHaveBeenCalledTimes(1))
    expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        equipmentInventory: [expect.objectContaining({
          kind: 'dumbbell',
          perHandLoads: ['2.5', '5', '7.5'],
        })],
      }),
    }))
    expect(onBuildPracticeDraft).toHaveBeenCalledWith({
      subjectId: 'subject-1',
      profileRevision: 4,
      cycleStartLocalDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})
