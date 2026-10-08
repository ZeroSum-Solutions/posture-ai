import {
  TrainingOfflineEnvelopeInputV1Schema,
  TrainingOfflineEnvelopeV1Schema,
  TrainingOfflineStoredEntrySchema,
  type TrainingOfflineEnvelopeInputV1,
  type TrainingOfflineStoredEntry,
  type TrainingOfflineStorage,
} from './types'

const sessionScopeListSchema = TrainingOfflineEnvelopeInputV1Schema.shape.sessionId
  .array()
  .superRefine((sessionIds, context) => {
    if (new Set(sessionIds).size !== sessionIds.length) {
      context.addIssue({ code: 'custom', message: 'Session scope IDs must be unique.' })
    }
  })

export type TrainingOfflineReplayOutcome =
  | { readonly kind: 'acknowledged' }
  | { readonly kind: 'retry_later' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | {
    readonly kind: 'denied'
    readonly scope: 'user' | 'subject' | 'session'
    readonly reason: 'unauthenticated' | 'authorization_revoked' | 'relationship_revoked' | 'assignment_expired' | 'subject_erased' | 'action_unavailable'
  }

export type TrainingOfflineReplay = (
  entry: TrainingOfflineStoredEntry,
  signal: AbortSignal,
) => Promise<TrainingOfflineReplayOutcome>

export type TrainingOfflineDrainResult =
  | { readonly kind: 'drained'; readonly acknowledgedCount: number }
  | { readonly kind: 'already_draining'; readonly acknowledgedCount: number; readonly retryAfterMs: number }
  | { readonly kind: 'account_changed'; readonly acknowledgedCount: number }
  | { readonly kind: 'retry_later'; readonly acknowledgedCount: number; readonly requestId: string }
  | { readonly kind: 'conflict'; readonly acknowledgedCount: number; readonly requestId: string }
  | { readonly kind: 'rejected'; readonly acknowledgedCount: number; readonly requestId: string; readonly reason: string }
  | {
    readonly kind: 'denied'
    readonly acknowledgedCount: number
    readonly requestId: string
    readonly reason: Extract<TrainingOfflineReplayOutcome, { kind: 'denied' }>['reason']
    readonly clearedCount: number
  }

export type TrainingOfflineSessionClearResult =
  | { readonly kind: 'cleared'; readonly clearedCount: number }
  | { readonly kind: 'inactive'; readonly clearedCount: 0 }
  | { readonly kind: 'account_changed'; readonly clearedCount: number }

export class TrainingOfflineDuplicateRequestError extends Error {
  constructor() {
    super('Training request ID is already queued with different content.')
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]))
}

async function fingerprint(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure browser hashing is required for training offline storage.')
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function immutableEntry(value: unknown): TrainingOfflineStoredEntry {
  const entry = TrainingOfflineStoredEntrySchema.parse(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return
    for (const child of Object.values(item)) freeze(child)
    Object.freeze(item)
  }
  freeze(entry)
  return entry
}

const MIN_LEASE_RETRY_MS = 250
const SAME_DOCUMENT_RETRY_MS = 2_000

export function createTrainingOfflineOutbox(options: {
  readonly storage: TrainingOfflineStorage
  readonly ownerId: string
  readonly now?: () => number
  readonly leaseMs?: number
}) {
  const now = options.now ?? Date.now
  const leaseMs = options.leaseMs ?? 30_000
  if (!options.ownerId || options.ownerId.length > 128) throw new Error('A stable outbox owner ID is required.')
  if (!Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new Error('Invalid outbox lease duration.')
  let activeDrain: AbortController | null = null

  // A lease held by another document (often one just reloaded or closed) ends at
  // its recorded expiry; waiting a full fresh lease from now would leave the
  // queue unsynced for up to twice the lease. Clamp so a skewed clock can neither
  // spin nor wait past one lease.
  async function retryAfterHeldLease(userId: string): Promise<number> {
    if (!options.storage.readDrainLeaseExpiry) return leaseMs
    const heldUntil = await options.storage.readDrainLeaseExpiry(userId, options.ownerId)
    // Released between the failed acquire and this read: the queue is free now.
    if (heldUntil === null) return MIN_LEASE_RETRY_MS
    return Math.min(leaseMs, Math.max(MIN_LEASE_RETRY_MS, heldUntil - now()))
  }

  async function activateUser(userId: string | null) {
    const parsedUserId = userId === null ? null : TrainingOfflineEnvelopeInputV1Schema.shape.userId.parse(userId)
    const current = await options.storage.readActiveUser()
    if (current !== parsedUserId) activeDrain?.abort()
    return options.storage.switchActiveUser(parsedUserId)
  }

  async function list(): Promise<TrainingOfflineStoredEntry[]> {
    const userId = await options.storage.readActiveUser()
    if (!userId) return []
    return (await options.storage.list(userId)).map(immutableEntry)
  }

  async function enqueue(input: TrainingOfflineEnvelopeInputV1): Promise<TrainingOfflineStoredEntry> {
    const parsed = TrainingOfflineEnvelopeInputV1Schema.parse(input)
    const activeUserId = await options.storage.readActiveUser()
    if (activeUserId !== parsed.userId) throw new Error('Queued mutations must belong to the active training account.')
    const contentFingerprint = await fingerprint(parsed)
    const envelope = TrainingOfflineEnvelopeV1Schema.parse({
      ...parsed,
      schemaVersion: 'training-offline-envelope.v1',
      queuedAt: new Date(now()).toISOString(),
    })
    const result = await options.storage.enqueue({
      fingerprint: contentFingerprint,
      status: 'pending',
      envelope,
    })
    if (result.kind === 'inactive') throw new Error('Queued mutations must belong to the active training account.')
    if (result.kind === 'conflict') throw new TrainingOfflineDuplicateRequestError()
    return immutableEntry(result.entry)
  }

  async function discardConflict(requestId: string): Promise<boolean> {
    const userId = await options.storage.readActiveUser()
    if (!userId) return false
    const entry = (await options.storage.list(userId)).find(item => item.envelope.requestId === requestId)
    return entry?.status === 'conflict' ? options.storage.remove(userId, requestId) : false
  }

  async function clearSessionScopes(
    rawSubjectId: string,
    rawSessionIds: readonly string[],
  ): Promise<TrainingOfflineSessionClearResult> {
    const subjectId = TrainingOfflineEnvelopeInputV1Schema.shape.subjectId.parse(rawSubjectId)
    const sessionIds = sessionScopeListSchema.parse(rawSessionIds)
    const userId = await options.storage.readActiveUser()
    if (!userId) return { kind: 'inactive', clearedCount: 0 }

    activeDrain?.abort()
    if (await options.storage.readActiveUser() !== userId) {
      return { kind: 'account_changed', clearedCount: 0 }
    }

    let clearedCount = 0
    for (const sessionId of sessionIds) {
      if (await options.storage.readActiveUser() !== userId) {
        return { kind: 'account_changed', clearedCount }
      }
      clearedCount += await options.storage.clear({ userId, subjectId, sessionId })
    }
    if (await options.storage.readActiveUser() !== userId) {
      return { kind: 'account_changed', clearedCount }
    }
    return { kind: 'cleared', clearedCount }
  }

  async function drain(replay: TrainingOfflineReplay): Promise<TrainingOfflineDrainResult> {
    const userId = await options.storage.readActiveUser()
    if (!userId) return { kind: 'drained', acknowledgedCount: 0 }
    // This document is already draining; re-check soon rather than a whole lease later.
    if (activeDrain) return { kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: Math.min(leaseMs, SAME_DOCUMENT_RETRY_MS) }
    const startedAt = now()
    if (!await options.storage.acquireDrainLease(userId, options.ownerId, startedAt, startedAt + leaseMs)) {
      return { kind: 'already_draining', acknowledgedCount: 0, retryAfterMs: await retryAfterHeldLease(userId) }
    }
    const controller = new AbortController()
    activeDrain = controller
    let acknowledgedCount = 0
    try {
      while (!controller.signal.aborted) {
        if (await options.storage.readActiveUser() !== userId) {
          return { kind: 'account_changed', acknowledgedCount }
        }
        const entry = (await options.storage.list(userId)).map(immutableEntry)[0]
        if (!entry) return { kind: 'drained', acknowledgedCount }
        if (entry.status === 'conflict') {
          return { kind: 'conflict', acknowledgedCount, requestId: entry.envelope.requestId }
        }

        let outcome: TrainingOfflineReplayOutcome
        try {
          outcome = await replay(entry, controller.signal)
        } catch {
          return { kind: 'retry_later', acknowledgedCount, requestId: entry.envelope.requestId }
        }
        if (outcome.kind === 'acknowledged') {
          await options.storage.remove(userId, entry.envelope.requestId)
          acknowledgedCount += 1
          const refreshedAt = now()
          if (!await options.storage.acquireDrainLease(userId, options.ownerId, refreshedAt, refreshedAt + leaseMs)) {
            return { kind: 'already_draining', acknowledgedCount, retryAfterMs: await retryAfterHeldLease(userId) }
          }
          continue
        }
        if (outcome.kind === 'retry_later') {
          return { kind: 'retry_later', acknowledgedCount, requestId: entry.envelope.requestId }
        }
        if (outcome.kind === 'conflict') {
          await options.storage.markConflict(userId, entry.envelope.requestId)
          return { kind: 'conflict', acknowledgedCount, requestId: entry.envelope.requestId }
        }
        if (outcome.kind === 'rejected') {
          await options.storage.remove(userId, entry.envelope.requestId)
          return { kind: 'rejected', acknowledgedCount, requestId: entry.envelope.requestId, reason: outcome.reason }
        }

        const clearedCount = outcome.scope === 'user'
          ? (await options.storage.switchActiveUser(null)).clearedCount
          : await options.storage.clear(outcome.scope === 'subject'
            ? { userId, subjectId: entry.envelope.subjectId }
            : { userId, subjectId: entry.envelope.subjectId, sessionId: entry.envelope.sessionId })
        return { kind: 'denied', acknowledgedCount, requestId: entry.envelope.requestId, reason: outcome.reason, clearedCount }
      }
      return { kind: 'account_changed', acknowledgedCount }
    } finally {
      activeDrain = null
      await options.storage.releaseDrainLease(userId, options.ownerId)
    }
  }

  return Object.freeze({ activateUser, enqueue, list, discardConflict, clearSessionScopes, drain })
}
