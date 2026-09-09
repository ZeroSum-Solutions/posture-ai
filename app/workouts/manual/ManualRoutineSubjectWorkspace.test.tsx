// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), createAttempt: vi.fn(), create: vi.fn(), load: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('./ManualRoutine.gateway', () => ({
  resolveManualRoutineSubject: mocks.resolve,
  createManualRoutineAttempt: mocks.createAttempt,
  createManualRoutine: mocks.create,
  loadManualRoutines: mocks.load,
  ManualRoutineCreateError: class ManualRoutineCreateError extends Error {
    constructor(message: string, readonly uncertain: boolean) {
      super(message)
    }
  },
}))
import ManualRoutineSubjectWorkspace from './ManualRoutineSubjectWorkspace'
import { ManualRoutineCreateError } from './ManualRoutine.gateway'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const exercise = {
  id: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69', name: 'Dumbbell Goblet Squat', category: 'legs', equipment: ['Dumbbell'],
  instructions: 'Hold one dumbbell at chest height and squat with control.', media: null,
  source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/203/', author: 'Source author', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
}

function fillRoutine(title = 'Saturday basics') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: title } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Sets for Dumbbell Goblet Squat' }), { target: { value: '3' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Reps for Dumbbell Goblet Squat' }), { target: { value: '8' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Load for Dumbbell Goblet Squat' }), { target: { value: '12.5' } })
}

describe('ManualRoutineSubjectWorkspace', () => {
  it('resolves a legacy client selector to a distinct canonical subject before listing routines', async () => {
    const clientId = '54000000-0000-4000-8000-000000000010'
    const subjectId = '54000000-0000-4000-8000-000000000011'
    mocks.resolve.mockResolvedValue(subjectId)
    mocks.load.mockResolvedValue({ routines: [], hasMore: false, nextCursor: null })
    render(<ManualRoutineSubjectWorkspace identity={{ kind: 'practitioner', clients: [{ id: clientId, name: 'Alex Rivera' }] }} mode="list" />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Client' }), { target: { value: clientId } })
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(clientId, expect.any(AbortSignal)))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(subjectId))
    expect(mocks.load).not.toHaveBeenCalledWith(clientId)
    expect(await screen.findByRole('heading', { name: 'No manual routines yet' })).toBeTruthy()
  })

  it('retries an ambiguous create with one frozen attempt while editing and subject switching stay locked', async () => {
    const clientId = '54000000-0000-4000-8000-000000000010'
    const subjectId = '54000000-0000-4000-8000-000000000011'
    const attempt = { requestId: '54000000-0000-4000-8000-000000000012', subjectId, input: {}, body: '{}' }
    mocks.resolve.mockResolvedValue(subjectId)
    mocks.createAttempt.mockReturnValue(attempt)
    mocks.create.mockRejectedValueOnce(new ManualRoutineCreateError('Routine save outcome is uncertain.', true))
      .mockResolvedValueOnce({ routineId: '54000000-0000-4000-8000-000000000013', subjectId })
    render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'practitioner', clients: [{ id: clientId, name: 'Alex Rivera' }] }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    const picker = screen.getByRole('combobox', { name: 'Client' }) as HTMLSelectElement
    fireEvent.change(picker, { target: { value: clientId } })
    await screen.findByRole('textbox', { name: 'Routine name' })
    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await screen.findByText('Routine save outcome is uncertain.')
    expect(picker.disabled).toBe(true)
    expect((screen.getByRole('textbox', { name: 'Routine name' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Retry original save' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls[0][0]).toBe(attempt)
    expect(mocks.create.mock.calls[1][0]).toBe(attempt)
    expect(mocks.createAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.push).toHaveBeenCalledWith('/workouts/manual/54000000-0000-4000-8000-000000000013')
  })

  it('unlocks a deterministically rejected attempt so edited input gets a distinct request identity', async () => {
    const first = { requestId: '54000000-0000-4000-8000-000000000012', subjectId: '54000000-0000-4000-8000-000000000011', input: {}, body: '{}' }
    const second = { ...first, requestId: '54000000-0000-4000-8000-000000000014' }
    mocks.createAttempt.mockReturnValueOnce(first).mockReturnValueOnce(second)
    mocks.create.mockRejectedValueOnce(new ManualRoutineCreateError('Review the routine name and every exercise target.', false))
      .mockResolvedValueOnce({ routineId: '54000000-0000-4000-8000-000000000015', subjectId: first.subjectId })
    render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: first.subjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await screen.findByText('Review the routine name and every exercise target.')
    expect((screen.getByRole('textbox', { name: 'Routine name' }) as HTMLInputElement).disabled).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: 'Edited routine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls[1][0]).toBe(second)
    expect(mocks.createAttempt.mock.calls[1][1]).toMatchObject({ title: 'Edited routine' })
  })

  it('does not navigate when a create receipt arrives after the workspace unmounts', async () => {
    let finish: ((value: { routineId: string; subjectId: string }) => void) | undefined
    const subjectId = '54000000-0000-4000-8000-000000000011'
    mocks.createAttempt.mockReturnValue({ requestId: '54000000-0000-4000-8000-000000000012', subjectId, input: {}, body: '{}' })
    mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    view.unmount()
    finish?.({ routineId: '54000000-0000-4000-8000-000000000015', subjectId })
    await Promise.resolve()

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not navigate a late create receipt after the authenticated identity changes', async () => {
    let finish: ((value: { routineId: string; subjectId: string }) => void) | undefined
    const firstSubjectId = '54000000-0000-4000-8000-000000000011'
    mocks.createAttempt.mockReturnValue({ requestId: '54000000-0000-4000-8000-000000000012', subjectId: firstSubjectId, body: '{}' })
    mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: firstSubjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    view.rerender(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: '54000000-0000-4000-8000-000000000099', name: 'Morgan Lee' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)
    await Promise.resolve()
    finish?.({ routineId: '54000000-0000-4000-8000-000000000015', subjectId: firstSubjectId })
    await Promise.resolve()

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('hides an idle workspace when the authenticated identity changes without a remount', () => {
    const firstSubjectId = '54000000-0000-4000-8000-000000000011'
    const view = render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: firstSubjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    expect(screen.getByRole('textbox', { name: 'Routine name' })).toBeTruthy()
    view.rerender(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: '54000000-0000-4000-8000-000000000099', name: 'Morgan Lee' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    expect(screen.getByRole('alert').textContent).toBe('The signed-in training account changed. Return to manual routines before continuing.')
    expect(screen.queryByRole('textbox', { name: 'Routine name' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save routine' })).toBeNull()
  })

  it('navigates after a successful save when mounted under Strict Mode', async () => {
    const subjectId = '54000000-0000-4000-8000-000000000011'
    mocks.createAttempt.mockReturnValue({ requestId: '54000000-0000-4000-8000-000000000012', subjectId, body: '{}' })
    mocks.create.mockResolvedValue({ routineId: '54000000-0000-4000-8000-000000000015', subjectId })
    render(<StrictMode><ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    /></StrictMode>)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/workouts/manual/54000000-0000-4000-8000-000000000015'))
  })

  it('surfaces a deterministic retry rejection and unlocks the frozen draft', async () => {
    const subjectId = '54000000-0000-4000-8000-000000000011'
    mocks.createAttempt.mockReturnValue({ requestId: '54000000-0000-4000-8000-000000000012', subjectId, body: '{}' })
    mocks.create
      .mockRejectedValueOnce(new ManualRoutineCreateError('Routine save outcome is uncertain.', true))
      .mockRejectedValueOnce(new ManualRoutineCreateError('Review the routine name and every exercise target.', false))
    render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry original save' }))

    expect(await screen.findByText('Review the routine name and every exercise target.', { exact: true })).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save routine' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('button', { name: 'Retry original save' })).toBeNull()
  })

  it('rejects retrying an uncertain attempt after the authenticated identity changes', async () => {
    const firstSubjectId = '54000000-0000-4000-8000-000000000011'
    const attempt = { requestId: '54000000-0000-4000-8000-000000000012', subjectId: firstSubjectId, body: '{}' }
    mocks.createAttempt.mockReturnValue(attempt)
    mocks.create.mockRejectedValueOnce(new ManualRoutineCreateError('Routine save outcome is uncertain.', true))
    const view = render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: firstSubjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await screen.findByRole('button', { name: 'Retry original save' })
    view.rerender(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId: '54000000-0000-4000-8000-000000000099', name: 'Morgan Lee' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)
    expect(await screen.findByText('The signed-in training account changed. Return to manual routines before continuing.', { exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry original save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save routine' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Routine name' })).toBeNull()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.createAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shares one in-flight create attempt across reentrant save events', async () => {
    let finish: ((value: { routineId: string; subjectId: string }) => void) | undefined
    const subjectId = '54000000-0000-4000-8000-000000000011'
    mocks.createAttempt.mockReturnValue({ requestId: '54000000-0000-4000-8000-000000000012', subjectId, body: '{}' })
    mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<ManualRoutineSubjectWorkspace
      identity={{ kind: 'athlete', subjectId, name: 'Alex Rivera' }}
      mode="create" exercises={[exercise]} availableExercises={[exercise]}
    />)

    fillRoutine()
    const save = screen.getByRole('button', { name: 'Save routine' })
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.createAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    finish?.({ routineId: '54000000-0000-4000-8000-000000000015', subjectId })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1))
  })
})
