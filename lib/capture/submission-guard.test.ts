import { describe, expect, it, vi } from 'vitest'
import { createSubmissionGuard } from './submission-guard'

describe('createSubmissionGuard', () => {
  it('synchronously collapses two submit attempts before a UI rerender', () => {
    const guard = createSubmissionGuard(() => 'submission-a')
    expect(guard.tryBegin()).toEqual({ submissionId: 'submission-a', token: 1 })
    expect(guard.tryBegin()).toBeNull()
  })

  it('reuses the same id for an unchanged retry', () => {
    const guard = createSubmissionGuard(() => 'submission-a')
    const first = guard.tryBegin()!
    guard.release(first)
    const retry = guard.tryBegin()!
    expect(retry.submissionId).toBe(first.submissionId)
    expect(retry.token).not.toBe(first.token)
  })

  it('rotates the id when capture content changes', () => {
    const ids = ['submission-a', 'submission-b']
    const createId = vi.fn(() => ids.shift()!)
    const guard = createSubmissionGuard(createId)
    expect(guard.currentId()).toBe('submission-a')
    expect(guard.contentChanged()).toBe('submission-b')
    expect(guard.tryBegin()?.submissionId).toBe('submission-b')
  })

  it('ignores a stale attempt release', () => {
    const guard = createSubmissionGuard(() => 'submission-a')
    const first = guard.tryBegin()!
    guard.release({ ...first, token: first.token + 1 })
    expect(guard.tryBegin()).toBeNull()
    expect(guard.isCurrent(first)).toBe(true)
  })

  it('unlocks after an accepted POST and preserves the key for ambiguous poll retries', () => {
    const ids = ['submission-a', 'submission-b']
    const guard = createSubmissionGuard(() => ids.shift()!)
    const first = guard.tryBegin()!

    guard.release(first)
    expect(guard.tryBegin()?.submissionId).toBe('submission-a')
  })

  it('rotates after a confirmed terminal failure returned during polling', () => {
    const ids = ['submission-a', 'submission-b']
    const guard = createSubmissionGuard(() => ids.shift()!)
    const first = guard.tryBegin()!

    guard.release(first)
    expect(guard.contentChanged()).toBe('submission-b')
    expect(guard.tryBegin()?.submissionId).toBe('submission-b')
  })
})
