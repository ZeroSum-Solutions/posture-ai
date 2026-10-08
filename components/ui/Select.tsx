'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef } from 'react'
import Icon from '../array/Icon'
import { FieldFoot } from './TextField'
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
 * A native `<select>` for short option lists, in the v4 field chrome: the
 * label is always risen (a select always shows a value) and the chevron
 * dips on focus. Long lists (e.g. the client picker) use a Sheet picker.
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
      <div className={styles.controlWrap}>
        <select
          id={selectId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          className={[styles.control, styles.labelled, styles.selectControl].join(' ')}
          {...rest}
        >
          {children}
        </select>
        <label htmlFor={selectId} className={styles.floatLabel} data-risen="true">
          {label}
        </label>
        <span className={styles.chevron}>
          <Icon name="alt-arrow-down-linear" size={20} />
        </span>
      </div>
      <FieldFoot id={selectId} hint={hint} error={error} required={required} />
    </div>
  )
})
