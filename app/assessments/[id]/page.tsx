'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type OverallGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'
type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'

interface Finding {
  id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  direction: string
  severity_pct: number
  zone: Zone
  view_used: string
  confidence: number
}

interface Assessment {
  id: string
  status: string
  overall_score: number
  overall_grade: OverallGrade
  overall_percentile: number
  front_rank: number
  side_rank: number
  assessed_at: string
  clients: { id: string; first_name: string; last_name: string }
}

// Grade → color mapping (S/A=green, B/C=amber, D/E=red)
function gradeColor(grade: OverallGrade): string {
  if (grade === 'S' || grade === 'A') return '#22C55E'
  if (grade === 'B' || grade === 'C') return '#F59E0B'
  return '#EF4444'
}

// Zone colors
const ZONE_COLORS: Record<Zone, string> = {
  maintain: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  unreliable: '#71717A',
}

// Band reference table
const GRADE_BANDS = [
  { grade: 'S', range: '0–5', desc: 'Elite', color: '#22C55E' },
  { grade: 'A', range: '5–15', desc: 'Excellent', color: '#22C55E' },
  { grade: 'B', range: '15–50', desc: 'Good', color: '#F59E0B' },
  { grade: 'C', range: '50–85', desc: 'Fair', color: '#F59E0B' },
  { grade: 'D', range: '85–95', desc: 'Poor', color: '#EF4444' },
  { grade: 'E', range: '95–100', desc: 'Critical', color: '#EF4444' },
]

const REGION_ORDER: Record<string, number> = { head_shoulders: 0, spine: 1, pelvis: 2, leg: 3 }
const REGION_LABELS: Record<string, string> = {
  head_shoulders: 'Head & Shoulders',
  spine: 'Spine',
  pelvis: 'Pelvis',
  leg: 'Legs',
}

// ---- Grade Ring Component ----
function GradeRing({ grade, score }: { grade: OverallGrade; score: number }) {
  const color = gradeColor(grade)
  const r = 42
  const circumference = 2 * Math.PI * r
  // Fill arc based on score (0=full circle fill for S, 100=empty for E)
  // Invert: lower score = more filled = better
  const fillPct = Math.max(0, 100 - score) / 100
  const dashOffset = circumference * (1 - fillPct)

  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        {/* Background track */}
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        {/* Filled arc */}
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '2rem', fontWeight: 900, color, lineHeight: 1 }}>{grade}</span>
      </div>
    </div>
  )
}

// ---- Score Gradient Bar ----
function ScoreBar({ score, grade }: { score: number; grade: OverallGrade }) {
  const color = gradeColor(grade)
  // Position marker: score 0=left (green), 100=right (red)
  const positionPct = Math.min(100, Math.max(0, score))

  return (
    <div>
      {/* Gradient bar */}
      <div style={{ position: 'relative', height: 12, borderRadius: 6, overflow: 'hidden',
        background: 'linear-gradient(to right, #22C55E 0%, #22C55E 15%, #F59E0B 50%, #EF4444 85%, #EF4444 100%)',
        marginBottom: 8,
      }}>
        {/* Score position marker */}
        <div style={{
          position: 'absolute',
          left: positionPct + '%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 18, height: 18,
          borderRadius: '50%',
          background: color,
          border: '3px solid #0A0A0B',
          boxShadow: '0 0 8px ' + color + '88',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#71717A' }}>
        <span style={{ color: '#22C55E' }}>S (Best)</span>
        <span>Score: {score}</span>
        <span style={{ color: '#EF4444' }}>E (Worst)</span>
      </div>
    </div>
  )
}

// ---- Band Reference Table ----
function BandTable({ currentGrade }: { currentGrade: OverallGrade }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grade Reference</h3>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {GRADE_BANDS.map(b => (
          <div key={b.grade} style={{
            padding: '6px 10px',
            borderRadius: 8,
            background: b.grade === currentGrade ? b.color + '22' : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (b.grade === currentGrade ? b.color : 'rgba(255,255,255,0.08)'),
            textAlign: 'center',
            minWidth: 56,
          }}>
            <div style={{ fontSize: '1rem', fontWeight: 900, color: b.color }}>{b.grade}</div>
            <div style={{ fontSize: '0.68rem', color: '#71717A', marginTop: 1 }}>{b.range}</div>
            <div style={{ fontSize: '0.65rem', color: '#52525B' }}>{b.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Findings Section ----
function FindingsSection({ findings }: { findings: Finding[] }) {
  const grouped = findings.reduce((acc, f) => {
    if (!acc[f.region]) acc[f.region] = []
    acc[f.region].push(f)
    return acc
  }, {} as Record<string, Finding[]>)

  const regions = Object.keys(grouped).sort((a, b) => (REGION_ORDER[a] ?? 99) - (REGION_ORDER[b] ?? 99))

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Detailed Findings
      </h2>
      {regions.map(region => (
        <div key={region} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6366F1', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {REGION_LABELS[region] ?? region}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grouped[region].map(f => (
              <div key={f.id} style={{
                background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: 16,
                borderLeft: '3px solid ' + ZONE_COLORS[f.zone],
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#F5F5F5', fontSize: '0.9rem' }}>
                    {f.label}
                    <span style={{ marginLeft: 8, fontSize: '0.78rem', color: '#A1A1AA' }}>({f.view_used} view)</span>
                  </span>
                  <span style={{
                    padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
                    background: ZONE_COLORS[f.zone] + '22',
                    color: ZONE_COLORS[f.zone], textTransform: 'uppercase',
                  }}>{f.zone}</span>
                </div>
                <div style={{ fontSize: '0.875rem', color: '#D4D4D8', marginBottom: 10 }}>
                  <strong>{Number(f.deviation).toFixed(1)}&deg;</strong> deviation
                  {f.direction && f.direction !== 'Neutral' && <span style={{ color: '#A1A1AA' }}> — {f.direction}</span>}
                </div>
                {/* Severity bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: '#71717A' }}>Severity</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: ZONE_COLORS[f.zone] }}>{f.severity_pct}%</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: f.severity_pct + '%',
                      background: ZONE_COLORS[f.zone],
                      borderRadius: 3, transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Main Results Page ----
export default function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assessmentId, setAssessmentId] = useState<string>('')

  useEffect(() => {
    params.then(p => setAssessmentId(p.id))
  }, [params])

  useEffect(() => {
    if (!assessmentId) return
    async function load() {
      try {
        const r = await fetch('/api/assessments/' + assessmentId)
        if (!r.ok) {
          if (r.status === 401) { router.push('/auth/sign-in'); return }
          setError('Assessment not found.')
          setLoading(false)
          return
        }
        const data = await r.json()
        setAssessment(data.assessment)
        setFindings(data.findings || [])
      } catch {
        setError('Failed to load assessment.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [assessmentId, router])

  if (loading) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, border: '4px solid rgba(99,102,241,0.2)', borderTop: '4px solid #6366F1', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        <p style={{ color: '#A1A1AA' }}>Loading results...</p>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: '#EF4444', marginBottom: 16 }}>{error || 'Assessment not found.'}</p>
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none' }}>Back to Clients</Link>
      </div>
    )
  }

  const grade = assessment.overall_grade
  const score = assessment.overall_score
  const percentile = assessment.overall_percentile
  const color = gradeColor(grade)
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name

  return (
    <div style={{ padding: '24px 16px', maxWidth: 960, margin: '0 auto' }}>
      {/* Back link */}
      <div style={{ marginBottom: 20 }}>
        <Link href={'/clients/' + assessment.clients.id}
          style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          ← Back to {clientName}
        </Link>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', margin: '0 0 4px' }}>Assessment Results</h1>
        <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
          {clientName} — {new Date(assessment.assessed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Disclaimer */}
      <div style={{
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: '0.8rem', color: '#A1A1AA', lineHeight: 1.5,
      }}>
        <strong style={{ color: '#6366F1' }}>Screening Only</strong> — Not a medical diagnosis. For educational and screening purposes only. Results require interpretation by a qualified professional.
      </div>

      {/* Overall Rating Panel */}
      <div style={{
        background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
        padding: 24, marginBottom: 24,
      }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Overall Rating
        </h2>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }}>
          {/* Grade ring SVG */}
          <GradeRing grade={grade} score={score} />

          {/* Percentile and score */}
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: 4 }}>
              Top {percentile}%
            </div>
            <div style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: 16 }}>
              Score: {score}/100 — Grade <span style={{ color, fontWeight: 700 }}>{grade}</span>
            </div>
            {/* Score gradient bar */}
            <ScoreBar score={score} grade={grade} />
          </div>
        </div>

        {/* Band table */}
        <BandTable currentGrade={grade} />
      </div>

      {/* Findings */}
      {findings.length > 0 && <FindingsSection findings={findings} />}

      {/* Footer disclaimer */}
      <div style={{
        background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: 10, padding: '12px 16px', fontSize: '0.78rem', color: '#71717A', lineHeight: 1.5,
        marginBottom: 24,
      }}>
        <strong style={{ color: '#EF4444' }}>SCREENING ONLY.</strong> These findings are for educational and screening purposes only. Do not substitute for clinical examination.
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href={'/clients/' + assessment.clients.id} style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.06)',
          color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44,
        }}>Back to Client</Link>
        <Link href="/assessments/new" style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(99,102,241,0.12)',
          color: '#6366F1', border: '1px solid rgba(99,102,241,0.3)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44,
        }}>New Assessment</Link>
      </div>
    </div>
  )
}
