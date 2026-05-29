'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, Legend,
} from 'recharts'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  sex_at_birth: string | null
  height_cm: number | null
  weight_kg: number | null
  notes: string | null
  consent_recorded_at: string | null
  created_at: string
}

interface Finding {
  imbalance_key: string
  label: string | null
  severity_pct: number | null
  zone: string | null
  region: string | null
}

interface Assessment {
  id: string
  assessed_at: string
  overall_grade: string | null
  overall_score: number | null
  status: string
  assessment_findings?: Finding[]
}

type Tab = 'assessments' | 'progress' | 'info'

const GRADE_TO_PCT: Record<string, number> = {
  S: 100, A: 83, B: 66, C: 50, D: 33, E: 0,
}

const IMBALANCE_COLORS = [
  '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#84CC16', '#EC4899', '#14B8A6',
]

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [client, setClient] = useState<Client | null>(null)
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('assessments')
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('practitioner_id', user.id)
        .single()
      if (error || !data) { router.push('/clients'); return }
      setClient(data)

      // Fetch assessments with findings for trend charts
      const res = await fetch(`/api/clients/${id}/assessments?include_findings=true`)
      if (res.ok) {
        const json = await res.json()
        setAssessments(json.assessments || [])
      }
      setLoading(false)
    }
    load()
  }, [id, router])

  async function handleArchive() {
    if (!client) return
    setArchiving(true)
    const res = await fetch(`/api/clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    setArchiving(false)
    if (res.ok) {
      router.push('/clients')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
        <p style={{ color: '#A1A1AA' }}>Loading...</p>
      </div>
    )
  }

  if (!client) return null

  const dob = client.date_of_birth
    ? new Date(client.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null

  const consentDate = client.consent_recorded_at
    ? new Date(client.consent_recorded_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: '10px 20px',
    background: activeTab === tab ? '#6366F1' : 'transparent',
    color: activeTab === tab ? '#fff' : '#A1A1AA',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  })

  // Build trend data for charts
  const hasMultipleAssessments = assessments.length >= 2

  // Collect all unique imbalance keys across assessments
  const imbalanceKeys: string[] = []
  const imbalanceLabels: Record<string, string> = {}
  assessments.forEach((a) => {
    (a.assessment_findings || []).forEach((f) => {
      if (!imbalanceKeys.includes(f.imbalance_key)) {
        imbalanceKeys.push(f.imbalance_key)
        imbalanceLabels[f.imbalance_key] = f.label || f.imbalance_key
      }
    })
  })

  // Build chart data points
  const trendData = assessments.map((a) => {
    const point: Record<string, number | string> = {
      date: new Date(a.assessed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      grade_pct: a.overall_grade ? (GRADE_TO_PCT[a.overall_grade] ?? 0) : 0,
    }
    const findingsMap: Record<string, number> = {}
    ;(a.assessment_findings || []).forEach((f) => {
      if (f.severity_pct !== null) {
        findingsMap[f.imbalance_key] = f.severity_pct
      }
    })
    imbalanceKeys.forEach((key) => {
      if (findingsMap[key] !== undefined) {
        point[key] = findingsMap[key]
      }
    })
    return point
  })

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Clients
        </Link>
      </div>

      {/* Profile Header */}
      <div style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '24px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '8px' }}>
            {client.first_name} {client.last_name}
          </h1>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {dob && (
              <span style={{ fontSize: '0.875rem', color: '#A1A1AA' }}>
                DOB: <span style={{ color: '#D4D4D8' }}>{dob}</span>
              </span>
            )}
            {consentDate && (
              <span style={{ fontSize: '0.875rem', color: '#A1A1AA' }}>
                Consent: <span style={{ color: '#10B981' }}>✓ {consentDate}</span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowArchiveConfirm(true)}
            style={{
              padding: '9px 16px', borderRadius: '8px',
              background: 'rgba(239,68,68,0.1)',
              color: '#EF4444',
              border: '1px solid rgba(239,68,68,0.25)',
              fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            Archive Client
          </button>
          <Link
            href={`/assessments/new?client_id=${client.id}`}
            style={{
              padding: '10px 18px', borderRadius: '8px', background: '#6366F1',
              color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
              whiteSpace: 'nowrap',
            }}
          >
            + New Assessment
          </Link>
        </div>
      </div>

      {/* Archive Confirmation Dialog */}
      {showArchiveConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100,
        }}>
          <div style={{
            background: '#1A1A1C', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '16px', padding: '32px', maxWidth: '420px', width: '90%',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '12px' }}>
              Archive Client?
            </h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.6 }}>
              Archiving <strong style={{ color: '#F5F5F5' }}>{client.first_name} {client.last_name}</strong> will
              remove them from your active client list. Their data will be preserved and can be recovered.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowArchiveConfirm(false)}
                disabled={archiving}
                style={{
                  flex: 1, padding: '10px', background: 'rgba(255,255,255,0.06)',
                  color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                style={{
                  flex: 1, padding: '10px',
                  background: archiving ? 'rgba(239,68,68,0.3)' : '#EF4444',
                  color: '#fff', border: 'none',
                  borderRadius: '8px', fontWeight: 600, cursor: archiving ? 'not-allowed' : 'pointer',
                }}
              >
                {archiving ? 'Archiving...' : 'Yes, Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '16px',
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px',
        padding: '4px',
        flexWrap: 'wrap',
      }}>
        <button style={tabStyle('assessments')} onClick={() => setActiveTab('assessments')}>
          Assessments
        </button>
        {hasMultipleAssessments && (
          <button style={tabStyle('progress')} onClick={() => setActiveTab('progress')}>
            Progress
          </button>
        )}
        <button style={tabStyle('info')} onClick={() => setActiveTab('info')}>
          Info
        </button>
      </div>

      {/* Assessments Tab */}
      {activeTab === 'assessments' && (
        <div style={{
          background: '#161618',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '24px',
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>
            Assessment History
          </h2>
          {assessments.length === 0 ? (
            <p style={{ color: '#A1A1AA', fontSize: '0.9rem' }}>
              No assessments yet. Click &quot;+ New Assessment&quot; to start.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[...assessments].reverse().map((a) => {
                const date = new Date(a.assessed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })
                return (
                  <li key={a.id} style={{
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    paddingBottom: '12px', marginBottom: '12px',
                  }}>
                    <Link href={`/assessments/${a.id}`} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      textDecoration: 'none',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', color: '#F5F5F5', fontWeight: 500 }}>
                          Assessment — {date}
                        </div>
                        {a.overall_score !== null && (
                          <div style={{ fontSize: '0.78rem', color: '#A1A1AA', marginTop: '2px' }}>
                            Score: {a.overall_score}/100
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {a.overall_grade && (
                          <span style={{
                            fontSize: '0.85rem', fontWeight: 700, color: '#6366F1',
                            background: 'rgba(99,102,241,0.12)', borderRadius: '6px', padding: '2px 8px',
                          }}>
                            Grade {a.overall_grade}
                          </span>
                        )}
                        <span style={{ color: '#A1A1AA' }}>›</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Progress / Trend Charts Tab */}
      {activeTab === 'progress' && hasMultipleAssessments && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Overall Grade Trend */}
          <div style={{
            background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px', padding: '24px',
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '8px' }}>
              Overall Grade Trend
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '16px' }}>
              Grade converted to 0–100 scale (S=100, A=83, B=66, C=50, D=33, E=0)
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1A1A1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  labelStyle={{ color: '#F5F5F5' }}
                  itemStyle={{ color: '#A1A1AA' }}
                />
                {/* Zone bands */}
                <ReferenceArea y1={66} y2={100} fill="rgba(16,185,129,0.08)" label={{ value: 'Maintain', fill: '#10B981', fontSize: 10, position: 'insideTopRight' }} />
                <ReferenceArea y1={33} y2={66} fill="rgba(245,158,11,0.08)" label={{ value: 'Warning', fill: '#F59E0B', fontSize: 10, position: 'insideTopRight' }} />
                <ReferenceArea y1={0} y2={33} fill="rgba(239,68,68,0.08)" label={{ value: 'Danger', fill: '#EF4444', fontSize: 10, position: 'insideTopRight' }} />
                <Line
                  type="monotone"
                  dataKey="grade_pct"
                  name="Grade"
                  stroke="#6366F1"
                  strokeWidth={2}
                  dot={{ fill: '#6366F1', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Imbalance Severity Trends */}
          {imbalanceKeys.length > 0 && (
            <div style={{
              background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px', padding: '24px',
            }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '8px' }}>
                Imbalance Severity Over Time
              </h2>
              <p style={{ fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '16px' }}>
                Severity % per imbalance — lower is better
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#A1A1AA', fontSize: 11 }} unit="%" />
                  <Tooltip
                    contentStyle={{ background: '#1A1A1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    labelStyle={{ color: '#F5F5F5' }}
                    itemStyle={{ color: '#A1A1AA' }}
                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, imbalanceLabels[name] || name]}
                  />
                  <Legend
                    formatter={(value) => imbalanceLabels[value] || value}
                    wrapperStyle={{ fontSize: '11px', color: '#A1A1AA' }}
                  />
                  {/* Zone reference bands */}
                  <ReferenceArea y1={0} y2={33} fill="rgba(16,185,129,0.06)" />
                  <ReferenceArea y1={33} y2={66} fill="rgba(245,158,11,0.06)" />
                  <ReferenceArea y1={66} y2={100} fill="rgba(239,68,68,0.06)" />
                  {imbalanceKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={IMBALANCE_COLORS[i % IMBALANCE_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div style={{
          background: '#161618',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '24px',
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>
            Client Information
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
            {dob && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Date of Birth</div>
                <div style={{ color: '#F5F5F5' }}>{dob}</div>
              </div>
            )}
            {client.sex_at_birth && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Sex at Birth</div>
                <div style={{ color: '#F5F5F5', textTransform: 'capitalize' }}>{client.sex_at_birth.replace('_', ' ')}</div>
              </div>
            )}
            {client.height_cm && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Height</div>
                <div style={{ color: '#F5F5F5' }}>{client.height_cm} cm</div>
              </div>
            )}
            {client.weight_kg && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Weight</div>
                <div style={{ color: '#F5F5F5' }}>{client.weight_kg} kg</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Added</div>
              <div style={{ color: '#F5F5F5' }}>
                {new Date(client.created_at).toLocaleDateString()}
              </div>
            </div>
            {client.consent_recorded_at && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Consent Recorded</div>
                <div style={{ color: '#10B981', fontSize: '0.875rem' }}>
                  ✓ {new Date(client.consent_recorded_at).toLocaleDateString()}
                </div>
              </div>
            )}
          </div>
          {client.notes && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Notes</div>
              <div style={{ color: '#F5F5F5', fontSize: '0.9rem', lineHeight: 1.6 }}>{client.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
