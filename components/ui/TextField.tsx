'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import Icon from '../array/Icon'
import type { IconName } from '../array/icons'
import styles from './Field.module.css'

type NativeInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'className'>

export interface TextFieldProps extends NativeInputProps {
  /** Shown above the control when the field is disabled (DESIGN.md › Colour: disabled states say why). */
  disabledReason?: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  /** 20px icon in the control's leading slot. */
  leading?: IconName
  /** Arbitrary trailing content (e.g. a clear IconButton). */
  trailing?: ReactNode
  className?: string
  controlClassName?: string
}

/**
 * The system's one text input: visible label above, a 52px solid field
 * (16px type — no iOS zoom), hint or error below. See DESIGN.md › spec §3.2.
 */
export const TextField = forwardRef(function TextField(
  { label, hint, error, required, leading, trailing, className, controlClassName, id, disabledReason, ...rest }: TextFieldProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [error ? errorId : hint ? hintId : undefined, rest.disabled && disabledReason ? `${inputId}-reason` : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        {required ? <span className={styles.required}>Required</span> : null}
      </div>
      {rest.disabled && disabledReason ? (
        <p id={`${inputId}-reason`} className={styles.disabledReason}>{disabledReason}</p>
      ) : null}
      <div className={styles.controlWrap}>
        {leading ? (
          <span className={styles.leading}>
            <Icon name={leading} size={20} />
          </span>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            styles.control,
            leading ? styles.withLeading : '',
            trailing ? styles.withTrailing : '',
            controlClassName,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
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
