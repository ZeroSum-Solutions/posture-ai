import { createHash } from 'node:crypto'

export type TierBSha256 = `sha256:${string}`

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  const count = Math.min(a.length, b.length)
  for (let index = 0; index < count; index++) {
    const delta = a[index].codePointAt(0)! - b[index].codePointAt(0)!
    if (delta !== 0) return delta
  }
  return a.length - b.length
}

function canonicalValue(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Tier B canonical JSON requires finite numbers')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Tier B canonical JSON cannot represent ${typeof value}`)
  }
  if (seen.has(value)) throw new TypeError('Tier B canonical JSON cannot represent cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError('Tier B canonical JSON cannot represent sparse arrays')
        }
      }
      return `[${value.map((entry) => canonicalValue(entry, seen)).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Tier B canonical JSON requires plain objects')
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(compareCodePoints)
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${canonicalValue(record[key], seen)}`,
    ).join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalizeTierB(value: unknown): string {
  return canonicalValue(value, new Set())
}

export function sha256TierB(value: unknown): TierBSha256 {
  const digest = createHash('sha256').update(canonicalizeTierB(value), 'utf8').digest('hex')
  return `sha256:${digest}`
}

export function sha256TierBBytes(bytes: Uint8Array): TierBSha256 {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function parseCanonicalTierBJson(text: string): unknown {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new TypeError(`Tier B JSON is invalid: ${error instanceof Error ? error.message : 'parse error'}`)
  }
  if (canonicalizeTierB(value) !== text) {
    throw new TypeError('Tier B JSON bytes are not canonical')
  }
  return value
}
