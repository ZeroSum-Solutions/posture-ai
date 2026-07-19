// @vitest-environment node
import React from 'react'
import { describe, expect, it } from 'vitest'
import { PostureReportPdf, type PdfAssessment, type PdfFinding } from './report'

const assessment: PdfAssessment = {
  id: 'assessment-current',
  overall_score: 30,
  overall_grade: 'B',
  overall_percentile: null,
  front_rank: null,
  side_rank: null,
  assessed_at: '2026-07-19T12:00:00.000Z',
  clients: { first_name: 'Jane', last_name: 'Doe' },
}

const findings: PdfFinding[] = [{
  id: 'finding-current',
  imbalance_key: 'anterior_imbalanced_shoulders',
  region: 'head_shoulders',
  label: 'Shoulder imbalance',
  deviation: 3.5,
  direction: 'Right',
  severity_pct: 45,
  zone: 'warning',
  view_used: 'front',
  confidence: 0.9,
  delta: 42.5,
}]

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

describe('PostureReportPdf comparisons', () => {
  it('shows a same-version degree delta', () => {
    const tree = PostureReportPdf({ assessment, findings, hasDelta: true })
    const text = renderedText(tree)

    expect(text).toContain('Delta column shows change vs prior assessment')
    expect(text).toContain('+42.5°')
  })

  it('suppresses all degree deltas when scoring versions differ', () => {
    const tree = PostureReportPdf({
      assessment,
      findings,
      hasDelta: true,
      engineVersionMismatch: true,
    })
    const text = renderedText(tree)

    expect(text).toContain('different scoring versions')
    expect(text).toContain('Comparison values are hidden')
    expect(text).not.toContain('+42.5°')
    expect(text).not.toContain('Delta column')
  })
})
