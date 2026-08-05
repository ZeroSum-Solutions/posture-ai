'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from './Icon'
import type { IconName } from './icons'
import { islandSlots, isIslandHidden, activeSlotHref } from './islandPolicy'
import styles from './IslandNav.module.css'

/**
 * The island: the app's only navigation. Five slots, the middle one an action.
 *
 * Immersive screens (capture, player) hide it through the shell's
 * `:has([data-immersive-surface])` rule and show only the home indicator, so
 * this component does not need to know about them.
 */
export default function IslandNav({ clinicalContentEnabled }: { clinicalContentEnabled: boolean }) {
  const pathname = usePathname() ?? ''
  if (isIslandHidden(pathname)) return null

  const slots = islandSlots(clinicalContentEnabled)
  const active = activeSlotHref(pathname, slots)

  return (
    <div className={`${styles.island} app-island`}>
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
