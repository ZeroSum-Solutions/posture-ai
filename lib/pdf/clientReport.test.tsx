// @vitest-environment node
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { ClientReport } from './clientReport'
import { buildProgramFrom } from '../program/buildProgram'
import { buildClientComparison } from '../reports/clientComparison'
import type { Finding } from '../../packages/posture-engine/src/types'

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

describe('ClientReport renders (smoke)', () => {
  it('renders without a comparison (base path stays intact)', async () => {
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} />
    expect(await isPdf(el)).toBe(true)
  })

  it('renders the progress card with mixed per-area directions', async () => {
    const comparison = buildClientComparison({
      priorDateStr: '03 Jun 2026',
      current: { grade: 'B', score: 40 },
      prior: { grade: 'C', score: 60 },
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
    expect(comparison.overall).toBe('improved')
    expect(comparison.byKey.forward_head_posture).toBe('improving')
    expect(comparison.byKey.anterior_pelvic_shift).toBe('attention')
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} comparison={comparison} />
    expect(await isPdf(el)).toBe(true)
  })

  it('renders a "slipped" comparison (amber framing path)', async () => {
    const comparison = buildClientComparison({
      priorDateStr: '03 Jun 2026',
      current: { grade: 'C', score: 60 },
      prior: { grade: 'B', score: 40 },
      currentFindings: [{ key: 'forward_head_posture', severityPct: 90 }],
      priorFindings: [{ key: 'forward_head_posture', severityPct: 60 }],
    })
    expect(comparison.overall).toBe('slipped')
    const el = <ClientReport clientName="Jane Doe" practitioner="Acme Clinic" dateStr="28 Jun 2026" report={program} comparison={comparison} />
    expect(await isPdf(el)).toBe(true)
  })
})
