// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DebouncedSearchInput from './DebouncedSearchInput'

describe('DebouncedSearchInput', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('updates the visible value immediately and emits only the settled query', () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    render(
      <DebouncedSearchInput
        ariaLabel="Search clients by name"
        placeholder="Search clients by name..."
        onQueryChange={onQueryChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Per' } })
    fireEvent.change(input, { target: { value: 'Performance' } })

    expect(input.value).toBe('Performance')
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(249))
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onQueryChange).toHaveBeenCalledOnce()
    expect(onQueryChange).toHaveBeenCalledWith('Performance')
  })
})
