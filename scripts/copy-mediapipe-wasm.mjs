/**
 * Copies @mediapipe/tasks-vision WASM assets from node_modules into
 * public/mediapipe/wasm/ so they are served first-party (no CDN dependency).
 * Runs as the `prebuild` and `predev` npm lifecycle hooks.
 */
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const dest = join(root, 'public/mediapipe/wasm')

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`[copy-mediapipe-wasm] copied wasm assets → public/mediapipe/wasm/`)
