import type { CSSProperties, ElementType, ReactNode } from 'react'
import Link from 'next/link'
import { SurfaceSheen } from './SurfaceSheen'
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
  /**
   * Press physics (scale .985, DESIGN.md › Motion) for a Surface a parent
   * makes clickable itself (e.g. by wrapping it in its own button). Always on
   * for SurfaceLink and SurfaceButton, since those ARE the pressable target.
   */
  interactive?: boolean
  /**
   * `feature` tier only: a pointer-tracked radial highlight (see
   * `SurfaceSheen`). Decorative, opacity-only, off under reduced motion.
   */
  sheen?: boolean
  'data-testid'?: string
}

/**
 * The system's one card material, in three tiers (DESIGN.md › Materials):
 *
 *  - `feature` → card glass (M1). One per screen, two at most. A single
 *    element carries the blur, the fill and a conic "edge light" border (a
 *    `padding-box`/`border-box` double background, so the ring reads as a lit
 *    edge rather than a flat line) plus an inset top highlight.
 *  - `tile` / `row` → flat (M0). No blur, ever — a solid fill and a 1px
 *    hairline, inset via `box-shadow` so it never fights a native
 *    button/link border reset.
 *
 * This replaces the v2 double-wrapper (a decorative `.gradient` sibling plus
 * an `.inner` content node): the border styling now lives directly on this
 * element. The one remaining inner wrapper exists only so `innerClassName`/
 * `innerStyle` keep working for every existing caller (grepped before this
 * rewrite) that reaches past the shell for scroll/overflow/background needs.
 */
export function Surface({
  tier = 'tile',
  pad = 'default',
  children,
  className,
  style,
  innerClassName,
  innerStyle,
  interactive = false,
  sheen = false,
  'data-testid': testId,
}: BaseProps) {
  return (
    <div
      className={[styles.shell, styles[tier], interactive ? styles.interactive : '', padClass[pad], className].filter(Boolean).join(' ')}
      style={style}
      data-testid={testId}
    >
      {sheen && tier === 'feature' ? <SurfaceSheen /> : null}
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
  sheen = false,
  'aria-label': ariaLabel,
  'data-testid': testId,
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
      data-testid={testId}
    >
      {sheen && tier === 'feature' ? <SurfaceSheen /> : null}
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
  sheen = false,
  as = 'button',
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'data-testid': testId,
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
      data-testid={testId}
    >
      {sheen && tier === 'feature' ? <SurfaceSheen /> : null}
      <span className={[styles.inner, innerClassName].filter(Boolean).join(' ')} style={innerStyle}>
        {children}
      </span>
    </Tag>
  )
}
