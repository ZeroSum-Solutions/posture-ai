'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import Icon from '../array/Icon'
import styles from './Toggle.module.css'

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  className?: string
}

/** 28×28 box, 48px hit including the label. Checked shows a check glyph, never color alone. */
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
        <span className={styles.checkboxBox}>
          <Icon name="check-linear" size={18} className={styles.checkboxGlyph} />
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  )
})
