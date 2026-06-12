// Shared screening-only disclaimer. Rendered on capture, results, and
// knowledge-base surfaces; keep this the single source for the copy.
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="screening-disclaimer"
      style={{
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: '10px',
        padding: compact ? '10px 14px' : '14px 18px',
        margin: compact ? '12px 0' : '20px 0',
      }}
    >
      <p style={{ color: '#A1A1AA', fontSize: compact ? '0.78rem' : '0.85rem', lineHeight: 1.5, margin: 0 }}>
        <strong style={{ color: '#C7C9FF' }}>Screening tool only.</strong> Posture AI provides
        screening information for movement professionals — it is not a medical diagnosis and does
        not replace evaluation by a qualified healthcare professional. Results identify areas that
        may benefit from further professional assessment.
      </p>
    </div>
  )
}
