import LegalNotice from './LegalNotice'

// Backward-compatible layout wrapper. The governed LegalNotice is the only
// source of screening copy and fails closed when it cannot be loaded.
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="screening-disclaimer"
      style={{
        background: 'rgba(0,152,243,0.08)',
        border: '1px solid rgba(0,152,243,0.25)',
        borderRadius: '10px',
        padding: compact ? '10px 14px' : '14px 18px',
        margin: compact ? '12px 0' : '20px 0',
      }}
    >
      <LegalNotice kind="screening_notice" compact={compact} />
    </div>
  )
}
