'use client'

import { forwardRef, useId, useState, type ChangeEvent, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import { haptic } from '@/lib/haptics'
import { ToggleText } from './ToggleText'
import styles from './Toggle.module.css'

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  /** Optional second line under the label (ink-3), linked as the description. */
  description?: ReactNode
  className?: string
}

/**
 * v4 switch: a 52×32 track. Off, the knob is a small grey bead; on, it grows
 * into a full dark knob on an ink-1 track and draws a check — a size morph
 * that squashes while it travels and widens under the finger. The whole row
 * is the target (48px min). On is never colour alone: knob size, position
 * and the check all change. A light haptic tap confirms each change.
 */
export const Switch = forwardRef(function Switch(
  { label, description, className, id, disabled, onChange, ...rest }: SwitchProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const descriptionId = description ? `${inputId}-description` : undefined
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
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          role="switch"
          disabled={disabled}
          aria-describedby={descriptionId}
          className={styles.input}
          onChange={handleChange}
          {...rest}
        />
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchThumb}>
            <span className={styles.switchKnob}>
              <svg className={styles.switchGlyph} viewBox="0 0 16 16">
                <path d="M3.8 8.3l2.7 2.7 5.7-6" />
              </svg>
            </span>
          </span>
        </span>
      </span>
      <ToggleText label={label} description={description} descriptionId={descriptionId} />
    </label>
  )
})
