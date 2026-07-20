import type { OverallGrade } from '@posture-ai/engine'
import {
  GRADE_DISPLAY_BANDS,
  getGradeDisplayBand,
} from '@/lib/scoring/grade-display'

export function gradeColor(grade: OverallGrade): string {
  return `var(${getGradeDisplayBand(grade).colorToken})`
}

const GRADE_BAR_BACKGROUND = `linear-gradient(to right, ${GRADE_DISPLAY_BANDS.flatMap((band, index) => {
  const end = GRADE_DISPLAY_BANDS[index + 1]?.min ?? 100
  const color = `var(${band.colorToken})`
  return [`${color} ${band.min}%`, `${color} ${end}%`]
}).join(', ')})`

export function GradeRing({ grade, score, description }: { grade: OverallGrade; score: number; description?: string }) {
  const color = gradeColor(grade)
  const accessibleDescription = description ?? getGradeDisplayBand(grade).description
  const r = 42
  const circumference = 2 * Math.PI * r
  const fillPct = Math.max(0, 100 - score) / 100
  const dashOffset = circumference * (1 - fillPct)

  return (
    <div
      role="img"
      aria-label={`Grade ${grade}: ${accessibleDescription}; deviation ${score} out of 100, lower is better`}
      style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}
    >
      <svg aria-hidden="true" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '2rem', fontWeight: 900, color, lineHeight: 1 }}>{grade}</span>
      </div>
    </div>
  )
}

export function ScoreBar({ score, grade }: { score: number; grade: OverallGrade }) {
  const color = gradeColor(grade)
  const positionPct = Math.min(100, Math.max(0, score))

  return (
    <div role="img" aria-label={`Deviation scale: ${score} out of 100, lower is better`}>
      <div style={{
        position: 'relative',
        height: 12,
        borderRadius: 6,
        overflow: 'hidden',
        background: GRADE_BAR_BACKGROUND,
        marginBottom: 8,
      }}>
        <div style={{
          position: 'absolute',
          left: positionPct + '%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: color,
          border: '3px solid var(--background)',
          boxShadow: `0 0 8px color-mix(in srgb, ${color} 53%, transparent)`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--maintain)' }}>Lower deviation</span>
        <span>Deviation: {score}</span>
        <span style={{ color: 'var(--danger)' }}>Higher deviation</span>
      </div>
    </div>
  )
}

export function BandTable({ currentGrade }: { currentGrade: OverallGrade }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grade Reference</h3>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {GRADE_DISPLAY_BANDS.map((band) => {
          const color = `var(${band.colorToken})`
          return (
            <div
              key={band.grade}
              aria-current={band.grade === currentGrade ? 'true' : undefined}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                background: band.grade === currentGrade ? `color-mix(in srgb, ${color} 13%, transparent)` : 'rgba(255,255,255,0.04)',
                border: '1px solid ' + (band.grade === currentGrade ? color : 'rgba(255,255,255,0.08)'),
                textAlign: 'center',
                minWidth: 56,
              }}
            >
              <div style={{ fontSize: '1rem', fontWeight: 900, color }}>{band.grade}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 1 }}>{band.range}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{band.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
