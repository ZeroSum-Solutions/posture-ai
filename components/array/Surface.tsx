import type { CSSProperties, ElementType, ReactNode } from 'react'
import Link from 'next/link'
import styles from './Surface.module.css'

type Tier = 'feature' | 'tile' | 'row'
type Pad = 'default' | 'snug' | 'rowy' | 'flush'

const padClass: Record<Pad, string> = {
  default: '',
  snug: styles.padSnug,
  rowy: styles.padRow,
  flush: styles.padFlush,
}

type BaseProps = {
  tier?: Tier
  pad?: Pad
  children: ReactNode
  className?: string
  style?: CSSProperties
  innerClassName?: string
  innerStyle?: CSSProperties
}

/**
 * A gradient-shell glass surface — the only two elevations in the system.
 *
 * `feature` (tier 1) is the screen's subject: one per screen, two at most.
 * `tile`/`row` (tier 2) is everything else. The shell is a 1px gradient border
 * drawn as a padded wrapper, so the inner radius is always one pixel tighter
 * than the outer.
 */
export function Surface({
  tier = 'tile',
  pad = 'default',
  children,
  className,
  style,
  innerClassName,
  innerStyle,
}: BaseProps) {
  return (
    <div className={[styles.shell, styles[tier], padClass[pad], className].filter(Boolean).join(' ')} style={style}>
      <div className={styles.gradient} />
      <div className={[styles.inner, innerClassName].filter(Boolean).join(' ')} style={innerStyle}>
        {children}
      </div>
    </div>
  )
}

/** The same surface as a single interactive target — a link or a button. */
export function SurfaceLink({
  href,
  tier = 'row',
  pad = 'default',
  children,
  className,
  style,
  innerClassName,
  innerStyle,
  'aria-label': ariaLabel,
  prefetch,
}: BaseProps & { href: string; 'aria-label'?: string; prefetch?: boolean }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      /* A list of rows should not prefetch every destination; long histories set
         this to false so a scroll does not fetch a page per row. */
      prefetch={prefetch}
      className={[styles.shell, styles[tier], styles.interactive, padClass[pad], className].filter(Boolean).join(' ')}
      style={style}
    >
      <span className={styles.gradient} />
      <span className={[styles.inner, innerClassName].filter(Boolean).join(' ')} style={innerStyle}>
        {children}
      </span>
    </Link>
  )
}

export function SurfaceButton({
  onClick,
  tier = 'row',
  pad = 'default',
  children,
  className,
  style,
  innerClassName,
  innerStyle,
  disabled,
  as = 'button',
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
}: BaseProps & {
  onClick?: () => void
  disabled?: boolean
  as?: ElementType
  'aria-label'?: string
  'aria-pressed'?: boolean
}) {
  const Tag = as
  return (
    <Tag
      type={as === 'button' ? 'button' : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={[styles.shell, styles[tier], styles.interactive, padClass[pad], className].filter(Boolean).join(' ')}
      style={{ opacity: disabled ? 0.45 : undefined, cursor: disabled ? 'not-allowed' : undefined, ...style }}
    >
      <span className={styles.gradient} />
      <span className={[styles.inner, innerClassName].filter(Boolean).join(' ')} style={innerStyle}>
        {children}
      </span>
    </Tag>
  )
}
