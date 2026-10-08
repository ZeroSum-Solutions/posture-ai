import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { Disclosure } from './Disclosure'
import styles from './ErrorState.module.css'

type Action = { label: string; href?: string; onPress?: () => void }

export type ErrorStateProps = {
  title: string
  body: string
  onRetry?: () => void
  retrying?: boolean
  /** Visible label for the retry button when idle. Defaults to "Retry". */
  retryLabel?: string
  secondary?: Action
  details?: string
  variant?: 'page' | 'inline' | 'blocking'
  /** Heading element for `title`. Defaults to 'h2' (unchanged) — pass 'h1'
   *  when this ErrorState is the only content on its page/route, so the page
   *  has a heading-one (axe `page-has-heading-one`). */
  headingLevel?: 'h1' | 'h2'
  className?: string
  'data-testid'?: string
}

/**
 * Same rhythm as EmptyState, on the canvas: a coral line glyph inside a
 * hairline ring, a headline, one sentence of what happened (never a raw
 * code), Retry as the one primary action plus an optional quiet one, and a
 * collapsed Details disclosure. `blocking` is the legal-gate-failure shape:
 * it owns the whole viewport and announces itself (role="alert").
 */
export function ErrorState({ title, body, onRetry, retrying = false, retryLabel = 'Retry', secondary, details, variant = 'page', headingLevel = 'h2', className, 'data-testid': testId }: ErrorStateProps) {
  const Heading = headingLevel
  return (
    <div
      role={variant === 'blocking' ? 'alert' : undefined}
      className={[styles.error, variant === 'inline' ? styles.inline : variant === 'blocking' ? styles.blocking : styles.page, className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon name="danger-circle-linear" size={variant === 'inline' ? 24 : 28} />
      </span>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.body}>{body}</p>
      {onRetry || secondary ? (
        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" onClick={onRetry} aria-busy={retrying} className={`a-primary ${styles.retry}`} data-retrying={retrying || undefined}>
              <Icon name="refresh-linear" size={18} className={styles.retryIcon} />
              {retrying ? 'Retrying…' : retryLabel}
            </button>
          ) : null}
          {secondary ? (
            secondary.href ? (
              <Link href={secondary.href} className={`a-quiet ${styles.quiet}`}>{secondary.label}</Link>
            ) : (
              <button type="button" onClick={secondary.onPress} className={`a-quiet ${styles.quiet}`}>{secondary.label}</button>
            )
          ) : null}
        </div>
      ) : null}
      {details ? (
        <div className={styles.details}>
          <Disclosure title="Details">
            <p className="t-footnote">{details}</p>
          </Disclosure>
        </div>
      ) : null}
    </div>
  )
}
