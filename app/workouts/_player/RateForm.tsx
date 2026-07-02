'use client'
import { useState } from 'react'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import type { RatingPayload } from './WorkoutPlayer'

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
        <div style={{ fontSize: '3rem', marginBottom: 8 }}>✓</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px' }}>Thanks for the feedback</h2>
        <p style={{ color: '#A1A1AA', margin: '0 0 22px' }}>It helps tune your next session.</p>
        {onExit && <button onClick={onExit} style={primaryBtn}>Done</button>}
      </div>
    )
  }

  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
      <h2 style={{ fontSize: 'clamp(1.6rem,6vw,2.2rem)', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-0.02em' }}>Nice work</h2>
      <div style={{ display: 'inline-flex', gap: 18, marginBottom: 22, color: '#D4D4D8', fontSize: '0.9rem' }}>
        <span><strong style={{ color: '#22C55E' }}>{done}</strong> / {total} done</span>
        {skipped > 0 && <span><strong style={{ color: '#A1A1AA' }}>{skipped}</strong> skipped</span>}
        <span><strong>{Math.max(1, Math.round(durationSec / 60))}</strong> min</span>
      </div>

      <div style={cardStyle}>
        <Row label="How clear were the cues?">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={clarity !== undefined && n <= clarity}
                onClick={() => setClarity(n)}
                style={{ ...starBtn, color: clarity !== undefined && n <= clarity ? '#F59E0B' : '#3F3F46' }}
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
              <button key={t.value} aria-pressed={tags.includes(t.value)} onClick={() => toggleTag(t.value)} style={{ ...chip, ...(tags.includes(t.value) ? chipOn : {}) }}>
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
              placeholder="What worked, what felt awkward…"
              style={{ width: '100%', resize: 'vertical', padding: 10, borderRadius: 10, background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.15)', color: '#F5F5F5', fontFamily: 'inherit', fontSize: '0.9rem' }}
            />
          </Row>
        )}
      </div>

      <p style={{ color: '#71717A', fontSize: '0.72rem', lineHeight: 1.5, margin: '14px auto 18px', maxWidth: 380 }}>{disclaimer}</p>

      {error && <div role="alert" style={{ color: '#F87171', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onSubmit} disabled={!canSubmit || submitting} style={{ ...primaryBtn, opacity: canSubmit && !submitting ? 1 : 0.5, cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Saving…' : 'Submit feedback'}
        </button>
        {onExit && (
          <button onClick={onExit} style={ghostBtn}>
            Skip
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.78rem', color: '#A1A1AA', marginBottom: 8, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, selected, onSelect }: { options: { value: T; label: string }[]; selected?: T; onSelect: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={selected === o.value} onClick={() => onSelect(o.value)} style={{ ...chip, ...(selected === o.value ? chipOn : {}) }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: 'rgba(22,22,24,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18, backdropFilter: 'blur(8px)' }
const starBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: '1.9rem', cursor: 'pointer', lineHeight: 1, padding: 2, minHeight: 44 }
const chip: React.CSSProperties = { padding: '8px 14px', minHeight: 44, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.3)', color: '#D4D4D8', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }
const chipOn: React.CSSProperties = { background: 'rgba(129,140,248,0.18)', borderColor: 'rgba(129,140,248,0.5)', color: '#C4B5FD' }
const primaryBtn: React.CSSProperties = { padding: '13px 32px', minHeight: 52, borderRadius: 999, border: 'none', background: '#6366F1', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { padding: '13px 24px', minHeight: 52, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#A1A1AA', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }
