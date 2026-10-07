// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchField } from './SearchField'

afterEach(cleanup)

describe('SearchField', () => {
  it('has no clear button until text is entered, then clears on click', () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    render(<SearchField label="Search clients" onQueryChange={onQueryChange} />)

    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

    const input = screen.getByRole('textbox', { name: 'Search clients' })
    fireEvent.change(input, { target: { value: 'Ada' } })

    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clearButton)

    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    vi.useRealTimers()
  })
})
