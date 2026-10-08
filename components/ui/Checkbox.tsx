'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import { ToggleText } from './ToggleText'
import styles from './Toggle.module.css'

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  /** Optional second line under the label (ink-3), linked as the description. */
  description?: ReactNode
  className?: string
}

/**
 * v4 checkbox: a 24px squircle, 48px hit including the label. Checking
 * blooms an ink-1 fill out of the centre on the jelly curve and the check
 * draws itself (stroke-dashoffset) — never colour alone.
 */
export const Checkbox = forwardRef(function Checkbox(
  { label, description, className, id, disabled, ...rest }: CheckboxProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const descriptionId = description ? `${inputId}-description` : undefined

  return (
    <label htmlFor={inputId} className={[styles.row, className].filter(Boolean).join(' ')} data-disabled={disabled || undefined}>
      <span className={styles.hit}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          aria-describedby={descriptionId}
          className={styles.input}
          {...rest}
        />
        <span className={styles.checkboxBox} aria-hidden="true">
          <svg className={styles.checkboxGlyph} viewBox="0 0 16 16">
            <path d="M3.4 8.4l3 3 6.2-6.6" />
          </svg>
        </span>
      </span>
      <ToggleText label={label} description={description} descriptionId={descriptionId} />
    </label>
  )
})
