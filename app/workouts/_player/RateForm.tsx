'use client'
import { useId, useState } from 'react'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import type { RatingPayload } from './WorkoutPlayer'
import { CheckGlyph } from '@/components/SignalGlyphs'
import { Surface } from '@/components/array/Surface'
import { Button, FilterChip } from '@/components/ui'
import { workoutTheme as theme } from './theme'
import LegalNotice from '@/components/LegalNotice'
import type { LegalSnapshot } from '@/lib/legal/types'

const PACE: { value: RatingPace; label: string }[] = [
  { value: 'too_slow', label: 'Too slow' },
  { value: 'just_right', label: 'Just right' },
  { value: 'too_fast', label: 'Too fast' },
]
const DIFFICULTY: { value: RatingDifficulty; label: string }[] = [
  { value: 'too_easy', label: 'Too easy' },
  { value: 'just_right', label: 'Just right' },
  { value: 'too_hard', label: 'Too hard' },
]
const TAGS: { value: string; label: string }[] = [
  { value: 'clear_cues', label: 'Clear cues' },
  { value: 'well_paced', label: 'Well paced' },
  { value: 'wanted_more_detail', label: 'Wanted more detail' },
  { value: 'good_variety', label: 'Good variety' },
]

/**
 * End-of-session summary + movement-education rating. Captures clarity / pace /
 * difficulty / tags (+ an optional lint-checked note on the authenticated path)
 * — deliberately NO symptom or outcome fields, keeping the screening boundary.
 */
export function RateForm({
  done,
  skipped,
  total,
  durationSec,
  legalNotice,
  legacyDisclaimer,
  prototypeDisclaimer,
  allowNotes,
  submitRating,
  onExit,
}: {
  done: number
  skipped: number
  total: number
  durationSec: number
  legalNotice?: LegalSnapshot
  legacyDisclaimer?: string
  prototypeDisclaimer?: string
  allowNotes: boolean
  submitRating: (payload: RatingPayload) => Promise<{ ok: boolean; error?: string }>
  onExit?: () => void
}) {
  const [clarity, setClarity] = useState<number | undefined>()
  const [pace, setPace] = useState<RatingPace | undefined>()
  const [difficulty, setDifficulty] = useState<RatingDifficulty | undefined>()
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [thanks, setThanks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = clarity !== undefined || pace !== undefined || difficulty !== undefined
  const toggleTag = (v: string) => setTags((t) => (t.includes(v) ? t.filter((x) => x !== v) : [...t, v]))

  const onSubmit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await submitRating({ clarity, pace, difficulty, feedback_tags: tags, notes: allowNotes && notes.trim() ? notes.trim() : undefined })
    setSubmitting(false)
    if (res.ok) setThanks(true)
    else setError(res.error ?? 'Could not save your feedback.')
  }

  if (thanks) {
    return (
      <Surface tier="feature" style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><CheckGlyph size={48} /></div>
        <h2 className="t-title-1" style={{ margin: '0 0 6px' }}>Thanks for the feedback</h2>
        <p className="t-body" style={{ margin: '0 0 22px' }}>It helps tune your next session.</p>
        {onExit && <Button onClick={onExit} variant="primary" size="md">Done</Button>}
      </Surface>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }} style={{ width: '100%', textAlign: 'center' }}>
      <h2 className="t-title-1" style={{ margin: '0 0 14px' }}>Nice work</h2>
      <div className="t-subhead" style={{ display: 'inline-flex', gap: 18, marginBottom: 22 }}>
        <span><strong style={{ color: theme.maintain }}>{done}</strong> / {total} done</span>
        {skipped > 0 && <span><strong>{skipped}</strong> skipped</span>}
        <span><strong>{Math.max(1, Math.round(durationSec / 60))}</strong> min</span>
      </div>

      <Surface tier="feature">
        <Row label="How clear were the cues?">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={clarity !== undefined && n <= clarity}
                onClick={() => setClarity(n)}
                style={{ ...starBtn, color: clarity !== undefined && n <= clarity ? theme.warning : theme.borderStrong }}
              >
                ★
              </button>
            ))}
          </div>
        </Row>

        <Row label="Pace">
          <Chips options={PACE} selected={pace} onSelect={(v) => setPace(v === pace ? undefined : v)} />
        </Row>

        <Row label="Difficulty">
          <Chips options={DIFFICULTY} selected={difficulty} onSelect={(v) => setDifficulty(v === difficulty ? undefined : v)} />
        </Row>

        <Row label="Anything stand out? (optional)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {TAGS.map((t) => (
              <FilterChip key={t.value} label={t.label} selected={tags.includes(t.value)} onToggle={() => toggleTag(t.value)} />
            ))}
          </div>
        </Row>

        {allowNotes && (
          <Row label="Notes for the practitioner (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              aria-label="Notes for the practitioner (optional)"
              placeholder="What worked, what felt awkward…"
              className="t-body"
              style={{ width: '100%', resize: 'vertical', padding: 'var(--s-12)', borderRadius: 'var(--r-md)', background: theme.surfaceWell, border: `1px solid ${theme.border}` }}
            />
          </Row>
        )}
      </Surface>

      <WorkoutLegalNotice legalNotice={legalNotice} legacyDisclaimer={legacyDisclaimer} prototypeDisclaimer={prototypeDisclaimer} />

      {error && <p role="alert" className="t-footnote" style={{ color: theme.danger, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={submitting}
          disabledReason={!canSubmit ? 'Choose a rating to continue' : undefined}
        >
          Submit feedback
        </Button>
        {onExit && (
          <Button type="button" onClick={onExit} variant="tertiary" size="md">
            Skip
          </Button>
        )}
      </div>
    </form>
  )
}

export function WorkoutLegalNotice({
  legalNotice,
  legacyDisclaimer,
  prototypeDisclaimer,
}: {
  legalNotice?: LegalSnapshot
  legacyDisclaimer?: string
  prototypeDisclaimer?: string
}) {
  if (legalNotice) {
    return (
      <div style={{ margin: '14px auto 18px', maxWidth: 440, textAlign: 'left' }}>
        <LegalNotice document={legalNotice} compact />
      </div>
    )
  }

  if (prototypeDisclaimer) {
    return (
      <div
        data-legal-provenance="prototype"
        className="t-footnote"
        style={{ margin: '14px auto 18px', maxWidth: 380 }}
      >
        <p style={{ margin: '0 0 6px' }}>{prototypeDisclaimer}</p>
        <p className="t-caption" style={{ margin: 0 }}>Prototype catalog · practitioner review required before use.</p>
      </div>
    )
  }

  return (
    <div
      data-legal-provenance="legacy"
      className="t-footnote"
      style={{ margin: '14px auto 18px', maxWidth: 380 }}
    >
      <p style={{ margin: '0 0 6px' }}>{legacyDisclaimer}</p>
      <p className="t-caption" style={{ margin: 0 }}>Legacy notice — version and effective date unavailable.</p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} style={{ marginBottom: 16 }}>
      <div id={labelId} className="t-subhead" style={{ marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, selected, onSelect }: { options: { value: T; label: string }[]; selected?: T; onSelect: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <FilterChip key={o.value} label={o.label} selected={selected === o.value} onToggle={() => onSelect(o.value)} />
      ))}
    </div>
  )
}

const starBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: '1.9rem', cursor: 'pointer', lineHeight: 1, padding: 2, minHeight: 44 }
