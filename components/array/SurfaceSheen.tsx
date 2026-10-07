'use client'
import { useEffect, useRef } from 'react'
import styles from './SurfaceSheen.module.css'

/**
 * Hero sheen for a feature-tier Surface (`sheen` prop): a pointer-tracked
 * radial highlight that reads as glass catching light. Opacity-only — it never
 * moves the card or anything inside it. Fine pointers (mouse/pen) track
 * continuously; a coarse (touch) pointer only repositions it on touch-down,
 * since tracking a drag would just chase the user's scroll gesture. Off
 * entirely under `prefers-reduced-motion`: this is pure delight, not
 * information, so reduced motion means no listeners at all, not a slower one.
 */
export function SurfaceSheen() {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) return
    // Guard the call itself, not just its result: unlike most DOM APIs,
    // `matchMedia` is absent outright in this project's jsdom test
    // environment (confirmed by probe), so `?.()` alone still throws on the
    // `.matches` access that follows it.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const setPos = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      el.style.setProperty('--my', `${e.clientY - rect.top}px`)
      el.style.opacity = '1'
    }
    const onMove = (e: PointerEvent) => {
      // Touch updates only land on pointerdown below — a continuously
      // tracked sheen under a finger would just follow the scroll gesture.
      if (e.pointerType === 'touch') return
      setPos(e)
    }
    const onLeave = () => { el.style.opacity = '0' }

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', setPos)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', setPos)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <span ref={ref} aria-hidden="true" className={styles.sheen} />
}
