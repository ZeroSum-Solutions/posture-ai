// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListGroup, ListRow } from './ListRow'

afterEach(cleanup)

describe('ListRow', () => {
  it('renders an <a> when given href', () => {
    render(<ListRow href="/clients/1" title="Jordan Pierce" />)
    const link = screen.getByRole('link', { name: 'Jordan Pierce' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/clients/1')
  })

  it('renders a <button> when given onPress, and fires it', () => {
    const onPress = vi.fn()
    render(<ListRow onPress={onPress} title="Open filters" />)
    const button = screen.getByRole('button', { name: 'Open filters' })
    expect(button.tagName).toBe('BUTTON')
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('renders a plain, non-interactive row when neither href nor onPress is given', () => {
    render(<ListRow title="Static summary" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Static summary')).toBeTruthy()
  })

  it('shows subtitle and trailing content', () => {
    render(<ListRow title="Tara Nkemelu" subtitle="Overdue · 42 days" trailing={<span>3</span>} />)
    expect(screen.getByText('Overdue · 42 days')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('ListGroup renders rows inside a ul/li with the group aria-label', () => {
    render(
      <ListGroup label="Recent clients">
        <ListRow href="/clients/1" title="Jordan Pierce" />
        <ListRow href="/clients/2" title="Tara Nkemelu" />
      </ListGroup>,
    )
    const list = screen.getByRole('list', { name: 'Recent clients' })
    expect(list.tagName).toBe('UL')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
