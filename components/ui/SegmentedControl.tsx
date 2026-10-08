'use client'

import type { CSSProperties, KeyboardEvent } from 'react'
import Icon from '../array/Icon'
import type { IconName } from '../array/icons'
import styles from './SegmentedControl.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Body view". */
  label: string
  size?: 'md' | 'sm'
  idBase?: string
  className?: string
}

/**
 * Inline filter / mode toggle (2–4 options) — Front/Back, kg/lb, Exercises/
 * Muscles. A single `radiogroup` (not tabs: nothing here is a separate
 * content pane). The selected thumb is always the same idiom — white fill,
 * `--text-on-action` label — never an accent-tint variant. See DESIGN.md ›
 * spec §3.3.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  idBase,
  className,
}: SegmentedControlProps<T>) {
  const groupId = idBase ?? label.replace(/\s+/g, '-').toLowerCase()
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value))
  // One CSS-positioned thumb: no layout reads on mount or change.
  const trackStyle = { '--seg-count': options.length, '--seg-index': activeIndex } as CSSProperties

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = options.length - 1
    if (next === null) return

    event.preventDefault()
    const target = options[next]
    onChange(target.value)
    document.getElementById(`${groupId}-${target.value}`)?.focus()
  }

  return (
    <div
      className={[styles.track, size === 'sm' ? styles.trackSm : '', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
      style={trackStyle}
    >
      <span className={styles.thumb} aria-hidden="true" />
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            id={`${groupId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={styles.segment}
          >
            <span className={[styles.label, active ? styles.labelActive : ''].filter(Boolean).join(' ')}>
              {option.icon ? <Icon name={option.icon} size={16} /> : null}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
