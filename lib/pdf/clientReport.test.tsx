// @vitest-environment node
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { ClientReport } from './clientReport'
import { buildProgramFrom } from '../program/buildProgram'
import { buildClientComparison } from '../reports/clientComparison'
import type { ClientComparison } from '../reports/clientComparison'
import type { Finding } from '../../packages/posture-engine/src/types'
import { compareOverallScores, compareSeverityPercentages } from '@/lib/comparison/policy'
import type { LegalSnapshot } from '@/lib/legal/types'

const VERSION = '2.0.0'
const legalNotice: LegalSnapshot = {
  schemaVersion: 1,
  documentId: 'screening-notice-test-fixture-v1',
  kind: 'screening_notice',
  version: 'test-1',
  title: 'Screening Notice',
  effectiveAt: '2026-07-20T00:00:00.000Z',
  jurisdiction: 'US',
  locale: 'en-US',
  productScope: 'us_fitness_wellness_assessment_beta_v1',
  audience: 'subject',
  bodySha256: 'c'.repeat(64),
  text: 'Exact governed screening notice text.',
  sections: [{ id: 'notice', heading: null, paragraphs: ['Exact governed screening notice text.'] }],
  isFixture: true,
}

const f = (over: Partial<Finding> & Pick<Finding, 'key' | 'label' | 'region' | 'severityPct' | 'zone'>): Finding => ({
  deviation: 10, standard: 0, unit: 'deg', direction: 'Forward',
  viewUsed: 'front', confidence: 0.85, reliable: true, landmarksUsed: [],
  ...over,
})

const findings: Finding[] = [
  f({ key: 'forward_head_posture', label: 'Forward Head Posture', region: 'head_shoulders', severityPct: 78, zone: 'danger' }),
  f({ key: 'anterior_pelvic_shift', label: 'Anterior Pelvic Shift', region: 'pelvis', severityPct: 64, zone: 'warning' }),
  f({ key: 'anterior_imbalanced_shoulders', label: 'Anterior Shoulders', region: 'head_shoulders', severityPct: 52, zone: 'warning' }),
]

const program = buildProgramFrom(findings, 'B')

async function isPdf(el: React.ReactElement): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf = await renderToBuffer(el as any)
  return Buffer.from(buf).slice(0, 4).toString('ascii') === '%PDF'
}

function renderedText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderedText).join(' ')
  if (!React.isValidElement(node)) return ''
  if (typeof node.type === 'function') {
    const Component = node.type as (props: Record<string, unknown>) => React.ReactNode
    return renderedText(Component(node.props as Record<string, unknown>))
  }
  return renderedText((node.props as { children?: React.ReactNode }).children)
}

describe('ClientReport renders (smoke)', () => {
  it('renders without a comparison (base path stays intact)', async () => {
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} legalNotice={legalNotice} />
    expect(await isPdf(el)).toBe(true)
  })

  it('renders the progress card with mixed per-area directions', async () => {
    const comparison = buildClientComparison({
      priorDateStr: '03 Jun 2026',
      current: { grade: 'B', score: 40, scoringEngineVersion: VERSION, assessedAt: '2026-06-28' },
      prior: { grade: 'C', score: 60, scoringEngineVersion: VERSION, assessedAt: '2026-06-03' },
      currentFindings: [
        { key: 'forward_head_posture', severityPct: 50 },        // improving (down 28)
        { key: 'anterior_pelvic_shift', severityPct: 84 },       // attention (up 20)
        { key: 'anterior_imbalanced_shoulders', severityPct: 53 }, // steady (+1)
      ],
      priorFindings: [
        { key: 'forward_head_posture', severityPct: 78 },
        { key: 'anterior_pelvic_shift', severityPct: 64 },
        { key: 'anterior_imbalanced_shoulders', severityPct: 52 },
      ],
    })
    expect(comparison.overall.status).toBe('improved')
    expect(comparison.byKey.forward_head_posture.status).toBe('improved')
    expect(comparison.byKey.anterior_pelvic_shift.status).toBe('regressed')
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} comparison={comparison} legalNotice={legalNotice} />
    expect(await isPdf(el)).toBe(true)
  })

  it('renders a regressed comparison (amber framing path)', async () => {
    const comparison = buildClientComparison({
      priorDateStr: '03 Jun 2026',
      current: { grade: 'C', score: 60, scoringEngineVersion: VERSION, assessedAt: '2026-06-28' },
      prior: { grade: 'B', score: 40, scoringEngineVersion: VERSION, assessedAt: '2026-06-03' },
      currentFindings: [{ key: 'forward_head_posture', severityPct: 90 }],
      priorFindings: [{ key: 'forward_head_posture', severityPct: 60 }],
    })
    expect(comparison.overall.status).toBe('regressed')
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} comparison={comparison} legalNotice={legalNotice} />
    expect(await isPdf(el)).toBe(true)
  })

  it('renders only the version caveat when a malicious caller supplies cross-version area directions', () => {
    const comparison: ClientComparison = {
      priorDateStr: '03 Jun 2026',
      priorGrade: 'B',
      currentGrade: 'C',
      overall: compareOverallScores({
        current: 30,
        prior: 40,
        currentEngineVersion: '2.0.0',
        priorEngineVersion: '1.0.0',
        currentAssessedAt: '2026-06-28',
        priorAssessedAt: '2026-06-03',
      }),
      byKey: {
        forward_head_posture: compareSeverityPercentages({
          current: 30,
          prior: 50,
          currentEngineVersion: VERSION,
          priorEngineVersion: VERSION,
          currentAssessedAt: '2026-06-28',
          priorAssessedAt: '2026-06-03',
        }),
      },
    }

    const tree = ClientReport({
      clientName: 'Jane Doe',
      practitioner: 'Acme Clinic',
      dateStr: '28 Jun 2026',
      report: program,
      comparison,
      legalNotice,
    })
    const text = renderedText(tree)

    expect(text).toContain('different or missing scoring versions')
    expect(text).not.toContain('Improved — lower severity')
    expect(text).not.toContain('Regressed — higher severity')
  })

  it('renders the exact governed screening notice text, version, and effective date', () => {
    const tree = ClientReport({
      clientName: 'Jane Doe',
      practitioner: 'Acme Clinic',
      dateStr: '28 Jun 2026',
      report: program,
      legalNotice,
    })
    const text = renderedText(tree)

    expect(text).toContain(legalNotice.text)
    expect(text).toContain(`Version ${legalNotice.version}`)
    expect(text).toContain(`Effective ${legalNotice.effectiveAt}`)
    expect(text).toContain('NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY')
  })
})
