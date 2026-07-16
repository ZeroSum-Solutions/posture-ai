'use client'
/**
 * "Why this?" rationale sheet — shows the chain:
 *   finding → implicated muscle(s) with evidence grade → what this movement does
 *
 * Two exports:
 *   WhyThisBody   — pure presentational; used by tests.
 *   WhyThisSheet  — fetching wrapper; mirrors ExerciseDetailSheet structure.
 */
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useFocusTrap } from './useFocusTrap'

// ─── Evidence badge ───────────────────────────────────────────────────────────

function evidenceBadge(confidence: 'high' | 'medium' | 'low' | undefined): string {
  if (confidence === 'high') return 'Well supported'
  if (confidence === 'low') return 'Possible / textbook-based'
  return 'Moderately supported' // 'medium' and undefined are medium-equivalent
}

function badgeColor(confidence: 'high' | 'medium' | 'low' | undefined): string {
  if (confidence === 'high') return 'var(--maintain)'
  if (confidence === 'low') return 'var(--warning)'
  return 'var(--brand)'
}

// ─── WhyThisBody (pure) ───────────────────────────────────────────────────────

export interface WhyThisBodyMuscle {
  slug: string
  name: string
  role: 'tight' | 'weak'
  confidence?: 'high' | 'medium' | 'low'
}

export interface WhyThisBodyProps {
  findingLabel: string
  muscles: WhyThisBodyMuscle[]
  movementAction: string
  exerciseName: string
}

export function WhyThisBody({ findingLabel, muscles, movementAction, exerciseName }: WhyThisBodyProps) {
  const label: React.CSSProperties = {
    fontSize: '0.66rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 4,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Block 1 — finding */}
      <div>
        <div style={label}>Finding</div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>{findingLabel}</div>
      </div>

      {/* Block 2 — implicated muscles with evidence grade */}
      {muscles.length > 0 && (
        <div>
          <div style={label}>Muscles involved in this finding</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {muscles.map((m) => (
              <div key={m.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                  {m.name}
                </span>
                <span
                  style={{
                    padding: '1px 8px',
                    borderRadius: 20,
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    background: `color-mix(in srgb, ${badgeColor(m.confidence)} 13%, transparent)`,
                    color: badgeColor(m.confidence),
                  }}
                >
                  {m.role === 'tight' ? 'tight' : 'weak'} · {evidenceBadge(m.confidence)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Block 3 — movement action */}
      <div>
        <div style={label}>What this movement does</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary)' }}>{exerciseName}</strong>{' '}
          {muscles.length > 0
            ? `${movementAction} the relevant muscles in this pattern, helping to address this finding.`
            : `${movementAction} the muscles involved in this finding.`}
        </div>
      </div>
    </div>
  )
}

// ─── WhyThisSheet (fetching wrapper) ─────────────────────────────────────────

interface MuscleRow {
  role: 'tight' | 'weak'
  muscle_slug: string
  link_evidence: 'high' | 'medium' | 'low' | null
  scored: boolean | null
  // Supabase embedded FK: typed as array in the inferred shape
  muscles: { name: string } | { name: string }[]
}

export interface WhyThisSheetProps {
  exerciseName: string
  findingKey: string
  findingLabel: string
  movementAction: string
  onClose: () => void
}

export default function WhyThisSheet({
  exerciseName,
  findingKey,
  findingLabel,
  movementAction,
  onClose,
}: WhyThisSheetProps) {
  const [muscles, setMuscles] = useState<WhyThisBodyMuscle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let cancelled = false
    supabase
      .from('muscle_imbalance_links')
      .select('role, muscle_slug, link_evidence, scored, muscles(name)')
      .eq('imbalance_key', findingKey)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) {
          setError('Could not load supporting detail.')
          setLoading(false)
          return
        }
        const rows = (data as unknown as MuscleRow[])
          .filter((r) => r.scored !== false)
          .map((r) => {
            const muscleObj = Array.isArray(r.muscles) ? r.muscles[0] : r.muscles
            return {
              slug: r.muscle_slug,
              name: muscleObj?.name ?? r.muscle_slug,
              role: r.role,
              confidence: r.link_evidence ?? undefined,
            }
          })
        setMuscles(rows)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [findingKey])

  const dialogRef = useFocusTrap<HTMLDivElement>()

  const escHandler = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', escHandler)
    return () => window.removeEventListener('keydown', escHandler)
  }, [escHandler])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Why ${exerciseName}?`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px 16px 0 0',
          padding: 20,
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
        >
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Why this?</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44,
              height: 44,
              minHeight: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(0,0,0,0.35)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
            {error}
          </p>
        )}
        {loading && !error && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading…</p>
        )}

        {!loading && !error && (
          <WhyThisBody
            findingLabel={findingLabel}
            muscles={muscles}
            movementAction={movementAction}
            exerciseName={exerciseName}
          />
        )}
      </div>
    </div>
  )
}
