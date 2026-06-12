
import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'

const DISCLAIMER = 'SCREENING ONLY — Not a medical diagnosis. For educational and screening purposes only. Do not substitute for clinical examination by a qualified professional.'

const ZONE_COLORS: Record<string, string> = {
  maintain: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  unreliable: '#71717A',
}

const REGION_ORDER: Record<string, number> = { head_shoulders: 0, spine: 1, pelvis: 2, leg: 3 }
const REGION_LABELS: Record<string, string> = {
  head_shoulders: 'Head & Shoulders',
  spine: 'Spine',
  pelvis: 'Pelvis',
  leg: 'Legs',
}

function gradeColor(grade: string): string {
  if (grade === 'S' || grade === 'A') return '#22C55E'
  if (grade === 'B' || grade === 'C') return '#F59E0B'
  return '#EF4444'
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#0A0A0B',
    color: '#F5F5F5',
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
    color: '#6366F1',
    fontFamily: 'Helvetica-Bold',
  },
  clientName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#F5F5F5',
    fontFamily: 'Helvetica-Bold',
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#A1A1AA',
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
    backgroundColor: '#161618',
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
    color: '#71717A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  rankRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  rankItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 6,
    padding: 8,
    flex: 1,
    alignItems: 'center',
  },
  rankLabel: {
    fontSize: 8,
    color: '#71717A',
    marginBottom: 2,
  },
  rankValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#F5F5F5',
  },
  findingCard: {
    backgroundColor: '#161618',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
  },
  findingLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#F5F5F5',
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
    color: '#D4D4D8',
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
    color: '#A1A1AA',
    marginTop: 3,
    lineHeight: 1.4,
  },
  causeLabel: {
    fontSize: 7,
    color: '#71717A',
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
    color: '#D4D4D8',
    lineHeight: 1.3,
  },
  regionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#6366F1',
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
    color: '#71717A',
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
    backgroundColor: 'rgba(99,102,241,0.06)',
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#6366F1',
  },
  exerciseName: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#A1A1AA',
    marginBottom: 2,
  },
  exerciseInstr: {
    fontSize: 7,
    color: '#71717A',
    lineHeight: 1.3,
  },
})

export interface PdfFinding {
  id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  direction: string
  severity_pct: number
  zone: string
  view_used: string
  confidence: number
  causes_text?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  delta?: number | null
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
  overall_grade: string
  overall_percentile: number
  front_rank: number | null
  side_rank: number | null
  assessed_at: string
  clients: { first_name: string; last_name: string }
}

interface Props {
  assessment: PdfAssessment
  findings: PdfFinding[]
  exercises?: PdfExercise[]
  practitioner?: { display_name?: string; practice_name?: string }
  hasDelta: boolean
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{DISCLAIMER}</Text>
    </View>
  )
}

function FindingCardPdf({ f, hasDelta }: { f: PdfFinding; hasDelta: boolean }) {
  const isUnreliable = f.zone === 'unreliable'
  const zoneColor = ZONE_COLORS[f.zone] || '#71717A'
  const deltaColor = f.delta === undefined || f.delta === null ? '#71717A'
    : f.delta <= 0 ? '#22C55E' : '#EF4444'

  const tightMuscles = Array.isArray(f.tight_muscles) ? f.tight_muscles : []
  const weakMuscles = Array.isArray(f.weak_muscles) ? f.weak_muscles : []

  return (
    <View wrap={false} style={[styles.findingCard, { borderLeftColor: zoneColor }, isUnreliable ? styles.unreliableOverlay : {}]}>
      <View style={styles.findingRow}>
        <Text style={[styles.findingLabel, { color: isUnreliable ? '#71717A' : '#F5F5F5' }]}>
          {f.label}
          {isUnreliable ? ' [Unreliable]' : ''}
        </Text>
        <Text style={[styles.zoneBadge, { color: zoneColor, backgroundColor: zoneColor + '22' }]}>
          {f.zone}
        </Text>
      </View>

      <View style={styles.findingRow}>
        <Text style={styles.findingDeviation}>
          {Number(f.deviation).toFixed(1)}° from 0° standard
          {f.direction && f.direction !== 'Neutral' && f.direction !== 'Level' ? '  —  ' + f.direction : ''}
        </Text>
        {hasDelta && (
          <Text style={[styles.deltaValue, { color: deltaColor }]}>
            {f.delta === undefined || f.delta === null ? 'N/A'
              : (f.delta > 0 ? '+' : '') + Number(f.delta).toFixed(1) + '°'}
          </Text>
        )}
      </View>

      {!isUnreliable && (
        <View>
          <View style={styles.barBackground}>
            <View style={[styles.barFill, { backgroundColor: zoneColor, width: f.severity_pct + '%' as unknown as number }]} />
          </View>
          <Text style={{ fontSize: 7, color: '#71717A' }}>Severity: {f.severity_pct}%</Text>
        </View>
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
              <Text style={[styles.muscleLabel, { color: '#EF4444' }]}>Tight</Text>
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

export function PostureReportPdf({ assessment, findings, exercises, practitioner, hasDelta }: Props) {
  const grade = assessment.overall_grade
  const gradeCol = gradeColor(grade)
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name
  const dateStr = new Date(assessment.assessed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

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
        <Footer />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandTitle}>Posture AI</Text>
            {practitioner?.practice_name && (
              <Text style={{ fontSize: 9, color: '#71717A' }}>{practitioner.practice_name}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={{ fontSize: 8, color: '#71717A' }}>{dateStr}</Text>
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
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Percentile</Text>
                <Text style={[styles.statValue, { color: gradeCol }]}>Top {assessment.overall_percentile}%</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.statLabel}>Composite Score</Text>
                <Text style={[styles.statValue, { color: '#F5F5F5' }]}>{assessment.overall_score}/100</Text>
              </View>
            </View>
          </View>

          {/* Per-view ranks */}
          <View style={styles.rankRow}>
            <View style={styles.rankItem}>
              <Text style={styles.rankLabel}>Front View Rank</Text>
              <Text style={styles.rankValue}>{assessment.front_rank ?? 'N/A'}</Text>
            </View>
            <View style={styles.rankItem}>
              <Text style={styles.rankLabel}>Side View Rank</Text>
              <Text style={styles.rankValue}>{assessment.side_rank ?? 'N/A'}</Text>
            </View>
          </View>
        </View>

        {/* Grade band reference */}
        <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Grade Reference</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {[
            { g: 'S', desc: 'Elite (0–5)' },
            { g: 'A', desc: 'Excellent (5–15)' },
            { g: 'B', desc: 'Good (15–50)' },
            { g: 'C', desc: 'Fair (50–85)' },
            { g: 'D', desc: 'Poor (85–95)' },
            { g: 'E', desc: 'Critical (95–100)' },
          ].map(b => (
            <View key={b.g} style={{
              backgroundColor: b.g === grade ? gradeCol + '22' : 'rgba(255,255,255,0.04)',
              borderRadius: 6, padding: 8, alignItems: 'center',
              borderWidth: b.g === grade ? 1 : 0, borderColor: gradeCol,
              minWidth: 60,
            }}>
              <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: gradeColor(b.g) }}>{b.g}</Text>
              <Text style={{ fontSize: 7, color: '#71717A', marginTop: 2 }}>{b.desc}</Text>
            </View>
          ))}
        </View>

        {/* Screening disclaimer note on page 1 */}
        <View style={{ marginTop: 20, backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 8, padding: 10 }}>
          <Text style={{ fontSize: 8, color: '#A1A1AA', lineHeight: 1.5 }}>
            <Text style={{ color: '#6366F1', fontFamily: 'Helvetica-Bold' }}>Screening Only. </Text>
            This report is produced by an AI-assisted posture screening tool. Results are for educational purposes only and require interpretation by a qualified health professional. Not a substitute for clinical examination.
          </Text>
        </View>
      </Page>

      {/* Page 2: Detailed Findings */}
      <Page size="A4" style={styles.page}>
        <Footer />

        {/* Header */}
        <View style={[styles.header, { marginBottom: 10 }]}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#F5F5F5' }}>Detailed Findings</Text>
          <Text style={{ fontSize: 9, color: '#71717A' }}>{clientName} — {dateStr}</Text>
        </View>

        {hasDelta && (
          <View style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 6, padding: 6, marginBottom: 8 }}>
            <Text style={{ fontSize: 7, color: '#A1A1AA' }}>Delta column shows change vs prior assessment. Green = improved, Red = worsened.</Text>
          </View>
        )}

        {regions.map(region => (
          <View key={region}>
            <Text style={styles.regionTitle}>{REGION_LABELS[region] ?? region}</Text>
            {grouped[region].map(f => (
              <FindingCardPdf key={f.id} f={f} hasDelta={hasDelta} />
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
