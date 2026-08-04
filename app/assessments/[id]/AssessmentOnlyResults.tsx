'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import LegalNotice from '@/components/LegalNotice'
import { BandTable, GradeRing, ScoreBar, gradeColor } from './GradeSummary'
import { getGradeDisplayBand, usesCurrentGradeScale } from '@/lib/scoring/grade-display'
import { bandFromZone, tone } from '@/components/array/severity'
import ReviewTabs from './ReviewTabs'
import styles from './AssessmentReviewStudio.module.css'

type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'

interface AssessmentOnlyFinding {
  id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  unit?: string | null
  direction: string
  severity_pct: number
  zone: Zone
  view_used: string
  confidence: number
  stability_score?: number | null
  uncertainty_deg?: number | null
}

interface AssessmentOnlyRecord {
  id: string
  overall_score: number
  overall_grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'E'
  scoring_engine_version: string | null
  assessed_at: string
  practitioner_approved?: boolean | null
  level_verified?: boolean | null
  capture_stability?: number | null
  clients: { id: string; first_name: string; last_name: string }
}

// Every zone here is a severity band, so its colour comes from the shared
// severity module rather than a per-file token guess.
const ZONE_COLORS: Record<Zone, string> = {
  maintain: tone(bandFromZone('maintain')),
  warning: tone(bandFromZone('warning')),
  danger: tone(bandFromZone('danger')),
  unreliable: tone(bandFromZone('unreliable')),
}

export default function AssessmentOnlyResults({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [assessmentId, setAssessmentId] = useState('')
  const [assessment, setAssessment] = useState<AssessmentOnlyRecord | null>(null)
  const [findings, setFindings] = useState<AssessmentOnlyFinding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => { void params.then(({ id }) => setAssessmentId(id)) }, [params])

  useEffect(() => {
    if (!assessmentId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/assessments/${assessmentId}`, { signal: controller.signal })
        if (response.status === 401) { router.push('/auth/sign-in'); return }
        if (!response.ok) throw new Error('Assessment not found.')
        const payload = await response.json()
        if (payload.clinical_content?.enabled !== false) {
          throw new Error('Assessment boundary could not be verified.')
        }
        setAssessment(payload.assessment)
        setFindings(payload.findings ?? [])
        setApproved(Boolean(payload.assessment?.practitioner_approved))
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [assessmentId, router])

  async function approveAssessment() {
    if (!assessmentId || approving) return
    setApproving(true)
    setError(null)
    try {
      const response = await fetch(`/api/assessments/${assessmentId}/approve`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      })
      if (!response.ok) throw new Error('The assessment could not be approved.')
      setApproved(true)
    } catch (approveError) {
      setError((approveError as Error).message)
    } finally {
      setApproving(false)
    }
  }

  async function generateAssessmentPdf() {
    if (!assessmentId || !approved || pdfLoading) return
    setPdfLoading(true)
    setPdfUrl(null)
    setError(null)
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, variant: 'practitioner' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.signed_url) throw new Error(payload.error ?? 'PDF generation failed.')
      setPdfUrl(payload.signed_url)
    } catch (pdfError) {
      setError((pdfError as Error).message)
    } finally {
      setPdfLoading(false)
    }
  }

  if (loading) return <div className="app-standard-page"><p>Loading assessment…</p></div>
  if (error && !assessment) return <div className="app-standard-page"><p role="alert">{error}</p></div>
  if (!assessment) return null

  const usesCurrentScale = usesCurrentGradeScale(assessment.scoring_engine_version)
  const gradeDescription = usesCurrentScale
    ? getGradeDisplayBand(assessment.overall_grade).description
    : 'Recorded screening grade'
  const clientName = `${assessment.clients.first_name} ${assessment.clients.last_name}`
  const findingsNeedingReview = findings.filter((finding) => finding.zone === 'warning' || finding.zone === 'danger').length
  const maintainingFindings = findings.filter((finding) => finding.zone === 'maintain').length
  const unavailableFindings = findings.filter((finding) => finding.zone === 'unreliable').length

  return (
    <div className={styles.reviewPage} data-testid="assessment-only-results">
      <Link className={styles.backLink} href={`/clients/${assessment.clients.id}`}>← Back to client</Link>
      <header className={styles.studioHeader}>
        <p className="app-page-kicker">Screening review</p>
        <h1>Screening results</h1>
        <p>Start with the grade, then open the practitioner findings when you are ready to review them.</p>
      </header>

      <div className={styles.studioGrid}>
        <aside className={styles.dock} aria-label="Assessment controls">
          <div className={styles.dockSummary}>
            <div className={styles.identity}>
              <div><span className={styles.quietLabel}>Assessment</span><h2>{clientName}</h2></div>
              <div className={styles.gradeReadout} aria-label={`Grade ${assessment.overall_grade}`}>
                <span>Grade</span>
                <strong>{assessment.overall_grade}</strong>
                <small>{assessment.overall_score}/100</small>
                <em>{gradeDescription}</em>
              </div>
            </div>
            <p className={styles.actionHint}>
              Recommendations and exercise programs are not included in this assessment-only release.
            </p>
          </div>
          <div className={styles.dockActions}>
            {!approved ? (
              <button className={styles.primaryAction} data-testid="approve-report" onClick={approveAssessment} disabled={approving}>
                <span>{approving ? 'Approving…' : 'Approve assessment'}</span>
              </button>
            ) : (
              <button className={styles.primaryAction} onClick={generateAssessmentPdf} disabled={pdfLoading}>
                <span>{pdfLoading ? 'Generating…' : 'Generate assessment PDF'}</span>
              </button>
            )}
            {pdfUrl && <a className={styles.downloadAction} href={pdfUrl} target="_blank" rel="noopener noreferrer">Open assessment PDF</a>}
            {error && <p role="alert" className={styles.actionAlert}>{error}</p>}
          </div>
        </aside>

        <main className={styles.canvas}>
          <ReviewTabs
            defaultTabId="assessment-summary"
            label="Assessment result details"
            tabs={[
              {
                id: 'assessment-summary',
                label: 'Summary',
                content: (
                  <>
                    <h2 className={styles.sectionHeading}>At a glance</h2>
                    <div className={styles.summaryHero}>
                      <div className={styles.ratingSummary}>
                        <GradeRing grade={assessment.overall_grade} score={assessment.overall_score} description={gradeDescription} />
                        <div>
                          <span className={styles.quietLabel}>Overall screening grade</span>
                          <strong>{gradeDescription}</strong>
                          <p>Deviation: {assessment.overall_score}/100 (lower is better) — Grade <span style={{ color: gradeColor(assessment.overall_grade) }}>{assessment.overall_grade}</span></p>
                          {usesCurrentScale && <ScoreBar score={assessment.overall_score} grade={assessment.overall_grade} />}
                        </div>
                      </div>
                      <div className={styles.findingSnapshot} aria-label="Finding summary">
                        <div className={styles.snapshotCard}>
                          <span>Review</span>
                          <strong className="data-readout">{findingsNeedingReview}</strong>
                          <small>flagged findings</small>
                        </div>
                        <div className={styles.snapshotCard}>
                          <span>Maintain</span>
                          <strong className="data-readout">{maintainingFindings}</strong>
                          <small>within maintain range</small>
                        </div>
                        <div className={styles.snapshotCard}>
                          <span>Unavailable</span>
                          <strong className="data-readout">{unavailableFindings}</strong>
                          <small>readings to recheck</small>
                        </div>
                      </div>
                      <a className={styles.snapshotAction} href="#assessment-findings">
                        Review all {findings.length} findings
                      </a>
                    </div>
                    {usesCurrentScale && (
                      <details className={styles.detailDisclosure}>
                        <summary>Grade reference</summary>
                        <div className={styles.detailDisclosureContent}>
                          <BandTable currentGrade={assessment.overall_grade} />
                        </div>
                      </details>
                    )}
                    <details data-testid="disclaimer" className={styles.detailDisclosure}>
                      <summary>Screening notice</summary>
                      <div className={styles.screeningNotice}><LegalNotice kind="screening_notice" compact /></div>
                    </details>
                  </>
                ),
              },
              {
                id: 'assessment-findings',
                label: 'Findings',
                count: findings.length,
                content: (
                  <>
                    <h2 className={styles.sectionHeading}>Practitioner findings</h2>
                    <div className={styles.compactFindings}>
                      {findings.map((finding) => (
                        <article key={finding.id} data-testid={`finding-card-${finding.imbalance_key}`} className={styles.compactFinding}>
                          <div className={styles.compactFindingHeader}>
                            <strong>{finding.label}</strong>
                            <span style={{ color: ZONE_COLORS[finding.zone] }}>{finding.zone}</span>
                          </div>
                          <p>
                            {Number(finding.deviation).toFixed(1)}{finding.unit ?? '°'} · {finding.direction} · {finding.view_used} view
                            {finding.uncertainty_deg != null ? ` · ±${finding.uncertainty_deg.toFixed(1)}° capture variation` : ''}
                          </p>
                        </article>
                      ))}
                      {findings.length === 0 && <p>No findings were recorded for this screening.</p>}
                    </div>
                  </>
                ),
              },
            ]}
          />
        </main>
      </div>
    </div>
  )
}
