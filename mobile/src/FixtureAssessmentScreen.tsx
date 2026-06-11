import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { assessPosture } from '@posture-ai/engine'
import type { AssessmentResult, Finding } from '@posture-ai/engine'

import { createInitialPoseFrameSourceState, getAssessableFrames } from './poseFrameSource'

const fixtureSource = createInitialPoseFrameSourceState()
const assessment = assessPosture(getAssessableFrames(fixtureSource))

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function rankLabel(rank: number | null): string {
  if (rank === null) return 'Rank N/A — insufficient data'
  return `Rank ${ordinal(rank)} out of 100`
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <View style={styles.findingRow} testID={`finding-${finding.key}`}>
      <Text style={styles.findingLabel}>{finding.label}</Text>
      <Text style={styles.findingMeta}>
        {finding.deviation.toFixed(1)}
        {finding.unit} · {finding.zone} · {finding.severityPct}%
      </Text>
    </View>
  )
}

function SummaryPanel({ result }: { result: AssessmentResult }) {
  return (
    <View style={styles.panel} testID="assessment-summary">
      <Text style={styles.sectionTitle}>Overall Rating</Text>
      <Text style={styles.grade} testID="overall-grade">
        {result.overallGrade}
      </Text>
      <Text style={styles.scoreLine} testID="overall-score">
        Score: {result.overallScore}/100
      </Text>
      <Text style={styles.percentile} testID="overall-percentile">
        Top {result.overallPercentile}%
      </Text>
      <Text style={styles.rankLine} testID="rank-front">
        Front — {rankLabel(result.ranks.front)}
      </Text>
      <Text style={styles.rankLine} testID="rank-side">
        Side — {rankLabel(result.ranks.side)}
      </Text>
    </View>
  )
}

export default function FixtureAssessmentScreen() {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="fixture-assessment-screen"
    >
      <Text style={styles.title}>Fixture Assessment Tracer</Text>
      <Text style={styles.subtitle}>Read-only · test-landmarks → assessPosture()</Text>

      <SummaryPanel result={assessment} />

      <View style={styles.panel} testID="findings-list">
        <Text style={styles.sectionTitle}>Findings ({assessment.findings.length})</Text>
        {assessment.findings.map((finding) => (
          <FindingRow key={finding.key} finding={finding} />
        ))}
      </View>

      <View style={styles.disclaimerBox} testID="disclaimer">
        <Text style={styles.disclaimerText}>{assessment.disclaimer}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0A0B',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#F5F5F5',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#71717A',
    fontSize: 13,
    marginBottom: 20,
  },
  panel: {
    backgroundColor: '#161618',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  grade: {
    color: '#F59E0B',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 8,
  },
  scoreLine: {
    color: '#D4D4D8',
    fontSize: 16,
    marginBottom: 4,
  },
  percentile: {
    color: '#F5F5F5',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  rankLine: {
    color: '#A1A1AA',
    fontSize: 14,
    marginBottom: 4,
  },
  findingRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 10,
  },
  findingLabel: {
    color: '#F5F5F5',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  findingMeta: {
    color: '#71717A',
    fontSize: 13,
  },
  disclaimerBox: {
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.25)',
    padding: 12,
  },
  disclaimerText: {
    color: '#D4D4D8',
    fontSize: 13,
    lineHeight: 20,
  },
})
