'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * True once the nearest enclosing <details> has been opened (or at once when
 * there is none). It stays true after the disclosure closes again, so content
 * mounted on first open keeps its state.
 */
export function useDisclosureOpen<T extends HTMLElement>() {
  const anchorRef = useRef<T>(null)
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    if (opened) return
    const details = anchorRef.current?.closest('details')
    if (!details) {
      setOpened(true)
      return
    }
    const sync = () => {
      if (details.open) setOpened(true)
    }
    sync()
    details.addEventListener('toggle', sync)
    return () => details.removeEventListener('toggle', sync)
  }, [opened])

  return [anchorRef, opened] as const
}
