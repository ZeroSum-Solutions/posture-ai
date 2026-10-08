'use client'
import { useId, useState } from 'react'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import type { RatingPayload } from './WorkoutPlayer'
import { CheckGlyph } from '@/components/SignalGlyphs'
import { Button, FilterChip, SlotNumber } from '@/components/ui'
import styles from './RateForm.module.css'
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
      <div className={styles.thanks}>
        <span className={styles.thanksMark}><CheckGlyph size={40} /></span>
        <h2 className={styles.title}>Thanks for the feedback</h2>
        <p className={styles.body}>It helps tune your next session.</p>
        {onExit && <div className={styles.actions}><Button onClick={onExit} variant="primary" size="lg" block>Done</Button></div>}
      </div>
    )
  }

  const mins = Math.max(1, Math.round(durationSec / 60))
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }} className={styles.form}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>Session complete</p>
        <h2 className={styles.title}>Nice work</h2>
      </div>
      <p className="sr-only">{done} of {total} done{skipped > 0 ? `, ${skipped} skipped` : ''}, {mins} min</p>
      <div className={styles.stats} aria-hidden="true">
        <div className={styles.stat}>
          <span className={styles.statValue}><SlotNumber value={done} /><span className={styles.statOf}>/{total}</span></span>
          <span className={styles.eyebrow}>done</span>
        </div>
        {skipped > 0 && (
          <div className={styles.stat}>
            <span className={styles.statValue}><SlotNumber value={skipped} delay={80} /></span>
            <span className={styles.eyebrow}>skipped</span>
          </div>
        )}
        <div className={styles.stat}>
          <span className={styles.statValue}><SlotNumber value={mins} delay={160} /></span>
          <span className={styles.eyebrow}>min</span>
        </div>
      </div>

      <div className={styles.groups}>
        <Row label="How clear were the cues?">
          <div className={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={clarity !== undefined && n <= clarity}
                onClick={() => setClarity(n)}
                className={styles.star}
                style={{ transitionDelay: clarity !== undefined && n <= clarity ? `${(n - 1) * 30}ms` : '0ms' }}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.5l-5.3 2.9 1.2-5.9L3.4 9.4l6-.7L12 3.2Z" /></svg>
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
          <div className={styles.chips}>
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
              className={styles.notes}
            />
          </Row>
        )}
      </div>

      <WorkoutLegalNotice legalNotice={legalNotice} legacyDisclaimer={legacyDisclaimer} prototypeDisclaimer={prototypeDisclaimer} />

      {error && <p role="alert" className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
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
    <div role="group" aria-labelledby={labelId} className={styles.row}>
      <div id={labelId} className={styles.rowLabel}>{label}</div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, selected, onSelect }: { options: { value: T; label: string }[]; selected?: T; onSelect: (v: T) => void }) {
  return (
    <div className={styles.chips}>
      {options.map((o) => (
        <FilterChip key={o.value} label={o.label} selected={selected === o.value} onToggle={() => onSelect(o.value)} />
      ))}
    </div>
  )
}

