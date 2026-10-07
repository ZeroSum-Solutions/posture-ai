// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./ManualRoutine.gateway', () => ({ loadManualRoutines: mocks.load }))
import ManualRoutineList from './ManualRoutineList'

afterEach(cleanup)
beforeEach(() => mocks.load.mockReset())

describe('ManualRoutineList', () => {
  it('loads only the canonical subject and links to durable routine IDs', async () => {
    const subjectId = '54000000-0000-4000-8000-000000000003'
    mocks.load.mockResolvedValue({
      routines: [{ routineId: '54000000-0000-4000-8000-000000000004', subjectId, revision: 1, status: 'active', title: 'Saturday basics', itemCount: 2, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null }],
      hasMore: false,
      nextCursor: null,
    })
    render(<ManualRoutineList subjectId={subjectId} />)

    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(subjectId))
    expect(screen.getByText('Saturday basics')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Saturday basics' }).getAttribute('href')).toBe('/workouts/manual/54000000-0000-4000-8000-000000000004')
  })

  it('loads another opaque page and deduplicates routine IDs while preserving server updates', async () => {
    const subjectId = '54000000-0000-4000-8000-000000000003'
    mocks.load
      .mockResolvedValueOnce({
        routines: [
          { routineId: '54000000-0000-4000-8000-000000000004', subjectId, revision: 1, status: 'active', title: 'Saturday basics', itemCount: 2, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null },
          { routineId: '54000000-0000-4000-8000-000000000005', subjectId, revision: 1, status: 'active', title: 'Travel', itemCount: 1, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null },
        ],
        hasMore: true,
        nextCursor: 'cGFnZS0y',
      })
      .mockResolvedValueOnce({
        routines: [
          { routineId: '54000000-0000-4000-8000-000000000005', subjectId, revision: 2, status: 'active', title: 'Travel updated', itemCount: 2, updatedAt: '2026-09-08T01:00:00Z', archivedAt: null },
          { routineId: '54000000-0000-4000-8000-000000000006', subjectId, revision: 1, status: 'active', title: 'Sunday walk', itemCount: 1, updatedAt: '2026-09-08T00:30:00Z', archivedAt: null },
        ],
        hasMore: false,
        nextCursor: null,
      })

    render(<ManualRoutineList subjectId={subjectId} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more routines' }))

    await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(subjectId, 'cGFnZS0y'))
    expect(await screen.findByText('Travel updated')).toBeTruthy()
    expect(screen.queryByText('Travel')).toBeNull()
    expect(screen.getByText('Sunday walk')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /^Open /u })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Load more routines' })).toBeNull()
  })

  it('keeps loaded routines on a page error and resets immediately when the subject changes', async () => {
    const firstSubject = '54000000-0000-4000-8000-000000000003'
    const secondSubject = '54000000-0000-4000-8000-000000000007'
    mocks.load
      .mockResolvedValueOnce({
        routines: [{ routineId: '54000000-0000-4000-8000-000000000004', subjectId: firstSubject, revision: 1, status: 'active', title: 'First athlete routine', itemCount: 2, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null }],
        hasMore: true,
        nextCursor: 'b3BhcXVlLW5leHQ',
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        routines: [{ routineId: '54000000-0000-4000-8000-000000000008', subjectId: secondSubject, revision: 1, status: 'active', title: 'Second athlete routine', itemCount: 1, updatedAt: '2026-09-08T00:00:00Z', archivedAt: null }],
        hasMore: false,
        nextCursor: null,
      })

    const view = render(<ManualRoutineList subjectId={firstSubject} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more routines' }))
    expect((await screen.findByRole('alert')).textContent).toContain('More routines could not be loaded')
    expect(screen.getByText('First athlete routine')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry loading more' })).toBeTruthy()

    view.rerender(<ManualRoutineList subjectId={secondSubject} />)
    expect(screen.getByRole('status').textContent).toContain('Loading manual routines')
    expect(screen.queryByText('First athlete routine')).toBeNull()
    expect(await screen.findByText('Second athlete routine')).toBeTruthy()
    expect(mocks.load).toHaveBeenLastCalledWith(secondSubject)
  })
})
