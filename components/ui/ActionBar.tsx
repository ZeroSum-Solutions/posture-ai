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
 * Pinned primary-action container above the tab bar (spec §3.15). Holds up to
 * two Buttons plus an optional reason line for a blocked action, associated
 * with the actions via `aria-describedby` so assistive tech announces why.
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
      {reason && (
        <p id={reasonId} className={`${styles.reason} t-footnote`}>
          {reason}
        </p>
      )}
      <div className={styles.actions} role="group" aria-describedby={reason ? reasonId : undefined}>
        {children}
      </div>
    </div>
  )
}
