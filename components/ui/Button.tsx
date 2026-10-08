'use client'

import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import Icon from '../array/Icon'
import type { IconName } from '../array/icons'
import { haptic as fireHaptic, type HapticKind } from '@/lib/haptics'
import { DotsBounce } from './DotsBounce'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type NativeButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'disabled' | 'onClick'>

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Fills the width of its container. */
  block?: boolean
  /** Leading icon, 20px. */
  icon?: IconName
  /** Trailing icon, 20px. */
  trailingIcon?: IconName
  /** Label cross-fades to DotsBounce; width stays locked so the pill never shrinks. */
  loading?: boolean
  /**
   * Renders the given reason above the button and switches it to
   * `aria-disabled` (not `disabled`) so the reason stays reachable to
   * screen readers. Clicks are swallowed either way.
   */
  disabledReason?: string
  /** Renders a `next/link` instead of a `<button>`. */
  href?: string
  /** Fires `lib/haptics` on a successful press. `false` opts out. */
  haptic?: HapticKind | false
  onClick?: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  className?: string
  children?: ReactNode
}

/**
 * The system's one button. Variant and size are the only things that change
 * its shape — see DESIGN.md › Actions and spec §3.1. Press feedback is a CSS
 * `:active` scale plus an instant overlay (not framer): cheap, and this
 * component never needs to coordinate with a sibling, so a spring hook would
 * only cost bundle weight for the same result.
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    icon,
    trailingIcon,
    loading = false,
    disabledReason,
    href,
    haptic = 'tap',
    onClick,
    className,
    children,
    type,
    ...rest
  }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement | HTMLAnchorElement>,
) {
  const reasonId = useId()
  const isBlocked = Boolean(disabledReason)
  const measuredWidth = useRef<number | null>(null)
  const elementRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)

  useLayoutEffect(() => {
    if (!loading && elementRef.current) {
      measuredWidth.current = elementRef.current.offsetWidth
    }
  }, [loading, children])

  function setRefs(node: HTMLButtonElement | HTMLAnchorElement | null) {
    elementRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as { current: HTMLButtonElement | HTMLAnchorElement | null }).current = node
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) {
    if (isBlocked || loading) {
      event.preventDefault()
      return
    }
    if (haptic) fireHaptic(haptic)
    onClick?.(event)
  }

  const content = (
    <>
      {icon ? <Icon name={icon} size={20} className={styles.icon} /> : null}
      <span className={styles.labelStack} style={loading && measuredWidth.current ? { minWidth: measuredWidth.current } : undefined}>
        <span className={styles.label}>{children}</span>
        <span className={styles.dots} aria-hidden={!loading}>
          <DotsBounce size={6} />
        </span>
      </span>
      {trailingIcon ? <Icon name={trailingIcon} size={20} className={styles.icon} /> : null}
    </>
  )

  const classes = [styles.btn, styles[variant], styles[size], block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ')

  const sharedProps = {
    className: classes,
    'aria-disabled': isBlocked || undefined,
    'aria-describedby': isBlocked ? reasonId : undefined,
    'aria-busy': loading || undefined,
    onClick: handleClick,
  }

  const button = href ? (
    <Link
      href={href}
      ref={setRefs as ForwardedRef<HTMLAnchorElement>}
      {...sharedProps}
      {...(rest as Omit<ComponentPropsWithoutRef<'a'>, 'className' | 'onClick' | 'href'>)}
    >
      {content}
    </Link>
  ) : (
    <button
      type={type ?? 'button'}
      ref={setRefs as ForwardedRef<HTMLButtonElement>}
      {...sharedProps}
      {...rest}
    >
      {content}
    </button>
  )

  if (!disabledReason) return button

  return (
    <span className={[styles.wrap, block ? styles.block : ''].filter(Boolean).join(' ')}>
      <span id={reasonId} className={styles.reason}>
        {disabledReason}
      </span>
      {button}
    </span>
  )
})
