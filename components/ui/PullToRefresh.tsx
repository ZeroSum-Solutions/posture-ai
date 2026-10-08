'use client'

import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { DotsBounce } from './DotsBounce'
import { spring } from '@/lib/motion'
import styles from './PullToRefresh.module.css'

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: ReactNode
  /** Accessible name for the fallback button and the busy region, e.g. "Clients". */
  label: string
  /**
   * The drag gesture is off by default on iOS/iPadOS Safari (no reliable way
   * to tell it apart from the OS's own rubber-banding there) — pass `true`
   * to force it on anyway. The fallback button always works regardless.
   */
  forceDragGesture?: boolean
  className?: string
}

const ARM_DISTANCE = 72
const RESISTANCE_STARTS_AFTER = 12

function applyResistance(distance: number): number {
  if (distance <= RESISTANCE_STARTS_AFTER) return distance
  const over = distance - RESISTANCE_STARTS_AFTER
  return RESISTANCE_STARTS_AFTER + over / (1 + over / 160)
}

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Wraps a scroll region with a springy pull-to-refresh gesture (Today,
 * Clients, Saved — spec §6.1.6). Resistance after 12px, "arms" at 72px,
 * the dot loader morphs into a Spinner while refreshing, and the content
 * springs back with `spring.layout`. A visible "Refresh" button is always
 * present as the accessible path for keyboard, VoiceOver, reduced motion,
 * and iOS, where the drag gesture is off by default.
 */
export function PullToRefresh({ onRefresh, children, label, forceDragGesture = false, className }: PullToRefreshProps) {
  const reducedMotion = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const pull = useMotionValue(0)
  const [refreshing, setRefreshing] = useState(false)
  const dragEnabled = (forceDragGesture || !isIOSSafari()) && !reducedMotion
  const startY = useRef<number | null>(null)
  const dragging = useRef(false)

  const runRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
      animate(pull, 0, spring.layout)
    }
  }, [onRefresh, pull])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!dragEnabled || refreshing) return
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return
    startY.current = event.clientY
    dragging.current = true
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || startY.current === null) return
    const delta = event.clientY - startY.current
    pull.set(delta <= 0 ? 0 : applyResistance(delta))
  }

  function handlePointerEnd() {
    if (!dragging.current) return
    dragging.current = false
    startY.current = null
    if (pull.get() >= ARM_DISTANCE) {
      pull.set(ARM_DISTANCE * 0.6)
      void runRefresh()
    } else {
      animate(pull, 0, spring.layout)
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.fallbackRow}>
        <Button size="sm" variant="tertiary" onClick={() => void runRefresh()} loading={refreshing} haptic={false}>
          Refresh
        </Button>
      </div>
      <motion.div className={styles.indicator} style={{ height: pull }} aria-hidden="true">
        {refreshing ? <Spinner size={24} /> : <DotsBounce size={8} />}
      </motion.div>
      <div
        ref={scrollRef}
        className={styles.scroll}
        role="region"
        aria-label={label}
        aria-busy={refreshing || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {children}
      </div>
    </div>
  )
}
