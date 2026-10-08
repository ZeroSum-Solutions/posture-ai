'use client'
import { useEffect, useState } from 'react'

/**
 * `innerHeight − visualViewport.height`: the virtual keyboard's height, kept
 * live via the viewport's own `resize` event. Used so a Sheet never grows
 * taller than what's actually visible, and so Toast can clear the keyboard
 * instead of sitting under it (DESIGN.md › 3.8, 3.9; §7.22 keyboard rule).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height))
    update()
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])
  return inset
}
