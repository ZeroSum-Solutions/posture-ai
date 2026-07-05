// Golden accuracy runner: scores every golden case with the CURRENT engine,
// reports per-metric mean absolute error vs analytic ground truth, and fails
// (exit 1) when any metric drifts from the accepted baseline by more than
// DRIFT_TOL. `--accept` rewrites the baseline (review like a snapshot).
// Usage: npm run golden [-- --accept]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const goldenDir = join(root, 'packages/posture-engine/golden')
const baselinePath = join(goldenDir, 'baseline.json')
const accept = process.argv.includes('--accept')
const DRIFT_TOL = 0.05 // degrees of MAE movement allowed without re-accept

// vite-node evaluates the TS engine + cases in one child (same tool qa:seed uses)
const evalTs = `
  import { GOLDEN_CASES } from './packages/posture-engine/golden/cases'
  import { generatePose, expectedDeviations } from './packages/posture-engine/golden/synthetic'
  import { assessPosture } from './packages/posture-engine/src/engine'
  const rows = []
  for (const c of GOLDEN_CASES) {
    const frames = [generatePose('front', c.spec, c.cam), generatePose('side', c.spec, c.cam)]
    const expected = expectedDeviations(c.spec)
    for (const f of assessPosture(frames).findings) {
      if (!(f.key in expected)) continue
      rows.push({ case: c.name, key: f.key, err: Math.abs(f.deviation - expected[f.key]) })
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

const byMetric = {}
for (const r of rows) (byMetric[r.key] ??= []).push(r.err)
const mae = Object.fromEntries(
  Object.entries(byMetric).map(([k, xs]) => [k, Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4))]),
)

console.log('Golden per-metric MAE (deg):')
for (const [k, v] of Object.entries(mae)) console.log(`  ${k.padEnd(32)} ${v}`)

if (accept || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({ acceptedAt: new Date().toISOString(), maeByMetric: mae }, null, 2))
  console.log(`\nBaseline ${accept ? 're-' : ''}accepted → ${baselinePath}`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).maeByMetric
let failed = false
for (const [k, v] of Object.entries(mae)) {
  const prev = baseline[k]
  if (prev === undefined || Math.abs(v - prev) > DRIFT_TOL) {
    console.error(`DRIFT: ${k} MAE ${prev ?? 'n/a'} → ${v} (tol ${DRIFT_TOL})`)
    failed = true
  }
}
for (const k of Object.keys(baseline)) {
  if (!(k in mae)) { console.error(`DRIFT: metric ${k} disappeared from output`); failed = true }
}
if (failed) {
  console.error('\nGolden drift detected. If intentional, re-accept: npm run golden -- --accept')
  process.exit(1)
}
console.log('\nGolden: no drift vs baseline ✓')
