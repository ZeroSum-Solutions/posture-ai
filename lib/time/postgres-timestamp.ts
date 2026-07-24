const RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/

type ParsedPostgresTimestamp = {
  canonical: string
  sortKey: string
}

function parsePostgresTimestamp(value: string): ParsedPostgresTimestamp | null {
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value)
  if (!match) return null
  const [, wholeSeconds, rawFraction = '', , offsetSign, rawOffsetHours, rawOffsetMinutes] = match
  const fraction = rawFraction.padEnd(6, '0')
  const wallClockMillis = Date.parse(`${wholeSeconds}.000Z`)
  if (!Number.isFinite(wallClockMillis) || new Date(wallClockMillis).toISOString().slice(0, 19) !== wholeSeconds) {
    return null
  }
  const offsetHours = Number(rawOffsetHours ?? 0)
  const offsetMinutes = Number(rawOffsetMinutes ?? 0)
  if (offsetHours > 23 || offsetMinutes > 59) return null
  const offsetDirection = offsetSign === '-' ? -1 : offsetSign === '+' ? 1 : 0
  const utcMillis = wallClockMillis - offsetDirection * (offsetHours * 60 + offsetMinutes) * 60_000
  const utcWholeSeconds = new Date(utcMillis).toISOString().slice(0, 19)

  // Retain PostgreSQL's meaningful microseconds. Millisecond-only timestamps
  // keep their established v1 representation for backward-compatible cursors.
  const canonicalFraction = fraction.slice(3) === '000' ? fraction.slice(0, 3) : fraction
  return {
    canonical: `${utcWholeSeconds}.${canonicalFraction}Z`,
    sortKey: `${utcWholeSeconds}.${fraction}`,
  }
}

export function canonicalizePostgresTimestamp(value: string): string | null {
  return parsePostgresTimestamp(value)?.canonical ?? null
}

export function isCanonicalPostgresTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.endsWith('Z')
    && canonicalizePostgresTimestamp(value) === value
}

export function comparePostgresTimestamps(left: string, right: string): number | null {
  const leftTimestamp = parsePostgresTimestamp(left)
  const rightTimestamp = parsePostgresTimestamp(right)
  if (leftTimestamp && rightTimestamp) {
    const order = leftTimestamp.sortKey.localeCompare(rightTimestamp.sortKey)
    return order < 0 ? -1 : order > 0 ? 1 : 0
  }

  // Preserve the established comparison contract for legacy date-only inputs.
  // Persisted RFC 3339 database values always take the exact path above.
  const leftMillis = Date.parse(left)
  const rightMillis = Date.parse(right)
  if (!Number.isFinite(leftMillis) || !Number.isFinite(rightMillis)) return null
  return leftMillis < rightMillis ? -1 : leftMillis > rightMillis ? 1 : 0
}
