import LegalNotice from './LegalNotice'
import { tint, ring } from '@/components/array/severity'

// Backward-compatible layout wrapper. The governed LegalNotice is the only
// source of screening copy and fails closed when it cannot be loaded.
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="screening-disclaimer"
      className="t-body"
      style={{
        // Array's informational colour (--info, #0A83C9) replaces the v1
        // brand blue; tint/ring match the idiom in app/assessments/new/page.tsx.
        background: tint('info'),
        boxShadow: `inset 0 0 0 1px ${ring('info')}`,
        borderRadius: '10px',
        padding: compact ? '10px 14px' : '14px 18px',
        margin: compact ? '12px 0' : '20px 0',
      }}
    >
      <LegalNotice kind="screening_notice" compact={compact} />
    </div>
  )
}
