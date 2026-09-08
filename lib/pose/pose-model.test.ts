import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json'
import {
  FULL_MODEL_URL,
  LITE_MODEL_URL,
  POSE_MODEL_SHA256,
  POSE_RUNTIME_VERSION,
} from './pose-model'

function sha256ForPublicAsset(assetPath: string): string {
  return createHash('sha256')
    .update(readFileSync(join(process.cwd(), 'public', assetPath.replace(/^\//, ''))))
    .digest('hex')
}

describe('pose model provenance constants', () => {
  it('matches the installed runtime and exact bundled model bytes', () => {
    expect(packageJson.dependencies['@mediapipe/tasks-vision']).toBe(POSE_RUNTIME_VERSION)
    expect(sha256ForPublicAsset(LITE_MODEL_URL)).toBe(POSE_MODEL_SHA256.lite)
    expect(sha256ForPublicAsset(FULL_MODEL_URL)).toBe(POSE_MODEL_SHA256.full)
  })
})
