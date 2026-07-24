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
    const onInputActivity = vi.fn()
    render(
      <DebouncedSearchInput
        ariaLabel="Search clients by name"
        placeholder="Search clients by name..."
        onInputActivity={onInputActivity}
        onQueryChange={onQueryChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Per' } })
    fireEvent.change(input, { target: { value: 'Performance' } })

    expect(input.value).toBe('Performance')
    expect(onInputActivity).toHaveBeenCalledTimes(2)
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(249))
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onQueryChange).toHaveBeenCalledOnce()
    expect(onQueryChange).toHaveBeenCalledWith('Performance')
  })

  it('does not emit when typing settles back to the last emitted query', () => {
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
    fireEvent.change(input, { target: { value: 'P' } })
    fireEvent.change(input, { target: { value: '' } })
    act(() => vi.advanceTimersByTime(250))

    expect(input.value).toBe('')
    expect(onQueryChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Performance' } })
    act(() => vi.advanceTimersByTime(250))
    expect(onQueryChange).toHaveBeenCalledOnce()
    fireEvent.change(input, { target: { value: 'Performance plus' } })
    fireEvent.change(input, { target: { value: 'Performance' } })
    act(() => vi.advanceTimersByTime(250))
    expect(onQueryChange).toHaveBeenCalledOnce()
  })

  it('restores a settled query without re-emitting it after remount', () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    render(
      <DebouncedSearchInput
        ariaLabel="Search clients by name"
        placeholder="Search clients by name..."
        initialValue="Ada"
        onQueryChange={onQueryChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement
    expect(input.value).toBe('Ada')
    fireEvent.change(input, { target: { value: 'Ada' } })
    act(() => vi.advanceTimersByTime(250))

    expect(onQueryChange).not.toHaveBeenCalled()
  })

  it('re-emits the settled query when typing invalidated its in-flight request', () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    const onInputActivity = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false)
    render(
      <DebouncedSearchInput
        ariaLabel="Search clients by name"
        placeholder="Search clients by name..."
        initialValue="Ada"
        onInputActivity={onInputActivity}
        onQueryChange={onQueryChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Search clients by name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ada L' } })
    fireEvent.change(input, { target: { value: 'Ada' } })
    act(() => vi.advanceTimersByTime(250))

    expect(onQueryChange).toHaveBeenCalledOnce()
    expect(onQueryChange).toHaveBeenCalledWith('Ada')
  })
})
