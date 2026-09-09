import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import ts from 'typescript'

const storageSource = readFileSync(resolve(__dirname, 'storage.ts'), 'utf8')
const browserStorageScript = `${ts.transpileModule(storageSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('export function createIndexedDbTrainingOfflineStorage', 'function createIndexedDbTrainingOfflineStorage')}
globalThis.createIndexedDbTrainingOfflineStorage = createIndexedDbTrainingOfflineStorage;`

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: browserStorageScript })
  await page.goto('/')
})

test('persists exact entries across a real browser page reload and detects duplicate ID conflicts', async ({ page }) => {
  const databaseName = `training-offline-reload-${crypto.randomUUID()}`
  const first = await page.evaluate(async database => {
    const storage = globalThis.createIndexedDbTrainingOfflineStorage({ indexedDB, databaseName: database })
    const envelope = {
      schemaVersion: 'training-offline-envelope.v1', queuedAt: '2026-09-08T12:00:00Z',
      userId: '71000000-0000-4000-8000-000000000001', subjectId: '72000000-0000-4000-8000-000000000001',
      sessionId: 'session-1', requestId: '73000000-0000-4000-8000-000000000001',
      mutation: { kind: 'session_completion', expectedRevision: 2, finishMode: 'complete' },
    } as const
    await storage.switchActiveUser(envelope.userId)
    return storage.enqueue({ fingerprint: 'a'.repeat(64), status: 'pending', envelope })
  }, databaseName)
  expect(first.kind).toBe('inserted')

  await page.reload()
  const reloaded = await page.evaluate(async database => {
    const storage = globalThis.createIndexedDbTrainingOfflineStorage({ indexedDB, databaseName: database })
    const entries = await storage.list('71000000-0000-4000-8000-000000000001')
    const exact = await storage.enqueue({
      fingerprint: entries[0].fingerprint, status: 'pending', envelope: entries[0].envelope,
    })
    const changed = await storage.enqueue({
      fingerprint: 'b'.repeat(64), status: 'pending', envelope: entries[0].envelope,
    })
    return { entries, exact: exact.kind, changed: changed.kind }
  }, databaseName)

  expect(reloaded.entries).toHaveLength(1)
  expect(reloaded.entries[0]).toMatchObject({ sequence: 1, status: 'pending', envelope: { sessionId: 'session-1' } })
  expect(reloaded).toMatchObject({ exact: 'existing', changed: 'conflict' })
})

test('serializes drain ownership and clears the prior account without queue transfer', async ({ page }) => {
  const result = await page.evaluate(async databaseName => {
    const first = globalThis.createIndexedDbTrainingOfflineStorage({ indexedDB, databaseName })
    const second = globalThis.createIndexedDbTrainingOfflineStorage({ indexedDB, databaseName })
    const userA = '71000000-0000-4000-8000-000000000001'
    const userB = '71000000-0000-4000-8000-000000000002'
    await first.switchActiveUser(userA)
    await first.enqueue({
      fingerprint: 'a'.repeat(64), status: 'pending',
      envelope: {
        schemaVersion: 'training-offline-envelope.v1', queuedAt: '2026-09-08T12:00:00Z',
        userId: userA, subjectId: '72000000-0000-4000-8000-000000000001', sessionId: 'session-1',
        requestId: '73000000-0000-4000-8000-000000000001',
        mutation: { kind: 'session_completion', expectedRevision: 2, finishMode: 'complete' },
      },
    })
    const firstLease = await first.acquireDrainLease(userA, 'tab-a', 1_000, 31_000)
    const secondLease = await second.acquireDrainLease(userA, 'tab-b', 1_000, 31_000)
    const switched = await second.switchActiveUser(userB)
    return {
      firstLease, secondLease, switched,
      activeUser: await first.readActiveUser(),
      oldEntries: await first.list(userA),
      newEntries: await first.list(userB),
    }
  }, `training-offline-account-${crypto.randomUUID()}`)

  expect(result).toEqual({
    firstLease: true,
    secondLease: false,
    switched: { previousUserId: '71000000-0000-4000-8000-000000000001', clearedCount: 1 },
    activeUser: '71000000-0000-4000-8000-000000000002',
    oldEntries: [],
    newEntries: [],
  })
})

declare global {
  var createIndexedDbTrainingOfflineStorage: typeof import('./storage').createIndexedDbTrainingOfflineStorage
}
