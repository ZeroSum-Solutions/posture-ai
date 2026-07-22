'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

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
  const [value, setValue] = useState('')
  const latestCallback = useRef(onQueryChange)
  const lastEmittedValue = useRef('')

  useEffect(() => {
    latestCallback.current = onQueryChange
  }, [onQueryChange])

  useEffect(() => {
    if (value === lastEmittedValue.current) return
    const timer = window.setTimeout(() => {
      lastEmittedValue.current = value
      latestCallback.current(value)
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [debounceMs, value])

  return (
    <input
      type="text"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      style={style}
    />
  )
}
