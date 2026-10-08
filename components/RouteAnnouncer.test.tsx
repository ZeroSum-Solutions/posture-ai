// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let pathname = '/dashboard'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import RouteAnnouncer from './RouteAnnouncer'

function Page() {
  return (
    <main id="main">
      <h1>Title</h1>
      <RouteAnnouncer />
    </main>
  )
}

async function flushFrame() {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
  })
}

describe('RouteAnnouncer', () => {
  beforeEach(() => {
    pathname = '/dashboard'
  })
  afterEach(cleanup)

  it('leaves the heading alone on first paint, even under Strict Mode', async () => {
    const { getByRole } = render(<StrictMode><Page /></StrictMode>)
    await flushFrame()
    const heading = getByRole('heading', { name: 'Title' })
    expect(heading.hasAttribute('tabindex')).toBe(false)
    expect(document.activeElement).not.toBe(heading)
  })

  it('moves focus to the new page heading after a client-side navigation', async () => {
    const { getByRole, rerender } = render(<StrictMode><Page /></StrictMode>)
    pathname = '/clients'
    rerender(<StrictMode><Page /></StrictMode>)
    await flushFrame()
    const heading = getByRole('heading', { name: 'Title' })
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(heading)
  })
})
