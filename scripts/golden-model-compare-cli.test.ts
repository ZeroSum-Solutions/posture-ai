import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { TIER_B_RELIABILITY_ONLY_PROTOCOL } from './golden-model-compare-core.mjs'

const ROOT = resolve(__dirname, '..')
const temporaryRoots: string[] = []

function fixtureDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'posture-ai-model-compare-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'participant-01'))
  return root
}

function run(directory: string) {
  return spawnSync('node', ['scripts/golden-model-compare.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDEN_MODEL_COMPARE_DIR: directory,
    },
  })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('golden model-comparison CLI evidence boundary', () => {
  it('makes the real wrapper reject paired Tier B repeatability evidence', () => {
    const directory = fixtureDirectory()
    const subject = join(directory, 'participant-01')
    const payload = {
      protocolVersion: TIER_B_RELIABILITY_ONLY_PROTOCOL,
      studyPurpose: 'repeatability',
      frames: [],
    }
    writeFileSync(join(subject, 'front-lite.json'), JSON.stringify(payload))
    writeFileSync(join(subject, 'front-full.json'), JSON.stringify(payload))

    const result = run(directory)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/reliability-only.*cannot adjudicate a model default/i)
  })

  it('fails closed when a lite input has no full-model pair', () => {
    const directory = fixtureDirectory()
    writeFileSync(join(
      directory,
      'participant-01',
      'front-lite.json',
    ), JSON.stringify({ studyPurpose: 'accuracy', frames: [] }))

    const result = run(directory)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unpaired model-comparison files')
  })
})
