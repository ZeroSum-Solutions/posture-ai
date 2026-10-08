'use client'
import type { KeyboardEvent } from 'react'
import { useThumbTravel } from '../ui/useThumbTravel'
import styles from './Tabs.module.css'

/**
 * The system's tab strip — a glass pill holding at most four segments; the
 * selection plate slides and stretches like SegmentedControl's (v4).
 *
 * It owns the full ARIA tab contract rather than leaving it to each caller:
 * one tab in the tab order at a time, arrow/Home/End moving selection, and
 * `aria-controls` pointing at a panel the caller labels with `tabPanelProps`.
 * Two screens carry tabs (client detail, review), and a tab strip that is
 * keyboard-navigable on one screen and not the other is worse than either.
 *
 * A tab bar must never wrap: past four segments the labels shrink past reading
 * size on a 390px viewport, which is the point at which the content wants a
 * different shape, not smaller type.
 */

export interface TabOption<T extends string> {
  value: T
  /** Full accessible name. */
  label: string
  /** Optional compact visible copy for narrow surfaces. */
  displayLabel?: string
}

export function tabId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`
}

export function tabPanelId(idBase: string, value: string): string {
  return `${idBase}-panel-${value}`
}

/** Props for the panel a tab controls, so the pairing cannot drift. */
export function tabPanelProps(idBase: string, value: string, active: boolean) {
  return {
    id: tabPanelId(idBase, value),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(idBase, value),
    // A hidden panel is not a tab stop; the visible one is reachable so a
    // keyboard user can move from the strip into the content it revealed.
    tabIndex: active ? 0 : -1,
  }
}

export function TabStrip<T extends string>({
  idBase,
  options,
  value,
  onChange,
  label,
}: {
  idBase: string
  options: readonly TabOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: T) {
    const index = options.findIndex(option => option.value === current)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % options.length
    if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = options.length - 1
    if (next === null) return

    event.preventDefault()
    const target = options[next]
    onChange(target.value)
    document.getElementById(tabId(idBase, target.value))?.focus()
  }

  const activeIndex = Math.max(0, options.findIndex(option => option.value === value))
  // The thumb is one element positioned from the active index with CSS, so the
  // strip never reads layout (no getBoundingClientRect) on mount or change; the
  // spring feel comes from the --ease-spring linear() curve, the stretch toward
  // the direction of travel from useThumbTravel's restartable keyframe.
  const { style: stripStyle, thumbProps } = useThumbTravel(activeIndex, options.length)

  return (
    <div className={styles.strip} role="tablist" aria-label={label} style={stripStyle}>
      <span className={styles.thumb} aria-hidden="true" {...thumbProps}>
        <span className={styles.thumbBody} />
      </span>
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            id={tabId(idBase, option.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(idBase, option.value)}
            aria-label={option.displayLabel ? option.label : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={event => handleKeyDown(event, option.value)}
            className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
          >
            <span className={styles.tabLabel}>{option.displayLabel ?? option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
