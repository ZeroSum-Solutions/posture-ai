import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { emitDataset } from './emit'
import type { ClientDataset } from './walk'

const client = (id: string, group: string, sessionCount: number): ClientDataset => ({
  clientId: id,
  group,
  sex: 'male',
  heightCm: 170,
  sessions: Array.from({ length: sessionCount }, (_, index) => ({
    index,
    date: null,
    extraData: null,
    adams: null,
    ribsAngle: null,
    photos: { front: null, back: null, side: null, adams: null },
  })),
  skeletons: { front: [], back: [], side: [] },
  debugLandmarks: [],
})

let outDir: string

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'moti-emit-'))
})

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('emitDataset', () => {
  test('writes one JSON file per client named by client id', () => {
    emitDataset([client('0774-AM-0001', 'version-1', 1)], outDir)
    const path = join(outDir, 'clients', '0774-AM-0001.json')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).clientId).toBe('0774-AM-0001')
  })

  test('writes an index with per-group and session totals', () => {
    emitDataset(
      [
        client('0774-AM-0001', 'version-1', 1),
        client('0774-AM-0052', 'both-versions', 2),
        client('0774-AM-0024', 'incomplete', 0),
      ],
      outDir,
    )
    const index = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'))
    expect(index.clientCount).toBe(3)
    expect(index.sessionCount).toBe(3)
    expect(index.groups).toEqual({
      'version-1': 1,
      'both-versions': 1,
      incomplete: 1,
    })
    expect(index.clients).toContain('0774-AM-0052')
  })
})
