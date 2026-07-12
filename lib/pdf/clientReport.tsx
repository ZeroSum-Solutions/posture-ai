import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ProgramReport, ProgramStep } from '../program/buildProgram'
import { renderDose } from '../program/dosage'
import { clientSummaryMode } from '../reports/clientProgram'
import type { ClientComparison, OverallDirection, AreaDirection } from '../reports/clientComparison'

const DISCLAIMER =
  'SCREENING ONLY — Not a medical assessment. For educational and screening purposes only. This does not replace evaluation by a qualified professional.'
const ENGINE_VERSION_CAVEAT =
  "These screenings used different scoring versions, so the grade change isn't directly comparable."

// Dark palette (matches the app design tokens) with high-contrast text.
// Solid hex throughout — react-pdf mis-renders rgba() border/background colors.
const C = {
  bg: '#000000',
  surface: '#060606',
  surface2: '#111111',
  border: '#292929',
  text: '#FFFFFF',
  sub: '#CCCCCC',
  faint: '#949494',
  brand: '#0098F3',
  green: '#5BD5AC',
  amber: '#FF8918',
  red: '#DA4E24',
}

const ZONE = {
  warning: { c: '#FF8918', bg: '#332008', word: 'Warning' },
  danger: { c: '#DA4E24', bg: '#3A1414', word: 'Danger' },
}

const STEP_COLOR: Record<string, string> = {
  Loosen: '#0098F3',
  Lengthen: '#5BD5AC',
  'Wake up': '#FF8918',
  Strengthen: '#5BD5AC',
  Connect: '#0098F3',
}

// Encouraging, non-diagnostic phrasing for the "since last time" progress card.
// Colours stay green/amber (never red) — a slip is framed as motivating, not alarming.
const OVERALL_COPY: Record<Exclude<OverallDirection, 'not_comparable'>, { word: string; color: string }> = {
  improved: { word: 'trending in the right direction', color: C.green },
  steady: { word: 'holding steady', color: C.sub },
  slipped: { word: 'some ground to make back — keep at it', color: C.amber },
}
const AREA_COPY: Record<AreaDirection, { word: string; color: string }> = {
  improving: { word: 'improving', color: C.green },
  steady: { word: 'about the same', color: C.sub },
  attention: { word: 'worth extra focus', color: C.amber },
}

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.text, fontFamily: 'Helvetica', padding: 36, paddingBottom: 56, fontSize: 10, lineHeight: 1.45 },
  // header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 12, marginBottom: 16 },
  brand: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.brand },
  brandSub: { fontSize: 8.5, color: C.sub, letterSpacing: 1.5, marginTop: 2 },
  hRight: { alignItems: 'flex-end' },
  clientName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.text },
  meta: { fontSize: 8.5, color: C.sub, marginTop: 2 },
  // generic
  sectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.sub, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  hero: { backgroundColor: C.surface, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: C.brand, padding: 14, marginBottom: 18 },
  heroText: { fontSize: 10.5, color: C.text, lineHeight: 1.55 },
  positives: { fontSize: 9.5, color: C.green, marginTop: 8 },
  // "since last time" progress (client report, page 1)
  progress: { backgroundColor: C.surface, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: C.green, padding: 14, marginBottom: 18 },
  progressTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.sub, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
  progressOverall: { fontSize: 10.5, color: C.text, lineHeight: 1.5 },
  progressArea: { fontSize: 9.5, color: C.text, marginTop: 3 },
  // priority summary card
  pcard: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10, flexDirection: 'row' },
  numCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  numText: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  pTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  pTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.text },
  pill: { borderRadius: 9, paddingVertical: 2, paddingHorizontal: 7, fontSize: 8 },
  body: { fontSize: 9.5, color: C.text, marginBottom: 3 },
  muted: { fontSize: 9, color: C.sub, marginBottom: 2 },
  reassure: { fontSize: 9, color: C.faint, fontStyle: 'italic', marginTop: 3 },
  // plan
  principle: { fontSize: 10, color: C.text, backgroundColor: C.surface2, borderRadius: 8, padding: 10, marginBottom: 12 },
  principleBold: { fontFamily: 'Helvetica-Bold', color: C.brand },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  trHead: { flexDirection: 'row', backgroundColor: C.surface2, paddingVertical: 6, paddingHorizontal: 8 },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 7, paddingHorizontal: 8, alignItems: 'center' },
  thStep: { width: '46%' },
  thWk: { width: '18%', textAlign: 'center' },
  thLabel: { fontSize: 8, color: C.sub, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  stepTag: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  exName: { fontSize: 9.5, color: C.text, fontFamily: 'Helvetica-Bold' },
  exFreq: { fontSize: 7.5, color: C.faint, marginTop: 1 },
  doseCell: { width: '18%', textAlign: 'center', fontSize: 9, color: C.text },
  doseMuted: { width: '18%', textAlign: 'center', fontSize: 9, color: C.faint },
  betterRow: { flexDirection: 'row', marginTop: 2, marginBottom: 4 },
  betterLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.green, marginRight: 4 },
  betterText: { fontSize: 9, color: C.sub, flex: 1 },
  offramp: { fontSize: 8.5, color: C.faint, marginTop: 2 },
  // final page
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  checkbox: { width: 11, height: 11, borderRadius: 3, borderWidth: 1, borderColor: C.sub, marginRight: 8 },
  checkText: { fontSize: 9.5, color: C.text },
  safety: { fontSize: 9, color: C.sub, marginBottom: 3 },
  // footer
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  footerText: { fontSize: 7, color: C.faint },
})

function Header({ clientName, practitioner, dateStr }: { clientName: string; practitioner: string; dateStr: string }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.brand}>Posture AI</Text>
        <Text style={s.brandSub}>YOUR POSTURE PLAN</Text>
      </View>
      <View style={s.hRight}>
        <Text style={s.clientName}>{clientName}</Text>
        <Text style={s.meta}>{practitioner}</Text>
        <Text style={s.meta}>{dateStr}</Text>
      </View>
    </View>
  )
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>{DISCLAIMER}</Text>
    </View>
  )
}

function ZonePill({ zone, word }: { zone: 'warning' | 'danger'; word: string }) {
  const z = ZONE[zone]
  return (
    <Text style={[s.pill, { backgroundColor: z.bg, color: z.c }]}>
      {word} · {z.word}
    </Text>
  )
}

function DoseTable({ steps }: { steps: ProgramStep[] }) {
  return (
    <View style={s.table}>
      <View style={s.trHead}>
        <Text style={[s.thStep, s.thLabel]}>Step &amp; Exercise</Text>
        <Text style={[s.thWk, s.thLabel]}>Week 1</Text>
        <Text style={[s.thWk, s.thLabel]}>Week 2</Text>
        <Text style={[s.thWk, s.thLabel]}>Week 3</Text>
      </View>
      {steps.map((st) => (
        <View style={s.tr} key={st.slug} wrap={false}>
          <View style={s.thStep}>
            <Text style={[s.stepTag, { color: STEP_COLOR[st.stepLabel] ?? C.sub }]}>
              {st.stepLabel}{st.isIntegrative ? ' · new in week 3' : ''}
            </Text>
            <Text style={s.exName}>{st.name}</Text>
            <Text style={s.exFreq}>{st.freq}</Text>
          </View>
          {st.weeks.map((d, i) => (
            <Text key={i} style={d ? s.doseCell : s.doseMuted}>{renderDose(d)}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}

export interface ClientReportProps {
  clientName: string
  practitioner: string
  dateStr: string
  report: ProgramReport
  /** Optional "since last time" progress vs an approved, same-client prior screening. */
  comparison?: ClientComparison | null
  engineVersionMismatch?: boolean
}

export function ClientReport({ clientName, practitioner, dateStr, report, comparison }: ClientReportProps) {
  const first = clientName.split(' ')[0]
  const mode = clientSummaryMode(report)
  const positivesLine =
    report.positives.length > 0
      ? `You're already maintaining good form in ${report.positives.slice(0, 3).join(', ')}.`
      : ''
  const heroPlanLine =
    mode === 'plan'
      ? "These next 3 weeks are about learning a few simple movements and making them feel natural. Visible change is a longer, 6–12 week journey — this is a strong start, and it's a screening, not a medical assessment."
      : mode === 'monitor'
        ? "Your practitioner is keeping an eye on a few areas for now rather than starting a program — see below. This is a screening, not a medical assessment."
        : "Nothing needs active work right now — keep doing what you're doing. This is a screening, not a medical assessment."

  return (
    <Document>
      {/* PAGE 1 — overview + top 3 */}
      <Page size="A4" style={s.page}>
        <Header clientName={clientName} practitioner={practitioner} dateStr={dateStr} />

        <View style={s.hero}>
          <Text style={s.heroText}>
            Hi {first} — here&apos;s your posture screening summary. {report.gradeHuman} {positivesLine} {heroPlanLine}
          </Text>
          {report.positives.length > 0 ? <Text style={s.positives}>✓ {positivesLine}</Text> : null}
        </View>

        {comparison ? (
          <View style={[s.progress, { borderLeftColor: comparison.overall === 'not_comparable' ? C.sub : OVERALL_COPY[comparison.overall].color }]}>
            <Text style={s.progressTitle}>Since your last screening</Text>
            {comparison.overall === 'not_comparable' ? (
              <Text style={s.progressOverall}>
                <Text style={{ color: C.sub }}>Compared with {comparison.priorDateStr}: </Text>
                {ENGINE_VERSION_CAVEAT}
              </Text>
            ) : (
              <Text style={s.progressOverall}>
                <Text style={{ color: C.sub }}>Compared with {comparison.priorDateStr}: </Text>
                Grade {comparison.priorGrade} → {comparison.currentGrade} ·{' '}
                <Text style={{ color: OVERALL_COPY[comparison.overall].color, fontFamily: 'Helvetica-Bold' }}>
                  {OVERALL_COPY[comparison.overall].word}
                </Text>.
              </Text>
            )}
            {report.priorities.map((p) => {
              const dir = comparison.byKey[p.primaryKey]
              if (!dir) return null
              const a = AREA_COPY[dir]
              return (
                <Text style={s.progressArea} key={p.primaryKey}>
                  • {p.label}: <Text style={{ color: a.color, fontFamily: 'Helvetica-Bold' }}>{a.word}</Text>
                </Text>
              )
            })}
          </View>
        ) : null}

        {mode === 'plan' ? (
          <>
            <Text style={s.sectionTitle}>Your Top {report.priorities.length} Priority {report.priorities.length === 1 ? 'Focus' : 'Focuses'}</Text>
            {report.priorities.map((p) => (
              <View style={s.pcard} key={p.primaryKey} wrap={false}>
                <View style={s.numCircle}><Text style={s.numText}>{p.rank}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={s.pTitleRow}>
                    <Text style={s.pTitle}>{p.label}</Text>
                    <ZonePill zone={p.zone} word={cap(p.severityWord)} />
                  </View>
                  <Text style={s.body}>{p.copy.whatItMeans}</Text>
                  <Text style={s.muted}>May feel like: {p.copy.whatItCanFeel}</Text>
                  <Text style={s.reassure}>{p.copy.reassurance}</Text>
                </View>
              </View>
            ))}
            {report.oneMoreToWatch ? (
              <Text style={s.muted}>One more to keep an eye on: {report.oneMoreToWatch}.</Text>
            ) : null}
          </>
        ) : mode === 'monitor' ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Being Monitored</Text>
            <Text style={s.body}>
              Your practitioner has chosen to watch these areas for now rather than start a program:
              {' '}{report.monitored.map((m) => m.label).join(', ')}. Keep moving daily and re-check at your next
              session so any change gets caught early.
            </Text>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.body}>
              Good news — nothing stood out as a priority to focus on right now. Keep moving daily, mix in some
              gentle mobility, and re-check your posture in a few weeks to stay on track.
            </Text>
          </View>
        )}
        <Footer />
      </Page>

      {/* PER-PRIORITY plan + 3-week ramp */}
      {report.priorities.map((p) => (
        <Page size="A4" style={s.page} key={`plan-${p.primaryKey}`}>
          <Header clientName={clientName} practitioner={practitioner} dateStr={dateStr} />
          <View style={s.pTitleRow}>
            <Text style={s.pTitle}>Priority {p.rank} · {p.label}</Text>
            <ZonePill zone={p.zone} word={cap(p.severityWord)} />
          </View>

          <Text style={s.principle}>
            The order matters: <Text style={s.principleBold}>Loosen → Strengthen → Connect</Text>. Loosen and
            lengthen what&apos;s tight, then wake up and strengthen what&apos;s weak, then tie it together — the order is
            what makes it stick.
          </Text>

          <Text style={s.sectionTitle}>Your Plan &amp; 3-Week Ramp</Text>
          <DoseTable steps={p.steps} />

          <View style={s.betterRow}>
            <Text style={s.betterLabel}>What better feels like:</Text>
            <Text style={s.betterText}>{p.copy.whatBetterLooksLike}</Text>
          </View>
          <Text style={s.offramp}>
            Aim for ~15 minutes a day. If a week felt hard, repeat the same numbers before moving up — the path
            is a suggestion, not a rule.
          </Text>
          <Footer />
        </Page>
      ))}

      {/* FINAL — progress + safety */}
      <Page size="A4" style={s.page}>
        <Header clientName={clientName} practitioner={practitioner} dateStr={dateStr} />
        <Text style={s.sectionTitle}>Track Your Progress</Text>
        <View style={s.card}>
          <Text style={[s.body, { marginBottom: 8 }]}>Tick a box each week you complete most of your sessions:</Text>
          {['Week 1 — Learn & Own', 'Week 2 — Reinforce', 'Week 3 — Consolidate'].map((w) => (
            <View style={s.checkRow} key={w}>
              <View style={s.checkbox} />
              <Text style={s.checkText}>{w}</Text>
            </View>
          ))}
          <Text style={[s.muted, { marginTop: 8 }]}>
            Day-21 check-in: How automatic does this feel now, 0–10? ____   (Compare it to how week 1 felt.)
          </Text>
          <Text style={s.muted}>
            Next step: run a second 3-week block, then re-screen your posture at about 6 weeks to see your progress.
          </Text>
        </View>

        <Text style={s.sectionTitle}>Safety &amp; When to See a Pro</Text>
        <View style={s.card}>
          <Text style={s.safety}>• Move within a comfortable range. Mild effort is fine; sharp pain is not — stop if it hurts.</Text>
          <Text style={s.safety}>• See a qualified professional if you have ongoing pain, numbness, tingling, dizziness, or a recent injury.</Text>
          <Text style={s.safety}>• This plan is general guidance from a posture screening, not a personalized medical assessment.</Text>
        </View>
        <Footer />
      </Page>
    </Document>
  )
}

function cap(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1)
}
