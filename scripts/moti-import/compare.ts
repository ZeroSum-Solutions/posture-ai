// Stage-1 validation: run the posture engine over BlazePose landmarks
// detected from the Moti-Physio archive photos and compare directly
// comparable metrics against the archive's stored ground truth.
//
//   npx vite-node scripts/moti-import/compare.ts -- [--model lite|full] [--out datasets/moti]
//
// Prerequisites: import.ts (dataset) and detect-batch.mjs (landmarks).
// Comparisons v1:
//   pelvic_obliquity            vs |ExtraData pelvis obliquity| (degrees)
//   anterior_imbalanced_shoulders vs shoulder tilt from debug acromial ends

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessPosture } from '../../packages/posture-engine/src/engine'
import type { PoseFrame } from '../../packages/posture-engine/src/types'
import { mapLandmarks } from '../../lib/pose/pose-model'
import { agreementStats, pairDebugRecords, shoulderAngleFromDebug } from './compare-core'
import type { ClientDataset } from './walk'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const MODEL = `pose_landmarker_${arg('model', 'lite')}`
const OUT = arg('out', 'datasets/moti')

interface RawDetection {
  width: number
  height: number
  landmarks: { x: number; y: number; z?: number; visibility: number | null }[]
}

function loadFrame(
  clientId: string,
  session: number,
  view: 'front' | 'side' | 'back',
): PoseFrame | null {
  const path = join(OUT, 'landmarks', `${clientId}_${session}_${view}.${MODEL}.json`)
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawDetection
  const frame: PoseFrame = {
    view,
    landmarks: mapLandmarks(
      raw.landmarks.map((p) => ({ ...p, visibility: p.visibility ?? undefined })),
    ),
    source: 'upload',
  }
  if (raw.width > 0 && raw.height > 0) frame.aspectRatio = raw.width / raw.height
  return frame
}

interface ComparisonRow {
  clientId: string
  session: number
  metric: string
  engine: number
  truth: number
  reliable: boolean
  zone: string
  confidence: number
}

const index = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) as {
  clients: string[]
}

const rows: ComparisonRow[] = []
let sessionsAssessed = 0

for (const clientId of index.clients) {
  const client = JSON.parse(
    readFileSync(join(OUT, 'clients', `${clientId}.json`), 'utf8'),
  ) as ClientDataset
  const debugBySession = pairDebugRecords(client.debugLandmarks, client.sessions)

  for (let s = 0; s < client.sessions.length; s++) {
    const session = client.sessions[s]
    const frames = (['front', 'side', 'back'] as const)
      .map((view) => loadFrame(clientId, session.index, view))
      .filter((f): f is PoseFrame => f !== null)
    if (frames.length === 0) continue

    const result = assessPosture(frames)
    sessionsAssessed++

    const finding = (key: string) => result.findings.find((f) => f.key === key)

    const pelvic = finding('pelvic_obliquity')
    const pelvicTruth = session.extraData?.pelvisObliquity
    if (pelvic && pelvicTruth != null) {
      rows.push({
        clientId,
        session: session.index,
        metric: 'pelvic_obliquity',
        engine: pelvic.deviation,
        truth: Math.abs(pelvicTruth),
        reliable: pelvic.reliable,
        zone: pelvic.zone,
        confidence: pelvic.confidence,
      })
    }

    const shoulders = finding('anterior_imbalanced_shoulders')
    const debugRecord = debugBySession[s]
    const shoulderTruth = debugRecord ? shoulderAngleFromDebug(debugRecord) : null
    if (shoulders && shoulderTruth != null) {
      rows.push({
        clientId,
        session: session.index,
        metric: 'anterior_imbalanced_shoulders',
        engine: shoulders.deviation,
        truth: shoulderTruth,
        reliable: shoulders.reliable,
        zone: shoulders.zone,
        confidence: shoulders.confidence,
      })
    }
  }
}

const metrics = [...new Set(rows.map((r) => r.metric))]
const report: Record<string, unknown> = { model: MODEL, sessionsAssessed }

console.log(`\nSessions assessed: ${sessionsAssessed} (model=${MODEL})`)
console.log(
  '\nmetric'.padEnd(32) +
    'n'.padStart(5) +
    'MAE°'.padStart(9) +
    'bias°'.padStart(9) +
    'LoA°'.padStart(19) +
    'r'.padStart(8) +
    'ICC(2,1)'.padStart(10),
)
console.log('-'.repeat(92))

for (const metric of metrics) {
  const reliableRows = rows.filter((r) => r.metric === metric && r.reliable)
  const unreliable = rows.filter((r) => r.metric === metric && !r.reliable).length
  const stats = agreementStats(
    reliableRows.map((r) => r.engine),
    reliableRows.map((r) => r.truth),
  )
  report[metric] = { stats, unreliableCount: unreliable, rows: rows.filter((r) => r.metric === metric) }
  if (!stats) {
    console.log(`${metric.padEnd(31)} <3 reliable pairs (${unreliable} unreliable)`)
    continue
  }
  console.log(
    metric.padEnd(31) +
      String(stats.n).padStart(5) +
      stats.mae.toFixed(2).padStart(9) +
      stats.bias.toFixed(2).padStart(9) +
      `[${stats.loaLow.toFixed(2)}, ${stats.loaHigh.toFixed(2)}]`.padStart(19) +
      stats.pearson.toFixed(3).padStart(8) +
      stats.icc21.toFixed(3).padStart(10) +
      (unreliable ? `  (+${unreliable} unreliable excluded)` : ''),
  )
}

const reportPath = join(OUT, `comparison-report-${arg('model', 'lite')}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 1))
console.log(`\nReport → ${reportPath}`)
