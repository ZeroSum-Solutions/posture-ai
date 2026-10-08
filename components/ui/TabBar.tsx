'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { haptic } from '@/lib/haptics'
import Lens from './Lens'
import { Morph } from './Morph'
import { activeSlotHref, isTabBarHidden, tabBarSlots, type TabBarAudience } from './tabBarPolicy'
import styles from './TabBar.module.css'

/** visualViewport shrink beyond this is "the keyboard is open". */
const KEYBOARD_SHRINK_PX = 120
/** Scroll distance before the dock tightens, and how far back up relaxes it. */
const TIGHTEN_AFTER_PX = 120

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

/** True while the reader is scrolling down a long page (dock tightens). */
function useScrollTight(): boolean {
  const [tight, setTight] = useState(false)
  useEffect(() => {
    let last = window.scrollY
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const y = window.scrollY
        const delta = y - last
        if (Math.abs(delta) > 6) {
          setTight(delta > 0 && y > TIGHTEN_AFTER_PX)
          last = y
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  return tight
}

/**
 * The dock: a floating liquid-glass capsule and the app's only navigation.
 * The active destination grows into a labelled pill (flex-grow spring, no
 * layout reads); the others are icon-only with accessible names. The Lens —
 * the capture action — sits in the centre and morphs into the capture
 * viewfinder through a shared view transition. Hidden on immersive routes
 * (`app-island` keeps the shell's `:has([data-immersive-surface])` rule
 * applying), on tabBarPolicy's hidden routes and while the keyboard is open.
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
  const tight = useScrollTight()

  if (isTabBarHidden(pathname)) return null
  const slots = tabBarSlots(clinicalContentEnabled, audience)
  if (slots.length === 0) return null
  const active = activeSlotHref(pathname, slots)

  return (
    <div
      className={`${styles.bar} app-island`}
      data-keyboard-open={keyboardOpen ? 'true' : undefined}
      data-tight={tight ? 'true' : undefined}
    >
      <nav className={styles.dock} aria-label="Primary">
        {slots.map((slot) => {
          if (slot.kind === 'action') {
            return (
              <Link
                key={slot.href}
                href={slot.href}
                aria-label={slot.label}
                className={styles.lensLink}
                onClick={() => haptic('tap')}
              >
                <Morph name="lens" kind="lens-morph">
                  <Lens size={52} breathing />
                </Morph>
              </Link>
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
              data-active={isActive ? 'true' : undefined}
              onClick={() => { if (!isActive) haptic('tap') }}
            >
              <span className={styles.plate} aria-hidden="true" />
              <Icon name={slot.icon as IconName} size={22} className={styles.icon} />
              <span className={styles.label} aria-hidden="true">{slot.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
