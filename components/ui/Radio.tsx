'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import { ToggleText } from './ToggleText'
import styles from './Toggle.module.css'

export interface RadioProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  /** Optional second line under the label (ink-3), linked as the description. */
  description?: ReactNode
  className?: string
}

/**
 * v4 radio: a 24px circle; selecting turns the ring ink-1 and springs a dot
 * in on the jelly curve. 48px hit including the label. Pair with others
 * sharing a `name`.
 */
export const Radio = forwardRef(function Radio(
  { label, description, className, id, disabled, ...rest }: RadioProps,
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
          type="radio"
          disabled={disabled}
          aria-describedby={descriptionId}
          className={styles.input}
          {...rest}
        />
        <span className={styles.radioCircle} aria-hidden="true">
          <span className={styles.radioDot} />
        </span>
      </span>
      <ToggleText label={label} description={description} descriptionId={descriptionId} />
    </label>
  )
})
