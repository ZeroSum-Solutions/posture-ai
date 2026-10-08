'use client'

import { forwardRef, useId, type ComponentPropsWithoutRef, type ForwardedRef, type ReactNode } from 'react'
import Icon from '../array/Icon'
import styles from './Toggle.module.css'

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'type'> {
  label: ReactNode
  className?: string
}

/**
 * 28px-tall track, 48px hit including the label — the whole row is the
 * target. The checked state is never color alone: a check glyph fades into
 * the thumb. See DESIGN.md › spec §3.15.
 */
export const Switch = forwardRef(function Switch(
  { label, className, id, disabled, ...rest }: SwitchProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const autoId = useId()
  const inputId = id ?? autoId

  return (
    <label htmlFor={inputId} className={[styles.row, className].filter(Boolean).join(' ')} data-disabled={disabled || undefined}>
      <span className={styles.hit}>
        <input ref={ref} id={inputId} type="checkbox" role="switch" disabled={disabled} className={styles.input} {...rest} />
        <span className={styles.switchTrack}>
          <span className={styles.switchThumb}>
            <Icon name="check-linear" size={12} className={styles.switchGlyph} />
          </span>
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  )
})
