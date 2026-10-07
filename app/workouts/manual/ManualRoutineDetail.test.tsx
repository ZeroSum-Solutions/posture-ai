// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), archive: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }), usePathname: () => '/workouts/manual/54000000-0000-4000-8000-000000000004' }))
vi.mock('./ManualRoutine.gateway', async original => {
  const actual = await original<typeof import('./ManualRoutine.gateway')>()
  return { ...actual, loadManualRoutine: mocks.load, updateManualRoutine: mocks.update, archiveManualRoutine: mocks.archive }
})
import { ManualRoutineConflictError } from './ManualRoutine.gateway'
import ManualRoutineDetail from './ManualRoutineDetail'

const display = {
  name: 'Dumbbell Romanian Deadlift', instructions: 'Hinge at the hips with one dumbbell in each hand.', equipment: ['Dumbbell'], media: null,
  source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/1652/', author: 'AlucardEvil40', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
}
const routine = {
  routineId: '54000000-0000-4000-8000-000000000004', subjectId: '54000000-0000-4000-8000-000000000003', revision: 1,
  status: 'active' as const, title: 'Original routine',
  source: { kind: 'manual_reference' as const, snapshotIds: ['wger-english-2026-09-08'], reviewStatus: 'reference_unreviewed' as const, screeningInfluence: 'none' as const },
  items: [{ itemId: '54000000-0000-4000-8000-000000000001', referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd', kind: 'strength' as const, sets: 3, reps: 8, load: { value: '12.50', unit: 'kg' as const }, exerciseDisplay: display }],
  updatedAt: '2026-09-08T00:00:00Z', archivedAt: null,
}

afterEach(cleanup)

describe('ManualRoutineDetail', () => {
  it('preserves edits on a revision conflict and explicitly loads the saved version', async () => {
    const current = { ...routine, revision: 2, title: 'Saved elsewhere' }
    mocks.load.mockResolvedValue(routine)
    mocks.update.mockRejectedValue(new ManualRoutineConflictError(current as never))
    render(<ManualRoutineDetail routineId={routine.routineId} availableExercises={[]} />)

    await screen.findByText('Original routine')
    expect(screen.queryByRole('link', { name: 'All manual routines' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: 'My unsaved edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('button', { name: 'Load latest saved version' })
    expect(screen.getByRole('textbox', { name: 'Routine name' }).getAttribute('value')).toBe('My unsaved edit')
    fireEvent.click(screen.getByRole('button', { name: 'Load latest saved version' }))
    expect(screen.getByText('Saved elsewhere')).toBeTruthy()
  })

  it('prevents duplicate archive requests while the mutation is pending', async () => {
    let finish: (() => void) | undefined
    mocks.load.mockResolvedValue(routine)
    mocks.archive.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    render(<ManualRoutineDetail routineId={routine.routineId} availableExercises={[]} />)
    await screen.findByText('Original routine')

    const button = screen.getByRole('button', { name: 'Archive routine' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.archive).toHaveBeenCalledTimes(1)
    finish?.()
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/workouts/manual'))
  })
})
