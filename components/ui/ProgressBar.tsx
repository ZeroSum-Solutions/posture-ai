'use client'

import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import styles from './ProgressBar.module.css'

export interface ProgressBarProps {
  /** 0..1. A lower value than previously seen is ignored — the fill never moves backward. */
  value: number
  /** Accessible name, e.g. "Processing 3 of 4 views". */
  label: string
  className?: string
}

/**
 * A 6px linear fill that chases `value` with a spring (stiffness 200,
 * damping 24) and never moves backward, even if a caller's `value` briefly
 * dips (e.g. a retried step). See DESIGN.md › Loaders and spec §6.1.5.
 */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const [highest, setHighest] = useState(clamped)
  if (clamped > highest) setHighest(clamped)

  const reducedMotion = useReducedMotion()
  const target = useMotionValue(highest)
  const spring = useSpring(target, { stiffness: 200, damping: 24 })
  const width = useTransform(spring, v => `${Math.min(100, Math.max(0, v * 100))}%`)

  useEffect(() => {
    target.set(highest)
  }, [highest, target])

  const [announced, setAnnounced] = useState(0)
  const nearestQuarter = Math.floor(highest * 4) / 4
  if (nearestQuarter > announced) setAnnounced(nearestQuarter)

  const percent = Math.round(highest * 100)

  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <motion.div className={styles.fill} style={{ width: reducedMotion ? `${percent}%` : width }} />
      </div>
      <span className="sr-only" aria-live="polite">
        {Math.round(announced * 100)}%
      </span>
    </div>
  )
}
