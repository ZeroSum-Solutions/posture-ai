// Test-retest repeatability over Tier B captures (reliability-axis accuracy
// phase, docs/plans/2026-07-17-reliability-baseline.md §2).
//
//   npx vite-node scripts/golden-repeatability.ts -- [--dir <tierb-dir>] [--out <reports-dir>]
//
// Reads packages/posture-engine/golden/tierb/<subject>/*.landmarks.json
// (produced by /dev/golden-ingest per golden/protocol.md), where filenames
// follow  <pose>_<view>_<device>_r<repeat>.landmarks.json
// e.g.     neutral_front_iphone_r1.landmarks.json
//
// Groups the views of each re-positioned capture, runs the real engine, and
// reports per-metric ICC(2,1)/SEM/MDC95 across repeats. Writes a versioned
// profile to golden/reports/reliability-profile.json. With 3–5 pilot subjects
// the profile is labeled "pilot" — never publish a universal ±X° claim from it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessPosture, ENGINE_VERSION } from '../packages/posture-engine/src/engine'
import type { PoseFrame } from '../packages/posture-engine/src/types'
import {
  buildRepeatMatrix,
  testRetestReliability,
  type ReliabilityStats,
} from '../packages/posture-engine/src/reliability'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const TIERB = arg('dir', join('packages', 'posture-engine', 'golden', 'tierb'))
const REPORTS = arg('out', join('packages', 'posture-engine', 'golden', 'reports'))
// [1]=pose [2]=view [3]=device [4]=repeat
const FILE_RE = /^([a-z0-9-]+)_(front|side|back)_([a-z0-9-]+)_r(\d+)\.landmarks\.json$/

interface IngestPayload {
  frames: PoseFrame[]
}

const subjects = existsSync(TIERB)
  ? readdirSync(TIERB, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

// captureKey = subject|pose|device|repeat → frames across views
const captures = new Map<string, { caseKey: string; frames: PoseFrame[] }>()
let skipped = 0

for (const subject of subjects) {
  for (const file of readdirSync(join(TIERB, subject)).sort()) {
    if (!file.endsWith('.landmarks.json')) continue
    const m = FILE_RE.exec(file)
    if (!m) {
      console.warn(`skipping ${subject}/${file} — name must match <pose>_<view>_<device>_r<repeat>.landmarks.json`)
      skipped++
      continue
    }
    const [, pose, , device, repeat] = m
    const payload = JSON.parse(readFileSync(join(TIERB, subject, file), 'utf8')) as IngestPayload
    const captureKey = `${subject}|${pose}|${device}|${repeat}`
    const entry = captures.get(captureKey) ?? { caseKey: `${subject}|${pose}|${device}`, frames: [] }
    entry.frames.push(...payload.frames)
    captures.set(captureKey, entry)
  }
}

if (captures.size === 0) {
  console.log(
    `No Tier B captures found under ${TIERB}.\n` +
      'Collect them per packages/posture-engine/golden/protocol.md (3–5 subjects × ' +
      'poses × 3 re-positioned repeats × 2 devices), ingest via /dev/golden-ingest, ' +
      'then re-run this script.',
  )
  process.exit(0)
}

// metric → per-capture deviations, insertion-ordered so repeats align by caseKey
const byMetric = new Map<string, Array<{ caseKey: string; value: number }>>()
let unreliableFindings = 0

for (const { caseKey, frames } of captures.values()) {
  const result = assessPosture(frames)
  for (const finding of result.findings) {
    if (!finding.reliable) {
      unreliableFindings++
      continue
    }
    const records = byMetric.get(finding.key) ?? []
    records.push({ caseKey, value: finding.deviation })
    byMetric.set(finding.key, records)
  }
}

const perMetric: Record<string, ReliabilityStats & { droppedCases: string[] }> = {}

console.log(`Captures assessed: ${captures.size} (engine ${ENGINE_VERSION})`)
if (skipped) console.log(`Files skipped (bad name): ${skipped}`)
if (unreliableFindings) console.log(`Unreliable findings excluded: ${unreliableFindings}`)
console.log(
  '\nmetric'.padEnd(32) + 'cases'.padStart(6) + 'k'.padStart(4) +
    'ICC(2,1)'.padStart(10) + 'SEM°'.padStart(8) + 'MDC95°'.padStart(9),
)
console.log('-'.repeat(69))

for (const [metric, records] of byMetric) {
  const { matrix, droppedCases, kRepeats } = buildRepeatMatrix(records)
  const stats = testRetestReliability(matrix)
  if (!stats) {
    console.log(`${metric.padEnd(31)} insufficient data (${matrix.length} complete cases × ${kRepeats} repeats)`)
    continue
  }
  perMetric[metric] = { ...stats, droppedCases }
  console.log(
    metric.padEnd(31) + String(stats.nCases).padStart(6) + String(stats.kRepeats).padStart(4) +
      stats.icc21.toFixed(3).padStart(10) + stats.sem.toFixed(2).padStart(8) +
      stats.mdc95.toFixed(2).padStart(9) +
      (droppedCases.length ? `  (${droppedCases.length} incomplete cases dropped)` : ''),
  )
}

const nSubjects = subjects.filter((s) =>
  [...captures.values()].some((c) => c.caseKey.startsWith(`${s}|`)),
).length

mkdirSync(REPORTS, { recursive: true })
const outPath = join(REPORTS, 'reliability-profile.json')
writeFileSync(
  outPath,
  JSON.stringify(
    {
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      // pilot until the sample supports a general claim — see plan §3
      label: nSubjects <= 5 ? 'pilot' : 'full',
      nSubjects,
      capturesAssessed: captures.size,
      perMetric,
    },
    null,
    2,
  ) + '\n',
)
console.log(`\nProfile written: ${outPath}`)
