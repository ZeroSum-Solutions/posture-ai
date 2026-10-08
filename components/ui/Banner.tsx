import type { ReactNode } from 'react'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import styles from './Banner.module.css'

export type BannerVariant = 'info' | 'warn' | 'error' | 'success'

export type BannerProps = {
  variant: BannerVariant
  children: ReactNode
  /** A tertiary action, e.g. "Send consent". */
  action?: { label: string; onPress: () => void }
  /**
   * The quiet "Why?" link (DESIGN.md › Principles: explanations live behind
   * a tap). Opens the caller's details — usually a Sheet. `label` defaults
   * to "Why?".
   */
  why?: { label?: string; onPress: () => void }
  /** A one-time contextual hint (DESIGN.md › first-run): role="note", and the
   * dismiss button is named "Dismiss hint" rather than the generic "Dismiss". */
  hint?: boolean
  onDismiss?: () => void
  className?: string
  'data-testid'?: string
}

const VARIANT_ICON: Record<BannerVariant, IconName> = {
  info: 'info-circle-linear',
  warn: 'danger-triangle-linear',
  error: 'danger-circle-linear',
  success: 'check-circle-linear',
}

/**
 * An inline note, not a boxed card (DESIGN.md › Do/Don't: "don't add
 * banners"): a 2px leading accent bar in the tone's colour, a small glyph and
 * one line of `ink-2` text set straight on the canvas, with an optional quiet
 * action, a quiet "Why?" link and a dismiss ×. `error` is role="alert"; a
 * `hint` is role="note". It eases in once on mount (opacity + 4px).
 */
export function Banner({ variant, children, action, why, hint = false, onDismiss, className, 'data-testid': testId }: BannerProps) {
  return (
    <div
      role={hint ? 'note' : variant === 'error' ? 'alert' : undefined}
      className={[styles.banner, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-testid={testId}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon name={VARIANT_ICON[variant]} size={16} />
      </span>
      <div className={styles.body}>
        <p className={styles.text}>{children}</p>
        {action || why ? (
          <div className={styles.links}>
            {action ? (
              <button type="button" className={styles.link} onClick={action.onPress}>
                {action.label}
                <Icon name="alt-arrow-right-linear" size={14} />
              </button>
            ) : null}
            {why ? (
              <button type="button" className={`${styles.link} ${styles.why}`} onClick={why.onPress}>
                {why.label ?? 'Why?'}
              </button>
            ) : null}
          </div>
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
