'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef } from 'react'
import Icon from '../array/Icon'
import styles from './Field.module.css'

type NativeTextareaProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'className'>

export interface TextareaProps extends NativeTextareaProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
}

/** Multiline sibling of TextField — same chrome, no leading/trailing slot (a pill can't hold one). */
export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, className, id, ...rest }: TextareaProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        {required ? <span className={styles.required}>Required</span> : null}
      </div>
      <textarea
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[styles.control, styles.textarea].join(' ')}
        {...rest}
      />
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
