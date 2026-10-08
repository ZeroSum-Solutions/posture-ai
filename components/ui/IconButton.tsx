'use client'

import { forwardRef, type ComponentPropsWithoutRef, type ForwardedRef } from 'react'
import Icon from '../array/Icon'
import type { IconName } from '../array/icons'
import { haptic as fireHaptic, type HapticKind } from '@/lib/haptics'
import styles from './IconButton.module.css'

export type IconButtonVariant = 'plain' | 'glass' | 'filled'

type NativeButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'disabled' | 'onClick'>

export interface IconButtonProps extends NativeButtonProps {
  icon: IconName
  /** Required: renders as `aria-label`. Icon-only controls have no other name. */
  label: string
  variant?: IconButtonVariant
  /** A number renders a count pill; `true` renders an unlabelled dot. */
  badge?: number | boolean
  disabledReason?: string
  haptic?: HapticKind | false
  className?: string
}

/**
 * A 48×48 hit area around a 44px visible circle (DESIGN.md › Actions › Icon).
 * `plain` sits on the canvas: no fill until pressed, when a plate blooms out
 * from the centre. `glass` sits on media (camera, 3D, photos). `filled` is a
 * solid surface-2 disc. `label` is mandatory: an icon alone never carries
 * meaning for assistive tech.
 */
export const IconButton = forwardRef(function IconButton(
  {
    icon,
    label,
    variant = 'plain',
    badge,
    disabledReason,
    haptic = 'tap',
    onClick,
    className,
    type,
    ...rest
  }: IconButtonProps & { onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void },
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const isBlocked = Boolean(disabledReason)

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (isBlocked) {
      event.preventDefault()
      return
    }
    if (haptic) fireHaptic(haptic)
    onClick?.(event)
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={disabledReason}
      aria-disabled={isBlocked || undefined}
      onClick={handleClick}
      className={[styles.btn, styles[variant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      <span className={styles.visual}>
        <span className={styles.plate} aria-hidden="true" />
        <Icon name={icon} size={22} className={styles.glyph} />
        {typeof badge === 'number' ? (
          // Keyed by count: a new count pops in again on the jelly curve.
          <span key={badge} className={styles.badge}>{badge > 99 ? '99+' : badge}</span>
        ) : badge ? (
          <span className={styles.badgeDot} />
        ) : null}
      </span>
    </button>
  )
})
