'use client'

import { forwardRef, useId, useState, type ChangeEvent, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import { haptic } from '@/lib/haptics'
import styles from './Toggle.module.css'

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  className?: string
}

/**
 * v4 switch: 52×32 track — surface-3 off, volt on — with a knob that
 * squashes while it travels and widens under the finger. The whole row is
 * the target (48px min). On is never colour alone: the knob moves and a
 * check draws itself into it. A light haptic tap confirms each change.
 */
export const Switch = forwardRef(function Switch(
  { label, className, id, disabled, onChange, ...rest }: SwitchProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [moved, setMoved] = useState(false)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setMoved(true)
    haptic('tap')
    onChange?.(event)
  }

  return (
    <label
      htmlFor={inputId}
      className={[styles.row, className].filter(Boolean).join(' ')}
      data-disabled={disabled || undefined}
      data-moved={moved || undefined}
    >
      <span className={styles.hit}>
        <input ref={ref} id={inputId} type="checkbox" role="switch" disabled={disabled} className={styles.input} onChange={handleChange} {...rest} />
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchThumb}>
            <svg className={styles.switchGlyph} viewBox="0 0 16 16">
              <path d="M3.8 8.3l2.7 2.7 5.7-6" />
            </svg>
          </span>
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  )
})
