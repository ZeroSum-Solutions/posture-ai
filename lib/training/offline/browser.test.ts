import { describe, expect, it, vi } from 'vitest'
import {
  createTrainingOfflineDocumentOwnerId,
  synchronizeTrainingOfflineAuth,
  trainingOfflineAuthState,
  type TrainingOfflineBrowserOutbox,
} from './browser'

describe('training offline browser auth lifecycle', () => {
  it('creates a distinct drain owner for each document runtime instead of reusing inherited tab storage', () => {
    const inheritedSessionStorageOwner = 'duplicated-tab-owner'
    const owners = ['document-a', 'document-b']

    const first = createTrainingOfflineDocumentOwnerId(() => owners.shift()!)
    const second = createTrainingOfflineDocumentOwnerId(() => owners.shift()!)

    expect(inheritedSessionStorageOwner).not.toBe(first)
    expect(inheritedSessionStorageOwner).not.toBe(second)
    expect(first).not.toBe(second)
  })

  it('treats explicit signout and authenticated sessions as authoritative', () => {
    expect(trainingOfflineAuthState('SIGNED_OUT', null)).toEqual({ kind: 'signed_out' })
    expect(trainingOfflineAuthState('SIGNED_IN', '71000000-0000-4000-8000-000000000001')).toEqual({
      kind: 'authenticated', userId: '71000000-0000-4000-8000-000000000001',
    })
  })

  it('keeps the queue untouched when auth identity is transiently unknown', async () => {
    const activateUser = vi.fn()
    const outbox = { activateUser } as unknown as TrainingOfflineBrowserOutbox

    expect(trainingOfflineAuthState('TOKEN_REFRESHED', null)).toEqual({ kind: 'unknown' })
    await synchronizeTrainingOfflineAuth({ kind: 'unknown' }, outbox)

    expect(activateUser).not.toHaveBeenCalled()
  })

  it('clears on explicit signout and switches atomically to a different account', async () => {
    const activateUser = vi.fn().mockResolvedValue({ previousUserId: null, clearedCount: 0 })
    const outbox = { activateUser } as unknown as TrainingOfflineBrowserOutbox

    await synchronizeTrainingOfflineAuth({
      kind: 'authenticated', userId: '71000000-0000-4000-8000-000000000002',
    }, outbox)
    await synchronizeTrainingOfflineAuth({ kind: 'signed_out' }, outbox)

    expect(activateUser.mock.calls).toEqual([
      ['71000000-0000-4000-8000-000000000002'],
      [null],
    ])
  })
})
