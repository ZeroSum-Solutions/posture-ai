'use client'
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { haptic } from '@/lib/haptics'
import styles from './FilterChip.module.css'

export type FilterChipProps = {
  label: string
  count?: number
  selected: boolean
  onToggle: () => void
  icon?: IconName
  className?: string
  'data-testid'?: string
}

/**
 * Array v4 filter chip: 36px visual pill, 44px hit. Selecting it floods an
 * ink-1 fill out from the point the finger touched (a circular clip-path
 * grown from --fx/--fy). The face blends with `difference`, so the label
 * inverts to canvas-dark exactly at the liquid edge — one copy of the text,
 * no duplicate in the accessibility tree — and a check draws itself in.
 * Never colour alone: selection is fill + check + `aria-pressed`.
 */
export function FilterChip({ label, count, selected, onToggle, icon, className, 'data-testid': testId }: FilterChipProps) {
  function setOrigin(el: HTMLElement, x: string, y: string) {
    el.style.setProperty('--fx', x)
    el.style.setProperty('--fy', y)
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setOrigin(event.currentTarget, `${event.clientX - rect.left}px`, `${event.clientY - rect.top}px`)
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Keyboard activation (detail 0) fills from the centre.
    if (event.detail === 0) setOrigin(event.currentTarget, '50%', '50%')
    haptic('tap')
    onToggle()
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      aria-pressed={selected}
      data-selected={selected ? 'true' : 'false'}
      className={[styles.chip, className].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.face}>
        <span className={styles.slot} data-has-icon={icon ? 'true' : undefined}>
          {icon && !selected ? (
            <Icon name={icon} size={14} />
          ) : (
            <svg className={styles.check} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 8.4l2.9 2.9 6.1-6.6" />
            </svg>
          )}
        </span>
        <span className={styles.label}>{label}</span>
        {count == null ? null : <span className={styles.count}>{count}</span>}
      </span>
    </button>
  )
}

/**
 * A single-line, horizontally scrolling row of chips. Edge fades follow the
 * scroll position (scroll-driven, where supported): no fade at an edge you
 * are already at. Chip rows never wrap (DESIGN.md › Chip family).
 *
 * `bleed`: the row runs to the screen edges and pads by the gutter, so the
 * first chip lines up with the content above it and chips scroll off the
 * glass edge rather than a hard inner edge. Use it for top-level filter rows
 * placed directly in `.app-screen-x` content.
 */
export function ChipRow({ children, label, style, bleed = false }: { children: ReactNode; label: string; style?: CSSProperties; bleed?: boolean }) {
  return (
    <div className={[styles.rowMask, bleed ? styles.bleed : ''].filter(Boolean).join(' ')} style={style}>
      <div className={styles.row} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  )
}
