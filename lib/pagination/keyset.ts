import { createHash } from 'node:crypto'

export const MAX_PAGE_SIZE = 50
const CURSOR_VERSION = 1
const MAX_CURSOR_LENGTH = 2_048
const MAX_SCOPE_LENGTH = 80
const MAX_FILTER_KEY_LENGTH = 1_024
const MAX_ID_LENGTH = 200
const UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+00:00)$/

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
  snapshotAt: string
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

function parseUtcTimestamp(value: string) {
  const match = UTC_TIMESTAMP_PATTERN.exec(value)
  if (!match) return null
  const [, wholeSeconds, rawFraction = ''] = match
  const fraction = rawFraction.padEnd(6, '0')
  const millisecondTimestamp = `${wholeSeconds}.${fraction.slice(0, 3)}Z`
  const parsed = new Date(millisecondTimestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== wholeSeconds) return null

  // Keep millisecond timestamps compatible with existing v1 cursors, but retain
  // all six digits whenever PostgreSQL supplied meaningful microseconds.
  const canonicalFraction = fraction.slice(3) === '000' ? fraction.slice(0, 3) : fraction
  return {
    canonical: `${wholeSeconds}.${canonicalFraction}Z`,
    sortKey: `${wholeSeconds}.${fraction}`,
  }
}

export function canonicalizeKeysetTimestamp(value: string): string {
  const parsed = parseUtcTimestamp(value)
  if (!parsed) throw new Error('Invalid cursor timestamp')
  return parsed.canonical
}

export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false
  return parseUtcTimestamp(value)?.canonical === value
}

function compareCanonicalTimestamps(left: string, right: string): number {
  const leftTimestamp = parseUtcTimestamp(left)
  const rightTimestamp = parseUtcTimestamp(right)
  if (!leftTimestamp || !rightTimestamp) throw new Error('Invalid cursor timestamp')
  return leftTimestamp.sortKey.localeCompare(rightTimestamp.sortKey)
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
    now?: () => Date
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
    const snapshotAt = (options.now ?? (() => new Date()))().toISOString()
    return { ok: true, value: { limit, snapshotAt, after: null } }
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
