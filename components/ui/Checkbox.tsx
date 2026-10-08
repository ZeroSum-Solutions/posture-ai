'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import styles from './Toggle.module.css'

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  className?: string
}

/**
 * v4 checkbox: a 24px squircle, 48px hit including the label. Checked fills
 * volt and the check draws itself (stroke-dashoffset) — never colour alone.
 */
export const Checkbox = forwardRef(function Checkbox(
  { label, className, id, disabled, ...rest }: CheckboxProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId

  return (
    <label htmlFor={inputId} className={[styles.row, className].filter(Boolean).join(' ')} data-disabled={disabled || undefined}>
      <span className={styles.hit}>
        <input ref={ref} id={inputId} type="checkbox" disabled={disabled} className={styles.input} {...rest} />
        <span className={styles.checkboxBox} aria-hidden="true">
          <svg className={styles.checkboxGlyph} viewBox="0 0 16 16">
            <path d="M3.4 8.4l3 3 6.2-6.6" />
          </svg>
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  )
})
