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
import { generatePose } from '../packages/posture-engine/golden/synthetic'
import {
  MODEL_COMPARISON_ASSET_SHA256,
  TIER_B_RELIABILITY_ONLY_PROTOCOL,
} from './golden-model-compare-core.mjs'

const ROOT = resolve(__dirname, '..')
const CAPTURE_HMAC = `hmac-sha256:${'a'.repeat(64)}`
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
  it('runs an exact paired accuracy-study metric through the real engine wrapper', () => {
    const directory = fixtureDirectory()
    const subject = join(directory, 'participant-01')
    const payload = {
      protocolVersion: 'measured-reference-v1',
      studyPurpose: 'accuracy',
      groundTruth: { anterior_imbalanced_shoulders: 4 },
    }
    writeFileSync(join(subject, 'front-lite.json'), JSON.stringify({
      ...payload,
      modelVariant: 'lite',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.lite,
      sourceCaptureHmacSha256: CAPTURE_HMAC,
      frames: [generatePose('front', { shoulderTiltDeg: 4 })],
    }))
    writeFileSync(join(subject, 'front-full.json'), JSON.stringify({
      ...payload,
      modelVariant: 'full',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.full,
      sourceCaptureHmacSha256: CAPTURE_HMAC,
      frames: [generatePose('front', { shoulderTiltDeg: 4 })],
    }))

    const result = run(directory)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('anterior_imbalanced_shoulders')
    expect(result.stdout).toContain('ADVISORY VERDICT: full-default = false')
  })

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
    expect(result.stderr).toContain('missing full')
  })

  it('fails closed when a full input has no lite-model pair', () => {
    const directory = fixtureDirectory()
    writeFileSync(join(
      directory,
      'participant-01',
      'front-full.json',
    ), JSON.stringify({ studyPurpose: 'accuracy', frames: [] }))

    const result = run(directory)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unpaired model-comparison files')
    expect(result.stderr).toContain('missing lite')
  })

  it('rejects paired files with different measured ground truth', () => {
    const directory = fixtureDirectory()
    const subject = join(directory, 'participant-01')
    writeFileSync(join(subject, 'front-lite.json'), JSON.stringify({
      studyPurpose: 'accuracy',
      protocolVersion: 'measured-reference-v1',
      modelVariant: 'lite',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.lite,
      sourceCaptureHmacSha256: CAPTURE_HMAC,
      frames: [],
      groundTruth: { trunk_lean: 8 },
    }))
    writeFileSync(join(subject, 'front-full.json'), JSON.stringify({
      studyPurpose: 'accuracy',
      protocolVersion: 'measured-reference-v1',
      modelVariant: 'full',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.full,
      sourceCaptureHmacSha256: CAPTURE_HMAC,
      frames: [],
      groundTruth: { trunk_lean: 9 },
    }))

    const result = run(directory)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/identical measured values.*trunk_lean/i)
  })

  it('rejects swapped model identities or mismatched source captures', () => {
    const directory = fixtureDirectory()
    const subject = join(directory, 'participant-01')
    const shared = {
      studyPurpose: 'accuracy',
      protocolVersion: 'measured-reference-v1',
      frames: [],
      groundTruth: { trunk_lean: 8 },
    }
    writeFileSync(join(subject, 'front-lite.json'), JSON.stringify({
      ...shared,
      modelVariant: 'full',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.full,
      sourceCaptureHmacSha256: CAPTURE_HMAC,
    }))
    writeFileSync(join(subject, 'front-full.json'), JSON.stringify({
      ...shared,
      modelVariant: 'lite',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.lite,
      sourceCaptureHmacSha256: `hmac-sha256:${'b'.repeat(64)}`,
    }))

    const result = run(directory)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/filename-designated lite and full/i)
  })

  it('rejects privacy-bearing extra evidence fields in the real wrapper', () => {
    const directory = fixtureDirectory()
    const subject = join(directory, 'participant-01')
    const shared = {
      studyPurpose: 'accuracy',
      protocolVersion: 'measured-reference-v1',
      sourceCaptureHmacSha256: CAPTURE_HMAC,
      frames: [],
      groundTruth: { trunk_lean: 8 },
    }
    writeFileSync(join(subject, 'front-lite.json'), JSON.stringify({
      ...shared,
      modelVariant: 'lite',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.lite,
      rawPhotoHash: `sha256:${'c'.repeat(64)}`,
    }))
    writeFileSync(join(subject, 'front-full.json'), JSON.stringify({
      ...shared,
      modelVariant: 'full',
      modelAssetSha256: MODEL_COMPARISON_ASSET_SHA256.full,
    }))

    const result = run(directory)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/only the exact governed evidence fields/i)
  })

  it('fails closed on a misnamed or unclassified comparison JSON', () => {
    const directory = fixtureDirectory()
    writeFileSync(join(
      directory,
      'participant-01',
      'front_lite.json',
    ), JSON.stringify({ studyPurpose: 'accuracy', frames: [] }))

    const result = run(directory)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unclassified model-comparison JSON files')
    expect(result.stderr).toContain('participant-01/front_lite.json')
  })
})
