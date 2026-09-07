import { describe, expect, it } from 'vitest'
import { isDemoPage, isDemoRequest } from './paths'
import { classifyAuthPath } from '@/lib/auth/public-paths'

describe('prototype route boundary', () => {
  it.each(['/demo', '/demo/scan', '/demo/workouts', '/demo/workouts/local-session'])('opens only local prototype page %s', path => {
    expect(isDemoPage(path)).toBe(true)
    expect(isDemoRequest(path)).toBe(true)
    expect(classifyAuthPath(path, 'production')).toBe('public')
  })
  it('opens only the one independently guarded generation endpoint', () => {
    expect(isDemoRequest('/api/demo/workouts/generate')).toBe(true)
  })
  it.each(['/mediapipe/models/pose_landmarker_lite.task', '/mediapipe/models/pose_landmarker_full.task', '/mediapipe/wasm/vision_wasm_internal.js', '/mediapipe/wasm/vision_wasm_internal.wasm', '/mediapipe/wasm/vision_wasm_nosimd_internal.js', '/mediapipe/wasm/vision_wasm_nosimd_internal.wasm', '/mediapipe/wasm/vision_wasm_module_internal.js', '/mediapipe/wasm/vision_wasm_module_internal.wasm'])('loads public pose-only asset %s for signed-out detection', path => {
    expect(isDemoRequest(path)).toBe(true)
    expect(classifyAuthPath(path, 'production')).toBe('public')
    expect(isDemoPage(path)).toBe(false)
  })
  it.each(['/mediapipe', '/mediapipe/wasm', '/mediapipe/wasm/vision_wasm_internal.js/admin', '/mediapipe/models/face_landmarker.task', '/demographics', '/demo-admin', '/api/demo', '/api/demo/workouts', '/api/demo/workouts/generate/admin', '/api/clients', '/assessments', '/workouts', '/demos'])('does not bypass authorization for %s', path => {
    expect(isDemoRequest(path)).toBe(false)
    expect(classifyAuthPath(path, 'production')).toBe('protected')
  })
})
