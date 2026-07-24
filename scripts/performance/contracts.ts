import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PERFORMANCE_FIXTURE_COUNTS = [150, 300, 1000] as const
export const PERFORMANCE_PAGE_LIMIT = 50
export const PERFORMANCE_WARMUPS = 5
export const PERFORMANCE_MEASUREMENTS = 40

/** Works for direct Node execution and for vite-node, which keeps its own CLI at argv[1]. */
export function isCliEntry(moduleUrl: string, argv: readonly string[] = process.argv): boolean {
  const modulePath = resolve(fileURLToPath(moduleUrl))
  // vite-node intentionally replaces argv with only `[node, vite-node]`; it does
  // not retain the executed source path. Performance entry files are not
  // libraries, so a vite-node process is their direct CLI execution context.
  if (/(?:^|\/)vite-node(?:\.mjs)?$/.test(argv[1] ?? '')) return true
  return argv.slice(1).some((argument) => {
    if (!argument || argument.startsWith('-')) return false
    try {
      return resolve(argument) === modulePath
    } catch {
      return false
    }
  })
}

const LOOPBACK_V4 = /^127(?:\.(?:\d{1,3})){3}$/

export function assertLoopbackUrl(
  label: string,
  raw: string,
  allowedProtocols: readonly string[],
): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const isV4Loopback = LOOPBACK_V4.test(hostname)
    && hostname.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
  if (hostname !== 'localhost' && hostname !== '::1' && !isV4Loopback) {
    throw new Error(`${label} must use a loopback host; refusing ${parsed.hostname}`)
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label} must use one of: ${allowedProtocols.join(', ')}`)
  }
  return parsed
}

export function assertPerformanceUrls(input: {
  appUrl: string
  supabaseUrl: string
  databaseUrl: string
}) {
  const app = assertLoopbackUrl('PERF_APP_URL', input.appUrl, ['http:', 'https:'])
  const supabase = assertLoopbackUrl('PERF_SUPABASE_URL', input.supabaseUrl, ['http:', 'https:'])
  const database = assertLoopbackUrl('PERF_DB_URL', input.databaseUrl, ['postgres:', 'postgresql:'])
  if (app.username || app.password || supabase.username || supabase.password) {
    throw new Error('HTTP performance URLs must not contain credentials')
  }
  return { app, supabase, database }
}

export function deterministicUuid(name: string): string {
  const bytes = createHash('sha256').update(`posture-ai-pr09-performance:${name}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export type QueriedFixtureCounts = Readonly<{
  activeClients: number
  completeAnchorAssessments: number
  assessmentFindings: number
  findingsPerAssessment: number
}>

export function assertExactFixtureCounts(
  expectedRecords: number,
  counts: QueriedFixtureCounts,
): void {
  const expectedFindings = expectedRecords * counts.findingsPerAssessment
  const mismatches = [
    counts.activeClients === expectedRecords ? null : `active clients ${counts.activeClients} != ${expectedRecords}`,
    counts.completeAnchorAssessments === expectedRecords
      ? null
      : `complete anchor assessments ${counts.completeAnchorAssessments} != ${expectedRecords}`,
    counts.assessmentFindings === expectedFindings
      ? null
      : `assessment findings ${counts.assessmentFindings} != ${expectedFindings}`,
  ].filter((value): value is string => value !== null)
  if (mismatches.length) throw new Error(`Performance fixture count mismatch: ${mismatches.join('; ')}`)
}

export function assertFixtureRestored(expectedRecords: number, actualRecords: number, context: string) {
  if (actualRecords !== expectedRecords) {
    throw new Error(
      `Performance fixture was not restored after ${context}: ${actualRecords} records != ${expectedRecords}`,
    )
  }
}

export async function withExactFixtureRestoration<T>(input: {
  expectedRecords: number
  context: string
  countRecords: () => Promise<number>
  cleanup: () => Promise<void>
  run: () => Promise<T>
}): Promise<T> {
  assertFixtureRestored(input.expectedRecords, await input.countRecords(), `${input.context}:before`)
  try {
    return await input.run()
  } finally {
    await input.cleanup()
    assertFixtureRestored(input.expectedRecords, await input.countRecords(), `${input.context}:cleanup`)
  }
}

export type TimedCursorPage = Readonly<{
  ids: readonly string[]
  nextCursor: string | null
  hasMore: boolean
  durationMilliseconds: number
  decodedResponseBodyUtf8Bytes: number
  responseContentEncoding: string
  status: number
}>

export type TraversalIntegrity = Readonly<{
  expectedRecordCount: number
  returnedRecordCount: number
  uniqueRecordCount: number
  duplicateRecordCount: number
  omittedRecordCount: number
  unexpectedRecordCount: number
  concurrentRecordReturned: boolean
  pageCount: number
  maximumPageRecords: number
  maximumResponseBytes: number
}>

export function summarizeTraversal(
  expectedIds: readonly string[],
  returnedIds: readonly string[],
  concurrentId: string,
  pages: readonly TimedCursorPage[],
): TraversalIntegrity {
  const expected = new Set(expectedIds)
  const returned = new Set(returnedIds)
  let duplicateRecordCount = 0
  const seen = new Set<string>()
  for (const id of returnedIds) {
    if (seen.has(id)) duplicateRecordCount += 1
    seen.add(id)
  }
  let omittedRecordCount = 0
  for (const id of expected) if (!returned.has(id)) omittedRecordCount += 1
  let unexpectedRecordCount = 0
  for (const id of returned) if (!expected.has(id)) unexpectedRecordCount += 1
  return {
    expectedRecordCount: expected.size,
    returnedRecordCount: returnedIds.length,
    uniqueRecordCount: returned.size,
    duplicateRecordCount,
    omittedRecordCount,
    unexpectedRecordCount,
    concurrentRecordReturned: returned.has(concurrentId),
    pageCount: pages.length,
    maximumPageRecords: Math.max(0, ...pages.map((page) => page.ids.length)),
    maximumResponseBytes: Math.max(0, ...pages.map((page) => page.decodedResponseBodyUtf8Bytes)),
  }
}

export async function traverseCursorPages(input: {
  expectedIds: readonly string[]
  concurrentId: string
  requestPage: (cursor: string | null) => Promise<TimedCursorPage>
  insertNewerAfterFirstPage: (firstPage: TimedCursorPage) => Promise<void>
  maximumPages?: number
}) {
  const pages: TimedCursorPage[] = []
  const returnedIds: string[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  const maximumPages = input.maximumPages ?? Math.ceil(input.expectedIds.length / PERFORMANCE_PAGE_LIMIT) + 2

  for (let pageIndex = 0; pageIndex < maximumPages; pageIndex += 1) {
    const page = await input.requestPage(cursor)
    if (page.status !== 200) throw new Error(`Cursor traversal request failed with HTTP ${page.status}`)
    if (page.ids.length > PERFORMANCE_PAGE_LIMIT) {
      throw new Error(`Cursor traversal page exceeded ${PERFORMANCE_PAGE_LIMIT} records`)
    }
    pages.push(page)
    returnedIds.push(...page.ids)
    if (pageIndex === 0) await input.insertNewerAfterFirstPage(page)
    if (!page.hasMore) {
      if (page.nextCursor !== null) throw new Error('Terminal cursor page unexpectedly supplied a cursor')
      return {
        pages,
        returnedIds,
        integrity: summarizeTraversal(input.expectedIds, returnedIds, input.concurrentId, pages),
      }
    }
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      throw new Error('Cursor traversal did not make forward progress')
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error(`Cursor traversal exceeded ${maximumPages} pages`)
}
