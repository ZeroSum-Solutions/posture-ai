import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installImportScriptsFallback,
  mediaPipeModuleLoaderUrl,
} from './import-scripts-fallback'

const scope = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  for (const key of ['document', 'importScripts', 'import']) delete scope[key]
})

describe('MediaPipe module-worker compatibility', () => {
  it('maps the classic SIMD loader to the ES module loader', () => {
    expect(mediaPipeModuleLoaderUrl('/mediapipe/wasm/vision_wasm_internal.js')).toBe(
      '/mediapipe/wasm/vision_wasm_module_internal.js',
    )
  })

  it('installs the upstream import hook only in a worker missing importScripts', async () => {
    const loadModule = vi.fn(async () => undefined)

    installImportScriptsFallback(loadModule)

    expect(() => (scope.importScripts as () => void)()).toThrow(TypeError)
    await (scope.import as (url: string) => Promise<void>)(
      'https://posture.test/mediapipe/wasm/vision_wasm_internal.js?build=1',
    )
    expect(loadModule).toHaveBeenCalledWith(
      'https://posture.test/mediapipe/wasm/vision_wasm_module_internal.js?build=1',
    )
  })

  it('does not replace Chromium module-worker importScripts', () => {
    const importScripts = vi.fn()
    const loadModule = vi.fn(async () => undefined)
    scope.importScripts = importScripts

    installImportScriptsFallback(loadModule)

    expect(scope.importScripts).toBe(importScripts)
    expect(scope.import).toBeUndefined()
  })

  it('does not install worker globals on the main thread', () => {
    const loadModule = vi.fn(async () => undefined)
    scope.document = {}

    installImportScriptsFallback(loadModule)

    expect(scope.importScripts).toBeUndefined()
    expect(scope.import).toBeUndefined()
  })
})
