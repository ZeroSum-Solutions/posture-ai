'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

interface DebouncedSearchInputProps {
  ariaLabel: string
  placeholder: string
  onQueryChange: (query: string) => void
  debounceMs?: number
  style?: CSSProperties
}

/**
 * Keep keystrokes local to the input so large result pages do not rerender on
 * every character. The parent receives only the settled query used for I/O.
 */
export default function DebouncedSearchInput({
  ariaLabel,
  placeholder,
  onQueryChange,
  debounceMs = 250,
  style,
}: DebouncedSearchInputProps) {
  const latestCallback = useRef(onQueryChange)
  const pendingTimer = useRef<number | null>(null)
  const lastEmittedValue = useRef('')

  useEffect(() => {
    latestCallback.current = onQueryChange
  }, [onQueryChange])

  useEffect(() => () => {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
  }, [])

  return (
    <input
      type="text"
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => {
        // The DOM already owns the visible value. Avoid a React render for every
        // keystroke while a large directory or picker is mounted; only the
        // settled query crosses the component boundary and starts I/O.
        const query = event.currentTarget.value
        if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
        pendingTimer.current = window.setTimeout(() => {
          pendingTimer.current = null
          // Consumers set their searching/loading state before updating the
          // query atom. Emitting an unchanged settled query would let React bail
          // out of that atom update and strand the consumer in its busy state.
          if (query === lastEmittedValue.current) return
          lastEmittedValue.current = query
          latestCallback.current(query)
        }, debounceMs)
      }}
      style={style}
    />
  )
}
