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

/** Hint or error on the left, "Required" on the right; shared by the field family. */
export function FieldFoot({ id, hint, error, required }: { id: string; hint?: string; error?: string; required?: boolean }) {
  if (!error && !hint && !required) return null
  return (
    <div className={styles.foot}>
      {error ? (
        <p id={`${id}-error`} className={styles.error}>
          <Icon name="danger-circle-linear" size={16} className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {required ? <span className={styles.required}>Required</span> : null}
    </div>
  )
}

/**
 * The system's one text input (DESIGN.md › v4 fields): a 52px surface-2
 * control with a floating label that rests inside and rises on focus or once
 * filled. 16px type — no iOS zoom. Hint or error below; an error slides in.
 * The label stays a real `<label for>`, so the accessible name is unchanged.
 */
export const TextField = forwardRef(function TextField(
  { label, hint, error, required, leading, trailing, className, controlClassName, id, disabledReason, placeholder, ...rest }: TextFieldProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [error ? errorId : hint ? hintId : undefined, rest.disabled && disabledReason ? `${inputId}-reason` : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
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
          aria-required={required || undefined}
          // A space keeps :placeholder-shown meaningful, which floats the label.
          placeholder={placeholder ?? ' '}
          className={[
            styles.control,
            styles.labelled,
            leading ? styles.withLeading : '',
            trailing ? styles.withTrailing : '',
            controlClassName,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        <label htmlFor={inputId} className={styles.floatLabel}>
          {label}
        </label>
        {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
      </div>
      <FieldFoot id={inputId} hint={hint} error={error} required={required} />
    </div>
  )
})
