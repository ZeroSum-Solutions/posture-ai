// P0c spike: validate MediaPipe tasks-vision 0.10.35 across browsers/models.
// Serves WASM + .task models first-party (rehearsing the P2 self-host setup),
// runs PoseLandmarker on a real photo in Chromium (mobile emulation + desktop)
// and WebKit, for both pose_landmarker_full and pose_landmarker_lite.
// Outputs scripts/spike/spike-results.json with timings, delegate used,
// landmark deltas, and engine reliability-floor checks.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, devices } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.html': 'text/html',
}

const PAGE = `<!doctype html><html><body>
<img id="photo">
<script type="module">
import { FilesetResolver, PoseLandmarker } from '/vision_bundle.mjs'
window.runDetect = async (modelName, photo) => {
  const photoEl = document.getElementById('photo')
  photoEl.src = '/photos/' + photo
  await new Promise((res, rej) => { photoEl.onload = res; photoEl.onerror = rej })
  const t0 = performance.now()
  const vision = await FilesetResolver.forVisionTasks('/wasm')
  const tFileset = performance.now()
  let landmarker, delegate = 'GPU'
  const opts = (d) => ({
    baseOptions: { modelAssetPath: '/models/' + modelName + '.task', delegate: d },
    runningMode: 'IMAGE', numPoses: 1,
  })
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, opts('GPU'))
  } catch (e) {
    delegate = 'CPU'
    landmarker = await PoseLandmarker.createFromOptions(vision, opts('CPU'))
  }
  const tModel = performance.now()
  const img = document.getElementById('photo')
  const r1 = landmarker.detect(img)
  const tDetect1 = performance.now()
  const r2 = landmarker.detect(img)
  const tDetect2 = performance.now()
  landmarker.close()
  const lms = (r1.landmarks && r1.landmarks[0]) ? r1.landmarks[0].map(p => ({
    x: p.x, y: p.y, z: p.z, visibility: typeof p.visibility === 'number' ? p.visibility : null,
  })) : []
  return {
    delegate,
    filesetMs: Math.round(tFileset - t0),
    modelLoadMs: Math.round(tModel - tFileset),
    coldDetectMs: Math.round(tDetect1 - tModel),
    warmDetectMs: Math.round(tDetect2 - tDetect1),
    landmarkCount: lms.length,
    landmarks: lms,
  }
}
window.harnessReady = true
</script></body></html>`

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = req.url.split('?')[0]
      let filePath
      if (url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end(PAGE)
      } else if (url === '/vision_bundle.mjs') {
        filePath = join(ROOT, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
      } else if (url.startsWith('/wasm/')) {
        filePath = join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm', url.slice(6))
      } else if (url.startsWith('/models/')) {
        filePath = join(ROOT, 'public/mediapipe/models', url.slice(8))
      } else if (url.startsWith('/photos/')) {
        filePath = join(ROOT, 'e2e/fixtures/photos', url.slice(8))
      }
      if (!filePath || !existsSync(filePath)) { res.writeHead(404); return res.end('nf') }
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      res.end(body)
    } catch (e) { res.writeHead(500); res.end(String(e)) }
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// 33-landmark names matching lib/pose/detect.ts ordering.
const NAMES = ['nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye','right_eye_outer','left_ear','right_ear','mouth_left','mouth_right','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle','left_heel','right_heel','left_foot_index','right_foot_index']
// Landmark groups the engine's 10 metrics depend on (RELIABILITY_FLOOR=0.5 on min visibility).
const METRIC_GROUPS = {
  forward_head: ['left_ear','right_ear','left_shoulder','right_shoulder'],
  shoulders: ['left_shoulder','right_shoulder'],
  pelvis: ['left_hip','right_hip'],
  knees: ['left_knee','right_knee','left_ankle','right_ankle','left_hip','right_hip'],
}

const PHOTOS = [
  { view: 'front', file: 'front_standing.jpg' },
  { view: 'side', file: 'side_standing.jpg' },
  { view: 'back', file: 'back_standing.jpg' },
]

async function main() {
  const server = await serve()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const results = []

  const targets = [
    { name: 'chromium-iphone14', launcher: chromium, ctx: { ...devices['iPhone 14'], defaultBrowserType: undefined } },
    { name: 'chromium-desktop', launcher: chromium, ctx: {} },
    { name: 'webkit-iphone14', launcher: webkit, ctx: { ...devices['iPhone 14'], defaultBrowserType: undefined } },
  ]

  for (const t of targets) {
    const browser = await t.launcher.launch()
    const context = await browser.newContext(t.ctx)
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await page.goto(base)
    await page.waitForFunction('window.harnessReady === true', null, { timeout: 30000 })
    for (const model of ['pose_landmarker_full', 'pose_landmarker_lite']) {
      for (const photo of PHOTOS) {
        try {
          const r = await page.evaluate(([m, ph]) => window.runDetect(m, ph), [model, photo.file])
          results.push({ browser: t.name, model, photo: photo.view, ok: true, ...r })
          console.log(`${t.name} ${model} ${photo.view}: delegate=${r.delegate} model=${r.modelLoadMs}ms cold=${r.coldDetectMs}ms warm=${r.warmDetectMs}ms landmarks=${r.landmarkCount}`)
        } catch (e) {
          results.push({ browser: t.name, model, photo: photo.view, ok: false, error: String(e), pageErrors: [...pageErrors] })
          console.log(`${t.name} ${model} ${photo.view}: FAILED ${e}`)
        }
      }
    }
    await browser.close()
  }
  server.close()

  // Lite-vs-full analysis per browser
  const analysis = {}
  for (const t of targets) for (const photo of PHOTOS) {
    const full = results.find(r => r.browser === t.name && r.photo === photo.view && r.model === 'pose_landmarker_full' && r.ok)
    const lite = results.find(r => r.browser === t.name && r.photo === photo.view && r.model === 'pose_landmarker_lite' && r.ok)
    if (!full || !lite || !full.landmarkCount || !lite.landmarkCount) continue
    const deltas = full.landmarks.map((f, i) => {
      const l = lite.landmarks[i]
      return { name: NAMES[i], dx: Math.abs(f.x - l.x), dy: Math.abs(f.y - l.y), fVis: f.visibility, lVis: l.visibility }
    })
    const meanDx = deltas.reduce((s, d) => s + d.dx, 0) / deltas.length
    const meanDy = deltas.reduce((s, d) => s + d.dy, 0) / deltas.length
    const gates = {}
    for (const [metric, group] of Object.entries(METRIC_GROUPS)) {
      const minFull = Math.min(...group.map(n => deltas.find(d => d.name === n)?.fVis ?? 0))
      const minLite = Math.min(...group.map(n => deltas.find(d => d.name === n)?.lVis ?? 0))
      gates[metric] = { minVisFull: +minFull.toFixed(3), minVisLite: +minLite.toFixed(3), fullPasses: minFull >= 0.5, litePasses: minLite >= 0.5 }
    }
    analysis[`${t.name}/${photo.view}`] = { meanDx: +meanDx.toFixed(4), meanDy: +meanDy.toFixed(4), maxDx: +Math.max(...deltas.map(d => d.dx)).toFixed(4), maxDy: +Math.max(...deltas.map(d => d.dy)).toFixed(4), reliabilityGates: gates }
  }

  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(ROOT, 'scripts/spike/spike-results.json'), JSON.stringify({ results: results.map(({ landmarks, ...rest }) => rest), analysis }, null, 2))
  console.log('\n=== ANALYSIS ===')
  console.log(JSON.stringify(analysis, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
