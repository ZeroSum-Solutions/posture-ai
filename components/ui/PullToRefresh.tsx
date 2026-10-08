'use client'

import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { haptic } from '@/lib/haptics'
import { spring } from '@/lib/motion'
import { Button } from './Button'
import Lens from './Lens'
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
/** Where the content rests while the refresh runs. */
const HOLD = 52

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
 * Pull to refresh with the Lens (DESIGN.md › Loaders, Motion rule 8). The
 * content follows the finger with growing resistance (transform only); a
 * ghost Lens rises out of the gap, scaling up and winding its reticle as the
 * pull grows. At 72px it arms — the Lens fills volt with a jelly pop and a
 * tap haptic — and on release the content settles to a hold while the Lens
 * runs its loading morph, then springs home with the gesture's velocity.
 * A visible "Refresh" button is always present as the tap equivalent for
 * keyboard, VoiceOver, reduced motion and iOS, where the drag is off.
 */
export function PullToRefresh({ onRefresh, children, label, forceDragGesture = false, className }: PullToRefreshProps) {
  const reducedMotion = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const pull = useMotionValue(0)
  const [refreshing, setRefreshing] = useState(false)
  const [armed, setArmed] = useState(false)
  const dragEnabled = (forceDragGesture || !isIOSSafari()) && !reducedMotion
  const startY = useRef<number | null>(null)
  const dragging = useRef(false)

  const lensScale = useTransform(pull, [0, ARM_DISTANCE], [0.4, 1], { clamp: true })
  const lensOpacity = useTransform(pull, [8, 36], [0, 1], { clamp: true })
  const lensTurn = useTransform(pull, [0, ARM_DISTANCE * 1.6], [-120, 90])
  const lensY = useTransform(pull, v => v / 2 - 16)

  const runRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
      setArmed(false)
      animate(pull, 0, spring.settle)
    }
  }, [onRefresh, pull])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!dragEnabled || refreshing) return
    if ((scrollRef.current?.scrollTop ?? 0) > 0 || window.scrollY > 0) return
    startY.current = event.clientY
    dragging.current = true
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || startY.current === null) return
    const delta = event.clientY - startY.current
    const next = delta <= 0 ? 0 : applyResistance(delta)
    pull.set(next)
    const nowArmed = next >= ARM_DISTANCE
    if (nowArmed !== armed) {
      setArmed(nowArmed)
      if (nowArmed) haptic('tap')
    }
  }

  function handlePointerEnd() {
    if (!dragging.current) return
    dragging.current = false
    startY.current = null
    if (pull.get() >= ARM_DISTANCE) {
      animate(pull, HOLD, { ...spring.settle, velocity: pull.getVelocity() })
      void runRefresh()
    } else {
      setArmed(false)
      animate(pull, 0, { ...spring.settle, velocity: pull.getVelocity() })
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.fallbackRow}>
        <Button size="sm" variant="tertiary" icon="refresh-linear" onClick={() => void runRefresh()} loading={refreshing} haptic={false}>
          Refresh
        </Button>
      </div>
      <div className={styles.stage}>
        <motion.span
          className={styles.indicator}
          style={{ y: lensY, scale: lensScale, opacity: refreshing ? 1 : lensOpacity }}
          data-armed={armed || refreshing ? 'true' : undefined}
          aria-hidden="true"
        >
          <motion.span className={styles.turn} style={{ rotate: refreshing ? 0 : lensTurn }}>
            <Lens size={32} tone={armed || refreshing ? 'volt' : 'ghost'} state={refreshing ? 'loading' : 'idle'} />
          </motion.span>
        </motion.span>
        <motion.div
          ref={scrollRef}
          className={styles.scroll}
          style={{ y: pull }}
          role="region"
          aria-label={label}
          aria-busy={refreshing || undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {children}
        </motion.div>
      </div>
    </div>
  )
}
