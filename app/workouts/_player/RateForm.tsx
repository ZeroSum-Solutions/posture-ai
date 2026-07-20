'use client'
import { useId, useState } from 'react'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import type { RatingPayload } from './WorkoutPlayer'
import { CheckGlyph } from '@/components/SignalGlyphs'
import { colorMix, workoutTheme as theme } from './theme'
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
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><CheckGlyph size={48} /></div>
        <h2 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: 0, margin: '0 0 6px', lineHeight: 1.12 }}>Thanks for the feedback</h2>
        <p style={{ color: theme.textSecondary, margin: '0 0 22px' }}>It helps tune your next session.</p>
        {onExit && <button onClick={onExit} style={primaryBtn}>Done</button>}
      </div>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }} style={{ width: '100%', textAlign: 'center' }}>
      <h2 style={{ fontSize: '40px', fontWeight: 700, margin: '0 0 14px', letterSpacing: 0, lineHeight: 1.08 }}>Nice work</h2>
      <div style={{ display: 'inline-flex', gap: 18, marginBottom: 22, color: theme.textSecondary, fontSize: '0.9rem' }}>
        <span><strong style={{ color: theme.maintain }}>{done}</strong> / {total} done</span>
        {skipped > 0 && <span><strong style={{ color: theme.textSecondary }}>{skipped}</strong> skipped</span>}
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
              style={{ width: '100%', resize: 'vertical', padding: 10, borderRadius: 10, background: theme.surfaceWell, border: `1px solid ${theme.border}`, color: theme.textPrimary, fontFamily: 'inherit', fontSize: '0.9rem' }}
            />
          </Row>
        )}
      </div>

      <WorkoutLegalNotice legalNotice={legalNotice} legacyDisclaimer={legacyDisclaimer} />

      {error && <div role="alert" style={{ color: theme.danger, fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>}

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

export function WorkoutLegalNotice({
  legalNotice,
  legacyDisclaimer,
}: {
  legalNotice?: LegalSnapshot
  legacyDisclaimer?: string
}) {
  if (legalNotice) {
    return (
      <div style={{ margin: '14px auto 18px', maxWidth: 440, textAlign: 'left' }}>
        <LegalNotice document={legalNotice} compact />
      </div>
    )
  }

  return (
    <div
      data-legal-provenance="legacy"
      style={{ color: theme.textMuted, fontSize: '0.72rem', lineHeight: 1.5, margin: '14px auto 18px', maxWidth: 380 }}
    >
      <p style={{ margin: '0 0 6px' }}>{legacyDisclaimer}</p>
      <p style={{ margin: 0, fontWeight: 700 }}>Legacy notice — version and effective date unavailable.</p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} style={{ marginBottom: 16 }}>
      <div id={labelId} style={{ fontSize: '0.78rem', color: theme.textSecondary, marginBottom: 8, fontWeight: 600 }}>{label}</div>
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

const cardStyle: React.CSSProperties = {
  background: `linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.012) 42%, rgba(255,255,255,.025)), ${theme.surface}`,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusCard,
  padding: 18,
  boxShadow: 'inset 0 1px 0 var(--glass-highlight), inset 0 -1px 0 rgba(0,0,0,.52), 0 8px 24px rgba(0,0,0,.38)',
  WebkitBackdropFilter: 'blur(28px) saturate(145%)',
  backdropFilter: 'blur(28px) saturate(145%)',
}
const starBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: '1.9rem', cursor: 'pointer', lineHeight: 1, padding: 2, minHeight: 44 }
const chip: React.CSSProperties = { padding: '8px 14px', minHeight: 44, borderRadius: theme.radiusControl, border: `1px solid ${theme.border}`, background: theme.surfaceWell, color: theme.textSecondary, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }
const chipOn: React.CSSProperties = { background: colorMix(theme.primary, 18), borderColor: colorMix(theme.primary, 54), color: theme.primary }
const primaryBtn: React.CSSProperties = { padding: '13px 32px', minHeight: 52, borderRadius: theme.radiusControl, border: '1px solid transparent', background: `linear-gradient(#060606,#060606) padding-box, ${theme.gradient} border-box`, color: theme.textPrimary, fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { padding: '13px 24px', minHeight: 52, borderRadius: theme.radiusControl, border: `1px solid ${theme.border}`, background: theme.surfaceWell, color: theme.textSecondary, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }
