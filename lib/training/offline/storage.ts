import type {
  TrainingOfflineClearScope,
  TrainingOfflineEnqueueResult,
  TrainingOfflineStoredEntry,
  TrainingOfflineStoredEntryInput,
  TrainingOfflineStorage,
} from './types'

const ENTRY_STORE = 'entries'
const META_STORE = 'meta'
const USER_INDEX = 'userId'
const USER_REQUEST_INDEX = 'userRequest'

type ActiveUserMeta = { key: 'activeUser'; userId: string | null }
type DrainLeaseMeta = { key: string; ownerId: string; expiresAt: number }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

export function createIndexedDbTrainingOfflineStorage(options: {
  readonly indexedDB: IDBFactory
  readonly databaseName?: string
}): TrainingOfflineStorage {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      const request = options.indexedDB.open(options.databaseName ?? 'posture-ai-training-offline', 1)
      request.onupgradeneeded = () => {
        const database = request.result
        const entries = database.createObjectStore(ENTRY_STORE, { keyPath: 'sequence', autoIncrement: true })
        entries.createIndex(USER_INDEX, 'envelope.userId')
        entries.createIndex(USER_REQUEST_INDEX, ['envelope.userId', 'envelope.requestId'], { unique: true })
        database.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Training offline storage could not be opened.'))
      request.onblocked = () => reject(new Error('Training offline storage upgrade is blocked.'))
    })
    return databasePromise
  }

  async function readActiveUser(): Promise<string | null> {
    const transaction = (await database()).transaction(META_STORE, 'readonly')
    const done = transactionDone(transaction)
    const meta = await requestResult(transaction.objectStore(META_STORE).get('activeUser')) as ActiveUserMeta | undefined
    await done
    return meta?.userId ?? null
  }

  async function switchActiveUser(userId: string | null) {
    const transaction = (await database()).transaction([ENTRY_STORE, META_STORE], 'readwrite')
    const done = transactionDone(transaction)
    const entries = transaction.objectStore(ENTRY_STORE)
    const metaStore = transaction.objectStore(META_STORE)
    const previous = await requestResult(metaStore.get('activeUser')) as ActiveUserMeta | undefined
    const previousUserId = previous?.userId ?? null
    let clearedCount = 0
    if (previousUserId && previousUserId !== userId) {
      const priorEntries = await requestResult(entries.index(USER_INDEX).getAll(previousUserId)) as TrainingOfflineStoredEntry[]
      for (const entry of priorEntries) {
        await requestResult(entries.delete(entry.sequence))
        clearedCount += 1
      }
    }
    if (previousUserId && previousUserId !== userId) await requestResult(metaStore.delete(`drain:${previousUserId}`))
    await requestResult(metaStore.put({ key: 'activeUser', userId } satisfies ActiveUserMeta))
    await done
    return { previousUserId, clearedCount }
  }

  async function enqueue(entry: TrainingOfflineStoredEntryInput): Promise<TrainingOfflineEnqueueResult> {
    const transaction = (await database()).transaction([ENTRY_STORE, META_STORE], 'readwrite')
    const done = transactionDone(transaction)
    const entries = transaction.objectStore(ENTRY_STORE)
    const active = await requestResult(transaction.objectStore(META_STORE).get('activeUser')) as ActiveUserMeta | undefined
    if (active?.userId !== entry.envelope.userId) {
      await done
      return { kind: 'inactive' }
    }
    const existing = await requestResult(entries.index(USER_REQUEST_INDEX)
      .get([entry.envelope.userId, entry.envelope.requestId])) as TrainingOfflineStoredEntry | undefined
    if (existing) {
      await done
      return existing.fingerprint === entry.fingerprint
        ? { kind: 'existing', entry: existing }
        : { kind: 'conflict' }
    }
    const sequence = Number(await requestResult(entries.add(entry)))
    await done
    return { kind: 'inserted', entry: { ...entry, sequence } }
  }

  async function list(userId: string): Promise<TrainingOfflineStoredEntry[]> {
    const transaction = (await database()).transaction(ENTRY_STORE, 'readonly')
    const done = transactionDone(transaction)
    const entries = await requestResult(transaction.objectStore(ENTRY_STORE).index(USER_INDEX).getAll(userId)) as TrainingOfflineStoredEntry[]
    await done
    return entries.sort((left, right) => left.sequence - right.sequence)
  }

  async function findEntry(transaction: IDBTransaction, userId: string, requestId: string) {
    return requestResult(transaction.objectStore(ENTRY_STORE).index(USER_REQUEST_INDEX)
      .get([userId, requestId])) as Promise<TrainingOfflineStoredEntry | undefined>
  }

  async function markConflict(userId: string, requestId: string): Promise<boolean> {
    const transaction = (await database()).transaction(ENTRY_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const entry = await findEntry(transaction, userId, requestId)
    if (entry) await requestResult(transaction.objectStore(ENTRY_STORE).put({ ...entry, status: 'conflict' }))
    await done
    return Boolean(entry)
  }

  async function remove(userId: string, requestId: string): Promise<boolean> {
    const transaction = (await database()).transaction(ENTRY_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const entry = await findEntry(transaction, userId, requestId)
    if (entry) await requestResult(transaction.objectStore(ENTRY_STORE).delete(entry.sequence))
    await done
    return Boolean(entry)
  }

  async function clear(scope: TrainingOfflineClearScope): Promise<number> {
    const transaction = (await database()).transaction(ENTRY_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const entriesStore = transaction.objectStore(ENTRY_STORE)
    const entries = await requestResult(entriesStore.index(USER_INDEX).getAll(scope.userId)) as TrainingOfflineStoredEntry[]
    const matches = entries.filter(entry => (!scope.subjectId || entry.envelope.subjectId === scope.subjectId)
      && (!scope.sessionId || entry.envelope.sessionId === scope.sessionId))
    for (const entry of matches) await requestResult(entriesStore.delete(entry.sequence))
    await done
    return matches.length
  }

  async function acquireDrainLease(userId: string, ownerId: string, now: number, expiresAt: number): Promise<boolean> {
    const transaction = (await database()).transaction(META_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const metaStore = transaction.objectStore(META_STORE)
    const key = `drain:${userId}`
    const existing = await requestResult(metaStore.get(key)) as DrainLeaseMeta | undefined
    if (existing && existing.ownerId !== ownerId && existing.expiresAt > now) {
      await done
      return false
    }
    await requestResult(metaStore.put({ key, ownerId, expiresAt } satisfies DrainLeaseMeta))
    await done
    return true
  }

  async function readDrainLeaseExpiry(userId: string, ownerId: string): Promise<number | null> {
    const transaction = (await database()).transaction(META_STORE, 'readonly')
    const done = transactionDone(transaction)
    const existing = await requestResult(transaction.objectStore(META_STORE).get(`drain:${userId}`)) as DrainLeaseMeta | undefined
    await done
    return existing && existing.ownerId !== ownerId ? existing.expiresAt : null
  }

  async function releaseDrainLease(userId: string, ownerId: string): Promise<void> {
    const transaction = (await database()).transaction(META_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const metaStore = transaction.objectStore(META_STORE)
    const key = `drain:${userId}`
    const existing = await requestResult(metaStore.get(key)) as DrainLeaseMeta | undefined
    if (existing?.ownerId === ownerId) await requestResult(metaStore.delete(key))
    await done
  }

  return Object.freeze({
    readActiveUser,
    switchActiveUser,
    enqueue,
    list,
    markConflict,
    remove,
    clear,
    acquireDrainLease,
    releaseDrainLease,
    readDrainLeaseExpiry,
  })
}
