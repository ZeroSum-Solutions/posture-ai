// @vitest-environment node
import React from 'react'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, type OverallGrade } from '@posture-ai/engine'
import { getGradeDisplayBand } from '@/lib/scoring/grade-display'
import { PostureReportPdf, type PdfAssessment, type PdfFinding } from './report'
import { compareSeverityPercentages, comparisonStatusText } from '@/lib/comparison/policy'
import type { LegalSnapshot } from '@/lib/legal/types'

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

const assessment: PdfAssessment = {
  id: 'assessment-current',
  overall_score: 14,
  overall_grade: 'B',
  scoring_engine_version: ENGINE_VERSION,
  assessed_at: '2026-07-19T12:00:00.000Z',
  clients: { first_name: 'Jane', last_name: 'Doe' },
}

const findings: PdfFinding[] = [{
  id: 'finding-current',
  imbalance_key: 'anterior_imbalanced_shoulders',
  region: 'head_shoulders',
  label: 'Shoulder imbalance',
  deviation: 3.5,
  unit: 'deg',
  direction: 'Right',
  severity_pct: 45,
  zone: 'warning',
  view_used: 'front',
  confidence: 0.9,
  delta: 42.5,
  comparison: compareSeverityPercentages({
    current: 45,
    prior: 40,
    currentEngineVersion: ENGINE_VERSION,
    priorEngineVersion: ENGINE_VERSION,
    currentAssessedAt: '2026-07-19',
    priorAssessedAt: '2026-06-19',
  }),
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

function renderedColors(node: React.ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(renderedColors)
  if (!React.isValidElement(node)) return []
  if (typeof node.type === 'function') {
    const Component = node.type as (props: Record<string, unknown>) => React.ReactNode
    return renderedColors(Component(node.props as Record<string, unknown>))
  }
  const props = node.props as { children?: React.ReactNode; style?: unknown }
  const styles = (Array.isArray(props.style) ? props.style : [props.style])
    .filter((style): style is Record<string, unknown> => Boolean(style) && typeof style === 'object')
  const ownColors = styles.flatMap(style => Object.entries(style)
    .filter(([key, value]) => (key === 'color' || key.endsWith('Color')) && typeof value === 'string')
    .map(([, value]) => value as string))
  return [...ownColors, ...renderedColors(props.children)]
}

describe('PostureReportPdf comparisons', () => {
  it('uses the same exact grade ranges and neutral descriptions as the web projection', () => {
    const tree = PostureReportPdf({ assessment, findings, hasDelta: false, legalNotice })
    const text = renderedText(tree)

    for (const [description, range] of [
      ['Minimal deviation', '0–3'],
      ['Low deviation', '4–7'],
      ['Mild deviation', '8–20'],
      ['Moderate deviation', '21–55'],
      ['High deviation', '56–87'],
      ['Very high deviation', '88–100'],
    ]) {
      expect(text).toContain(description)
      expect(text).toContain(range)
    }

    for (const banned of ['elite', 'critical', 'percentile', 'rank', 'top 10%', 'modeled population']) {
      expect(text.toLowerCase()).not.toContain(banned)
    }
  })

  it('does not apply current ranges to a historical stored grade', () => {
    const tree = PostureReportPdf({
      assessment: { ...assessment, overall_grade: 'D', scoring_engine_version: '1.0.0' },
      findings,
      hasDelta: false,
      legalNotice,
    })
    const text = renderedText(tree)

    expect(text).toContain('different or unknown scoring version')
    expect(text).toContain('D')
    expect(text).not.toContain('Mild deviation')
    expect(text).not.toContain('8–20')
  })

  it.each(['S', 'A', 'B', 'C', 'D', 'E'] as const)('uses the shared %s tone color in the PDF', (grade: OverallGrade) => {
    const tree = PostureReportPdf({
      assessment: { ...assessment, overall_grade: grade },
      findings,
      hasDelta: false,
      legalNotice,
    })

    expect(renderedColors(tree)).toContain(getGradeDisplayBand(grade).hexColor)
  })

  it('shows a same-version degree delta', () => {
    const tree = PostureReportPdf({ assessment, findings, hasDelta: true, legalNotice })
    const text = renderedText(tree)

    expect(text).toContain('Recorded measurement deltas are shown separately')
    expect(text).toContain('Recorded delta +42.5°')
    expect(text).toContain(comparisonStatusText('regressed', 'finding'))
  })

  it('suppresses all degree deltas when scoring versions differ', () => {
    const tree = PostureReportPdf({
      assessment,
      findings: findings.map((finding) => ({
        ...finding,
        comparison: compareSeverityPercentages({
          current: 45,
          prior: 40,
          currentEngineVersion: ENGINE_VERSION,
          priorEngineVersion: '1.0.0',
          currentAssessedAt: '2026-07-19',
          priorAssessedAt: '2026-06-19',
        }),
      })),
      hasDelta: true,
      engineVersionMismatch: true,
      legalNotice,
    })
    const text = renderedText(tree)

    expect(text).toContain('different or missing scoring versions')
    expect(text).not.toContain('+42.5°')
    expect(text).toContain('Not comparable')
  })

  it('renders the exact governed screening notice text, version, and effective date', () => {
    const text = renderedText(PostureReportPdf({
      assessment,
      findings,
      hasDelta: false,
      legalNotice,
    }))

    expect(text).toContain(legalNotice.text)
    expect(text).toContain(`Version ${legalNotice.version}`)
    expect(text).toContain(`Effective ${legalNotice.effectiveAt}`)
    expect(text).toContain('NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY')
  })

  it('keeps assessment-only reports free of unreviewed clinical guidance', () => {
    const text = renderedText(PostureReportPdf({
      assessment,
      findings: findings.map((finding) => ({
        ...finding,
        causes_text: '',
        tight_muscles: [],
        weak_muscles: [],
      })),
      exercises: [],
      hasDelta: false,
      legalNotice,
    }))

    expect(text).toContain('Detailed Findings')
    expect(text).toContain('Shoulder imbalance')
    for (const clinicalHeading of [
      'Behavioral Causes',
      'Tight',
      'Weak',
      'Muscle Guide',
      'Corrective Exercises',
    ]) {
      expect(text).not.toContain(clinicalHeading)
    }
  })
})
