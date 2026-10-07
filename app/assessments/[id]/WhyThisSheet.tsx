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
import { useFocusTrap } from './useFocusTrap'
import { Surface } from '@/components/array/Surface'
import { Chip } from '@/components/array/Chip'
import type { SeverityBand } from '@/components/array/severity'

// ─── Evidence badge ───────────────────────────────────────────────────────────

function evidenceBadge(confidence: 'high' | 'medium' | 'low' | undefined): string {
  if (confidence === 'high') return 'Well supported'
  if (confidence === 'low') return 'Possible / textbook-based'
  return 'Moderately supported' // 'medium' and undefined are medium-equivalent
}

/**
 * The evidence badge borrows the severity band vocabulary purely for its
 * colour scale — high confidence reads maintain-green, low reads
 * monitor-amber, medium/ungraded reads info-blue. It is not a clinical
 * severity signal, just the closest existing three-step colour ramp.
 */
function confidenceBand(confidence: 'high' | 'medium' | 'low' | undefined): SeverityBand {
  if (confidence === 'high') return 'maintain'
  if (confidence === 'low') return 'monitor'
  return 'info'
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

// Section overline: t-caption (Medium 500) plus the uppercase and tracking
// already established for this folder's small caption labels, see
// MuscleBodyMap's "Tight"/"Weak"/"Possible" headers.
//
// Note: lib/ui-vocabulary.test.ts sweeps this file's source text — comments
// included — against the screening-vocabulary list. That is the right default
// for a screening-only tool, so keep clinical-care wording out of here.
const sectionLabelStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
}

export function WhyThisBody({ findingLabel, muscles, movementAction, exerciseName }: WhyThisBodyProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Block 1 — finding */}
      <div>
        <div className="t-caption" style={sectionLabelStyle}>Finding</div>
        <div className="t-headline">{findingLabel}</div>
      </div>

      {/* Block 2 — implicated muscles with evidence grade */}
      {muscles.length > 0 && (
        <div>
          <div className="t-caption" style={sectionLabelStyle}>Muscles involved in this finding</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {muscles.map((m) => (
              <div key={m.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t-body" style={{ textTransform: 'capitalize' }}>
                  {m.name}
                </span>
                <Chip band={confidenceBand(m.confidence)} size="sm">
                  {m.role === 'tight' ? 'tight' : 'weak'} · {evidenceBadge(m.confidence)}
                </Chip>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Block 3 — movement action */}
      <div>
        <div className="t-caption" style={sectionLabelStyle}>What this movement does</div>
        <div className="t-body">
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
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(`/api/clinical-content/findings/${encodeURIComponent(findingKey)}/muscles`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await response.json().catch(() => ({})) as { muscles?: WhyThisBodyMuscle[] }
        if (!response.ok || !Array.isArray(body.muscles)) throw new Error('unavailable')
        setMuscles(body.muscles)
        setLoading(false)
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return
        setError('Could not load supporting detail.')
        setLoading(false)
      }
    })()
    return () => controller.abort()
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
      {/* Stops the backdrop's onClose from firing when the click lands on the sheet itself. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560 }}>
        <Surface
          tier="feature"
          /* Bottom sheets sit flush with the viewport edge; flatten the tier-1
             shell's bottom corners rather than inventing a fourth radius family. */
          style={{ borderRadius: '24px 24px 0 0' }}
          innerStyle={{ maxHeight: '85vh', overflowY: 'auto' }}
        >
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Why ${exerciseName}?`}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
            >
              <h3 className="t-title-2">Why this?</h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="a-secondary"
                style={{ width: 44, padding: 0 }}
              >
                ✕
              </button>
            </div>

            {error && (
              <p role="alert" className="a-error">
                {error}
              </p>
            )}
            {loading && !error && (
              <p className="t-body">Loading…</p>
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
        </Surface>
      </div>
    </div>
  )
}
