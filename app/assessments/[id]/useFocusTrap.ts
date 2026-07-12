import { useEffect, useRef } from 'react'

/**
 * Focus trap for modal dialogs (mirrors FullScreenCapture, SC 2.1.2 / 2.4.3):
 *  - on open, moves focus into the container,
 *  - keeps Tab (and Shift+Tab) cycling within it,
 *  - on close/unmount, restores focus to the element that opened it.
 *
 * Attach the returned ref to the dialog element (give it tabIndex={-1} so the
 * container itself can receive focus as a fallback).
 */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'))

    // Move focus into the dialog (first focusable control, else the container).
    ;(focusable()[0] ?? root).focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [])

  return ref
}
