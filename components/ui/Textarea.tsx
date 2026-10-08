'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef } from 'react'
import { FieldFoot } from './TextField'
import styles from './Field.module.css'

type NativeTextareaProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'className'>

export interface TextareaProps extends NativeTextareaProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
}

/** Multiline sibling of TextField — same chrome and floating label, no leading/trailing slot. */
export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, className, id, placeholder, ...rest }: TextareaProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <div className={[styles.controlWrap, styles.textareaWrap].join(' ')}>
        <textarea
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          placeholder={placeholder ?? ' '}
          className={[styles.control, styles.textarea, styles.labelled].join(' ')}
          {...rest}
        />
        <label htmlFor={inputId} className={styles.floatLabel}>
          {label}
        </label>
      </div>
      <FieldFoot id={inputId} hint={hint} error={error} required={required} />
    </div>
  )
})
