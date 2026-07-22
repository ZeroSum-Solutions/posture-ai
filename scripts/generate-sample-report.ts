/**
 * Dev tool: render a sample dark client report PDF from a made-up assessment.
 * Run: npx vite-node scripts/generate-sample-report.ts
 * Output: $OUT (defaults to the session scratchpad). Not part of the app build.
 */
import { renderToFile } from '@react-pdf/renderer'
import { ClientReport } from '../lib/pdf/clientReport'
import { buildProgram } from '../lib/program/buildProgram'
import type { AssessmentResult, Finding } from '../packages/posture-engine/src/types'
import { resolveRuntimeLegalDocument } from '../lib/legal/runtime'
import { snapshotLegalDocument } from '../lib/legal/policy'

const f = (over: Partial<Finding> & Pick<Finding, 'key' | 'label' | 'region' | 'deviation' | 'direction' | 'severityPct' | 'zone'>): Finding => ({
  standard: 0,
  unit: 'deg',
  viewUsed: 'front',
  landmarksUsed: [],
  reliable: true,
  confidence: 0.85,
  ...over,
})

const findings: Finding[] = [
  f({ key: 'forward_head_posture', label: 'Forward Head Posture', region: 'head_shoulders', deviation: 22, direction: 'Forward', severityPct: 78, zone: 'danger', viewUsed: 'side', confidence: 0.92 }),
  f({ key: 'anterior_pelvic_shift', label: 'Anterior Pelvic Shift', region: 'pelvis', deviation: 14, direction: 'Anterior', severityPct: 64, zone: 'warning', viewUsed: 'side', confidence: 0.86 }),
  f({ key: 'anterior_imbalanced_shoulders', label: 'Anterior Shoulders', region: 'head_shoulders', deviation: 5, direction: 'Forward', severityPct: 52, zone: 'warning', confidence: 0.81 }),
  f({ key: 'pelvic_obliquity', label: 'Pelvic Obliquity', region: 'pelvis', deviation: 1, direction: 'Level', severityPct: 12, zone: 'maintain' }),
  f({ key: 't1_tilt_backward', label: 'T1 Tilt', region: 'spine', deviation: 2, direction: 'Neutral', severityPct: 14, zone: 'maintain', viewUsed: 'side' }),
  f({ key: 'posterior_imbalanced_shoulders', label: 'Posterior Shoulders', region: 'head_shoulders', deviation: 1, direction: 'Level', severityPct: 9, zone: 'maintain' }),
  f({ key: 'pelvic_axial_rotation', label: 'Pelvic Rotation', region: 'pelvis', deviation: 2, direction: 'Neutral', severityPct: 0, zone: 'unreliable', reliable: false, confidence: 0.3 }),
  f({ key: 'genu_varum_valgum_left', label: 'Left Knee', region: 'leg', deviation: 2, direction: 'Neutral', severityPct: 8, zone: 'maintain' }),
  f({ key: 'genu_varum_valgum_right', label: 'Right Knee', region: 'leg', deviation: 2, direction: 'Neutral', severityPct: 7, zone: 'maintain' }),
  f({ key: 'knee_extension_back_knee', label: 'Knee Extension', region: 'leg', deviation: 3, direction: 'Neutral', severityPct: 13, zone: 'maintain', viewUsed: 'side' }),
]

const result: AssessmentResult = {
  findings,
  overallScore: 32,
  overallGrade: 'B',
  viewSeverityIndex: { front: 30, side: 36 },
  ranks: { front: 30, side: 36 },
  generatedAt: '2026-06-23T00:00:00.000Z',
  engineVersion: 'sample',
  disclaimer: 'Screening only — not a medical diagnosis.',
  missingViews: [],
  tiltCorrected: false,
  levelVerified: true,
}

const report = buildProgram(result, 'standard')
const legalResolution = resolveRuntimeLegalDocument({ kind: 'screening_notice' })
if (!legalResolution.ok) {
  throw new Error(
    `Screening notice unavailable (${legalResolution.code}). Run sample generation only with an approved document or authorized non-production fixture mode.`,
  )
}
const legalNotice = snapshotLegalDocument(legalResolution.document)
const OUT = process.env.OUT ?? '/private/tmp/claude-501/-Users-zero-suminc-/b0721cc5-ba3c-4cf7-a546-5a18fdc23825/scratchpad/client-report.pdf'

await renderToFile(
  ClientReport({
    clientName: 'Jordan Avery',
    practitioner: 'Apex Movement Co. · SAMPLE',
    dateStr: '23 Jun 2026',
    report,
    legalNotice,
  }),
  OUT,
)

console.log('wrote', OUT)
console.log('screening summary:', report.screeningSummary)
for (const p of report.priorities) {
  console.log(`  Priority ${p.rank}: ${p.label} [${p.severityWord}/${p.zone}] — ${p.steps.length} steps: ${p.steps.map((st) => `${st.stepLabel}:${st.slug}`).join(', ')}`)
}
console.log('positives:', report.positives.join(', '))
