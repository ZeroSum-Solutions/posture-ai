// golden-model-compare.mjs — lite vs full over Tier B landmarks.
// Tier B JSONs are produced per model by running the ingest page twice with
// NEXT_PUBLIC_POSE_MODEL=lite then =full (files suffixed -lite / -full).
// Reports per-metric |deviation_lite − deviation_full| and each model's error
// vs measured groundTruth. Decision rule (spec §2.1): any scored metric with
// median |Δ| > 1° across Tier B ⇒ full becomes the default.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'packages/posture-engine/golden/tierb')

const subjects = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
if (subjects.length === 0) {
  console.error('No Tier B data yet — capture per golden/protocol.md first.')
  process.exit(2)
}

// Collect paired lite/full JSONs across all subject directories
const pairs = []
for (const subj of subjects) {
  const subjDir = join(dir, subj.name)
  const files = readdirSync(subjDir).filter(f => f.endsWith('.json'))
  const liteFiles = files.filter(f => f.endsWith('-lite.json'))
  for (const liteFile of liteFiles) {
    const baseName = liteFile.slice(0, -'-lite.json'.length)
    const fullFile = baseName + '-full.json'
    if (!files.includes(fullFile)) continue
    const lite = JSON.parse(readFileSync(join(subjDir, liteFile), 'utf8'))
    const full = JSON.parse(readFileSync(join(subjDir, fullFile), 'utf8'))
    pairs.push({
      name: `${subj.name}/${baseName}`,
      liteFrames: lite.frames,
      fullFrames: full.frames,
      groundTruth: lite.groundTruth ?? {},
    })
  }
}

if (pairs.length === 0) {
  console.error('No paired *-lite.json/*-full.json files found — run ingest twice (lite then full).')
  process.exit(2)
}

// vite-node evaluates the TS engine in one child (same pattern as golden-report.mjs)
const evalTs = `
  import { assessPosture } from './packages/posture-engine/src/engine'
  const pairs = ${JSON.stringify(pairs)}
  const rows = []
  for (const { name, liteFrames, fullFrames, groundTruth } of pairs) {
    const liteFindings = assessPosture(liteFrames).findings
    const fullFindings = assessPosture(fullFrames).findings
    for (const lf of liteFindings) {
      const ff = fullFindings.find(x => x.key === lf.key)
      if (!ff) continue
      const gt = groundTruth[lf.key]
      rows.push({
        name,
        key: lf.key,
        liteDev: lf.deviation,
        fullDev: ff.deviation,
        delta: Math.abs(lf.deviation - ff.deviation),
        liteErr: gt != null ? Math.abs(lf.deviation - gt) : null,
        fullErr: gt != null ? Math.abs(ff.deviation - gt) : null,
      })
    }
  }
  console.log(JSON.stringify(rows))
`
writeFileSync(join(root, '.golden-eval.ts'), evalTs)
let rows
try {
  rows = JSON.parse(execSync('npx vite-node .golden-eval.ts', { cwd: root, encoding: 'utf8' }).trim().split('\n').pop())
} finally {
  execSync('rm -f .golden-eval.ts', { cwd: root })
}

// Aggregate per-metric deltas and errors
const byMetric = {}
for (const r of rows) {
  const m = (byMetric[r.key] ??= { deltas: [], liteErrs: [], fullErrs: [] })
  m.deltas.push(r.delta)
  if (r.liteErr != null) m.liteErrs.push(r.liteErr)
  if (r.fullErr != null) m.fullErrs.push(r.fullErr)
}

const median = xs => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

const fmt = v => (v != null ? v.toFixed(3) : 'n/a')

console.log('\nPer-metric lite-vs-full comparison (deg):')
console.log(
  'metric'.padEnd(36) +
  'medianΔ'.padEnd(12) +
  'liteMAE'.padEnd(12) +
  'fullMAE'
)
console.log('-'.repeat(72))

let fullDefault = false
for (const [key, { deltas, liteErrs, fullErrs }] of Object.entries(byMetric)) {
  const medDelta = median(deltas)
  const liteMAE = median(liteErrs)
  const fullMAE = median(fullErrs)
  const flag = medDelta != null && medDelta > 1 ? ' ← >1°' : ''
  if (medDelta != null && medDelta > 1) fullDefault = true
  console.log(
    key.padEnd(36) +
    fmt(medDelta).padEnd(12) +
    fmt(liteMAE).padEnd(12) +
    fmt(fullMAE) +
    flag
  )
}

console.log(`\nVERDICT: full-default = ${fullDefault}`)
