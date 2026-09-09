// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  erase: vi.fn(),
  activateUser: vi.fn(),
  randomUUID: vi.fn(() => '77000000-0000-4000-8000-000000000001'),
}))
vi.mock('./TrainingSubjectErasure.gateway', () => ({ eraseTrainingSubject: state.erase }))
vi.mock('@/lib/training/offline', () => ({
  getTrainingOfflineBrowserOutbox: () => ({ activateUser: state.activateUser }),
}))

import TrainingSubjectErasure from './TrainingSubjectErasure'

afterEach(cleanup)

const userId = '71000000-0000-4000-8000-000000000001'
const subjectId = '72000000-0000-4000-8000-000000000001'
const stableRequestId = '77000000-0000-4000-8000-000000000001'

function confirm() {
  fireEvent.click(screen.getByLabelText(/remove my saved programs/i))
  fireEvent.change(screen.getByLabelText('Type ERASE MY TRAINING to confirm'), { target: { value: 'ERASE MY TRAINING' } })
}

describe('TrainingSubjectErasure', () => {
  beforeEach(() => {
    state.erase.mockReset().mockResolvedValue({ schemaVersion: 'training-subject-erasure.v1', status: 'erased', subjectId, requestId: stableRequestId })
    state.activateUser.mockReset()
      .mockResolvedValueOnce({ previousUserId: userId, clearedCount: 0 })
      .mockResolvedValueOnce({ previousUserId: userId, clearedCount: 2 })
    state.randomUUID.mockClear()
  })

  test('requires explicit confirmation and explains the exact boundary', () => {
    render(<TrainingSubjectErasure userId={userId} subjectId={subjectId} createRequestId={state.randomUUID} />)
    expect(screen.getByText(/programs, session prescriptions, saved actuals, eligibility answers, profiles, and pending changes/i)).toBeTruthy()
    expect(screen.getByText(/practitioner’s separate legacy client record remains/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Permanently erase my training' }) as HTMLButtonElement).disabled).toBe(true)
    confirm()
    expect((screen.getByRole('button', { name: 'Permanently erase my training' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('reuses one request ID after an ambiguous response and blocks concurrent submits', async () => {
    let rejectFirst!: (cause: unknown) => void
    state.erase.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce({ schemaVersion: 'training-subject-erasure.v1', status: 'already_erased', subjectId, requestId: stableRequestId })
    render(<TrainingSubjectErasure userId={userId} subjectId={subjectId} createRequestId={state.randomUUID} />)
    confirm()
    const button = screen.getByRole('button', { name: 'Permanently erase my training' })
    fireEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(state.erase).toHaveBeenCalledTimes(1))
    fireEvent.click(button)
    expect(state.erase).toHaveBeenCalledTimes(1)
    rejectFirst(Object.assign(new Error('not confirmed'), { canRetryExact: true }))
    expect(await screen.findByText(/not confirmed/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry permanent erasure' }))
    await screen.findByText(/training data was permanently erased/i)
    expect(state.erase.mock.calls.map(call => call[0].requestId)).toEqual([stableRequestId, stableRequestId])
    expect(state.randomUUID).toHaveBeenCalledTimes(1)
  })

  test('clears the active subject queue only after a matching server receipt', async () => {
    render(<TrainingSubjectErasure userId={userId} subjectId={subjectId} createRequestId={state.randomUUID} />)
    confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Permanently erase my training' }))
    await screen.findByText(/training data was permanently erased/i)
    expect(state.activateUser.mock.calls).toEqual([[userId], [null]])
  })

  test('offers device cleanup without repeating a confirmed server erasure', async () => {
    state.activateUser.mockReset()
      .mockResolvedValueOnce({ previousUserId: userId, clearedCount: 0 })
      .mockRejectedValueOnce(new Error('indexeddb failed'))
      .mockResolvedValueOnce({ previousUserId: userId, clearedCount: 2 })
    render(<TrainingSubjectErasure userId={userId} subjectId={subjectId} createRequestId={state.randomUUID} />)
    confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Permanently erase my training' }))
    expect(await screen.findByText(/server data is erased, but pending changes could not be cleared/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry device cleanup' }))
    await waitFor(() => expect(screen.getByText(/training data was permanently erased/i)).toBeTruthy())
    expect(state.erase).toHaveBeenCalledTimes(1)
  })
})
