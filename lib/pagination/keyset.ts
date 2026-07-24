import { createHash } from 'node:crypto'
import {
  canonicalizePostgresTimestamp,
  comparePostgresTimestamps,
  isCanonicalPostgresTimestamp,
} from '@/lib/time/postgres-timestamp'

export const MAX_PAGE_SIZE = 50
const CURSOR_VERSION = 1
const MAX_CURSOR_LENGTH = 2_048
const MAX_SCOPE_LENGTH = 80
const MAX_FILTER_KEY_LENGTH = 1_024
const MAX_ID_LENGTH = 200

export interface KeysetPosition {
  at: string
  id: string
}

export interface KeysetRow {
  id: string
  created_at: string
}

interface CursorPayload {
  version: typeof CURSOR_VERSION
  scope: string
  filterHash: string
  snapshotAt: string
  after: KeysetPosition
}

export interface ParsedKeysetPage {
  limit: number
  snapshotAt: string | null
  after: KeysetPosition | null
}

type ParseResult =
  | { ok: true; value: ParsedKeysetPage }
  | { ok: false; error: 'Invalid limit' | 'Invalid cursor' | 'Cursor does not match this request' }

export function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

function filterHash(filterKey: string): string {
  return createHash('sha256').update(filterKey).digest('hex')
}

export function canonicalizeKeysetTimestamp(value: string): string {
  const canonical = canonicalizePostgresTimestamp(value)
  if (!canonical) throw new Error('Invalid cursor timestamp')
  return canonical
}

export function isCanonicalIsoTimestamp(value: unknown): value is string {
  return isCanonicalPostgresTimestamp(value)
}

function compareCanonicalTimestamps(left: string, right: string): number {
  const order = comparePostgresTimestamps(left, right)
  if (order === null) throw new Error('Invalid cursor timestamp')
  return order
}

function exactObjectKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index])
}

function decodeCursor(raw: string): CursorPayload | null {
  if (!raw || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const cursor = parsed as Record<string, unknown>
    if (!exactObjectKeys(cursor, ['version', 'scope', 'filterHash', 'snapshotAt', 'after'])) return null
    if (cursor.version !== CURSOR_VERSION) return null
    if (typeof cursor.scope !== 'string' || !cursor.scope || cursor.scope.length > MAX_SCOPE_LENGTH) return null
    if (typeof cursor.filterHash !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.filterHash)) return null
    if (!isCanonicalIsoTimestamp(cursor.snapshotAt)) return null
    if (!cursor.after || typeof cursor.after !== 'object' || Array.isArray(cursor.after)) return null
    const after = cursor.after as Record<string, unknown>
    if (!exactObjectKeys(after, ['at', 'id'])) return null
    if (!isCanonicalIsoTimestamp(after.at)) return null
    if (typeof after.id !== 'string' || !after.id || after.id.length > MAX_ID_LENGTH) return null
    if (compareCanonicalTimestamps(after.at, cursor.snapshotAt) > 0) return null
    return cursor as unknown as CursorPayload
  } catch {
    return null
  }
}

export function encodeKeysetCursor(input: {
  scope: string
  filterKey: string
  snapshotAt: string
  after: KeysetPosition
}): string {
  if (!input.scope || input.scope.length > MAX_SCOPE_LENGTH) throw new Error('Invalid cursor scope')
  if (input.filterKey.length > MAX_FILTER_KEY_LENGTH) throw new Error('Invalid cursor filter')
  if (!isCanonicalIsoTimestamp(input.snapshotAt) || !isCanonicalIsoTimestamp(input.after.at)) throw new Error('Invalid cursor timestamp')
  if (!input.after.id || input.after.id.length > MAX_ID_LENGTH) throw new Error('Invalid cursor id')
  if (compareCanonicalTimestamps(input.after.at, input.snapshotAt) > 0) throw new Error('Cursor position exceeds snapshot')

  const payload: CursorPayload = {
    version: CURSOR_VERSION,
    scope: input.scope,
    filterHash: filterHash(input.filterKey),
    snapshotAt: input.snapshotAt,
    after: input.after,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function parseKeysetPageRequest(
  searchParams: URLSearchParams,
  options: {
    scope: string
    filterKey: string
    isValidId?: (id: string) => boolean
  },
): ParseResult {
  const limitValues = searchParams.getAll('limit')
  const cursorValues = searchParams.getAll('cursor')
  if (limitValues.length > 1) return { ok: false, error: 'Invalid limit' }
  if (cursorValues.length > 1) return { ok: false, error: 'Invalid cursor' }
  if (!options.scope || options.scope.length > MAX_SCOPE_LENGTH || options.filterKey.length > MAX_FILTER_KEY_LENGTH) {
    return { ok: false, error: 'Invalid cursor' }
  }

  const rawLimit = limitValues[0]
  const limit = rawLimit === undefined ? MAX_PAGE_SIZE : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || String(limit) !== (rawLimit ?? String(MAX_PAGE_SIZE))) {
    return { ok: false, error: 'Invalid limit' }
  }

  const rawCursor = cursorValues[0]
  if (!rawCursor) {
    // A JavaScript Date has only millisecond precision. The owning route must
    // bind first-page traversal to a database-issued microsecond snapshot.
    return { ok: true, value: { limit, snapshotAt: null, after: null } }
  }

  const cursor = decodeCursor(rawCursor)
  if (!cursor) return { ok: false, error: 'Invalid cursor' }
  if (options.isValidId && !options.isValidId(cursor.after.id)) {
    return { ok: false, error: 'Invalid cursor' }
  }
  if (cursor.scope !== options.scope || cursor.filterHash !== filterHash(options.filterKey)) {
    return { ok: false, error: 'Cursor does not match this request' }
  }
  return {
    ok: true,
    value: {
      limit,
      snapshotAt: cursor.snapshotAt,
      after: cursor.after,
    },
  }
}

export function finalizeKeysetPage<Row>(
  rows: Row[],
  options: {
    scope: string
    filterKey: string
    snapshotAt: string
    limit: number
    key: (row: Row) => KeysetPosition
  },
) {
  if (rows.length > options.limit + 1) {
    throw new Error('Keyset query returned more than one look-ahead row')
  }
  const hasMore = rows.length > options.limit
  const records = hasMore ? rows.slice(0, options.limit) : rows
  const last = records.at(-1)
  const nextCursor = hasMore && last
    ? encodeKeysetCursor({
        scope: options.scope,
        filterKey: options.filterKey,
        snapshotAt: options.snapshotAt,
        after: options.key(last),
      })
    : null

  return {
    records,
    pagination: {
      limit: options.limit,
      returned: records.length,
      has_more: hasMore,
      next_cursor: nextCursor,
      snapshot_at: options.snapshotAt,
    },
  }
}
