// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TopBar from './TopBar'

afterEach(cleanup)

describe('TopBar', () => {
  it('renders the large title as the page h1', () => {
    render(<TopBar title="Today" />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Today')
  })

  it('renders the collapsed-mode title as the page h1 when large is false', () => {
    render(<TopBar title="Settings" large={false} />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Settings')
  })

  it('names the back control with the supplied label and points it at the href', () => {
    render(<TopBar title="Client" back={{ href: '/clients', label: 'Back to Clients' }} />)
    const back = screen.getByRole('link', { name: 'Back to Clients' })
    expect(back.getAttribute('href')).toBe('/clients')
  })

  it('exposes exactly one reachable back link even though it is duplicated across zones', () => {
    render(<TopBar title="Client" back={{ href: '/clients', label: 'Back to Clients' }} />)
    // getByRole throws on more than one match, so this alone proves there is
    // exactly one in the accessibility tree; the inert copy is excluded.
    expect(screen.getByRole('link', { name: 'Back to Clients' })).toBeTruthy()
  })

  it('exposes exactly one h1 even with a back link and actions', () => {
    render(
      <TopBar
        title="Client"
        back={{ href: '/clients', label: 'Back to Clients' }}
        actions={<span role="button" aria-label="More">⋯</span>}
      />,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
