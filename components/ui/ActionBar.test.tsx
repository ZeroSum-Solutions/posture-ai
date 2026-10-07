// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ActionBar from './ActionBar'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

afterEach(cleanup)

describe('ActionBar', () => {
  it('associates the reason line with the action group via aria-describedby', () => {
    navigation.pathname = '/dashboard'
    render(
      <ActionBar reason="Add a client to start a scan.">
        <button type="button">Start scan</button>
      </ActionBar>,
    )

    const group = screen.getByRole('group')
    const reason = screen.getByText('Add a client to start a scan.')
    expect(group.getAttribute('aria-describedby')).toBe(reason.id)
    expect(reason.id).toBeTruthy()
  })

  it('renders no description hook when there is no reason', () => {
    navigation.pathname = '/dashboard'
    render(
      <ActionBar>
        <button type="button">Start scan</button>
      </ActionBar>,
    )
    expect(screen.getByRole('group').hasAttribute('aria-describedby')).toBe(false)
  })

  it('is not standalone when the tab bar is present', () => {
    navigation.pathname = '/dashboard'
    const { container } = render(
      <ActionBar>
        <button type="button">Start scan</button>
      </ActionBar>,
    )
    expect(container.firstElementChild?.getAttribute('data-standalone')).toBeNull()
  })

  it('is standalone on a route where the tab bar is hidden', () => {
    navigation.pathname = '/onboarding'
    const { container } = render(
      <ActionBar>
        <button type="button">I agree</button>
      </ActionBar>,
    )
    expect(container.firstElementChild?.getAttribute('data-standalone')).toBe('true')
  })

  it('carries the app-actionbar marker class for the chrome-bottom contract', () => {
    navigation.pathname = '/dashboard'
    const { container } = render(
      <ActionBar>
        <button type="button">Start scan</button>
      </ActionBar>,
    )
    expect(container.firstElementChild?.classList.contains('app-actionbar')).toBe(true)
  })
})
