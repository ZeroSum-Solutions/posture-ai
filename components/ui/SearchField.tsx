'use client'

import { useRef, useState, type CSSProperties, type FocusEvent } from 'react'
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
  /** While focused, a quiet "Cancel" slides in from the right (iOS pattern). Default true. */
  cancelable?: boolean
  /** Fires after Cancel clears and blurs the field. */
  onCancel?: () => void
  initialValue?: string
  debounceMs?: number
  className?: string
  style?: CSSProperties
}

/**
 * v4 search: a 52px pill. Focus lights the volt edge and slides a quiet
 * "Cancel" in from the right (the slot's width springs open, so the pill
 * gives way); a clear button pops in once there is text. Keystrokes stay
 * local to the DOM input (via `DebouncedSearchInput`) so a long list does not
 * rerender per character; only focus and empty/non-empty cross into React.
 */
export function SearchField({
  label,
  inputType,
  placeholder = 'Search',
  onQueryChange,
  onInputActivity,
  onClear,
  cancelable = true,
  onCancel,
  initialValue = '',
  debounceMs,
  className,
  style,
}: SearchFieldProps) {
  const [hasValue, setHasValue] = useState(initialValue.length > 0)
  const [active, setActive] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  function input() {
    return wrapRef.current?.querySelector('input') ?? null
  }

  function handleActivity() {
    const el = input()
    setHasValue(Boolean(el && el.value.length > 0))
    return onInputActivity?.()
  }

  function emptyField() {
    const el = input()
    if (el) {
      el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setHasValue(false)
    onClear?.()
    onQueryChange('')
  }

  function handleClear() {
    emptyField()
    input()?.focus()
  }

  function handleCancel() {
    if (hasValue) emptyField()
    input()?.blur()
    setActive(false)
    onCancel?.()
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false)
  }

  return (
    <div
      ref={wrapRef}
      className={[styles.search, className].filter(Boolean).join(' ')}
      style={style}
      data-active={cancelable && active ? 'true' : 'false'}
      onFocus={() => setActive(true)}
      onBlur={handleBlur}
    >
      <div className={styles.controlWrap}>
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
          className={[styles.control, styles.searchControl, hasValue ? styles.withTrailing : ''].filter(Boolean).join(' ')}
        />
        {hasValue ? (
          <span className={[styles.trailing, styles.clearIn].join(' ')}>
            <IconButton icon="close-linear" label="Clear search" variant="plain" onClick={handleClear} haptic={false} />
          </span>
        ) : null}
      </div>
      {cancelable ? (
        <div className={styles.cancelSlot}>
          <button
            type="button"
            className={styles.cancel}
            aria-hidden={active ? undefined : true}
            tabIndex={active ? 0 : -1}
            inert={!active}
            // Keep focus in the field until the click lands (iOS blurs on tap).
            onPointerDown={event => event.preventDefault()}
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
