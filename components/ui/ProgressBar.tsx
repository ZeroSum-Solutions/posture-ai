'use client'

import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, type MotionStyle } from 'framer-motion'
import { spring as springs } from '@/lib/motion'
import styles from './ProgressBar.module.css'

export interface ProgressBarProps {
  /** 0..1. A lower value than previously seen is ignored — the fill never moves backward. */
  value: number
  /** Accessible name, e.g. "Processing 3 of 4 views". */
  label: string
  className?: string
}

/**
 * A 6px determinate track (DESIGN.md › Loaders). One motion value, `--p`,
 * drives both the fill (a clip-path inset, so the rounded ends never squash)
 * and a glowing volt head riding its leading edge (a translate) — no width or
 * layout animation. The value chases on the `settle` spring and never moves
 * backward, even if a caller's `value` briefly dips (a retried step). While
 * running, a faint light sweeps along the filled part; at 100% the head
 * fades and the sweep stops.
 */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const [highest, setHighest] = useState(clamped)
  if (clamped > highest) setHighest(clamped)

  const reducedMotion = useReducedMotion()
  const target = useMotionValue(highest)
  const progress = useSpring(target, { stiffness: springs.settle.stiffness, damping: springs.settle.damping })

  useEffect(() => {
    target.set(highest)
  }, [highest, target])

  const [announced, setAnnounced] = useState(0)
  const nearestQuarter = Math.floor(highest * 4) / 4
  if (nearestQuarter > announced) setAnnounced(nearestQuarter)

  const percent = Math.round(highest * 100)
  const style = { '--p': reducedMotion ? highest : progress } as MotionStyle

  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <motion.div
        className={styles.track}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        data-complete={highest >= 1 ? 'true' : undefined}
        style={style}
      >
        <span className={styles.fill} />
        <span className={styles.head} />
      </motion.div>
      <span className="sr-only" aria-live="polite">
        {Math.round(announced * 100)}%
      </span>
    </div>
  )
}
