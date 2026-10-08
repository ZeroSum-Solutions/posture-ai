'use client'

import { useRef, useState, type CSSProperties } from 'react'
import DebouncedSearchInput from '../DebouncedSearchInput'
import Icon from '../array/Icon'
import { IconButton } from './IconButton'
import styles from './Field.module.css'

export interface SearchFieldProps {
  /** Accessible name; the field has no visible label (the leading icon carries the affordance). */
  label: string
  /** 'search' gives the field the searchbox role (default 'text'). */
  inputType?: 'text' | 'search'
  placeholder?: string
  onQueryChange: (query: string) => void
  onInputActivity?: () => boolean | void
  onClear?: () => void
  initialValue?: string
  debounceMs?: number
  className?: string
  style?: CSSProperties
}

/**
 * Keystrokes stay local to the DOM input (via `DebouncedSearchInput`) so a
 * long client or exercise list does not rerender per character; only the
 * clear button's visibility crosses into React state, and only on the two
 * moments the field becomes empty or non-empty.
 */
export function SearchField({
  label,
  inputType,
  placeholder = 'Search',
  onQueryChange,
  onInputActivity,
  onClear,
  initialValue = '',
  debounceMs,
  className,
  style,
}: SearchFieldProps) {
  const [hasValue, setHasValue] = useState(initialValue.length > 0)
  const wrapRef = useRef<HTMLDivElement>(null)

  function handleActivity() {
    const input = wrapRef.current?.querySelector('input')
    const isEmpty = !input || input.value.length === 0
    setHasValue(!isEmpty)
    return onInputActivity?.()
  }

  function handleClear() {
    const input = wrapRef.current?.querySelector('input')
    if (input) {
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    }
    setHasValue(false)
    onClear?.()
    onQueryChange('')
  }

  return (
    <div ref={wrapRef} className={[styles.controlWrap, className].filter(Boolean).join(' ')} style={style}>
      <span className={styles.leading}>
        <Icon name="magnifer-linear" size={20} />
      </span>
      <DebouncedSearchInput
        ariaLabel={label}
        type={inputType}
        placeholder={placeholder}
        initialValue={initialValue}
        debounceMs={debounceMs}
        onInputActivity={handleActivity}
        onQueryChange={onQueryChange}
        enterKeyHint="search"
        className={[styles.control, styles.withLeading, hasValue ? styles.withTrailing : ''].filter(Boolean).join(' ')}
      />
      {hasValue ? (
        <span className={styles.trailing}>
          <IconButton icon="close-linear" label="Clear search" variant="plain" onClick={handleClear} haptic={false} />
        </span>
      ) : null}
    </div>
  )
}
