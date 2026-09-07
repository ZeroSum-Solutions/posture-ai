
import React from 'react'
import type { OverallGrade } from '@posture-ai/engine'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import { GRADE_DISPLAY_BANDS, getGradeDisplayBand, usesCurrentGradeScale } from '@/lib/scoring/grade-display'
import {
  ENGINE_VERSION_COMPARISON_COPY,
  MISSING_VALUE_COMPARISON_COPY,
  MEASUREMENT_TOLERANCE_COPY,
  comparisonDecisionText,
  comparisonTone,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import { reportNoticeCaption, type ReportNotice } from './notice'

const ZONE_COLORS: Record<string, string> = {
  maintain: '#5BD5AC',
  warning: '#FF8918',
  danger: '#DA4E24',
  unreliable: '#949494',
}

const REGION_ORDER: Record<string, number> = { head_shoulders: 0, spine: 1, pelvis: 2, leg: 3 }
const REGION_LABELS: Record<string, string> = {
  head_shoulders: 'Head & Shoulders',
  spine: 'Spine',
  pelvis: 'Pelvis',
  leg: 'Legs',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#000000',
    color: '#FFFFFF',
    fontFamily: 'Helvetica',
    padding: 40,
    fontSize: 10,
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0098F3',
    fontFamily: 'Helvetica-Bold',
  },
  clientName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#CCCCCC',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    fontFamily: 'Helvetica-Bold',
  },
  gradeBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  gradeLetter: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
  },
  overallPanel: {
    backgroundColor: '#060606',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 8,
    color: '#949494',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  findingCard: {
    backgroundColor: '#060606',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
  },
  findingLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  findingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
    alignItems: 'center',
  },
  findingDeviation: {
    fontSize: 9,
    color: '#E4E4E4',
  },
  zoneBadge: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    textTransform: 'uppercase',
  },
  barBackground: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    marginBottom: 4,
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  causeText: {
    fontSize: 8,
    color: '#CCCCCC',
    marginTop: 3,
    lineHeight: 1.4,
  },
  causeLabel: {
    fontSize: 7,
    color: '#949494',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Helvetica-Bold',
  },
  muscleRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  muscleBox: {
    flex: 1,
    borderRadius: 4,
    padding: 4,
  },
  muscleLabel: {
    fontSize: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  muscleText: {
    fontSize: 7,
    color: '#E4E4E4',
    lineHeight: 1.3,
  },
  regionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#0098F3',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 8,
  },
  unreliableOverlay: {
    opacity: 0.5,
  },
  unreliableBadge: {
    fontSize: 7,
    color: '#949494',
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 6.5,
    color: '#52525B',
    textAlign: 'center',
  },
  deltaValue: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  exerciseCard: {
    backgroundColor: 'rgba(0,152,243,0.06)',
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#0098F3',
  },
  exerciseName: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#CCCCCC',
    marginBottom: 2,
  },
  exerciseInstr: {
    fontSize: 7,
    color: '#949494',
    lineHeight: 1.3,
  },
})

export interface PdfFinding {
  id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number | null
  unit: string
  direction: string
  severity_pct: number | null
  zone: string
  view_used: string
  confidence: number
  causes_text?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  delta?: number | null
  comparison?: ComparisonDecision | null
}

export interface PdfExercise {
  name: string
  category: string
  instructions?: string
  sets?: number
  hold_seconds?: number
}

export interface PdfAssessment {
  id: string
  overall_score: number
  overall_grade: OverallGrade
  scoring_engine_version: string | null
  assessed_at: string
  clients: { first_name: string; last_name: string }
}

interface Props {
  assessment: PdfAssessment
  findings: PdfFinding[]
  exercises?: PdfExercise[]
  practitioner?: { display_name?: string; practice_name?: string }
  hasDelta: boolean
  engineVersionMismatch?: boolean
  legalNotice: ReportNotice
}

function Footer({ legalNotice }: { legalNotice: ReportNotice }) {
  return (
    <View style={styles.footer} fixed>
      {legalNotice.kind !== 'prototype_notice' && legalNotice.isFixture ? (
        <Text style={[styles.footerText, { color: '#FF8918', fontFamily: 'Helvetica-Bold' }]}>NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY</Text>
      ) : null}
      <Text style={styles.footerText}>{legalNotice.text}</Text>
      <Text style={styles.footerText}>{reportNoticeCaption(legalNotice)}</Text>
    </View>
  )
}

function FindingCardPdf({ f, hasDelta }: { f: PdfFinding; hasDelta: boolean }) {
  const isUnreliable = f.zone === 'unreliable'
  const zoneColor = ZONE_COLORS[f.zone] || '#949494'
  const comparisonColor = !f.comparison ? '#949494'
    : comparisonTone(f.comparison.status) === 'positive' ? '#5BD5AC'
      : comparisonTone(f.comparison.status) === 'negative' ? '#DA4E24'
        : '#CCCCCC'
  const unit = f.unit === 'deg' ? '°' : f.unit
  const comparableMeasurementDelta = f.comparison
    && f.comparison.reason !== 'different_version'
    && f.comparison.reason !== 'missing_version'

  const tightMuscles = Array.isArray(f.tight_muscles) ? f.tight_muscles : []
  const weakMuscles = Array.isArray(f.weak_muscles) ? f.weak_muscles : []

  return (
    <View wrap={false} style={[styles.findingCard, { borderLeftColor: zoneColor }, isUnreliable ? styles.unreliableOverlay : {}]}>
      <View style={styles.findingRow}>
        <Text style={[styles.findingLabel, { color: isUnreliable ? '#949494' : '#FFFFFF' }]}>
          {f.label}
          {isUnreliable ? ' [Unreliable]' : ''}
        </Text>
        <Text style={[styles.zoneBadge, { color: zoneColor, backgroundColor: zoneColor + '22' }]}>
          {f.zone}
        </Text>
      </View>

      <View style={styles.findingRow}>
        <Text style={styles.findingDeviation}>
          {f.deviation === null ? 'Measurement unavailable' : `${f.deviation.toFixed(1)}${unit} from 0${unit} standard`}
          {f.direction && f.direction !== 'Neutral' && f.direction !== 'Level' ? '  —  ' + f.direction : ''}
        </Text>
        {hasDelta && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.deltaValue, { color: '#CCCCCC' }]}>
              {!comparableMeasurementDelta || f.delta === undefined || f.delta === null ? 'Delta N/A'
                : `Recorded delta ${(f.delta > 0 ? '+' : '')}${Number(f.delta).toFixed(1)}${unit}`}
            </Text>
            <Text style={[styles.deltaValue, { color: comparisonColor }]}>
              {f.comparison ? comparisonDecisionText(f.comparison, 'finding') : MISSING_VALUE_COMPARISON_COPY}
            </Text>
          </View>
        )}
      </View>

      {!isUnreliable && f.severity_pct !== null && (
        <View>
          <View style={styles.barBackground}>
            <View style={[styles.barFill, { backgroundColor: zoneColor, width: f.severity_pct + '%' as unknown as number }]} />
          </View>
          <Text style={{ fontSize: 7, color: '#949494' }}>Severity: {f.severity_pct}%</Text>
        </View>
      )}
      {!isUnreliable && f.severity_pct === null && (
        <Text style={{ fontSize: 7, color: '#949494' }}>Severity unavailable</Text>
      )}

      {f.causes_text ? (
        <Text style={styles.causeText}>
          <Text style={styles.causeLabel}>Behavioral Causes: </Text>
          {f.causes_text}
        </Text>
      ) : null}

      {(tightMuscles.length > 0 || weakMuscles.length > 0) && (
        <View style={styles.muscleRow}>
          {tightMuscles.length > 0 && (
            <View style={[styles.muscleBox, { backgroundColor: 'rgba(239,68,68,0.08)' }]}>
              <Text style={[styles.muscleLabel, { color: '#DA4E24' }]}>Tight</Text>
              <Text style={styles.muscleText}>{tightMuscles.join(', ')}</Text>
            </View>
          )}
          {weakMuscles.length > 0 && (
            <View style={[styles.muscleBox, { backgroundColor: 'rgba(59,130,246,0.08)' }]}>
              <Text style={[styles.muscleLabel, { color: '#3B82F6' }]}>Weak</Text>
              <Text style={styles.muscleText}>{weakMuscles.join(', ')}</Text>
            </View>
          )}
        </View>
      )}
      {(tightMuscles.length > 0 || weakMuscles.length > 0) && (
        <Text style={[styles.muscleText, { marginTop: 3, color: '#8A8A93' }]}>
          See the in-app Muscle Guide for anatomy, screening notes, and exercise progressions.
        </Text>
      )}
    </View>
  )
}

export function PostureReportPdf({ assessment, findings, exercises, practitioner, hasDelta, engineVersionMismatch, legalNotice }: Props) {
  const grade = assessment.overall_grade
  const gradeCol = getGradeDisplayBand(grade).hexColor
  const showCurrentGradeScale = usesCurrentGradeScale(assessment.scoring_engine_version)
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name
  const dateStr = new Date(assessment.assessed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const showComparison = hasDelta

  // Group findings by region
  const grouped: Record<string, PdfFinding[]> = {}
  for (const f of findings) {
    if (!grouped[f.region]) grouped[f.region] = []
    grouped[f.region].push(f)
  }
  const regions = Object.keys(grouped).sort((a, b) => (REGION_ORDER[a] ?? 99) - (REGION_ORDER[b] ?? 99))

  return (
    <Document>
      {/* Page 1: Summary */}
      <Page size="A4" style={styles.page}>
        <Footer legalNotice={legalNotice} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandTitle}>Posture AI</Text>
            {practitioner?.practice_name && (
              <Text style={{ fontSize: 9, color: '#949494' }}>{practitioner.practice_name}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={{ fontSize: 8, color: '#949494' }}>{dateStr}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Overall Posture Rating</Text>

        <View style={styles.overallPanel}>
          <View style={styles.statsRow}>
            {/* Grade circle */}
            <View style={[styles.gradeBox, { borderColor: gradeCol }]}>
              <Text style={[styles.gradeLetter, { color: gradeCol }]}>{grade}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.statLabel}>Deviation (lower is better)</Text>
                <Text style={[styles.statValue, { color: '#FFFFFF' }]}>{assessment.overall_score}/100</Text>
              </View>
            </View>
          </View>

        </View>

        {showCurrentGradeScale ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Grade Reference</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {GRADE_DISPLAY_BANDS.map(band => (
                <View key={band.grade} style={{
                  backgroundColor: band.grade === grade ? gradeCol + '22' : 'rgba(255,255,255,0.04)',
                  borderRadius: 6, padding: 8, alignItems: 'center',
                  borderWidth: band.grade === grade ? 1 : 0, borderColor: gradeCol,
                  minWidth: 60,
                }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: band.hexColor }}>{band.grade}</Text>
                  <Text style={{ fontSize: 7, color: '#949494', marginTop: 2 }}>{band.description} ({band.range})</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={{ marginTop: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: 8 }}>
            <Text style={{ fontSize: 8, color: '#949494', lineHeight: 1.4 }}>
              Recorded with a different or unknown scoring version; the current grade scale is not applied.
            </Text>
          </View>
        )}

        {/* Screening disclaimer note on page 1 */}
        <View style={{ marginTop: 20, backgroundColor: 'rgba(0,152,243,0.08)', borderRadius: 8, padding: 10 }}>
          <Text style={{ fontSize: 8, color: '#CCCCCC', lineHeight: 1.5 }}>{legalNotice.text}</Text>
          <Text style={{ fontSize: 7, color: '#949494', marginTop: 4 }}>
            {reportNoticeCaption(legalNotice)}
          </Text>
        </View>
      </Page>

      {/* Page 2: Detailed Findings */}
      <Page size="A4" style={styles.page}>
        <Footer legalNotice={legalNotice} />

        {/* Header */}
        <View style={[styles.header, { marginBottom: 10 }]}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' }}>Detailed Findings</Text>
          <Text style={{ fontSize: 9, color: '#949494' }}>{clientName} — {dateStr}</Text>
        </View>

        {showComparison && (
          <View style={{ backgroundColor: 'rgba(0,152,243,0.08)', borderRadius: 6, padding: 6, marginBottom: 8 }}>
            <Text style={{ fontSize: 7, color: '#CCCCCC' }}>
              {engineVersionMismatch
                ? ENGINE_VERSION_COMPARISON_COPY
                : `${MEASUREMENT_TOLERANCE_COPY} Recorded measurement deltas are shown separately and never determine the status.`}
            </Text>
          </View>
        )}

        {regions.map(region => (
          <View key={region}>
            <Text style={styles.regionTitle}>{REGION_LABELS[region] ?? region}</Text>
            {grouped[region].map(f => (
              <FindingCardPdf key={f.id} f={f} hasDelta={showComparison} />
            ))}
          </View>
        ))}

        {/* Exercises section */}
        {exercises && exercises.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.sectionTitle}>Corrective Exercises</Text>
            {exercises.map((ex, i) => (
              <View key={i} style={styles.exerciseCard}>
                <Text style={styles.exerciseName}>{ex.name} ({ex.category}){ex.sets ? '  ' + ex.sets + ' sets' : ''}{ex.hold_seconds ? '  ×  ' + ex.hold_seconds + 's hold' : ''}</Text>
                {ex.instructions ? <Text style={styles.exerciseInstr}>{ex.instructions}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}
