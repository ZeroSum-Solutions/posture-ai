/**
 * Dev tool: SSR-render the coach PriorityProgram section with a made-up
 * assessment and screenshot it via Playwright. Not part of the app build.
 * Run: npx vite-node scripts/preview-coach-program.tsx
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { chromium } from 'playwright'
import PriorityProgram from '../app/assessments/[id]/PriorityProgram'
import { buildProgram } from '../lib/program/buildProgram'
import type { AssessmentResult, Finding } from '../packages/posture-engine/src/types'

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
  f({ key: 'knee_extension_back_knee', label: 'Knee Extension', region: 'leg', deviation: 8, direction: 'Hyperextended', severityPct: 40, zone: 'warning', viewUsed: 'side', confidence: 0.74 }),
  f({ key: 'pelvic_obliquity', label: 'Pelvic Obliquity', region: 'pelvis', deviation: 1, direction: 'Level', severityPct: 12, zone: 'maintain' }),
  f({ key: 'genu_varum_valgum_left', label: 'Left Knee', region: 'leg', deviation: 2, direction: 'Neutral', severityPct: 8, zone: 'maintain' }),
  f({ key: 'pelvic_axial_rotation', label: 'Pelvic Rotation', region: 'pelvis', deviation: 6, direction: 'Rotated left', severityPct: 33, zone: 'unreliable', reliable: false, confidence: 0.31 }),
]

const result: AssessmentResult = {
  findings,
  overallScore: 38,
  overallGrade: 'C',
  overallPercentile: 61,
  ranks: { front: 36, side: 40 },
  generatedAt: '2026-06-23T00:00:00.000Z',
  engineVersion: 'sample',
  disclaimer: 'Screening only — not a medical diagnosis.',
  missingViews: [],
  tiltCorrected: false,
  levelVerified: true,
}

const report = buildProgram(result, 'standard')
const unreliable = findings.filter((x) => x.zone === 'unreliable').map((x) => ({ label: x.label }))

const body = renderToString(
  createElement(PriorityProgram, { report, unreliable, capability: 'standard', onCapabilityChange: () => {} }),
)

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0A0A0B; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 28px 20px; }
  .ctx { font-size: 0.8rem; color: #52525B; margin-bottom: 18px; }
</style></head><body><div class="wrap">
  <div class="ctx">Coach view · /assessments/[id] · client "Jordan Avery" (SAMPLE) · Grade C</div>
  ${body}
</div></body></html>`

const OUT = process.env.OUT ?? '/private/tmp/claude-501/-Users-zero-suminc-/b0721cc5-ba3c-4cf7-a546-5a18fdc23825/scratchpad/coach-program.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.screenshot({ path: OUT, fullPage: true })
// Zoomed crop of the first priority card for legibility review.
const card = page.locator('[data-testid^="priority-card-"]').first()
await card.screenshot({ path: OUT.replace('.png', '-card1.png') })
await browser.close()

console.log('wrote', OUT)
console.log('priorities:', report.priorities.map((p) => `${p.rank}.${p.label} [${p.severityWord}/${p.zone}] ${p.steps.length} steps${p.hasConnect ? ' +Connect' : ''}`).join(' | '))
console.log('positives:', report.positives.join(', ') || '(none)')
console.log('oneMoreToWatch:', report.oneMoreToWatch ?? '(none)')
console.log('unreliable:', unreliable.map((u) => u.label).join(', ') || '(none)')
