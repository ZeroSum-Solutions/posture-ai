// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PullToRefresh } from './PullToRefresh'

afterEach(cleanup)

describe('PullToRefresh', () => {
  it('always renders a visible Refresh button that calls onRefresh', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <PullToRefresh onRefresh={onRefresh} label="Clients">
        <p>List content</p>
      </PullToRefresh>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders the wrapped content inside an accessible region', () => {
    render(
      <PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)} label="Clients">
        <p>List content</p>
      </PullToRefresh>,
    )
    expect(screen.getByRole('region', { name: 'Clients' })).toBeTruthy()
    expect(screen.getByText('List content')).toBeTruthy()
  })
})
