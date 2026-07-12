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
  const SAG = ['forward_head_posture', 'trunk_lean', 'knee_extension_back_knee']
  const rows = []
  const perSide = []
  for (const c of GOLDEN_CASES) {
    const expected = expectedDeviations(c.spec)
    if (c.sideProfiles) {
      // Two profiled side frames: assert the aggregate picks the worst side
      // EXACTLY (deviation + drivingProfileSide + both observations). Kept out of
      // the accuracy MAE — worst-side selection is a distinct property, and a
      // leaned trunk couples into forward-head (a false error there).
      const frames = [
        generatePose('front', c.spec, c.cam),
        generatePose('side', c.sideProfiles.left, c.cam, 'left'),
        generatePose('side', c.sideProfiles.right, c.cam, 'right'),
      ]
      for (const f of assessPosture(frames).findings) {
        if (!SAG.includes(f.key)) continue
        const exp = expected[f.key] ?? 0
        if (exp <= 0) continue // only the metric this case exercises
        perSide.push({
          case: c.name, key: f.key,
          devOk: Math.abs(f.deviation - exp) < 1e-6,
          sideOk: f.drivingProfileSide === c.expectWinner,
          obsOk: (f.observations?.length ?? 0) === 2,
          detail: 'dev ' + f.deviation.toFixed(4) + ' vs ' + exp + ', drive ' + f.drivingProfileSide + ' vs ' + c.expectWinner + ', obs ' + (f.observations?.length ?? 0),
        })
      }
      continue
    }
    // Legacy: one unprofiled side frame (byte-identical accuracy path).
    const frames = [generatePose('front', c.spec, c.cam), generatePose('side', c.spec, c.cam)]
    for (const f of assessPosture(frames).findings) {
      if (!(f.key in expected)) continue
      rows.push({ case: c.name, key: f.key, err: Math.abs(f.deviation - expected[f.key]) })
    }
  }
  console.log(JSON.stringify({ rows, perSide }))
`
writeFileSync(join(root, '.golden-eval.ts'), evalTs)
let rows, perSide
try {
  const out = JSON.parse(execSync('npx vite-node .golden-eval.ts', { cwd: root, encoding: 'utf8' }).trim().split('\n').pop())
  rows = out.rows
  perSide = out.perSide
} finally {
  execSync('rm -f .golden-eval.ts', { cwd: root })
}

// Per-side worst-side selection: an exact check, independent of the accuracy MAE.
let perSideFailed = false
if (perSide.length) {
  console.log('Per-side worst-side selection:')
  for (const p of perSide) {
    const ok = p.devOk && p.sideOk && p.obsOk
    console.log(`  ${ok ? '✓' : '✗'} ${p.case.padEnd(26)} ${p.key.padEnd(20)} ${p.detail}`)
    if (!ok) perSideFailed = true
  }
  console.log('')
}

const byMetric = {}
for (const r of rows) (byMetric[r.key] ??= []).push(r.err)
const mae = Object.fromEntries(
  Object.entries(byMetric).map(([k, xs]) => [k, Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4))]),
)

console.log('Golden per-metric MAE (deg):')
for (const [k, v] of Object.entries(mae)) console.log(`  ${k.padEnd(32)} ${v}`)

// A broken worst-side selection blocks everything, including --accept: never
// re-baseline the accuracy MAE while the engine mis-picks a side.
if (perSideFailed) {
  console.error('\nPer-side worst-side selection FAILED — see ✗ rows above.')
  process.exit(1)
}

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
