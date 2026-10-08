import type { ReactNode } from 'react'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { ring, tint, tone, type SeverityBand } from '@/components/array/severity'
import styles from './Banner.module.css'

export type BannerVariant = 'info' | 'warn' | 'error' | 'success'

export type BannerProps = {
  variant: BannerVariant
  children: ReactNode
  /** A tertiary action, e.g. "Send consent". */
  action?: { label: string; onPress: () => void }
  /** A one-time contextual hint (DESIGN.md › first-run): role="note", and the
   * dismiss button is named "Dismiss hint" rather than the generic "Dismiss". */
  hint?: boolean
  onDismiss?: () => void
  className?: string
  'data-testid'?: string
}

const VARIANT_BAND: Record<BannerVariant, SeverityBand> = {
  info: 'info',
  warn: 'monitor',
  error: 'review',
  success: 'maintain',
}
const VARIANT_ICON: Record<BannerVariant, IconName> = {
  info: 'info-circle-linear',
  warn: 'danger-triangle-linear',
  error: 'danger-circle-linear',
  success: 'check-circle-linear',
}

/** Inline `info|warn|error|success` strip: `--r-md`, tint + icon + text (DESIGN.md › 3.15). */
export function Banner({ variant, children, action, hint = false, onDismiss, className, 'data-testid': testId }: BannerProps) {
  const band = VARIANT_BAND[variant]
  return (
    <div
      role={hint ? 'note' : variant === 'error' ? 'alert' : undefined}
      className={[styles.banner, className].filter(Boolean).join(' ')}
      style={{ background: tint(band), boxShadow: `inset 0 0 0 1px ${ring(band)}` }}
      data-testid={testId}
    >
      <span className={styles.icon} style={{ color: tone(band) }}>
        <Icon name={VARIANT_ICON[variant]} size={20} />
      </span>
      <div className={styles.body}>
        <p className="t-callout" style={{ color: 'var(--text-1)' }}>{children}</p>
        {action ? (
          <button type="button" className={`a-quiet ${styles.action}`} onClick={action.onPress}>
            {action.label}
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={hint ? 'Dismiss hint' : 'Dismiss'}
          className={styles.dismiss}
        >
          <Icon name="close-linear" size={16} />
        </button>
      ) : null}
    </div>
  )
}
