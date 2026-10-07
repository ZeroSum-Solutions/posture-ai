'use client'
import { Children, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { spring } from '@/lib/motion'
import styles from './ListRow.module.css'

export type ListRowProps = {
  /** Avatar (40) or icon tile (40). Its presence grows the row to 72. */
  leading?: ReactNode
  title: string
  /** Callout/Subhead, max 2 lines. */
  subtitle?: string
  /** A third, lighter line of metadata (e.g. a timestamp), when subtitle is also present. */
  meta?: string
  /** A value, SeverityChip, Badge, etc. */
  trailing?: ReactNode
  /** Appends a chevron after `trailing` — the row leads somewhere. */
  chevron?: boolean
  href?: string
  onPress?: () => void
  /** Row content is replaced by a layout-matched skeleton. */
  busy?: boolean
  disabled?: boolean
  'aria-label'?: string
  className?: string
  'data-testid'?: string
}

/**
 * A row: leading (avatar/icon tile) · title + subtitle (max 2 lines) ·
 * trailing (DESIGN.md › 3.5). 56 tall (one line), 64 (two lines), 72 (with a
 * leading avatar/tile) — never under 48. The whole row is one target: `<a>`
 * when `href` is given, `<button>` when `onPress` is, otherwise a plain,
 * non-interactive row (never a `div` with a click handler).
 */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  chevron = false,
  href,
  onPress,
  busy = false,
  disabled = false,
  'aria-label': ariaLabel,
  className,
  'data-testid': testId,
}: ListRowProps) {
  const minHeight = leading ? 72 : subtitle ? 64 : 56
  const style: CSSProperties = { minHeight }

  const content = busy ? (
    <BusyContent hasLeading={!!leading} />
  ) : (
    <>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.text}>
        <span className={`t-headline ${styles.title}`}>{title}</span>
        {subtitle ? <span className={`t-callout ${styles.subtitle}`}>{subtitle}</span> : null}
        {meta ? <span className={`t-footnote ${styles.meta}`}>{meta}</span> : null}
      </span>
      {trailing || chevron ? (
        <span className={styles.trailing}>
          {trailing}
          {chevron ? <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} /> : null}
        </span>
      ) : null}
    </>
  )

  const commonClassName = [styles.row, href || onPress ? styles.interactive : '', className].filter(Boolean).join(' ')
  const commonProps = {
    className: commonClassName,
    style,
    'data-testid': testId,
    'aria-label': ariaLabel,
    'aria-busy': busy || undefined,
  }

  if (href && !disabled) {
    return (
      <motion.div whileTap={{ scale: 0.985 }} transition={spring.press}>
        <Link href={href} {...commonProps}>
          {content}
        </Link>
      </motion.div>
    )
  }
  if (onPress) {
    return (
      <motion.button
        type="button"
        onClick={onPress}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.985 }}
        transition={spring.press}
        {...commonProps}
      >
        {content}
      </motion.button>
    )
  }
  return <div {...commonProps}>{content}</div>
}

function BusyContent({ hasLeading }: { hasLeading: boolean }) {
  return (
    <>
      {hasLeading ? <span className={`skeleton ${styles.leading} ${styles.skeletonLeading}`} /> : null}
      <span className={styles.text}>
        <span className={`skeleton ${styles.skeletonLine}`} style={{ width: '55%', height: 14 }} />
        <span className={`skeleton ${styles.skeletonLine}`} style={{ width: '35%', height: 12, marginTop: 6 }} />
      </span>
    </>
  )
}

/**
 * A group of `ListRow`s renders as one flat surface (M0), not one glass per
 * row (DESIGN.md › 3.5): `Surface tier="tile"` backs a `ul`/`li` list, so
 * each `ListRow` stays usable on its own (e.g. a single row inside a Card)
 * while a group gets the list semantics and the inset hairline dividers.
 */
export function ListGroup({ children, label, className, 'data-testid': testId }: { children: ReactNode; label: string; className?: string; 'data-testid'?: string }) {
  const items = Children.toArray(children)
  return (
    <Surface tier="tile" pad="flush" className={className} data-testid={testId}>
      <ul className={styles.group} aria-label={label}>
        {items.map((child, index) => (
          <li key={index} className={styles.item}>
            {child}
          </li>
        ))}
      </ul>
    </Surface>
  )
}
