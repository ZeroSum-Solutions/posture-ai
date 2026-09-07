/** Exact immutable model/runtime files used by capture; never an API prefix. */
export function isPublicPoseAsset(pathname: string): boolean {
  return POSE_ASSETS.has(pathname)
}

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
