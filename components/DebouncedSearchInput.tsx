'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

interface DebouncedSearchInputProps {
  ariaLabel: string
  placeholder: string
  onQueryChange: (query: string) => void
  onInputActivity?: () => boolean | void
  initialValue?: string
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
  onInputActivity,
  initialValue = '',
  debounceMs = 250,
  style,
}: DebouncedSearchInputProps) {
  const latestCallback = useRef(onQueryChange)
  const latestActivityCallback = useRef(onInputActivity)
  const pendingTimer = useRef<number | null>(null)
  const lastEmittedValue = useRef(initialValue)
  const requestWasInvalidated = useRef(false)
  const inputElement = useRef<HTMLInputElement>(null)

  useEffect(() => {
    latestCallback.current = onQueryChange
    latestActivityCallback.current = onInputActivity
  }, [onInputActivity, onQueryChange])

  useEffect(() => () => {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
  }, [])

  useEffect(() => {
    // The server-rendered field is visible before React can observe input.
    // Enable it imperatively after hydration so early mobile taps/keystrokes
    // cannot be accepted by the browser and silently missed by this handler.
    if (inputElement.current) inputElement.current.disabled = false
  }, [])

  return (
    <input
      ref={inputElement}
      type="text"
      disabled
      placeholder={placeholder}
      aria-label={ariaLabel}
      defaultValue={initialValue}
      onChange={(event) => {
        // The DOM already owns the visible value. Avoid a React render for every
        // keystroke while a large directory or picker is mounted; only the
        // settled query crosses the component boundary and starts I/O.
        const query = event.currentTarget.value
        if (latestActivityCallback.current?.()) requestWasInvalidated.current = true
        if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
        pendingTimer.current = window.setTimeout(() => {
          pendingTimer.current = null
          // Consumers set their searching/loading state before updating the
          // query atom. Emitting an unchanged settled query would let React bail
          // out of that atom update and strand the consumer in its busy state.
          if (query === lastEmittedValue.current && !requestWasInvalidated.current) return
          requestWasInvalidated.current = false
          lastEmittedValue.current = query
          latestCallback.current(query)
        }, debounceMs)
      }}
      style={style}
    />
  )
}
