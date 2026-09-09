// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TrainingProgramOptionsV1 } from '@/lib/training/contracts/program-options'
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
    supportedCycleLengths={[4, 6, 8, 12]}
    catalogState={{ status: 'pending', message: 'Reviewed strength catalog connection is pending.' }}
    {...overrides}
  />)
}

describe('StrengthProgramBuilder', () => {
  it('keeps live program creation unavailable until server-projected reviewed options load', async () => {
    setup({
      programContext: 'live',
      onLoadProgramOptions: async () => { throw new Error('Reviewed program catalog is not available yet.') },
      onBuildPracticeDraft: vi.fn(),
    })

    const button = screen.getByRole('button', { name: 'Build program draft' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect((await screen.findAllByText('Reviewed program catalog is not available yet.')).length).toBeGreaterThan(0)
    expect(button.disabled).toBe(true)
  })

  it('enables the live build action from a matching server-authored catalog projection', async () => {
    const onBuild = vi.fn(async () => ({
      schemaVersion: 'training-build-projection.v1' as const,
      buildId: null,
      result: { kind: 'invalid_cycle_start' } as never,
      calibrations: [],
    }))
    setup({
      programContext: 'live',
      onLoadProgramOptions: async (subjectId, profileRevision) => ({
        schemaVersion: 'training-program-options.v1', subjectId, profileRevision,
        executionContext: { kind: 'live' }, catalogVersion: 'authored.v1',
        catalogOrigin: { kind: 'authored_catalog' }, conditioningPreference: { status: 'required' },
        conditioningModes: [{ modalityId: 'walking.v1', label: 'Walking' }],
        exerciseOptions: [{
          exerciseVersionId: 'squat.v1', label: 'Squat',
          equipmentOptions: [{ equipmentId: 'dumbbells-1', basis: 'dumbbell_single_implement', unit: 'kg' }],
        }],
      }),
      onBuildPracticeDraft: onBuild,
    })

    const button = await screen.findByRole('button', { name: 'Build program draft' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(screen.getByText(/1 reviewed exercise variants available/)).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() => expect(onBuild).toHaveBeenCalledWith(expect.objectContaining({ subjectId: subject.id, profileRevision: 3 })))
  })

  it('ignores an obsolete draft failure after the cycle start date changes', async () => {
    let failOld!: (cause: Error) => void
    setup({ onBuildPracticeDraft: () => new Promise((_resolve, reject) => { failOld = reject }) })
    fireEvent.click(screen.getByRole('button', { name: 'Build practice draft' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    fireEvent.change(screen.getByLabelText('Cycle start date'), { target: { value: '2030-01-07' } })
    await act(async () => failOld(new Error('Old request failed')))
    expect(screen.queryByText('Practice draft could not be built. Try again.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Build practice draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps edits made during a profile save unsaved and uses the acknowledged revision for the next save', async () => {
    let acknowledge!: (outcome: SaveProfileOutcome) => void
    const onSaveProfile = vi.fn(() => new Promise<SaveProfileOutcome>(resolve => { acknowledge = resolve }))
    setup({ onSaveProfile })
    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: 'intermediate' } })
    await act(async () => acknowledge({ status: 'saved', revision: 4 }))
    expect(screen.getByText('Not saved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(onSaveProfile).toHaveBeenLastCalledWith({ expectedRevision: 4, profile: expect.objectContaining({ experience: 'intermediate' }) })
    await act(async () => acknowledge({ status: 'saved', revision: 5 }))
  })

  it('ignores a late catalog response from the previous saved profile revision', async () => {
    let finishOld!: (value: TrainingProgramOptionsV1) => void
    const projection = (profileRevision: number, label: string): TrainingProgramOptionsV1 => ({
      schemaVersion: 'training-program-options.v1', subjectId: subject.id, profileRevision,
      executionContext: { kind: 'live' }, catalogVersion: 'catalog.v1', catalogOrigin: { kind: 'authored_catalog' },
      conditioningPreference: { status: 'required' }, conditioningModes: [{ modalityId: 'walk.v1', label }], exerciseOptions: [],
    })
    const onLoadProgramOptions = vi.fn((_id: string, revision: number) => revision === 3
      ? new Promise<TrainingProgramOptionsV1>(resolve => { finishOld = resolve })
      : Promise.resolve(projection(revision, 'Current walking')))
    setup({ onLoadProgramOptions, onSaveProfile: async () => ({ status: 'saved', revision: 4 }) })
    fireEvent.change(screen.getByLabelText('Training goal'), { target: { value: 'strength' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Starting loads' }))
    await screen.findByRole('option', { name: 'Current walking' })
    await act(async () => finishOld(projection(3, 'Old walking')))
    expect(screen.queryByRole('option', { name: 'Old walking' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Current walking' })).toBeTruthy()
  })

  it('requires an explicit conditioning choice and refreshes catalog options after saving it', async () => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    const onLoadProgramOptions = vi.fn(async (subjectId: string, profileRevision: number) => ({
      schemaVersion: 'training-program-options.v1' as const, subjectId, profileRevision,
      executionContext: { kind: 'live' as const }, catalogVersion: 'catalog.v1',
      catalogOrigin: { kind: 'authored_catalog' as const }, conditioningPreference: { status: 'required' as const },
      conditioningModes: [{ modalityId: 'cycling.v1', label: 'Cycling' }], exerciseOptions: [],
    }))
    setup({ onSaveProfile, onLoadProgramOptions })
    fireEvent.click(screen.getByRole('tab', { name: 'Starting loads' }))
    const select = await screen.findByRole('combobox', { name: 'Preferred conditioning activity' })
    expect((select as HTMLSelectElement).value).toBe('')
    fireEvent.change(select, { target: { value: 'cycling.v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({ expectedRevision: 3, profile: expect.objectContaining({
      conditioningPreference: { schemaVersion: 'conditioning-preference.v1', catalogVersion: 'catalog.v1', preferredModalityIds: ['cycling.v1'] },
    }) }))
    await waitFor(() => expect(onLoadProgramOptions).toHaveBeenLastCalledWith(subject.id, 4))
  })

  it('saves optional recalled sets with the profile while preserving exact load and excluding progression evidence', async () => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    const initialProfile = createInitialStrengthProfile('America/Los_Angeles')
    initialProfile.equipmentInventory = [{ kind: 'dumbbell', equipmentId: 'db', unit: 'lb', perHandLoads: ['4.125'] }]
    setup({ initialProfile, onSaveProfile, startingHistoryOptions: [{
      exerciseVersionId: 'press.v1', label: 'Floor press',
      equipmentOptions: [{ equipmentId: 'db', basis: 'dumbbell_per_hand', unit: 'lb' }],
    }] })
    fireEvent.click(screen.getByRole('tab', { name: 'Starting loads' }))
    fireEvent.change(screen.getByLabelText('Exercise'), { target: { value: 'press.v1' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Equipment' }), { target: { value: JSON.stringify(['db', 'dumbbell_per_hand', 'lb']) } })
    fireEvent.change(screen.getByLabelText('Load (lb)'), { target: { value: '4.125' } })
    fireEvent.change(screen.getByLabelText('Repetitions'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add recent set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({
      expectedRevision: 3, profile: expect.objectContaining({ startingHistory: [expect.objectContaining({
        exerciseVersionId: 'press.v1', reps: 7, progressionEvidenceEligible: false,
        equipmentLoad: expect.objectContaining({ quantity: expect.objectContaining({ entered: { value: '4.125', unit: 'lb' } }) }),
      })] }),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove recent set 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(onSaveProfile).toHaveBeenLastCalledWith({
      expectedRevision: 4, profile: expect.objectContaining({ startingHistory: [] }),
    }))
  })

  it('offers heavy and volume programming only for intermediate experience and clears it when experience changes', () => {
    setup()
    expect(screen.queryByLabelText('Strength programming')).toBeNull()
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: 'intermediate' } })
    const style = screen.getByLabelText('Strength programming') as HTMLSelectElement
    expect(style.value).toBe('repeatable')
    fireEvent.change(style, { target: { value: 'intermediate_undulating' } })
    expect(style.value).toBe('intermediate_undulating')
    expect(screen.getByText(/Heavy and volume sessions keep separate starting loads/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: 'beginner' } })
    expect(screen.queryByLabelText('Strength programming')).toBeNull()
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: 'intermediate' } })
    expect((screen.getByLabelText('Strength programming') as HTMLSelectElement).value).toBe('repeatable')
  })

  it('uses compact visible tab copy while preserving full accessible names', () => {
    setup()

    expect(screen.getByRole('tab', { name: 'Equipment' }).textContent).toBe('Kit')
    expect(screen.getByRole('tab', { name: 'Starting loads' }).textContent).toBe('Loads')
  })

  it('shows the complete setup flow with every compiler-supported cycle and truthful integration state', () => {
    setup()

    expect(screen.getByRole('heading', { name: 'Build a strength program' })).toBeTruthy()
    expect(screen.getByText(subject.name)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Schedule' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Equipment' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Starting loads' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    expect(screen.getByRole('button', { name: '8 weeks Available' }).getAttribute('aria-pressed')).toBe('true')
    for (const weeks of [4, 6, 8, 12]) {
      expect((screen.getByRole('button', { name: `${weeks} weeks Available` }) as HTMLButtonElement).disabled).toBe(false)
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    expect(screen.getByText('Reviewed strength catalog connection is pending.')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Starting loads' }))
    expect(screen.getByText(/Starting-load acceptance becomes available after reviewed exercise variants are connected/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Profile saving is not connected yet.')).toBeTruthy()
  })

  it.each([4, 6, 12] as const)('selects and saves a %s-week cycle without changing its value', async (cycleLengthWeeks) => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    setup({ supportedCycleLengths: [4, 6, 8, 12], onSaveProfile })

    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    fireEvent.click(screen.getByRole('button', { name: `${cycleLengthWeeks} weeks Available` }))
    expect(screen.getByRole('button', { name: `${cycleLengthWeeks} weeks Available` }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({
      expectedRevision: 3,
      profile: expect.objectContaining({ cycleLengthWeeks }),
    }))
    expect(screen.getByText(`${cycleLengthWeeks}-week foundation`)).toBeTruthy()
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

  it('preserves exact barbell, microplate, collar, and machine-stack values when saving', async () => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    setup({ onSaveProfile })

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add barbell setup' }))
    fireEvent.change(screen.getByLabelText(/^Bar weight for barbell-1/), { target: { value: '20.00' } })
    fireEvent.change(screen.getByLabelText(/^Collars total weight for barbell-1/), { target: { value: '0.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add plate denomination for barbell-1' }))
    fireEvent.change(screen.getByLabelText(/^Plate weight 1 for barbell-1/), { target: { value: '1.25' } })
    fireEvent.change(screen.getByLabelText('Plate count 1 for barbell-1'), { target: { value: '4' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add machine stack' }))
    fireEvent.change(screen.getByLabelText('Unit for machine-1'), { target: { value: 'lb' } })
    fireEvent.change(screen.getByLabelText(/^Available stack weights for machine-1/), { target: { value: '10, 12.5, 15.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({
      expectedRevision: 3,
      profile: expect.objectContaining({
        equipmentInventory: [
          {
            kind: 'barbell', equipmentId: 'barbell-1', unit: 'kg',
            barWeight: '20.00', collarsTotalWeight: '0.50',
            plates: [{ value: '1.25', count: 4 }],
          },
          {
            kind: 'machine', equipmentId: 'machine-1', unit: 'lb',
            stackLoads: ['10', '12.5', '15.00'],
          },
        ],
      }),
    }))
  })

  it('preserves bodyweight external loads and assistance settings as distinct nonnegative inventories', async () => {
    const onSaveProfile = vi.fn(async (): Promise<SaveProfileOutcome> => ({ status: 'saved', revision: 4 }))
    setup({ onSaveProfile })

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add bodyweight external loads' }))
    fireEvent.change(screen.getByLabelText(/^Available added external loads for bodyweight-external-1/), {
      target: { value: '0, 2.5, 5.00' },
    })
    expect(screen.getByText(/body mass is never added/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add assistance machine' }))
    fireEvent.change(screen.getByLabelText('Unit for assistance-machine-1'), { target: { value: 'lb' } })
    fireEvent.change(screen.getByLabelText(/^Available assistance settings for assistance-machine-1/), {
      target: { value: '20, 30.5, 40' },
    })
    expect(screen.getByText(/Do not encode assistance as a negative load/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({
      expectedRevision: 3,
      profile: expect.objectContaining({
        equipmentInventory: [{
          kind: 'bodyweight_external', equipmentId: 'bodyweight-external-1', unit: 'kg',
          externalLoads: ['0', '2.5', '5.00'],
        }, {
          kind: 'assistance_machine', equipmentId: 'assistance-machine-1', unit: 'lb',
          assistanceLoads: ['20', '30.5', '40'],
        }],
      }),
    }))
    await screen.findByText('Saved · revision 4')

    fireEvent.change(screen.getByLabelText(/^Available assistance settings for assistance-machine-1/), {
      target: { value: '-20' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(onSaveProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Review the highlighted profile fields before saving.')).toBeTruthy()
  })

  it('does not save malformed plate precision', () => {
    const onSaveProfile = vi.fn()
    setup({ onSaveProfile })

    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add barbell setup' }))
    fireEvent.change(screen.getByLabelText(/^Bar weight for barbell-1/), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add plate denomination for barbell-1' }))
    fireEvent.change(screen.getByLabelText(/^Plate weight 1 for barbell-1/), { target: { value: '1.2345' } })
    fireEvent.change(screen.getByLabelText('Plate count 1 for barbell-1'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(onSaveProfile).not.toHaveBeenCalled()
    expect(screen.getByText('Review the highlighted profile fields before saving.')).toBeTruthy()
  })
})
