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
// profile to golden/reports/reliability-profile.json. The profile stays labeled
// "pilot" and consumer-ineligible until uncertainty is separately qualified.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessPosture, ENGINE_VERSION } from '../packages/posture-engine/src/engine'
import type { PoseFrame } from '../packages/posture-engine/src/types'
import type { TierBPoseModel } from '../lib/pose/tierb-contract'
import {
  buildMetricReliability,
  buildReliabilityProfile,
  assertCapturePoseModel,
  EXPECTED_REPEAT_IDS,
  fingerprintTierBDataset,
  parseTierBFileName,
  validateTierBProvenance,
  type MetricCaptureRecord,
  type MetricReliabilityProfile,
} from './golden-repeatability-core'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const TIERB = arg('dir', join('packages', 'posture-engine', 'golden', 'tierb'))
const REPORTS = arg('out', join('packages', 'posture-engine', 'golden', 'reports'))
interface IngestPayload {
  frames: PoseFrame[]
  poseModel?: unknown
  protocolVersion?: unknown
}

const subjects = existsSync(TIERB)
  ? readdirSync(TIERB, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : []

// captureKey = subject|pose|device|repeat → frames across views
const captures = new Map<string, {
  caseKey: string
  repeatId: string
  poseModel: TierBPoseModel
  frames: PoseFrame[]
}>()
const datasetEntries: Array<{ path: string; content: string }> = []
let skipped = 0

for (const subject of subjects) {
  for (const file of readdirSync(join(TIERB, subject)).sort()) {
    if (!file.endsWith('.landmarks.json')) continue
    const parsed = parseTierBFileName(file)
    if (!parsed) {
      console.warn(`skipping ${subject}/${file} — name must match <pose>_<view>_<device>_r<repeat>.landmarks.json`)
      skipped++
      continue
    }
    const rawPayload = readFileSync(join(TIERB, subject, file), 'utf8')
    datasetEntries.push({ path: `${subject}/${file}`, content: rawPayload })
    const payload = JSON.parse(rawPayload) as IngestPayload
    const poseModel = validateTierBProvenance(payload, `${subject}/${file}`)
    const captureKey = `${subject}|${parsed.pose}|${parsed.device}|${parsed.repeatId}`
    const entry = captures.get(captureKey) ?? {
      caseKey: `${subject}|${parsed.pose}|${parsed.device}`,
      repeatId: parsed.repeatId,
      poseModel,
      frames: [],
    }
    assertCapturePoseModel(entry.poseModel, poseModel, captureKey)
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

// metric → per-capture values. repeatId is preserved so missing unreliable
// findings drop an incomplete case instead of silently shifting matrix columns.
const byMetric = new Map<string, MetricCaptureRecord[]>()
let unreliableFindings = 0

for (const { caseKey, repeatId, frames } of captures.values()) {
  const result = assessPosture(frames)
  for (const finding of result.findings) {
    // NOTE (honesty): excluding unreliable findings drops exactly the noisy
    // captures, so the resulting ICC is repeatability of the RELIABLE-GATED
    // pipeline, not of raw capture — an optimistic bound on the latter. The
    // count is surfaced in the profile so readers can judge the bias. A case
    // that loses one repeat is dropped by the labeled complete-case guard.
    if (!finding.reliable) {
      unreliableFindings++
      continue
    }
    const records = byMetric.get(finding.key) ?? []
    records.push({
      caseKey,
      repeatId,
      deviationDeg: finding.deviation,
      severityPct: finding.severityPct,
    })
    byMetric.set(finding.key, records)
  }
}

const perMetric: Record<string, MetricReliabilityProfile> = {}

console.log(`Captures assessed: ${captures.size} (engine ${ENGINE_VERSION})`)
if (skipped) console.log(`Files skipped (bad name): ${skipped}`)
if (unreliableFindings) console.log(`Unreliable findings excluded: ${unreliableFindings}`)
console.log(
  '\nmetric'.padEnd(32) + 'cases'.padStart(6) + 'k'.padStart(4) +
    'ICC(2,1)'.padStart(10) + 'SEM°'.padStart(8) + 'MDC95°'.padStart(9),
)
console.log('-'.repeat(69))

for (const [metric, records] of byMetric) {
  const metricProfile = buildMetricReliability(records, EXPECTED_REPEAT_IDS)
  const stats = metricProfile.deviationDeg.stats
  const { droppedCases, repeatIds } = metricProfile
  if (!stats) {
    const completeCases = records.length > 0
      ? new Set(records.map((record) => record.caseKey)).size - droppedCases.length
      : 0
    console.log(`${metric.padEnd(31)} insufficient data (${completeCases} complete cases × ${repeatIds.length} repeats)`)
    continue
  }
  perMetric[metric] = metricProfile
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
const poseModels = [...new Set([...captures.values()].map((capture) => capture.poseModel))]
if (poseModels.length !== 1) {
  throw new Error(`Tier B dataset must contain exactly one pose model; found ${poseModels.join(', ') || 'none'}`)
}

const profile = buildReliabilityProfile({
  engineVersion: ENGINE_VERSION,
  poseModel: poseModels[0],
  datasetFingerprint: fingerprintTierBDataset(datasetEntries),
  generatedAt: new Date().toISOString(),
  nSubjects,
  capturesAssessed: captures.size,
  unreliableFindingsExcluded: unreliableFindings,
  perMetric,
})

mkdirSync(REPORTS, { recursive: true })
const outPath = join(REPORTS, 'reliability-profile.json')
writeFileSync(
  outPath,
  JSON.stringify(profile, null, 2) + '\n',
)
console.log(`\nProfile written: ${outPath}`)
