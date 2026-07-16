// Batch BlazePose detection over the Moti-Physio archive photos.
// Adapts scripts/spike/detect-spike.mjs: serves WASM + .task models + archive
// photos first-party, runs PoseLandmarker (IMAGE mode, numPoses 1 — matching
// lib/pose/detect.ts) in Chromium via Playwright, and caches one landmark JSON
// per (client, session, view) under datasets/moti/landmarks/. Resumable:
// existing outputs are skipped.
//
//   node scripts/moti-import/detect-batch.mjs \
//     --archive "/path/to/03 - Client Screenings" [--model lite|full] [--out datasets/moti]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const ARCHIVE = arg('archive')
if (!ARCHIVE) {
  console.error('Usage: detect-batch.mjs --archive "<path>" [--model lite|full] [--out datasets/moti]')
  process.exit(1)
}
const MODEL = `pose_landmarker_${arg('model', 'lite')}`
const OUT = join(ROOT, arg('out', 'datasets/moti'))
const LANDMARKS_DIR = join(OUT, 'landmarks')
mkdirSync(LANDMARKS_DIR, { recursive: true })

// Map clientId -> client folder by re-reading `_Client Info.txt` from the
// archive (folder names contain client names and are never persisted).
const GROUP_DIRS = ['Version 1 - Original', 'Version 2 - Latest', 'Both Versions', 'Incomplete - No Data']
const clientDirs = new Map()
for (const group of GROUP_DIRS) {
  const groupDir = join(ARCHIVE, group)
  if (!existsSync(groupDir)) continue
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const infoPath = join(groupDir, entry.name, '_Client Info.txt')
    if (!existsSync(infoPath)) continue
    const match = readFileSync(infoPath, 'utf8').match(/Client ID\s*:\s*(\S+)/)
    if (match) clientDirs.set(match[1], join(groupDir, entry.name))
  }
}

const index = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'))
const VIEWS = ['front', 'side', 'back']

// Work list: one entry per (client, session, view) with a photo on disk.
const work = []
for (const clientId of index.clients) {
  const client = JSON.parse(readFileSync(join(OUT, 'clients', `${clientId}.json`), 'utf8'))
  const dir = clientDirs.get(clientId)
  if (!dir) continue
  for (const session of client.sessions) {
    for (const view of VIEWS) {
      const photo = session.photos[view]
      if (!photo) continue
      const outPath = join(LANDMARKS_DIR, `${clientId}_${session.index}_${view}.${MODEL}.json`)
      if (existsSync(outPath)) continue
      work.push({ photoPath: join(dir, photo), outPath })
    }
  }
}
console.log(`${work.length} detections to run (model=${MODEL})`)
if (work.length === 0) process.exit(0)

const MIME = {
  '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
}

const PAGE = `<!doctype html><html><body>
<img id="photo">
<script type="module">
import { FilesetResolver, PoseLandmarker } from '/vision_bundle.mjs'
const vision = await FilesetResolver.forVisionTasks('/wasm')
let landmarker, delegate = 'GPU'
const opts = (d) => ({
  baseOptions: { modelAssetPath: '/models/${MODEL}.task', delegate: d },
  runningMode: 'IMAGE', numPoses: 1,
})
try {
  landmarker = await PoseLandmarker.createFromOptions(vision, opts('GPU'))
} catch (e) {
  delegate = 'CPU'
  landmarker = await PoseLandmarker.createFromOptions(vision, opts('CPU'))
}
window.runDetect = async (photoIndex) => {
  const el = document.getElementById('photo')
  el.src = '/photos/' + photoIndex
  await new Promise((res, rej) => { el.onload = res; el.onerror = rej })
  const r = landmarker.detect(el)
  const lms = (r.landmarks && r.landmarks[0]) ? r.landmarks[0].map(p => ({
    x: p.x, y: p.y, z: p.z, visibility: typeof p.visibility === 'number' ? p.visibility : null,
  })) : []
  return { delegate, width: el.naturalWidth, height: el.naturalHeight, landmarks: lms }
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
        // Photos are addressed by work-list index, never by path.
        const item = work[Number(url.slice(8))]
        filePath = item?.photoPath
      }
      if (!filePath || !existsSync(filePath)) { res.writeHead(404); return res.end('nf') }
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      res.end(body)
    } catch (e) { res.writeHead(500); res.end(String(e)) }
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const server = await serve()
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${server.address().port}`)
await page.waitForFunction('window.harnessReady === true', null, { timeout: 60000 })

let done = 0
let failed = 0
for (let i = 0; i < work.length; i++) {
  try {
    const r = await page.evaluate((idx) => window.runDetect(idx), i)
    writeFileSync(work[i].outPath, JSON.stringify({ model: MODEL, ...r }))
    done++
  } catch (e) {
    failed++
    console.error(`FAIL ${work[i].outPath}: ${String(e).slice(0, 120)}`)
  }
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${work.length}`)
}

await browser.close()
server.close()
console.log(`done: ${done} ok, ${failed} failed`)
