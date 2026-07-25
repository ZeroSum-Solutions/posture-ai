import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createNodeTierBArtifactReader,
  TierBArtifactVerificationError,
} from './tierb-validator'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'posture-ai-tierb-'))
  roots.push(root)
  return root
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('Tier B descriptor-bound artifact reader', () => {
  it('reads a canonical artifact through the verified descriptor', () => {
    const root = temporaryRoot()
    const bytes = Buffer.from('{"a":1}')
    writeFileSync(join(root, 'landmark.json'), bytes)
    const result = createNodeTierBArtifactReader(root).readVerified({
      path: 'landmark.json',
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
      mime: 'application/json',
    })

    expect(Buffer.from(result.bytes)).toEqual(bytes)
    expect(result.sha256).toBe(sha256(bytes))
  })

  it('accepts a structurally valid JPEG and rejects magic-byte-only impostors', () => {
    const root = temporaryRoot()
    const jpeg = readFileSync(new URL(
      '../../e2e/fixtures/photos/front_standing.jpg',
      import.meta.url,
    ))
    const truncatedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00])
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not-a-png'),
    ])
    writeFileSync(join(root, 'valid.jpg'), jpeg)
    writeFileSync(join(root, 'truncated.jpg'), truncatedJpeg)
    writeFileSync(join(root, 'polyglot.png'), fakePng)
    const reader = createNodeTierBArtifactReader(root)

    expect(reader.readVerified({
      path: 'valid.jpg',
      sha256: sha256(jpeg),
      byteLength: jpeg.byteLength,
      mime: 'image/jpeg',
    }).mime).toBe('image/jpeg')

    for (const [path, bytes, mime] of [
      ['truncated.jpg', truncatedJpeg, 'image/jpeg'],
      ['polyglot.png', fakePng, 'image/png'],
    ] as const) {
      expect(() => reader.readVerified({
        path,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        mime,
      })).toThrowError(expect.objectContaining({
        code: 'ARTIFACT_MIME_MISMATCH',
      }) as TierBArtifactVerificationError)
    }
  })

  it('rejects traversal, symlinks, and noncanonical JSON bytes', () => {
    const root = temporaryRoot()
    const outsideRoot = temporaryRoot()
    const outside = join(outsideRoot, 'outside.json')
    writeFileSync(outside, '{"a":1}')
    symlinkSync(outside, join(root, 'linked.json'))
    const noncanonical = Buffer.from('{"b":2,"a":1}')
    writeFileSync(join(root, 'noncanonical.json'), noncanonical)
    const reader = createNodeTierBArtifactReader(root)

    expect(() => reader.readVerified({
      path: '../outside.json',
      sha256: sha256(Buffer.from('{"a":1}')),
      byteLength: 7,
      mime: 'application/json',
    })).toThrowError(expect.objectContaining({
      code: 'ARTIFACT_PATH_INVALID',
    }) as TierBArtifactVerificationError)

    expect(() => reader.readVerified({
      path: 'linked.json',
      sha256: sha256(Buffer.from('{"a":1}')),
      byteLength: 7,
      mime: 'application/json',
    })).toThrowError(expect.objectContaining({
      code: 'ARTIFACT_SYMLINK',
    }) as TierBArtifactVerificationError)

    expect(() => reader.readVerified({
      path: 'noncanonical.json',
      sha256: sha256(noncanonical),
      byteLength: noncanonical.byteLength,
      mime: 'application/json',
    })).toThrowError(expect.objectContaining({
      code: 'ARTIFACT_CANONICAL_BYTES_MISMATCH',
    }) as TierBArtifactVerificationError)
  })
})
