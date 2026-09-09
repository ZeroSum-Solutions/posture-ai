import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import snapshotJson from '../../../content/training/library/wger-english-2026-09-08.json'
import supplementJson from '../../../content/training/library/wger-1652-media-pilot-2026-09-08.json'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

describe('manual routine reference provenance seed', () => {
  it('pins every combined-library record to its canonical source hash', () => {
    const migration = readFileSync(new URL(
      '../../../supabase/migrations/20260907054000_training_manual_reference_routines.sql',
      import.meta.url,
    ), 'utf8')
    const records = [...snapshotJson.records, supplementJson.record]
    expect(records).toHaveLength(280)

    for (const record of records) {
      const hash = createHash('sha256').update(canonicalJson(record)).digest('hex')
      expect(migration).toContain(`('${record.id}'`)
      expect(migration).toContain(`'${hash}'`)
    }
  })
})
