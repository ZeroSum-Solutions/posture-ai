'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import styles from './Toggle.module.css'

export interface RadioProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  className?: string
}

/** 28px circle, 48px hit including the label. Pair with others sharing a `name`. */
export const Radio = forwardRef(function Radio(
  { label, className, id, disabled, ...rest }: RadioProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId

  return (
    <label htmlFor={inputId} className={[styles.row, className].filter(Boolean).join(' ')} data-disabled={disabled || undefined}>
      <span className={styles.hit}>
        <input ref={ref} id={inputId} type="radio" disabled={disabled} className={styles.input} {...rest} />
        <span className={styles.radioCircle}>
          <span className={styles.radioDot} />
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  )
})
