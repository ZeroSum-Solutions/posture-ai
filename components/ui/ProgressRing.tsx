'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionStyle } from 'framer-motion'
import Icon from '../array/Icon'
import { haptic } from '@/lib/haptics'
import { reduced, spring } from '@/lib/motion'
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
 * A determinate ring with a tabular number (DESIGN.md › Loaders). The arc
 * chases the value on the `settle` spring — driven straight from a motion
 * value, so nothing re-renders per frame — with a bright volt head at its
 * leading end. At 100% the ring closes into a ghost Lens (volt outline) that
 * blooms on the jelly spring around a check; a success haptic fires once.
 */
export function ProgressRing({ value, size = 48, label, className }: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const [highest, setHighest] = useState(clamped)
  if (clamped > highest) setHighest(clamped)

  const reducedMotion = useReducedMotion()
  const target = useMotionValue(highest)
  const animated = useSpring(target, { stiffness: spring.settle.stiffness, damping: spring.settle.damping })
  const announcedComplete = useRef(false)

  useEffect(() => {
    target.set(highest)
  }, [highest, target])

  useEffect(() => {
    if (highest >= 1 && !announcedComplete.current) {
      announcedComplete.current = true
      haptic('success')
    }
  }, [highest])

  const strokeWidth = size === 72 ? 5 : 4
  const radius = size / 2 - strokeWidth
  const circumference = 2 * Math.PI * radius
  const dashOffset = useTransform(animated, v => circumference * (1 - Math.min(1, Math.max(0, v))))
  const headRotate = useTransform(animated, v => Math.min(1, Math.max(0, v)) * 360)
  const complete = highest >= 1

  return (
    <div
      className={[styles.ring, size === 72 ? styles.ringLg : '', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(highest * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-complete={complete ? 'true' : undefined}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.svg} aria-hidden="true">
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
        <motion.circle
          className={styles.fill}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          style={{ strokeDashoffset: reducedMotion ? circumference * (1 - highest) : dashOffset }}
        />
      </svg>
      {!complete ? (
        <motion.span
          className={styles.headOrbit}
          style={{ rotate: reducedMotion ? highest * 360 : headRotate, '--ring-r': `${radius}px` } as MotionStyle}
          aria-hidden="true"
        >
          <span className={styles.head} />
        </motion.span>
      ) : null}
      <span className={styles.center}>
        <AnimatePresence mode="wait" initial={false}>
          {complete ? (
            <motion.span
              key="check"
              className={styles.done}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: reducedMotion ? reduced : { ...spring.jelly, opacity: { duration: 0.12 } } }}
            >
              <Icon name="check-linear" size={size === 72 ? 30 : 22} className={styles.check} title="Complete" />
            </motion.span>
          ) : (
            <motion.span
              key="value"
              className={styles.value}
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.12 }}
            >
              {Math.round(highest * 100)}
              <span className={styles.unit}>%</span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  )
}
