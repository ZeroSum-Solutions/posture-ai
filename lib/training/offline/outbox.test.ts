import { describe, expect, it } from 'vitest'
import {
  createTrainingOfflineOutbox,
  TrainingOfflineDuplicateRequestError,
  type TrainingOfflineReplay,
} from './outbox'
import type {
  TrainingOfflineEnvelopeInputV1,
  TrainingOfflineStoredEntry,
  TrainingOfflineStorage,
} from './types'

const USER_A = '71000000-0000-4000-8000-000000000001'
const USER_B = '71000000-0000-4000-8000-000000000002'
const SUBJECT_A = '72000000-0000-4000-8000-000000000001'
const SUBJECT_B = '72000000-0000-4000-8000-000000000002'

function setEnvelope(overrides: Partial<TrainingOfflineEnvelopeInputV1> = {}): TrainingOfflineEnvelopeInputV1 {
  return {
    userId: USER_A,
    subjectId: SUBJECT_A,
    sessionId: 'session-1',
    requestId: '73000000-0000-4000-8000-000000000001',
    mutation: {
      kind: 'set_actual',
      setId: 'set-1',
      expectedRevision: 2,
      actual: {
        quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' },
        reps: 8,
        rir: 2,
        side: 'bilateral',
        symptomState: 'none',
        occurredAt: '2026-09-08T12:00:00Z',
      },
    },
    ...overrides,
  } as TrainingOfflineEnvelopeInputV1
}

class MemoryTrainingOfflineStorage implements TrainingOfflineStorage {
  private activeUserId: string | null = null
  private nextSequence = 1
  private readonly entries: TrainingOfflineStoredEntry[] = []
  private readonly leases = new Map<string, { ownerId: string; expiresAt: number }>()

  async readActiveUser() { return this.activeUserId }

  async switchActiveUser(userId: string | null) {
    const previousUserId = this.activeUserId
    const clearedCount = previousUserId && previousUserId !== userId ? await this.clear({ userId: previousUserId }) : 0
    if (previousUserId && previousUserId !== userId) this.leases.delete(previousUserId)
    this.activeUserId = userId
    return { previousUserId, clearedCount }
  }

  async enqueue(entry: Omit<TrainingOfflineStoredEntry, 'sequence'>) {
    if (this.activeUserId !== entry.envelope.userId) return { kind: 'inactive' as const }
    const existing = this.entries.find(item => item.envelope.userId === entry.envelope.userId
      && item.envelope.requestId === entry.envelope.requestId)
    if (existing) return existing.fingerprint === entry.fingerprint
      ? { kind: 'existing' as const, entry: structuredClone(existing) }
      : { kind: 'conflict' as const }
    const stored = { ...structuredClone(entry), sequence: this.nextSequence++ }
    this.entries.push(stored)
    return { kind: 'inserted' as const, entry: structuredClone(stored) }
  }

  async list(userId: string) {
    return structuredClone(this.entries.filter(item => item.envelope.userId === userId)
      .sort((left, right) => left.sequence - right.sequence))
  }

  async markConflict(userId: string, requestId: string) {
    const entry = this.entries.find(item => item.envelope.userId === userId && item.envelope.requestId === requestId)
    if (!entry) return false
    entry.status = 'conflict'
    return true
  }

  async remove(userId: string, requestId: string) {
    const index = this.entries.findIndex(item => item.envelope.userId === userId && item.envelope.requestId === requestId)
    if (index < 0) return false
    this.entries.splice(index, 1)
    return true
  }

  async clear(scope: { userId: string; subjectId?: string; sessionId?: string }) {
    let cleared = 0
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const envelope = this.entries[index].envelope
      if (envelope.userId === scope.userId
        && (!scope.subjectId || envelope.subjectId === scope.subjectId)
        && (!scope.sessionId || envelope.sessionId === scope.sessionId)) {
        this.entries.splice(index, 1)
        cleared += 1
      }
    }
    return cleared
  }

  async acquireDrainLease(userId: string, ownerId: string, now: number, expiresAt: number) {
    const lease = this.leases.get(userId)
    if (lease && lease.ownerId !== ownerId && lease.expiresAt > now) return false
    this.leases.set(userId, { ownerId, expiresAt })
    return true
  }

  async releaseDrainLease(userId: string, ownerId: string) {
    if (this.leases.get(userId)?.ownerId === ownerId) this.leases.delete(userId)
  }
}

describe('training offline outbox', () => {
  it('clears only exact session scopes for the active account', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const outbox = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())
    await outbox.enqueue(setEnvelope({
      requestId: '73000000-0000-4000-8000-000000000002',
      sessionId: 'self-directed-session',
    }))
    await outbox.enqueue(setEnvelope({
      requestId: '73000000-0000-4000-8000-000000000003',
      subjectId: SUBJECT_B,
      sessionId: 'other-subject-session',
    }))

    expect(await outbox.clearSessionScopes(SUBJECT_A, ['session-1'])).toEqual({
      kind: 'cleared', clearedCount: 1,
    })
    expect((await outbox.list()).map(item => item.envelope.sessionId)).toEqual([
      'self-directed-session',
      'other-subject-session',
    ])
  })

  it('aborts an active replay before scoped cleanup and leaves unrelated work restartable', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const outbox = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())
    await outbox.enqueue(setEnvelope({
      requestId: '73000000-0000-4000-8000-000000000002',
      sessionId: 'unrelated-session',
    }))
    let replayStarted: (() => void) | undefined
    const replayReady = new Promise<void>(resolve => { replayStarted = resolve })
    const draining = outbox.drain((_entry, signal) => new Promise(resolve => {
      replayStarted?.()
      if (signal.aborted) resolve({ kind: 'retry_later' })
      else signal.addEventListener('abort', () => resolve({ kind: 'retry_later' }), { once: true })
    }))
    await replayReady

    expect(await outbox.clearSessionScopes(SUBJECT_A, ['session-1'])).toEqual({
      kind: 'cleared', clearedCount: 1,
    })
    await expect(draining).resolves.toMatchObject({ kind: 'retry_later' })
    expect((await outbox.list()).map(item => item.envelope.sessionId)).toEqual(['unrelated-session'])
    await expect(outbox.drain(async () => ({ kind: 'acknowledged' })))
      .resolves.toEqual({ kind: 'drained', acknowledgedCount: 1 })
  })

  it('does not clear a newly active account when the account changes during cleanup', async () => {
    class AccountSwitchRaceStorage extends MemoryTrainingOfflineStorage {
      reads = 0
      armed = false
      override async readActiveUser() {
        if (!this.armed) return super.readActiveUser()
        this.reads += 1
        return this.reads === 1 ? USER_A : super.readActiveUser()
      }
    }
    const storage = new AccountSwitchRaceStorage()
    await storage.switchActiveUser(USER_B)
    const outbox = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1' })
    await outbox.enqueue(setEnvelope({ userId: USER_B }))
    storage.armed = true

    expect(await outbox.clearSessionScopes(SUBJECT_A, ['session-1'])).toEqual({
      kind: 'account_changed', clearedCount: 0,
    })
    expect((await storage.list(USER_B)).map(item => item.envelope.sessionId)).toEqual(['session-1'])
  })

  it('treats scoped cleanup as a no-op while signed out and rejects ambiguous scope lists', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    expect(await outbox.clearSessionScopes(SUBJECT_A, ['session-1']))
      .toEqual({ kind: 'inactive', clearedCount: 0 })
    await outbox.activateUser(USER_A)
    await expect(outbox.clearSessionScopes(SUBJECT_A, ['session-1', 'session-1']))
      .rejects.toThrow(/unique/i)
    await expect(outbox.clearSessionScopes('not-a-subject', ['session-1']))
      .rejects.toThrow()
  })

  it('clears every exact receipt-bound session when a relationship spans more than 128 sessions', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const outbox = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    const sessionIds = Array.from({ length: 129 }, (_, index) => `coach-session-${index + 1}`)
    await outbox.enqueue(setEnvelope({ sessionId: sessionIds[128] }))

    await expect(outbox.clearSessionScopes(SUBJECT_A, sessionIds))
      .resolves.toEqual({ kind: 'cleared', clearedCount: 1 })
    expect(await outbox.list()).toEqual([])
  })

  it('reloads an exact pending envelope from shared durable storage', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const first = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1', now: () => Date.parse('2026-09-08T12:00:00Z') })
    await first.activateUser(USER_A)
    const queued = await first.enqueue(setEnvelope())

    expect(queued.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(queued.fingerprint).not.toContain('2026-09-08T12:00:00Z')

    const reloaded = createTrainingOfflineOutbox({ storage, ownerId: 'tab-2' })
    expect(await reloaded.list()).toEqual([queued])
    expect((await reloaded.list())[0]).toMatchObject({ status: 'pending', envelope: setEnvelope() })
  })

  it('deduplicates an exact request ID and rejects changed content under that ID', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    const first = await outbox.enqueue(setEnvelope())
    expect(await outbox.enqueue(setEnvelope())).toEqual(first)
    expect(await outbox.list()).toHaveLength(1)

    const original = setEnvelope()
    if (original.mutation.kind !== 'set_actual') throw new Error('set fixture required')
    const changed = setEnvelope({ mutation: { ...original.mutation, actual: { ...original.mutation.actual, reps: 9 } } })
    await expect(outbox.enqueue(changed)).rejects.toBeInstanceOf(TrainingOfflineDuplicateRequestError)
  })

  it('stops on an ambiguous retry and later replays the same-session envelopes in order', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    const first = await outbox.enqueue(setEnvelope())
    const secondInput = setEnvelope()
    if (secondInput.mutation.kind !== 'set_actual') throw new Error('set fixture required')
    const second = await outbox.enqueue(setEnvelope({ requestId: '73000000-0000-4000-8000-000000000002', mutation: {
      ...secondInput.mutation, setId: 'set-2', expectedRevision: 3,
    } }))
    const seen: TrainingOfflineStoredEntry[] = []
    const retry: TrainingOfflineReplay = async entry => { seen.push(entry); return { kind: 'retry_later' } }

    expect(await outbox.drain(retry)).toMatchObject({ kind: 'retry_later', acknowledgedCount: 0 })
    expect(seen).toEqual([first])
    expect(await outbox.list()).toEqual([first, second])

    seen.length = 0
    expect(await outbox.drain(async entry => { seen.push(entry); return { kind: 'acknowledged' } }))
      .toEqual({ kind: 'drained', acknowledgedCount: 2 })
    expect(seen).toEqual([first, second])
    expect(await outbox.list()).toEqual([])
  })

  it('allows only one tab to drain a user queue at a time', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const first = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1', now: () => 1_000, leaseMs: 1_000 })
    const second = createTrainingOfflineOutbox({ storage, ownerId: 'tab-2', now: () => 1_000, leaseMs: 1_000 })
    await first.activateUser(USER_A)
    await first.enqueue(setEnvelope())
    let release: (() => void) | undefined
    const blocked = first.drain(() => new Promise(resolve => { release = () => resolve({ kind: 'acknowledged' }) }))
    await Promise.resolve()

    expect(await second.drain(async () => ({ kind: 'acknowledged' }))).toEqual({
      kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: 1_000,
    })
    release?.()
    await expect(blocked).resolves.toEqual({ kind: 'drained', acknowledgedCount: 1 })
  })

  it('does not release the active lease when the same tab asks to drain twice', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const first = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1', now: () => 1_000, leaseMs: 1_000 })
    const third = createTrainingOfflineOutbox({ storage, ownerId: 'tab-3', now: () => 1_000, leaseMs: 1_000 })
    await first.activateUser(USER_A)
    await first.enqueue(setEnvelope())
    let release: (() => void) | undefined
    const blocked = first.drain(() => new Promise(resolve => { release = () => resolve({ kind: 'acknowledged' }) }))
    await Promise.resolve()

    expect(await first.drain(async () => ({ kind: 'acknowledged' }))).toEqual({
      kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: 1_000,
    })
    expect(await third.drain(async () => ({ kind: 'acknowledged' }))).toEqual({
      kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: 1_000,
    })
    release?.()
    await blocked
  })

  it('clears the previous account on account change or logout and never transfers its queue', async () => {
    const storage = new MemoryTrainingOfflineStorage()
    const outbox = createTrainingOfflineOutbox({ storage, ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())

    expect(await outbox.activateUser(USER_B)).toEqual({ previousUserId: USER_A, clearedCount: 1 })
    expect(await outbox.list()).toEqual([])
    const userB = await outbox.enqueue(setEnvelope({ userId: USER_B }))
    expect(userB.envelope.userId).toBe(USER_B)

    expect(await outbox.activateUser(null)).toEqual({ previousUserId: USER_B, clearedCount: 1 })
    expect(await outbox.list()).toEqual([])
    await expect(outbox.enqueue(setEnvelope())).rejects.toThrow(/active training account/i)
  })

  it('persists a conflict and waits for explicit discard without rebasing later mutations', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())
    const secondInput = setEnvelope()
    if (secondInput.mutation.kind !== 'set_actual') throw new Error('set fixture required')
    await outbox.enqueue(setEnvelope({ requestId: '73000000-0000-4000-8000-000000000002', mutation: {
      ...secondInput.mutation, setId: 'set-2', expectedRevision: 3,
    } }))
    const replay = async () => ({ kind: 'conflict' as const })

    expect(await outbox.drain(replay)).toMatchObject({ kind: 'conflict', requestId: setEnvelope().requestId })
    expect((await outbox.list()).map(entry => entry.status)).toEqual(['conflict', 'pending'])
    expect(await outbox.drain(async () => ({ kind: 'acknowledged' }))).toMatchObject({ kind: 'conflict' })

    expect(await outbox.discardConflict(setEnvelope().requestId)).toBe(true)
    expect(await outbox.drain(async () => ({ kind: 'acknowledged' }))).toEqual({ kind: 'drained', acknowledgedCount: 1 })
  })

  it('removes only a definitively rejected envelope and leaves newer work pending', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())
    await outbox.enqueue(setEnvelope({ requestId: '73000000-0000-4000-8000-000000000002', sessionId: 'session-2' }))

    expect(await outbox.drain(async () => ({ kind: 'rejected', reason: 'invalid_training_payload' }))).toEqual({
      kind: 'rejected', acknowledgedCount: 0, requestId: setEnvelope().requestId,
      reason: 'invalid_training_payload',
    })
    expect((await outbox.list()).map(entry => entry.envelope.sessionId)).toEqual(['session-2'])
  })

  it.each([
    [{ scope: 'session', reason: 'assignment_expired' } as const, 1],
    [{ scope: 'subject', reason: 'subject_erased' } as const, 2],
    [{ scope: 'session', reason: 'relationship_revoked' } as const, 1],
    [{ scope: 'user', reason: 'unauthenticated' } as const, 3],
  ])('stops and clears the denied %s scope', async (denial, expectedClearedCount) => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())
    await outbox.enqueue(setEnvelope({ requestId: '73000000-0000-4000-8000-000000000002', sessionId: 'session-2' }))
    await outbox.enqueue(setEnvelope({ requestId: '73000000-0000-4000-8000-000000000003', subjectId: SUBJECT_B, sessionId: 'session-3' }))

    expect(await outbox.drain(async () => ({ kind: 'denied', ...denial }))).toMatchObject({
      kind: 'denied', reason: denial.reason, clearedCount: expectedClearedCount,
    })
    expect(await outbox.list()).toHaveLength(3 - expectedClearedCount)
    if (denial.reason === 'relationship_revoked') {
      expect((await outbox.list()).map(entry => entry.envelope.sessionId)).toContain('session-2')
    }
  })

  it('deactivates the account after an unauthenticated replay denial', async () => {
    const outbox = createTrainingOfflineOutbox({ storage: new MemoryTrainingOfflineStorage(), ownerId: 'tab-1' })
    await outbox.activateUser(USER_A)
    await outbox.enqueue(setEnvelope())

    await outbox.drain(async () => ({ kind: 'denied', scope: 'user', reason: 'unauthenticated' }))

    expect(await outbox.list()).toEqual([])
    await expect(outbox.enqueue(setEnvelope())).rejects.toThrow(/active training account/i)
  })
})
