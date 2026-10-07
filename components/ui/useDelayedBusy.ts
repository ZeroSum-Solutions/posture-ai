'use client'

import { useEffect, useRef, useState } from 'react'
import { busyTiming } from '@/lib/motion'

export interface DelayedBusyOptions {
  /** Wait this long before showing busy UI, so a fast load never flashes a spinner. */
  delay?: number
  /** Once shown, stay visible at least this long, so a loader is never a flicker. */
  min?: number
}

/**
 * Debounces a raw busy flag into the "show after 300ms, stay ≥500ms" contract
 * every springy loader follows (DESIGN.md › Motion, spec §3.10). Defaults come
 * from `lib/motion.ts#busyTiming` so every caller agrees on the timing without
 * repeating the numbers.
 */
export function useDelayedBusy(isBusy: boolean, options: DelayedBusyOptions = {}): boolean {
  const delay = options.delay ?? busyTiming.delayMs
  const min = options.min ?? busyTiming.minVisibleMs
  const [visible, setVisible] = useState(false)
  const shownAt = useRef<number | null>(null)

  useEffect(() => {
    if (isBusy) {
      const showTimer = setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, delay)
      return () => clearTimeout(showTimer)
    }

    if (shownAt.current === null) {
      setVisible(false)
      return
    }

    const elapsed = Date.now() - shownAt.current
    const remaining = Math.max(0, min - elapsed)
    const hideTimer = setTimeout(() => {
      shownAt.current = null
      setVisible(false)
    }, remaining)
    return () => clearTimeout(hideTimer)
  }, [isBusy, delay, min])

  return visible
}
