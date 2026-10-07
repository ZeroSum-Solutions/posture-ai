// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CardSkeleton, ListRowSkeleton, Skeleton } from './Skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('renders every shape without throwing', () => {
    const shapes = ['line', 'row', 'card', 'avatar', 'thumb'] as const
    for (const shape of shapes) {
      const { container, unmount } = render(<Skeleton shape={shape} />)
      expect(container.querySelector('.skeleton')).toBeTruthy()
      unmount()
    }
  })

  it('stacks multiple lines', () => {
    const { container } = render(<Skeleton shape="line" lines={3} />)
    expect(container.querySelectorAll('.skeleton').length).toBe(3)
  })

  it('renders the ListRowSkeleton and CardSkeleton presets', () => {
    const { container: rowContainer } = render(<ListRowSkeleton />)
    expect(rowContainer.querySelectorAll('.skeleton').length).toBe(3)

    const { container: cardContainer } = render(<CardSkeleton />)
    expect(cardContainer.querySelectorAll('.skeleton').length).toBe(3)
  })
})
