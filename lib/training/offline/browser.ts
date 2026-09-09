import { createTrainingOfflineOutbox } from './outbox'
import { createIndexedDbTrainingOfflineStorage } from './storage'

export type TrainingOfflineBrowserOutbox = ReturnType<typeof createTrainingOfflineOutbox>

export type TrainingOfflineAuthState =
  | { readonly kind: 'authenticated'; readonly userId: string }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unknown' }

export function trainingOfflineAuthState(event: string, userId: string | null): TrainingOfflineAuthState {
  if (event === 'SIGNED_OUT') return { kind: 'signed_out' }
  return userId ? { kind: 'authenticated', userId } : { kind: 'unknown' }
}

export async function synchronizeTrainingOfflineAuth(
  state: TrainingOfflineAuthState,
  outbox = getTrainingOfflineBrowserOutbox(),
): Promise<void> {
  if (state.kind === 'unknown') return
  await outbox.activateUser(state.kind === 'authenticated' ? state.userId : null)
}

export function createTrainingOfflineBrowserOutbox(options: {
  readonly indexedDB: IDBFactory
  readonly ownerId: string
  readonly databaseName?: string
}): TrainingOfflineBrowserOutbox {
  return createTrainingOfflineOutbox({
    storage: createIndexedDbTrainingOfflineStorage({
      indexedDB: options.indexedDB,
      databaseName: options.databaseName,
    }),
    ownerId: options.ownerId,
  })
}

let defaultOutbox: TrainingOfflineBrowserOutbox | null = null
let documentOwnerId: string | null = null

export function createTrainingOfflineDocumentOwnerId(randomUUID: () => string): string {
  return randomUUID()
}

function defaultOwnerId(): string {
  documentOwnerId ??= createTrainingOfflineDocumentOwnerId(() => globalThis.crypto.randomUUID())
  return documentOwnerId
}

export function getTrainingOfflineBrowserOutbox(): TrainingOfflineBrowserOutbox {
  if (defaultOutbox) return defaultOutbox
  if (!globalThis.indexedDB || !globalThis.crypto?.randomUUID) {
    throw new Error('Durable training storage is unavailable in this browser.')
  }
  defaultOutbox = createTrainingOfflineBrowserOutbox({
    indexedDB: globalThis.indexedDB,
    ownerId: defaultOwnerId(),
  })
  return defaultOutbox
}
