// @vitest-environment node
import React from 'react'
import { describe, expect, it } from 'vitest'
import type { Finding } from '@posture-ai/engine'
import ComparisonWorkspace from '@/app/clients/[id]/ComparisonWorkspace'
import { ClientReport } from '@/lib/pdf/clientReport'
import { PostureReportPdf, type PdfAssessment } from '@/lib/pdf/report'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import type { ClientComparison } from '@/lib/reports/clientComparison'
import type { LegalSnapshot } from '@/lib/legal/types'
import {
  compareOverallScores,
  compareSeverityPercentages,
  comparisonDecisionText,
  type ComparisonDecision,
} from './policy'

const VERSION = '2.0.0'
const legalNotice: LegalSnapshot = {
  schemaVersion: 1,
  documentId: 'screening-notice-test-v1',
  kind: 'screening_notice',
  version: 'test-1',
  title: 'Screening Notice',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  jurisdiction: 'US',
  locale: 'en-US',
  productScope: 'us_fitness_wellness_assessment_beta_v1',
  audience: 'subject',
  bodySha256: 'b'.repeat(64),
  text: 'Exact screening notice.',
  sections: [{ id: 'notice', heading: null, paragraphs: ['Exact screening notice.'] }],
  isFixture: true,
}
const versionPair = {
  currentEngineVersion: VERSION,
  priorEngineVersion: VERSION,
  currentAssessedAt: '2026-02-01',
  priorAssessedAt: '2026-01-01',
}

const finding: Finding = {
  key: 'forward_head_posture',
  label: 'Forward Head Posture',
  region: 'head_shoulders',
  deviation: 8,
  standard: 0,
  unit: 'deg',
  direction: 'Forward',
  severityPct: 54,
  zone: 'warning',
  viewUsed: 'side',
  confidence: 0.9,
  reliable: true,
  landmarksUsed: [],
}

const program = buildProgramFrom([finding], 'B')
const assessment: PdfAssessment = {
  id: 'current',
  overall_score: 20,
  overall_grade: 'B',
  scoring_engine_version: VERSION,
  assessed_at: '2026-02-01T00:00:00Z',
  clients: { first_name: 'Jane', last_name: 'Doe' },
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

function webText(
  decision: ComparisonDecision,
  overall = compareOverallScores({ current: 20, prior: 20, ...versionPair }),
) {
  return renderedText(ComparisonWorkspace({
    assessments: [
      { id: 'prior', assessedAt: '2026-01-01T00:00:00Z', overallGrade: 'B', overallScore: 20, scoringEngineVersion: VERSION, status: 'approved' },
      { id: 'current', assessedAt: '2026-02-01T00:00:00Z', overallGrade: 'B', overallScore: 20, scoringEngineVersion: VERSION, status: 'approved' },
    ],
    baseId: 'prior',
    targetId: 'current',
    overallComparison: overall,
    deltaRows: [{
      key: finding.key,
      label: finding.label,
      baseDeviation: 8,
      targetDeviation: 8,
      baseUnit: 'deg',
      targetUnit: 'deg',
      unit: 'deg',
      delta: 0,
      comparison: decision,
    }],
    onBaseChange: () => undefined,
    onTargetChange: () => undefined,
  }))
}

function clientPdfText(
  decision: ComparisonDecision,
  overall = compareOverallScores({ current: 20, prior: 20, ...versionPair }),
) {
  const comparison: ClientComparison = {
    priorDateStr: '01 Jan 2026',
    priorGrade: 'B',
    currentGrade: 'B',
    overall,
    byKey: { [finding.key]: decision },
  }
  return renderedText(ClientReport({
    clientName: 'Jane Doe',
    practitioner: 'Test Practice',
    dateStr: '01 Feb 2026',
    report: program,
    comparison,
    legalNotice,
  }))
}

function practitionerPdfText(decision: ComparisonDecision) {
  return renderedText(PostureReportPdf({
    assessment,
    hasDelta: true,
    legalNotice,
    findings: [{
      id: 'finding',
      imbalance_key: finding.key,
      region: finding.region,
      label: finding.label,
      deviation: finding.deviation,
      unit: finding.unit,
      direction: finding.direction,
      severity_pct: finding.severityPct,
      zone: finding.zone,
      view_used: finding.viewUsed,
      confidence: finding.confidence,
      delta: 0,
      comparison: decision,
    }],
  }))
}

describe('comparison consumer parity', () => {
  const cases: Array<[string, ComparisonDecision]> = [
    ['improved', compareSeverityPercentages({ current: 45, prior: 50, ...versionPair })],
    ['regressed', compareSeverityPercentages({ current: 55, prior: 50, ...versionPair })],
    ['unchanged', compareSeverityPercentages({ current: 50, prior: 50, ...versionPair })],
    ['within_tolerance', compareSeverityPercentages({ current: 54, prior: 50, ...versionPair })],
    ['different_version', compareSeverityPercentages({
      current: 10,
      prior: 90,
      currentEngineVersion: VERSION,
      priorEngineVersion: '1.0.0',
      currentAssessedAt: '2026-02-01',
      priorAssessedAt: '2026-01-01',
    })],
    ['missing_value', compareSeverityPercentages({ current: null, prior: 50, ...versionPair })],
    ['unreliable', compareSeverityPercentages({ current: 0, prior: 50, currentReliable: false, ...versionPair })],
    ['unit_mismatch', compareSeverityPercentages({ current: 45, prior: 50, currentUnit: 'deg', priorUnit: 'cm', ...versionPair })],
    ['missing_timestamp', compareSeverityPercentages({
      current: 45,
      prior: 50,
      currentEngineVersion: VERSION,
      priorEngineVersion: VERSION,
      currentAssessedAt: undefined,
      priorAssessedAt: undefined,
    })],
    ['non_chronological', compareSeverityPercentages({
      current: 45,
      prior: 50,
      currentEngineVersion: VERSION,
      priorEngineVersion: VERSION,
      currentAssessedAt: '2026-01-01',
      priorAssessedAt: '2026-02-01',
    })],
  ]

  it.each(cases)('uses the exact central %s decision wording in web and both PDFs', (_name, decision) => {
    const expected = comparisonDecisionText(decision, 'finding')
    expect(webText(decision)).toContain(expected)
    expect(clientPdfText(decision)).toContain(expected)
    expect(practitionerPdfText(decision)).toContain(expected)
  })

  it.each([
    ['improved', compareOverallScores({ current: 17, prior: 20, ...versionPair })],
    ['regressed', compareOverallScores({ current: 23, prior: 20, ...versionPair })],
    ['unchanged', compareOverallScores({ current: 20, prior: 20, ...versionPair })],
    ['within_tolerance', compareOverallScores({ current: 19, prior: 20, ...versionPair })],
    ['not_comparable', compareOverallScores({
      current: 10,
      prior: 90,
      currentEngineVersion: VERSION,
      priorEngineVersion: '1.0.0',
      currentAssessedAt: '2026-02-01',
      priorAssessedAt: '2026-01-01',
    })],
  ])('uses the exact central %s overall wording in web and client PDF', (_name, overall) => {
    const findingDecision = compareSeverityPercentages({ current: 50, prior: 50, ...versionPair })
    const expected = comparisonDecisionText(overall, 'overall')
    expect(webText(findingDecision, overall)).toContain(expected)
    expect(clientPdfText(findingDecision, overall)).toContain(expected)
  })
})
