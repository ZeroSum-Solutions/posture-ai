'use client'
import { useId, useState } from 'react'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import type { RatingPayload } from './WorkoutPlayer'
import { CheckGlyph } from '@/components/SignalGlyphs'

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
  disclaimer,
  allowNotes,
  submitRating,
  onExit,
}: {
  done: number
  skipped: number
  total: number
  durationSec: number
  disclaimer: string
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
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><CheckGlyph size={48} /></div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px' }}>Thanks for the feedback</h2>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 22px' }}>It helps tune your next session.</p>
        {onExit && <button onClick={onExit} style={primaryBtn}>Done</button>}
      </div>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }} style={{ width: '100%', textAlign: 'center' }}>
      <h2 style={{ fontSize: 'clamp(1.6rem,6vw,2.2rem)', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-0.02em' }}>Nice work</h2>
      <div style={{ display: 'inline-flex', gap: 18, marginBottom: 22, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        <span><strong style={{ color: 'var(--maintain)' }}>{done}</strong> / {total} done</span>
        {skipped > 0 && <span><strong style={{ color: 'var(--text-secondary)' }}>{skipped}</strong> skipped</span>}
        <span><strong>{Math.max(1, Math.round(durationSec / 60))}</strong> min</span>
      </div>

      <div style={cardStyle}>
        <Row label="How clear were the cues?">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={clarity !== undefined && n <= clarity}
                onClick={() => setClarity(n)}
                style={{ ...starBtn, color: clarity !== undefined && n <= clarity ? 'var(--warning)' : 'var(--border-strong)' }}
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
              <button key={t.value} type="button" aria-pressed={tags.includes(t.value)} onClick={() => toggleTag(t.value)} style={{ ...chip, ...(tags.includes(t.value) ? chipOn : {}) }}>
                {t.label}
              </button>
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
              style={{ width: '100%', resize: 'vertical', padding: 10, borderRadius: 10, background: 'var(--background)', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.9rem' }}
            />
          </Row>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.5, margin: '14px auto 18px', maxWidth: 380 }}>{disclaimer}</p>

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={!canSubmit || submitting} style={{ ...primaryBtn, opacity: canSubmit && !submitting ? 1 : 0.5, cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Saving…' : 'Submit feedback'}
        </button>
        {onExit && (
          <button type="button" onClick={onExit} style={ghostBtn}>
            Skip
          </button>
        )}
      </div>
    </form>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} style={{ marginBottom: 16 }}>
      <div id={labelId} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, selected, onSelect }: { options: { value: T; label: string }[]; selected?: T; onSelect: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={selected === o.value} onClick={() => onSelect(o.value)} style={{ ...chip, ...(selected === o.value ? chipOn : {}) }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: 'rgba(22,22,24,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18, backdropFilter: 'blur(8px)' }
const starBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: '1.9rem', cursor: 'pointer', lineHeight: 1, padding: 2, minHeight: 44 }
const chip: React.CSSProperties = { padding: '8px 14px', minHeight: 44, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.3)', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }
const chipOn: React.CSSProperties = { background: 'rgba(0,152,243,0.18)', borderColor: 'rgba(0,152,243,0.5)', color: 'var(--brand)' }
const primaryBtn: React.CSSProperties = { padding: '13px 32px', minHeight: 52, borderRadius: 999, border: 'none', background: 'var(--brand)', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { padding: '13px 24px', minHeight: 52, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }
