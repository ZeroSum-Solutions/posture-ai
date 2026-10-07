// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

afterEach(cleanup)

describe('TabBar', () => {
  it('renders five labelled links for a practitioner, with Today active', () => {
    navigation.pathname = '/dashboard'
    render(<TabBar clinicalContentEnabled audience="practitioner" />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual([
      'Today', 'Clients', 'Capture', 'Workouts', 'Profile',
    ])

    expect(within(nav).getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('marks the active destination with aria-current and leaves the others unmarked', () => {
    navigation.pathname = '/settings'
    render(<TabBar clinicalContentEnabled audience="practitioner" />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Today' }).hasAttribute('aria-current')).toBe(false)
  })

  it('never marks Capture as the active destination', () => {
    // The capture wizard itself hides the tab bar; an assessment route under
    // the same prefix still shows it and must not mark Capture as current.
    navigation.pathname = '/assessments/abc-123'
    render(<TabBar clinicalContentEnabled audience="practitioner" />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const capture = within(nav).getByRole('link', { name: 'Capture' })
    expect(capture.hasAttribute('aria-current')).toBe(false)
  })

  it('drops Workouts when clinical content is gated off', () => {
    navigation.pathname = '/dashboard'
    render(<TabBar clinicalContentEnabled={false} audience="practitioner" />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).queryByRole('link', { name: 'Workouts' })).toBeNull()
  })

  it('renders nothing on a hidden route', () => {
    navigation.pathname = '/privacy'
    const { container } = render(<TabBar clinicalContentEnabled audience="practitioner" />)
    expect(container.children.length).toBe(0)
  })

  it('renders nothing before an actor is established (public audience)', () => {
    navigation.pathname = '/dashboard'
    const { container } = render(<TabBar clinicalContentEnabled audience="public" />)
    expect(container.children.length).toBe(0)
  })

  it('carries the app-island class so the immersive-route CSS hook still applies', () => {
    navigation.pathname = '/dashboard'
    const { container } = render(<TabBar clinicalContentEnabled audience="practitioner" />)
    expect(container.firstElementChild?.classList.contains('app-island')).toBe(true)
  })
})
