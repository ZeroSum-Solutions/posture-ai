import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import clinicalContentInventory from '@/content/clinical-content-inventory.json'

const seedSql = readFileSync(resolve(process.cwd(), 'supabase/seed.sql'), 'utf8')
const inventorySha256 = clinicalContentInventory.inventory_sha256
const algorithmSha256 = clinicalContentInventory.items.find(
  (item) => item.id === 'algorithm:recommendation-engine',
)?.sha256

if (!algorithmSha256) throw new Error('Missing recommendation algorithm from clinical inventory')

const governedBindings = [
  {
    path: 'supabase/seed.sql',
    hashes: [inventorySha256, algorithmSha256],
  },
  {
    path: 'supabase/tests/clinical_content_governance_test.sql',
    hashes: [inventorySha256],
  },
  {
    path: 'supabase/tests/legal_document_provenance_test.sql',
    hashes: [inventorySha256],
  },
  {
    path: 'supabase/tests/privacy_lifecycle_test.sql',
    hashes: [inventorySha256],
  },
  {
    path: 'docs/qa/clinical-content-governance.md',
    hashes: [inventorySha256, algorithmSha256],
  },
] as const

function concreteSha256Literals(path: string) {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8')
  return [...new Set(source.match(/\b[0-9a-f]{64}\b/g) ?? [])]
    .filter((hash) => !/^([0-9a-f])\1{63}$/.test(hash))
    .sort()
}

type ClinicalReleaseTable =
  | 'public.clinical_content_releases'
  | 'private.clinical_content_activation'

function splitSqlValues(source: string): string[] {
  const values: string[] = []
  let current = ''
  let depth = 0
  let isQuoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === "'" && isQuoted && source[index + 1] === "'") {
      current += "''"
      index += 1
      continue
    }
    if (character === "'") isQuoted = !isQuoted
    if (!isQuoted && character === '(') depth += 1
    if (!isQuoted && character === ')') depth -= 1
    if (!isQuoted && depth === 0 && character === ',') {
      values.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  values.push(current.trim())
  return values
}

function inventoryShaFor(source: string, table: ClinicalReleaseTable) {
  const insert = source.match(new RegExp(
    `INSERT\\s+INTO\\s+${table.replace('.', '\\.')}\\s*`
      + String.raw`\(([^;]*?)\)\s*VALUES\s*\(([^;]*?)\)\s*;`,
  ))
  if (!insert) throw new Error(`Missing local clinical inventory fixture for ${table}`)

  const columns = insert[1].split(',').map((column) => column.trim())
  const values = splitSqlValues(insert[2])
  if (columns.length !== values.length) {
    throw new Error(`Column/value mismatch in local clinical inventory fixture for ${table}`)
  }

  const inventoryIndex = columns.indexOf('inventory_sha256')
  const literal = values[inventoryIndex]?.match(/^'([0-9a-f]{64})'$/)
  if (!literal?.[1]) {
    throw new Error(`Clinical inventory fixture for ${table} must use a literal SHA-256`)
  }
  return literal[1]
}

function replaceReleaseInventory(source: string, replacement: string) {
  const start = source.indexOf('INSERT INTO public.clinical_content_releases')
  const end = source.indexOf(';', start)
  if (start < 0 || end < 0) throw new Error('Missing local clinical release fixture')

  const statement = source.slice(start, end + 1)
  const replaced = statement.replace(`'${inventorySha256}'`, replacement)
  if (replaced === statement) throw new Error('Missing release inventory literal')
  return source.slice(0, start) + replaced + source.slice(end + 1)
}

describe('local QA clinical content provenance', () => {
  test('binds the seeded release and activation to the current source inventory', () => {
    expect(inventoryShaFor(seedSql, 'public.clinical_content_releases')).toBe(
      inventorySha256,
    )
    expect(inventoryShaFor(seedSql, 'private.clinical_content_activation')).toBe(
      inventorySha256,
    )
  })

  test('reads the release and activation bindings from their own statements', () => {
    const staleReleaseSha = 'a'.repeat(64)
    const staleReleaseSeed = replaceReleaseInventory(seedSql, `'${staleReleaseSha}'`)

    expect(inventoryShaFor(staleReleaseSeed, 'public.clinical_content_releases')).toBe(
      staleReleaseSha,
    )
    expect(inventoryShaFor(staleReleaseSeed, 'private.clinical_content_activation')).toBe(
      inventorySha256,
    )
  })

  test('rejects a computed release hash instead of accepting another statement', () => {
    const computedReleaseSeed = replaceReleaseInventory(seedSql, "repeat('a', 64)")

    expect(() => inventoryShaFor(
      computedReleaseSeed,
      'public.clinical_content_releases',
    )).toThrow('must use a literal SHA-256')
  })

  test.each(governedBindings)(
    '$path contains only current generated clinical hashes',
    ({ path, hashes }) => {
      expect(concreteSha256Literals(path)).toEqual([...hashes].sort())
    },
  )
})
