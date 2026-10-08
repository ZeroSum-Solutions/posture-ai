'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef } from 'react'
import Icon from '../array/Icon'
import styles from './Field.module.css'

type NativeSelectProps = Omit<ComponentPropsWithoutRef<'select'>, 'className'>

export interface SelectProps extends NativeSelectProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
}

/**
 * A native `<select>` for short option lists, styled as a field with a
 * trailing chevron. Long lists (e.g. the client picker) use a Sheet picker
 * instead — see spec §3.2.
 */
export const Select = forwardRef(function Select(
  { label, hint, error, required, className, id, children, ...rest }: SelectProps,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  const autoId = useId()
  const selectId = id ?? autoId
  const hintId = `${selectId}-hint`
  const errorId = `${selectId}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <label htmlFor={selectId} className={styles.label}>
          {label}
        </label>
        {required ? <span className={styles.required}>Required</span> : null}
      </div>
      <div className={styles.controlWrap}>
        <select
          id={selectId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[styles.control, styles.selectControl].join(' ')}
          {...rest}
        >
          {children}
        </select>
        <span className={styles.chevron}>
          <Icon name="alt-arrow-down-linear" size={20} />
        </span>
      </div>
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="danger-circle-linear" size={16} className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  )
})
