'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { haptic } from '@/lib/haptics'
import { activeSlotHref, isTabBarHidden, tabBarSlots, type TabBarAudience } from './tabBarPolicy'
import styles from './TabBar.module.css'

const TAB_ICON_SIZE = 24
/** visualViewport shrink beyond this is "the keyboard is open" (spec §3.7, §7.22). */
const KEYBOARD_SHRINK_PX = 120
/** A small overshoot on the icon pop: not one of lib/motion.ts's named
 * presets, requested specifically for this micro-interaction. */
const iconPopTransition = { type: 'spring', stiffness: 420, damping: 26 } as const

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  const maxHeightRef = useRef(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    maxHeightRef.current = viewport.height

    const onResize = () => {
      maxHeightRef.current = Math.max(maxHeightRef.current, viewport.height)
      setOpen(maxHeightRef.current - viewport.height > KEYBOARD_SHRINK_PX)
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [])

  return open
}

/**
 * The tab bar: the app's only navigation. Five slots, the middle one an
 * action. Hidden on immersive routes via the shell's
 * `:has([data-immersive-surface])` rule (this component carries the
 * `app-island` class so that rule keeps applying), on the hidden routes
 * tabBarPolicy knows about, and while the virtual keyboard is open. It never
 * hides on scroll.
 */
export default function TabBar({
  clinicalContentEnabled,
  audience = 'practitioner',
}: {
  clinicalContentEnabled: boolean
  audience?: TabBarAudience
}) {
  const pathname = usePathname() ?? ''
  const keyboardOpen = useKeyboardOpen()

  if (isTabBarHidden(pathname)) return null
  const slots = tabBarSlots(clinicalContentEnabled, audience)
  if (slots.length === 0) return null
  const active = activeSlotHref(pathname, slots)

  return (
    <div
      className={`${styles.bar} app-island`}
      data-keyboard-open={keyboardOpen ? 'true' : undefined}
    >
      <nav className={styles.nav} aria-label="Primary">
        {slots.map((slot) => {
          if (slot.kind === 'action') {
            return (
              <div key={slot.href} className={styles.actionWrap}>
                <Link
                    href={slot.href}
                    aria-label={slot.label}
                    className={styles.action}
                    onClick={() => haptic('tap')}
                  >
                    <span className={styles.actionCircle}>
                      <Icon name={slot.icon as IconName} size={TAB_ICON_SIZE} />
                    </span>
                    <span className={styles.actionLabel}>{slot.label}</span>
                </Link>
              </div>
            )
          }

          const isActive = slot.href === active
          return (
            <Link
              key={slot.href}
              href={slot.href}
              aria-current={isActive ? 'page' : undefined}
              aria-label={slot.label}
              className={styles.slot}
            >
              <span className={styles.slotInner}>
                {/* CSS-only "jelly" entrance (no layout reads on navigation). */}
                {isActive && <span className={styles.indicator} aria-hidden="true" />}
                <motion.span
                  key={isActive ? `${slot.href}-active` : `${slot.href}-inactive`}
                  className={styles.iconWrap}
                  initial={isActive ? { scale: 0.8 } : false}
                  animate={{ scale: 1 }}
                  transition={iconPopTransition}
                >
                  <Icon
                    name={slot.icon as IconName}
                    size={TAB_ICON_SIZE}
                    className={isActive ? styles.iconActive : styles.iconInactive}
                  />
                </motion.span>
                <span className={[styles.label, isActive ? styles.labelActive : ''].filter(Boolean).join(' ')}>
                  {slot.label}
                </span>
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
