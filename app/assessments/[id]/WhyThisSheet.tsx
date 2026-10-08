'use client'
/**
 * "Why this?" rationale sheet — shows the chain:
 *   finding → implicated muscle(s) with evidence grade → what this movement does
 *
 * Two exports:
 *   WhyThisBody   — pure presentational; used by tests.
 *   WhyThisSheet  — fetching wrapper; mirrors ExerciseDetailSheet structure.
 */
import { useEffect, useState } from 'react'
import { Sheet } from '@/components/ui'
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

  return (
    <Sheet
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={`Why ${exerciseName}?`}
      detents={['medium']}
      data-testid="why-this-sheet"
    >
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
    </Sheet>
  )
}
