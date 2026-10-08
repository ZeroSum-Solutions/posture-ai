'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import Icon from '../array/Icon'
import type { IconName } from '../array/icons'
import { haptic as fireHaptic, type HapticKind } from '@/lib/haptics'
import Lens from './Lens'
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
  /** Quiet (`tertiary`) buttons: a trailing chevron that nudges right on press. */
  chevron?: boolean
  /**
   * The pill morphs into a circle holding the Lens loader. Clicks are
   * swallowed and `aria-busy` is set; the label stays in the tree so the
   * accessible name never changes.
   */
  loading?: boolean
  /**
   * Set together with (or just before) `loading` → false: the circle shows a
   * self-drawing check for ~0.9s, then springs back to the full pill.
   */
  success?: boolean
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

type Phase = 'idle' | 'loading' | 'success'

const SUCCESS_HOLD_MS = 900

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Width morph (FLIP on `width` only). Runs when the phase or the label text
 * changes: reads the new resting width once, starts from the last settled
 * width, and lets the CSS curve (spring out, expo in) carry it. Inline width
 * is cleared when the morph lands so the button stays responsive.
 */
function useWidthMorph(
  ref: React.RefObject<HTMLElement | null>,
  morphKey: string,
) {
  const lastWidth = useRef<number | null>(null)

  // Track the settled width without forcing layout (ResizeObserver is async).
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.borderBoxSize?.[0]
      lastWidth.current = box ? box.inlineSize : el.offsetWidth
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const from = lastWidth.current
    el.style.transition = 'none'
    el.style.width = ''
    const to = el.getBoundingClientRect().width
    lastWidth.current = to
    el.style.transition = ''
    if (from == null || Math.abs(from - to) < 1 || prefersReducedMotion()) return

    el.style.transition = 'none'
    el.style.width = `${from}px`
    void el.offsetWidth // commit the start frame
    el.style.transition = ''
    el.style.width = `${to}px`

    function settle(event: TransitionEvent) {
      if (event.target !== el || event.propertyName !== 'width') return
      el!.style.width = ''
      el!.removeEventListener('transitionend', settle)
    }
    el.addEventListener('transitionend', settle)
    return () => el.removeEventListener('transitionend', settle)
  }, [ref, morphKey])
}

/**
 * The system's one button (DESIGN.md › Actions). Primary is the volt pill;
 * pending, it morphs into a 52px circle holding the Lens loader, then (with
 * `success`) a check, then springs back to the pill. Label changes crossfade
 * while the width springs to fit. Press: CSS `:active` scale .96, released on
 * the spring curve so it lands with a small overshoot.
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    icon,
    trailingIcon,
    chevron = false,
    loading = false,
    success = false,
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
  const elementRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)

  // Phase follows `loading`; a finished load with `success` holds a check.
  const [phase, setPhase] = useState<Phase>(loading ? 'loading' : 'idle')
  const [prevLoading, setPrevLoading] = useState(loading)
  if (loading !== prevLoading) {
    setPrevLoading(loading)
    setPhase(loading ? 'loading' : success ? 'success' : 'idle')
  }
  useEffect(() => {
    if (phase !== 'success') return
    fireHaptic('success')
    const timer = window.setTimeout(() => setPhase('idle'), SUCCESS_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Label crossfade: only for text labels (a key we can compare).
  const labelKey = typeof children === 'string' || typeof children === 'number' ? String(children) : null
  const [label, setLabel] = useState<{ key: string | null; prev: string | null; n: number }>({ key: labelKey, prev: null, n: 0 })
  if (labelKey !== label.key) {
    setLabel({ key: labelKey, prev: labelKey !== null ? label.key : null, n: label.n + 1 })
  }

  const round = phase !== 'idle'
  useWidthMorph(elementRef, round ? 'round' : `idle:${labelKey ?? ''}`)

  function setRefs(node: HTMLButtonElement | HTMLAnchorElement | null) {
    elementRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as { current: HTMLButtonElement | HTMLAnchorElement | null }).current = node
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) {
    if (isBlocked || loading || phase !== 'idle') {
      event.preventDefault()
      return
    }
    if (haptic) fireHaptic(haptic)
    onClick?.(event)
  }

  const showChevron = chevron && !trailingIcon
  const content = (
    <>
      <span className={styles.content}>
        {icon ? <Icon name={icon} size={20} className={styles.icon} /> : null}
        <span className={styles.labelStack}>
          <span key={`in-${label.n}`} className={styles.label} data-enter={label.n > 0 ? 'true' : undefined}>
            {children}
          </span>
          {label.prev != null ? (
            <span
              key={`out-${label.n}`}
              className={styles.labelOut}
              aria-hidden="true"
              onAnimationEnd={() => setLabel(current => ({ ...current, prev: null }))}
            >
              {label.prev}
            </span>
          ) : null}
        </span>
        {trailingIcon ? <Icon name={trailingIcon} size={20} className={styles.icon} /> : null}
        {showChevron ? <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} /> : null}
      </span>
      <span className={styles.orb} aria-hidden="true">
        {round ? (
          <Lens size={size === 'lg' ? 30 : 26} state={phase === 'success' ? 'done' : 'loading'} tone="ghost" className={styles.lens} />
        ) : null}
      </span>
    </>
  )

  const classes = [styles.btn, styles[variant], styles[size], block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ')

  const sharedProps = {
    className: classes,
    'data-phase': phase,
    'aria-disabled': isBlocked || undefined,
    'aria-describedby': isBlocked ? reasonId : undefined,
    'aria-busy': loading || phase === 'success' || undefined,
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
