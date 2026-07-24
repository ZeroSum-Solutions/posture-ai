// golden-model-compare.mjs — advisory lite-vs-full accuracy-study comparison.
// Inputs must be paired, explicitly marked studyPurpose:"accuracy", and carry
// measured ground truth. Reliability-only Tier B v2 evidence is refused.
// Reports per-metric |deviation_lite − deviation_full| and each model's error
// vs measured groundTruth. Decision rule (spec §2.1, amended 2026-07-16):
// disagreement (any scored metric with median |Δ| > 1° across Tier B) makes
// full a CANDIDATE; the switch verdict additionally requires full to be at
// least as accurate as lite against ground truth. Disagreement alone proves
// the models differ, not that full is better.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { assertModelComparisonEvidence } from './golden-model-compare-core.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = process.env.GOLDEN_MODEL_COMPARE_DIR
  ? resolve(process.env.GOLDEN_MODEL_COMPARE_DIR)
  : join(root, 'packages/posture-engine/golden/tierb')

if (!existsSync(dir) || readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).length === 0) {
  console.error('No Tier B data yet — capture per golden/protocol.md first.')
  process.exit(2)
}
const subjects = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())

// Collect paired lite/full JSONs across all subject directories
const pairs = []
const unpaired = []
const unclassified = []
for (const subj of subjects) {
  const subjDir = join(dir, subj.name)
  const files = readdirSync(subjDir).filter(f => f.endsWith('.json'))
  for (const file of files) {
    if (!file.endsWith('-lite.json') && !file.endsWith('-full.json')) {
      unclassified.push(`${subj.name}/${file}`)
    }
  }
  const liteBases = new Set(
    files
      .filter(f => f.endsWith('-lite.json'))
      .map(f => f.slice(0, -'-lite.json'.length)),
  )
  const fullBases = new Set(
    files
      .filter(f => f.endsWith('-full.json'))
      .map(f => f.slice(0, -'-full.json'.length)),
  )
  for (const baseName of liteBases) {
    if (!fullBases.has(baseName)) {
      unpaired.push(`${subj.name}/${baseName} (missing full)`)
    }
  }
  for (const baseName of fullBases) {
    if (!liteBases.has(baseName)) {
      unpaired.push(`${subj.name}/${baseName} (missing lite)`)
    }
  }
  for (const baseName of [...liteBases].filter(name => fullBases.has(name)).sort()) {
    const liteFile = baseName + '-lite.json'
    const fullFile = baseName + '-full.json'
    const lite = JSON.parse(readFileSync(join(subjDir, liteFile), 'utf8'))
    const full = JSON.parse(readFileSync(join(subjDir, fullFile), 'utf8'))
    const groundTruth = assertModelComparisonEvidence(
      lite,
      full,
      `${subj.name}/${baseName}`,
    )
    pairs.push({
      name: `${subj.name}/${baseName}`,
      liteFrames: lite.frames,
      fullFrames: full.frames,
      groundTruth,
    })
  }
}

if (unpaired.length > 0) {
  console.error(`Unpaired model-comparison files: ${unpaired.join(', ')}`)
  process.exit(2)
}

if (unclassified.length > 0) {
  console.error(
    `Unclassified model-comparison JSON files: ${unclassified.join(', ')}`,
  )
  process.exit(2)
}

if (pairs.length === 0) {
  console.error('No paired *-lite.json/*-full.json files found — run ingest twice (lite then full).')
  process.exit(2)
}

// vite-node evaluates the TS engine in one child (same pattern as golden-report.mjs)
const evalTs = `
  import { assessPosture } from './packages/posture-engine/src/engine'
  import { buildAccuracyRows } from './scripts/golden-model-compare-core.mjs'
  const pairs = ${JSON.stringify(pairs)}
  const rows = []
  for (const { name, liteFrames, fullFrames, groundTruth } of pairs) {
    const liteFindings = assessPosture(liteFrames).findings
    const fullFindings = assessPosture(fullFrames).findings
    rows.push(...buildAccuracyRows(
      name,
      liteFindings,
      fullFindings,
      groundTruth,
    ))
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
  m.liteErrs.push(r.liteErr)
  m.fullErrs.push(r.fullErr)
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

let disagreement = false
const gtMaeDeltas = [] // fullMAE − liteMAE per metric with ground truth
for (const [key, { deltas, liteErrs, fullErrs }] of Object.entries(byMetric)) {
  const medDelta = median(deltas)
  const liteMAE = median(liteErrs)
  const fullMAE = median(fullErrs)
  const flag = medDelta != null && medDelta > 1 ? ' ← >1°' : ''
  if (medDelta != null && medDelta > 1) disagreement = true
  if (liteMAE != null && fullMAE != null) gtMaeDeltas.push(fullMAE - liteMAE)
  console.log(
    key.padEnd(36) +
    fmt(medDelta).padEnd(12) +
    fmt(liteMAE).padEnd(12) +
    fmt(fullMAE) +
    flag
  )
}

let fullDefault = false
if (!disagreement) {
  console.log('\nModels agree within 1° on every measured metric — no reason to switch.')
} else {
  fullDefault = median(gtMaeDeltas) <= 0
  console.log(
    `\nModels disagree >1°; median ground-truth MAE delta (full − lite) = ${fmt(median(gtMaeDeltas))}` +
    ` → full is ${fullDefault ? 'at least as accurate — switch justified' : 'less accurate — do NOT switch'}.`
  )
}

console.log(`\nADVISORY VERDICT: full-default = ${fullDefault}`)
