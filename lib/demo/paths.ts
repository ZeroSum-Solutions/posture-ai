/** The prototype owns browser-local data only; no practitioner route is included. */
export function isDemoPage(pathname: string): boolean {
  return pathname === '/demo' || pathname.startsWith('/demo/')
}

export function isDemoRequest(pathname: string): boolean {
  return isDemoPage(pathname) || pathname === '/api/demo/workouts/generate' || POSE_ASSETS.has(pathname)
}

// These immutable public model/runtime files contain no user data. Keep the
// allowlist exact so a future endpoint under /mediapipe cannot inherit access.
const POSE_ASSETS = new Set([
  '/mediapipe/models/pose_landmarker_lite.task',
  '/mediapipe/models/pose_landmarker_full.task',
  '/mediapipe/wasm/vision_wasm_internal.js',
  '/mediapipe/wasm/vision_wasm_internal.wasm',
  '/mediapipe/wasm/vision_wasm_module_internal.js',
  '/mediapipe/wasm/vision_wasm_module_internal.wasm',
  '/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  '/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
])
