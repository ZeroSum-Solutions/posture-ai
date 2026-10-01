'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Icon from './Icon'
import type { IconName } from './icons'
import { islandSlots, isIslandHidden, isIslandScrollRevealed, activeSlotHref, type IslandAudience } from './islandPolicy'
import styles from './IslandNav.module.css'

/**
 * The island: the app's only navigation. Five slots, the middle one an action.
 *
 * Immersive screens (capture, player) hide it through the shell's
 * `:has([data-immersive-surface])` rule and show only the home indicator, so
 * this component does not need to know about them.
 */
/** Scroll distance in one direction before the island changes state, so jitter does not flicker it. */
const REVEAL_THRESHOLD_PX = 12

/**
 * On scroll-revealed routes: tucked away at first, shown while the user scrolls up, tucked away
 * again on the way down. Always shown elsewhere.
 */
function useScrollRevealed(enabled: boolean, pathname: string): boolean {
  // Keyed by route so a navigation starts tucked again without resetting state in the effect.
  const [revealedOn, setRevealedOn] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let lastY = window.scrollY
    let travel = 0
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const y = window.scrollY
        const dy = y - lastY
        lastY = y
        // Restart the run whenever the direction flips.
        travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy
        if (travel <= -REVEAL_THRESHOLD_PX) setRevealedOn(pathname)
        else if (travel >= REVEAL_THRESHOLD_PX) setRevealedOn(null)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [enabled, pathname])

  return !enabled || revealedOn === pathname
}

export default function IslandNav({ clinicalContentEnabled, audience = 'practitioner' }: { clinicalContentEnabled: boolean; audience?: IslandAudience }) {
  const pathname = usePathname() ?? ''
  const scrollRevealed = isIslandScrollRevealed(pathname)
  const shown = useScrollRevealed(scrollRevealed, pathname)
  if (isIslandHidden(pathname)) return null

  const slots = islandSlots(clinicalContentEnabled, audience)
  if (slots.length === 0) return null
  const active = activeSlotHref(pathname, slots)

  return (
    <div
      className={`${styles.island} ${shown ? '' : styles.islandTucked} app-island`}
      data-island-state={shown ? 'shown' : 'tucked'}
    >
      <div className={styles.fade} aria-hidden="true" />
      <div className={styles.dock}>
        <motion.div
          key={active ?? 'none'}
          className={styles.shell}
          initial={{ scale: 0.96 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className={styles.ring} aria-hidden="true" />
          <nav className={styles.bar} aria-label="Primary">
            {slots.map((slot) => {
              const isActive = slot.href === active
              return (
                <Link
                  key={slot.href}
                  href={slot.href}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={slot.label}
                  className={[
                    styles.slot,
                    slot.kind === 'action' ? styles.capture : '',
                    isActive && slot.kind !== 'action' ? styles.slotActive : '',
                  ].filter(Boolean).join(' ')}
                >
                  <Icon name={slot.icon as IconName} size={20} />
                  {isActive && slot.kind !== 'action'
                    ? <span className={styles.slotLabel}>{slot.label}</span>
                    : null}
                </Link>
              )
            })}
          </nav>
        </motion.div>
      </div>
    </div>
  )
}
