import type { CSSProperties, ReactNode } from 'react'
import { Surface } from '@/components/array/Surface'
import styles from './Card.module.css'

export type CardProps = {
  /** Title 2 (or Headline for a denser card) above the content. */
  title?: ReactNode
  /** Headline vs. Title 2 for the heading above. Default 'title'. */
  titleSize?: 'title' | 'headline'
  children: ReactNode
  /** Optional footer action row, right-aligned (e.g. a tertiary "See all"). */
  footer?: ReactNode
  tier?: 'feature' | 'tile' | 'row'
  interactive?: boolean
  sheen?: boolean
  className?: string
  style?: CSSProperties
  'data-testid'?: string
}

/**
 * Surface + title + content + an optional footer action (DESIGN.md › 3.5).
 * `tier="feature"` is card glass — use it at most once per screen.
 */
export function Card({
  title,
  titleSize = 'title',
  children,
  footer,
  tier = 'tile',
  interactive = false,
  sheen = false,
  className,
  style,
  'data-testid': testId,
}: CardProps) {
  return (
    <Surface
      tier={tier}
      interactive={interactive}
      sheen={sheen}
      className={[styles.card, className].filter(Boolean).join(' ')}
      style={style}
      data-testid={testId}
    >
      {title ? <div className={titleSize === 'headline' ? 't-headline' : 't-title-2'} style={{ marginBottom: 'var(--s-8)' }}>{title}</div> : null}
      <div className={styles.content}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </Surface>
  )
}
