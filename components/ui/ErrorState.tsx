import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { ring, tint, tone } from '@/components/array/severity'
import { Disclosure } from './Disclosure'
import styles from './ErrorState.module.css'

type Action = { label: string; href?: string; onPress?: () => void }

export type ErrorStateProps = {
  title: string
  body: string
  onRetry?: () => void
  retrying?: boolean
  secondary?: Action
  details?: string
  variant?: 'page' | 'inline' | 'blocking'
  className?: string
  'data-testid'?: string
}

/**
 * Same layout as EmptyState: `alert-circle` in `--review` tint, one sentence
 * of what happened (never a raw code), Retry primary + an optional tertiary,
 * and a collapsed Details disclosure (DESIGN.md › 3.11). `blocking` is the
 * legal-gate-failure shape: it owns the whole viewport and announces itself.
 */
export function ErrorState({ title, body, onRetry, retrying = false, secondary, details, variant = 'page', className, 'data-testid': testId }: ErrorStateProps) {
  return (
    <div
      role={variant === 'blocking' ? 'alert' : undefined}
      className={[styles.error, variant === 'inline' ? styles.inline : variant === 'blocking' ? styles.blocking : styles.page, className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
    >
      <span className={styles.icon} style={{ background: tint('review'), boxShadow: `inset 0 0 0 1px ${ring('review')}`, color: tone('review') }}>
        <Icon name="danger-circle-linear" size={variant === 'inline' ? 22 : 26} />
      </span>
      <h2 className={variant === 'inline' ? 't-title-2' : 't-title-1'}>{title}</h2>
      <p className="t-body" style={{ color: 'var(--text-2)' }}>{body}</p>
      {onRetry || secondary ? (
        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" onClick={onRetry} aria-busy={retrying} className="a-primary">
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          ) : null}
          {secondary ? (
            secondary.href ? (
              <Link href={secondary.href} className="a-quiet" style={{ justifyContent: 'center' }}>{secondary.label}</Link>
            ) : (
              <button type="button" onClick={secondary.onPress} className="a-quiet" style={{ justifyContent: 'center' }}>{secondary.label}</button>
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
