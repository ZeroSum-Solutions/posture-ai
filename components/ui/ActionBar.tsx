'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isTabBarHidden } from './tabBarPolicy'
import styles from './ActionBar.module.css'

const KEYBOARD_SHRINK_PX = 120

/** Tracks how far the virtual keyboard has eaten into the viewport, 0 when closed. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  const maxHeightRef = useRef(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    maxHeightRef.current = viewport.height

    const onResize = () => {
      maxHeightRef.current = Math.max(maxHeightRef.current, viewport.height)
      const shrink = maxHeightRef.current - viewport.height
      setInset(shrink > KEYBOARD_SHRINK_PX ? Math.round(shrink) : 0)
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [])

  return inset
}

/**
 * The primary action's home in the thumb zone (DESIGN.md › Actions). No box:
 * a floating row above the dock on a soft canvas fade, so the content scrolls
 * away beneath it instead of being cut by a ruled bar. Each child takes an
 * equal share of the row (one primary = full width). It rises in on mount
 * (transform + opacity). An optional reason line for a blocked action is tied
 * to the actions via `aria-describedby` so assistive tech announces why.
 * When the keyboard opens, the row re-docks just above it.
 *
 * Carries the `app-actionbar` marker class so the shell's chrome-bottom
 * contract (`app/globals.css`) can add `--actionbar-h` to `--chrome-bottom`
 * for scrolling content while this is mounted, via a `:has()` rule — no
 * context or effect needed for that part.
 */
export default function ActionBar({
  children,
  reason,
  className,
}: {
  children: ReactNode
  reason?: string
  className?: string
}) {
  const pathname = usePathname() ?? ''
  const keyboardInset = useKeyboardInset()
  const reasonId = useId()
  const standalone = isTabBarHidden(pathname) || keyboardInset > 0

  const style: CSSProperties | undefined = keyboardInset > 0 ? { bottom: keyboardInset } : undefined

  return (
    <div
      className={[styles.bar, 'app-actionbar', className].filter(Boolean).join(' ')}
      data-standalone={standalone ? 'true' : undefined}
      style={style}
    >
      <span className={styles.fade} aria-hidden="true" />
      {reason && (
        <p id={reasonId} className={styles.reason}>
          {reason}
        </p>
      )}
      <div className={styles.actions} role="group" aria-describedby={reason ? reasonId : undefined}>
        {children}
      </div>
    </div>
  )
}
