'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring } from 'framer-motion'
import Icon from '../array/Icon'
import { haptic } from '@/lib/haptics'
import { spring } from '@/lib/motion'
import styles from './ProgressRing.module.css'

export type ProgressRingSize = 48 | 72

export interface ProgressRingProps {
  /** 0..1. Never moves backward, same contract as ProgressBar. */
  value: number
  size?: ProgressRingSize
  /** Accessible name, e.g. "Setup checklist". */
  label: string
  className?: string
}

/**
 * A determinate ring with a tabular counting number. At 100% the arc
 * crossfades into a check (a fade swap stands in for a true path morph —
 * the visual effect is the same without animating an SVG `d`), the ring
 * pops on `spring.delight`, and a success haptic fires once.
 */
export function ProgressRing({ value, size = 48, label, className }: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const [highest, setHighest] = useState(clamped)
  if (clamped > highest) setHighest(clamped)

  const reducedMotion = useReducedMotion()
  const target = useMotionValue(highest)
  const animated = useSpring(target, { stiffness: 200, damping: 24 })
  const [displayPercent, setDisplayPercent] = useState(Math.round(highest * 100))
  const announcedComplete = useRef(false)

  useEffect(() => {
    target.set(highest)
  }, [highest, target])

  useMotionValueEvent(animated, 'change', latest => {
    setDisplayPercent(Math.round(Math.min(1, Math.max(0, latest)) * 100))
  })

  useEffect(() => {
    if (highest >= 1 && !announcedComplete.current) {
      announcedComplete.current = true
      haptic('success')
    }
  }, [highest])

  const strokeWidth = size === 72 ? 5 : 4
  const radius = size / 2 - strokeWidth
  const circumference = 2 * Math.PI * radius
  const visiblePercent = reducedMotion ? Math.round(highest * 100) : displayPercent
  const dashOffset = circumference * (1 - visiblePercent / 100)
  const complete = highest >= 1

  return (
    <motion.div
      className={[styles.ring, size === 72 ? styles.ringLg : '', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(highest * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      animate={complete && !reducedMotion ? { scale: [1, 1.12, 1] } : undefined}
      transition={spring.delight}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.svg}>
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
        <circle
          className={styles.fill}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className={styles.center}>
        <AnimatePresence mode="wait" initial={false}>
          {complete ? (
            <motion.span
              key="check"
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12 }}
            >
              <Icon name="check-linear" size={size === 72 ? 28 : 20} className={styles.check} title="Complete" />
            </motion.span>
          ) : (
            <motion.span
              key="value"
              className={[styles.value, 'n'].join(' ')}
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {Math.round(highest * 100)}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.div>
  )
}
