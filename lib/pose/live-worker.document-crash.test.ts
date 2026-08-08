import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Node has the same missing-global shape as the reported WebKit module
// worker: neither document nor importScripts exists. Pointing the real
// resolver at the real vendored files drives MediaPipe's actual loader; the
// later model URL failure is the deterministic proof that wasm bootstrap got
// past both the document crash and ModuleFactory registration.
const REAL_WASM_DIR = fileURLToPath(new URL('../../public/mediapipe/wasm', import.meta.url))

vi.mock('./pose-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pose-model')>()
  return { ...actual, WASM_URL: REAL_WASM_DIR }
})

type PostedMessage = { type: string; code?: string; message?: string; [key: string]: unknown }
type MessageListener = (event: { data: unknown }) => void

describe('live pose worker startup in a WebKit-shaped module-worker scope', () => {
  let posted: PostedMessage[]
  let messageListener: MessageListener | null

  beforeEach(() => {
    posted = []
    messageListener = null
    expect(typeof document).toBe('undefined')
    expect(typeof (globalThis as unknown as { importScripts?: unknown }).importScripts).not.toBe('function')

    ;(globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {}
    ;(globalThis as unknown as { self: typeof globalThis }).self = globalThis
    ;(globalThis as unknown as { postMessage: (message: unknown) => void }).postMessage = message => {
      posted.push(message as PostedMessage)
    }
    ;(globalThis as unknown as { addEventListener: (type: string, listener: MessageListener) => void }).addEventListener = (type, listener) => {
      if (type === 'message') messageListener = listener
    }
  })

  afterEach(() => {
    for (const key of [
      'self',
      'postMessage',
      'addEventListener',
      'OffscreenCanvas',
      'importScripts',
      'import',
      'ModuleFactory',
      'Module',
      'custom_dbg',
    ]) {
      delete (globalThis as unknown as Record<string, unknown>)[key]
    }
  })

  it('boots the real wasm loader far enough to request the model asset', async () => {
    await import('./live-worker')
    expect(messageListener).not.toBeNull()

    messageListener!({ data: { type: 'init', preferCpu: true } })

    await vi.waitFor(
      () => expect(posted.some(message => message.type === 'error')).toBe(true),
      { timeout: 3_000 },
    )
    const error = posted.find(message => message.type === 'error')
    expect(error?.message).toMatch(/Failed to parse URL.*pose_landmarker_lite\.task/i)
    expect(error?.message).not.toMatch(/\bdocument\b|ModuleFactory|import\.meta/i)
    expect(posted.some(message => message.type === 'ready')).toBe(false)
  })
})
